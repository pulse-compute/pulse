'use strict';
// R06: real compiled wasm32 calls, checked by an independent host oracle.
// --viceroy additionally executes the same probe on the explicit local engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'wasm/test/fixtures/projects/fastly-compute-reality/dynamic-backend-abi.as.ts');
const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function compile(directory, dynamic, ca = '') {
  const name = dynamic ? (ca ? 'tls' : 'dynamic') : 'static';
  const source = fs.readFileSync(fixture, 'utf8').replace('const DYNAMIC: bool = true;', `const DYNAMIC: bool = ${dynamic};`)
    .replace('const CA: string = "";', `const CA: string = ${JSON.stringify(ca)};`);
  const file = path.join(directory, name + '.ts'), wasmFile = path.join(directory, name + '.wasm');
  fs.writeFileSync(file, source);
  const asc = require('../../packages/build-support/src/assemblyscript-compile.js').resolveAsc(path.join(root, 'wasm/packages/compiler'));
  assert(asc, 'Lockfile-pinned AssemblyScript is required');
  const result = spawnSync(asc.executable, [asc.script, path.basename(file), '--outFile', wasmFile, '--runtime', 'stub',
    '--optimize', '--noAssert', '--use', `abort=${name}/abort`], { cwd: directory, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const bytes = fs.readFileSync(wasmFile), module = new WebAssembly.Module(bytes);
  assert.equal(WebAssembly.Module.imports(module).some(x => x.name === 'register_dynamic_backend'), dynamic,
    'A disabled probe must have no dynamic registration import');
  return { wasmFile, module, bytes: bytes.length, sha256: hash(bytes), compiler: require(path.join(asc.packageRoot, 'package.json')).version };
}

function strictHost(compiled, options = {}) {
  let instance, next = 10, downstream, registrations = 0;
  const requests = new Map(), bodies = new Map(), pending = new Map(), backends = new Map();
  const calls = [], waits = [], closed = [];
  const headers = { 'x-r06-target-a': 'alpha.test:8080', 'x-r06-target-b': 'beta.test:8081',
    'x-r06-host-a': 'alpha.test:8080', 'x-r06-host-b': 'beta.test:8081', ...options.headers };
  const memory = () => instance.exports.memory.buffer;
  const view = () => new DataView(memory());
  const put = (p, x) => view().setUint32(p, x, true);
  const text = (p, n) => Buffer.from(memory(), p, n).toString('utf8');
  const write = (p, value) => Buffer.from(memory()).set(Buffer.from(value), p);
  const host = {
    fastly_abi: { init(v) { assert.equal(v, 1n); return 0; } },
    fastly_http_req: {
      register_dynamic_backend(np, nl, tp, tl, mask, config) {
        registrations++;
        assert.equal(config % 4, 0);
        const words = Array.from({ length: 27 }, (_, i) => view().getUint32(config + i * 4, true));
        const field = offset => text(words[offset / 4], words[offset / 4 + 1]);
        const name = text(np, nl), target = text(tp, tl), override = field(0);
        assert.equal(words[2], 1000); assert.equal(words[3], 1000); assert.equal(words[4], 1000);
        assert(words.slice(15).every(x => x === 0), 'Unused current ABI tail must be zero');
        const ssl = (mask & 32) !== 0;
        assert.equal(mask & ~1, ssl ? 2366 : 30, 'Independent flag-bit oracle');
        if (ssl) { assert.equal(field(52), 'localhost'); assert.equal(field(28), headers['x-r06-case'] === 'mismatched-tls' ? 'wrong.invalid' : 'localhost'); }
        else assert(words.slice(5).every(x => x === 0), 'HTTP must not carry TLS settings');
        calls.push({ name, target, override, ssl, mask });
        if (mask & 1 || override === '' || headers['x-r06-case'] === 'mismatched-tls') return 2;
        if (options.registerStatus) return options.registerStatus;
        if (backends.has(name)) return 1;
        backends.set(name, { target, override }); return 0;
      },
      body_downstream_get(r, b) { put(r, 1); put(b, 2); return 0; },
      header_value_get(req, p, n, dest, max, written) { const value = headers[text(p, n)]; if (value === undefined) return 10;
        assert(Buffer.byteLength(value) <= max); write(dest, value); put(written, Buffer.byteLength(value)); return 0; },
      new(p) { const id = next++; requests.set(id, {}); put(p, id); return 0; },
      method_set(req, p, n) { assert.equal(text(p, n), 'GET'); return 0; },
      uri_set(req, p, n) { requests.get(req).url = text(p, n); return 0; },
      header_insert() { return 0; },
      header_append() { return 0; },
      send_async(req, body, p, n, out) { const name = text(p, n); assert(backends.has(name) || name.startsWith('r06-static-'));
        const id = next++; pending.set(id, requests.get(req).url.endsWith('/alpha') ? 'alpha' : 'beta'); put(out, id); return 0; },
      pending_req_wait(id, resp, body) { assert(pending.has(id)); waits.push(pending.get(id)); const b = next++; bodies.set(b, pending.get(id)); pending.delete(id); put(resp, next++); put(body, b); return 0; }
    },
    fastly_http_resp: { new(p) { put(p, next++); return 0; }, send_downstream(resp, body, streaming) { assert.equal(streaming, 0); downstream = bodies.get(body); return 0; } },
    fastly_http_body: {
      new(p) { const id = next++; bodies.set(id, ''); put(p, id); return 0; },
      read(id, p, max, written) { const value = bodies.get(id); assert.notEqual(value, undefined); assert(Buffer.byteLength(value) <= max);
        write(p, value); put(written, Buffer.byteLength(value)); bodies.set(id, ''); return 0; },
      write(id, p, n, end, written) { bodies.set(id, text(p, n)); put(written, n); return 0; },
      close(id) { closed.push(id); bodies.delete(id); return 0; }
    }
  };
  instance = new WebAssembly.Instance(compiled.module, host);
  return { instance, calls, waits, closed, run() { instance.exports._start(); return downstream; }, get registrations() { return registrations; }, get pending() { return pending.size; } };
}

async function localProof(directory, dynamic, staticControl) {
  const binary = process.env.PULSE_VICEROY_BIN;
  assert(binary, '--viceroy requires explicit PULSE_VICEROY_BIN; no mock fallback');
  const launcher = cli.inspectFastlyComputeLauncher({ viceroyBinary: binary, required: true });
  assert.equal(launcher.viceroyInspection.version, '0.21.1', 'Review another host version before admission');
  const key = path.join(directory, 'key.pem'), cert = path.join(directory, 'cert.pem');
  const ca = path.join(directory, 'ca.pem'), caKey = path.join(directory, 'ca-key.pem'), csr = path.join(directory, 'server.csr');
  function openssl(args) {
    const made = spawnSync('openssl', args, { encoding: 'utf8', timeout: 10000 });
    assert.equal(made.status, 0, 'Local TLS proof requires OpenSSL: ' + made.stderr);
  }
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=R06 test CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', caKey, '-out', ca]);
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', key, '-out', csr]);
  const extensions = path.join(directory, 'server.ext');
  fs.writeFileSync(extensions, 'basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n');
  openssl(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-days', '1', '-extfile', extensions, '-out', cert]);
  const tlsProbe = compile(directory, true, fs.readFileSync(ca, 'utf8'));
  let arrivals = [], completions = [], alphaResponse, betaResponse;
  const observed = [];
  function handler(req, res) {
    const id = req.url === '/alpha' ? 'alpha' : 'beta'; arrivals.push(id);
    observed.push({ id, host: req.headers.host, sni: req.socket.servername || null });
    res.on('finish', () => completions.push(id));
    if (id === 'alpha') alphaResponse = res;
    else betaResponse = res;
    // Either origin may receive first. Neither can finish until both requests
    // have arrived; finish beta before releasing alpha without a timing race.
    if (alphaResponse && betaResponse) {
      const a = alphaResponse, b = betaResponse; alphaResponse = null; betaResponse = null;
      b.once('finish', () => a.end('alpha')); b.end('beta');
    }
  }
  const servers = [http.createServer(handler), http.createServer(handler), https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, handler)];
  let compute;
  const checks = [];
  const stopped = [];
  async function stopCompute() {
    if (!compute) return;
    await compute.stop();
    assert(compute.child.exitCode !== null || compute.child.signalCode, 'Viceroy must be terminal');
    stopped.push({ exitCode: compute.child.exitCode, signal: compute.child.signalCode }); compute = null;
  }
  async function launch(probe, backends = {}) {
    await stopCompute();
    const manifestFile = path.join(directory, 'fastly.toml');
    fs.writeFileSync(manifestFile, cli.renderFastlyLocalConfig({ name: 'r06-dynamic-backend-abi', backends }));
    compute = await cli.startFastlyComputeServe({ launcher, packageRoot: directory, wasmFile: probe.wasmFile, manifestFile, startTimeoutMs: 15000, stopTimeoutMs: 3000 });
  }
  async function request(name, headers, expected) {
    arrivals = []; completions = []; observed.length = 0; alphaResponse = null; betaResponse = null;
    const response = await fetch(compute.baseUrl, { headers, signal: AbortSignal.timeout(5000) });
    const text = await response.text(); assert.equal(text, expected, `${name}: ${text}\n${compute.logs.stderr}\n${compute.logs.stdout}`); checks.push(name);
    return [...observed];
  }
  try {
    for (const server of servers) { server.listen(0); await once(server, 'listening'); }
    const target = servers.map(s => `localhost:${s.address().port}`);
    const headers = { 'x-r06-target-a': target[0], 'x-r06-target-b': target[1], 'x-r06-host-a': target[0], 'x-r06-host-b': target[1] };
    await launch(dynamic);
    const found = await request('two-runtime-origins', headers, 'alpha|beta');
    assert.deepEqual([...arrivals].sort(), ['alpha', 'beta']); assert.deepEqual(completions, ['beta', 'alpha']);
    assert.deepEqual(found.sort((a, b) => a.id.localeCompare(b.id)).map(x => x.host), target.slice(0, 2));
    await request('fresh-request-same-names', headers, 'alpha|beta');
    await request('same-origin-reuse', { ...headers, 'x-r06-target-b': target[0], 'x-r06-host-b': target[0] }, 'alpha|beta');
    await request('duplicate-name-rejected', { ...headers, 'x-r06-case': 'duplicate' }, 'duplicate:1');
    await request('reserved-mask-rejected', { ...headers, 'x-r06-case': 'reserved-mask' }, 'register:2');
    await request('empty-host-rejected', { ...headers, 'x-r06-host-a': '' }, 'register:2');
    await launch(tlsProbe);
    const tlsHeaders = { 'x-r06-target-a': target[2], 'x-r06-target-b': target[2], 'x-r06-host-a': target[2], 'x-r06-host-b': target[2], 'x-r06-tls': '1', 'x-r06-tls-name': 'localhost' };
    const secured = await request('tls-ca-host-sni', tlsHeaders, 'alpha|beta');
    assert(secured.every(x => x.host === target[2] && x.sni === 'localhost'));
    await request('mismatched-cert-sni-rejected', { ...tlsHeaders, 'x-r06-case': 'mismatched-tls' }, 'register:2');
    await request('wrong-certificate-host-rejected', { ...tlsHeaders, 'x-r06-tls-name': 'wrong.invalid' }, 'wait:1:1');
    assert.equal(arrivals.length, 0, 'Hostname verification must fail before an HTTP request reaches the origin');
    await launch(dynamic);
    await request('untrusted-ca-rejected', tlsHeaders, 'wait:1:1');
    assert.equal(arrivals.length, 0, 'An untrusted certificate must not reach the HTTP application');
    await launch(dynamic, { 'pulse-r06-0': { url: `http://${target[0]}` } });
    await request('static-name-collision-rejected', headers, 'register:1');
    await launch(staticControl, { 'r06-static-0': { url: `http://${target[0]}`, overrideHost: target[0] }, 'r06-static-1': { url: `http://${target[1]}`, overrideHost: target[1] } });
    await request('disabled-static-control', headers, 'alpha|beta');
    return { status: 'passed', checks, engine: launcher.viceroyInspection.version, binarySha256: hash(fs.readFileSync(binary)),
      openssl: spawnSync('openssl', ['version'], { encoding: 'utf8' }).stdout.trim(), tlsArtifactSha256: tlsProbe.sha256,
      testCaSha256: hash(fs.readFileSync(ca)), stopped, cleanup: 'passed', testCaOnly: true, hosted: 'not-run' };
  } finally {
    await stopCompute();
    for (const server of servers) { server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  }
}

function prove(directory) {
    const dynamic = compile(directory, true), control = compile(directory, false);
    let cells = 0;
    for (const compiled of [dynamic, control]) { const host = strictHost(compiled); assert.equal(host.run(), 'alpha|beta'); assert.deepEqual(host.waits, ['beta', 'alpha']); assert.equal(host.pending, 0); assert.equal(host.closed.length, 2); cells++; }
    const same = strictHost(dynamic, { headers: { 'x-r06-target-b': 'alpha.test:8080', 'x-r06-host-b': 'alpha.test:8080' } });
    assert.equal(same.run(), 'alpha|beta'); assert.equal(same.registrations, 1); cells++;
    const tls = strictHost(dynamic, { headers: { 'x-r06-tls': '1', 'x-r06-tls-name': 'localhost' } }); assert.equal(tls.run(), 'alpha|beta'); cells++;
    for (const [headers, expected] of [[{ 'x-r06-case': 'duplicate' }, 'duplicate:1'], [{ 'x-r06-case': 'reserved-mask' }, 'register:2'],
      [{ 'x-r06-host-a': '' }, 'register:2'], [{ 'x-r06-tls': '1', 'x-r06-tls-name': 'localhost', 'x-r06-case': 'mismatched-tls' }, 'register:2']]) {
      const host = strictHost(dynamic, { headers }); assert.equal(host.run(), expected); assert.equal(host.waits.length, 0); cells++;
    }
    for (const registerStatus of [1, 5, 13]) { const host = strictHost(dynamic, { registerStatus }); assert.equal(host.run(), 'register:' + registerStatus); assert.equal(host.pending, 0); cells++; }
    const bounded = strictHost(dynamic); assert.equal(bounded.instance.exports.probeBound(33), 1001); assert.equal(bounded.registrations, 32); cells++;
    const failedBound = strictHost(dynamic, { registerStatus: 5 }); assert.equal(failedBound.instance.exports.probeFailures(33), 1001); assert.equal(failedBound.registrations, 32); cells++;
    return { dynamic, control, cells };
}
function observation({ dynamic, control, cells }, localResult) {
    return { schemaVersion: 'pulse.r06-dynamic-backend-proof.v1', status: 'passed', claim: 'standalone ABI experiment; Pulse Native support remains R07',
      compiler: dynamic.compiler, strictCells: cells, dynamic: { bytes: dynamic.bytes, sha256: dynamic.sha256 }, staticControl: { bytes: control.bytes, sha256: control.sha256 },
      standaloneProbeDeltaBytes: dynamic.bytes - control.bytes, local: localResult };
}
function proveStrict() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-r06-dynamic-abi-'));
  try {
    const result = observation(prove(directory), { status: 'not-selected', hosted: 'not-run' });
    console.log(JSON.stringify(result)); return result;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function main() {
  assert(process.argv.slice(2).every(x => x === '--viceroy'), 'Only --viceroy is supported');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-r06-dynamic-abi-'));
  try {
    const proven = prove(directory);
    const localResult = process.argv.includes('--viceroy') ? await localProof(directory, proven.dynamic, proven.control) : { status: 'not-selected', hosted: 'not-run' };
    const result = observation(proven, localResult);
    if (process.env.R06_PROOF_FILE) fs.writeFileSync(process.env.R06_PROOF_FILE, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { proveStrict };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
