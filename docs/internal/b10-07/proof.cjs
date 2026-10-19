'use strict';
// Private protocol/representation experiment; does not install a public resource API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { gzipSync } = require('node:zlib');
const { hash, range, catalogue, execution, LIMITS } = require('./model.cjs');
const root = path.resolve(__dirname, '../../..');
const { resolveAsc } = require('../../../wasm/packages/build-support/src/assemblyscript-compile.js');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const cases = [];
let checkpointFile;
let checkpoint;
const persist = () => fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
function check(name, run) { run(); cases.push({ name, status: 'passed' }); }
function binary(length) {
  const bytes = Buffer.alloc(length); let state = 0x12345678;
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; bytes[i] = state & 255;
  }
  return bytes;
}
function vector() {
  const bytes = Buffer.alloc(16 + 32 * 8 * 4);
  bytes.write('PVB1'); bytes.writeUInt32LE(32, 4); bytes.writeUInt32LE(8, 8); bytes.writeUInt32LE(1024, 12);
  for (let row = 0; row < 32; row++) for (let d = 0; d < 8; d++) bytes.writeFloatLE((row - 7) / 4 + d / 8, 16 + (row * 8 + d) * 4);
  return bytes;
}
function compile(bytes, mode, directory, fastly = false) {
  const asc = resolveAsc(path.join(root, 'wasm/packages/compiler')); assert(asc, 'Restore lockfile-pinned AssemblyScript first');
  let storage;
  if (mode === 'raw') storage = `const DATA: usize = memory.data<u8>([${[...bytes].join(',')}]);
    function byteAt(offset: i32): u8 { return load<u8>(DATA + offset); }`;
  else if (mode === 'base64') storage = `const DATA: string = ${JSON.stringify(bytes.toString('base64'))};
    function digit(code: i32): i32 {
      return code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 71
        : code >= 48 && code <= 57 ? code + 4 : code == 43 ? 62 : 63;
    }
    function byteAt(offset: i32): u8 {
      const group = (offset / 3) * 4, part = offset % 3;
      const a = digit(DATA.charCodeAt(group + part));
      const b = digit(DATA.charCodeAt(group + part + 1));
      return u8(part == 0 ? (a << 2) | (b >> 4) : part == 1 ? (a << 4) | (b >> 2) : (a << 6) | b);
    }`;
  else storage = `let DATA: usize = 0;
    export function prepare(): usize { DATA = heap.alloc(LENGTH); memory.fill(DATA, 0, LENGTH); return DATA; }
    function byteAt(offset: i32): u8 { return load<u8>(DATA + offset); }`;
  const guest = fs.readFileSync(path.join(__dirname, 'guest.as.ts'), 'utf8');
  const source = `const LENGTH: i32 = ${bytes.length};\n${storage}\n${guest}\n${fastly ? fastlyDriver() : ''}`;
  const name = `${mode}-${bytes.length}${fastly ? '-fastly' : ''}`;
  const input = path.join(directory, `${name}.ts`), output = path.join(directory, `${name}.wasm`);
  fs.writeFileSync(input, source);
  execFileSync(asc.executable, [asc.script, input, '--outFile', output, '--runtime', 'stub',
    '--optimize', '--noAssert', '--use', 'abort=', '--maximumMemory', '64'],
  { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const wasm = fs.readFileSync(output), module = new WebAssembly.Module(wasm);
  const imports = WebAssembly.Module.imports(module);
  assert(fastly || imports.length === 0, 'Private mapped guest must have no runtime host dependency');
  return { file: output, wasm, bytes: wasm.length, gzipBytes: gzipSync(wasm).length,
    sha256: hash(wasm), sourceSha256: hash(source), imports };
}
function fastlyDriver() {
  return `
@external('fastly_abi', 'init') declare function abi_init(version: i64): void;
@external('fastly_http_resp', 'new') declare function response_new(out: usize): i32;
@external('fastly_http_body', 'new') declare function body_new(out: usize): i32;
@external('fastly_http_body', 'write') declare function body_write(body: i32, ptr: usize, len: i32, end: i32, out: usize): i32;
@external('fastly_http_resp', 'send_downstream') declare function send(response: i32, body: i32, streaming: i32): i32;
const SCRATCH: usize = memory.data<u8>([0,0,0,0,0,0,0,0]);
// Existing injected-host diagnostic hook, not a new resource operation.
export function pulse_fastly_last_error(): i32 { return last_error(); }
export function _start(): void {
  abi_init(1);
  const token = begin();
  // Compute in the guest and return one fixed JSON-independent byte: nearest row 7.
  let best: i32 = -1; let minimum: f64 = Infinity;
  for (let row = 0; row < 32; row++) {
    const score = distance(token, row, 8); if (last_error()) unreachable();
    if (score < minimum) { minimum = score; best = row; }
  }
  if (best != 7 || u32le(token, 0) != 0x31425650) unreachable();
  close();
  if (response_new(SCRATCH)) unreachable(); const response = load<i32>(SCRATCH);
  if (body_new(SCRATCH)) unreachable(); const body = load<i32>(SCRATCH);
  store<u8>(SCRATCH, u8(best));
  if (body_write(body, SCRATCH, 1, 0, SCRATCH + 1)) unreachable();
  if (send(response, body, 0)) unreachable();
}`;
}
async function main() {
  const { createEmbeddedManifest } = await import(pathToFileURL(path.join(root, 'packages/assets/dist/embedded.js')));
  const out = fs.mkdtempSync(path.join(root, 'wasm/.test-results/b10-07-'));
  checkpointFile = path.join(out, 'results.json');
  checkpoint = { status: 'running', cases, measurements: [] }; persist();
  const generic = Buffer.from([0, 255, 192, 128, 254, 1, 0, 127, 128, 255]);
  const vectors = vector();
  fs.writeFileSync(path.join(out, 'vector.bin'), vectors); fs.writeFileSync(path.join(out, 'payload.bin'), generic);
  const manifest = await createEmbeddedManifest([{ path: '/vector.bin', bytes: vectors },
    { path: '/payload.bin', bytes: generic }, { path: '/empty.bin', bytes: Buffer.alloc(0) }]);
  const serialized = JSON.stringify(manifest);
  const declarations = [{ id: 'vectors', path: '/vector.bin' }, { id: 'payload', path: '/payload.bin' }, { id: 'empty', path: '/empty.bin' }];
  const catalog = catalogue(serialized, declarations);
  check('proposed public syntax is not accepted by the production compiler', () => {
    const { compileCanonicalSource } = require('../../../wasm/packages/compiler/src/canonical-api-compiler.js');
    const { buildCanonicalNativePlan } = require('../../../wasm/packages/compiler/src/canonical-native-plan.js');
    assert.throws(() => buildCanonicalNativePlan(compileCanonicalSource(`export default async function handler(ctx) {
      const bytes = ctx.resources.map('vectors'); return ctx.json(bytes.readU8(0));
    }`, { fileName: 'not-yet-public.ts', strict: false })), { code: 'PULSE_CANONICAL_NATIVE_PLAN_FAILED' });
  });
  check('manifest identity independent of logical declaration order', () => {
    assert.equal(catalog.identity, catalogue(serialized, [...declarations].reverse()).identity);
    assert.notEqual(catalog.identity, catalogue(serialized, declarations.slice(0, 2)).identity);
  });
  for (const [name, mutate] of [
    ['hash', m => m.files[0].sha256 = '0'.repeat(64)],
    ['identity', m => m.id = '0'.repeat(64)],
    ['length', m => m.files[1].byteLength++],
    ['truncation', m => m.files[1].data = m.files[1].data.slice(0, -4)],
    ['noncanonical base64', m => m.files[1].data += '\n']
  ]) check(`reject corrupt manifest ${name}`, () => {
    const invalid = structuredClone(manifest); mutate(invalid);
    assert.throws(() => catalogue(JSON.stringify(invalid), declarations), { code: 'RESOURCE_INTEGRITY' });
  });
  check('reject missing, duplicate and path-like logical identities', () => {
    assert.throws(() => catalogue(serialized, [{ id: 'absent', path: '/absent' }]), { code: 'RESOURCE_MISSING' });
    assert.throws(() => catalogue(serialized, [declarations[0], declarations[0]]), { code: 'RESOURCE_DECLARATION' });
    assert.throws(() => catalogue(serialized, [{ id: '../secret', path: '/vector.bin' }]), { code: 'RESOURCE_DECLARATION' });
  });
  const runtime = execution(catalog), genericView = runtime.map('payload');
  check('generic bytes preserved without text decoding', () => assert.deepEqual(
    Buffer.from([...generic].map((_, i) => runtime.u8(genericView, i))), generic));
  for (const offset of [-1, 0.5, NaN, Infinity, 10, Number.MAX_SAFE_INTEGER]) {
    check(`JS bounds ${String(offset)}`, () => assert.throws(() => runtime.u8(genericView, offset), { code: 'RESOURCE_BOUNDS' }));
  }
  check('empty and end-exclusive range arithmetic', () => {
    range(0, 0, 0); range(10, 10, 0);
    assert.throws(() => range(10, 1, Number.MAX_SAFE_INTEGER), { code: 'RESOURCE_BOUNDS' });
    assert.throws(() => runtime.u8(runtime.map('empty'), 0), { code: 'RESOURCE_BOUNDS' });
  });
  check('unaligned explicit little-endian word', () => assert.equal(runtime.u32LE(genericView, 1), generic.readUInt32LE(1)));
  check('foreign and forged views rejected', () => {
    const other = execution(catalog);
    assert.throws(() => other.u8(genericView, 0), { code: 'RESOURCE_OWNER' });
    assert.throws(() => runtime.u8({ byteLength: generic.length }, 0), { code: 'RESOURCE_OWNER' }); other.close();
  });
  const supplied = new Map([...catalog.entries].map(([id, e]) => [id, Uint8Array.from(e.bytes)]));
  check('host snapshot, missing, wrong-length and corrupt input', () => {
    const owner = execution(catalog, supplied), view = owner.map('payload'); supplied.get('payload')[0] = 42;
    assert.equal(owner.u8(view, 0), generic[0]); owner.close();
    assert.throws(() => execution(catalog, supplied), { code: 'RESOURCE_INTEGRITY' });
    supplied.set('payload', Uint8Array.from(generic.subarray(1)));
    assert.throws(() => execution(catalog, supplied), { code: 'RESOURCE_LENGTH' });
    supplied.delete('payload'); assert.throws(() => execution(catalog, supplied), { code: 'RESOURCE_MISSING' });
  });
  check('read budget and lifecycle', () => {
    const owner = execution(catalog, undefined, 4), view = owner.map('payload'); owner.u32LE(view, 0);
    assert.throws(() => owner.u8(view, 0), { code: 'RESOURCE_LIMIT' });
    assert.throws(() => owner.map('payload'), { code: 'RESOURCE_CLOSED' });
    runtime.close(); assert.throws(() => runtime.u8(genericView, 0), { code: 'RESOURCE_CLOSED' });
  });
  const vectorGuest = compile(vectors, 'raw', out);
  const guest = new WebAssembly.Instance(new WebAssembly.Module(vectorGuest.wasm)).exports;
  check('JS and actual Wasm vector readers match independent oracle for all 32 rows', () => {
    const owner = execution(catalog), view = owner.map('vectors'), token = guest.begin();
    assert.equal(owner.u32LE(view, 0), 0x31425650); assert.equal(guest.u32le(token, 0), 0x31425650);
    const scores = [];
    for (let row = 0; row < 32; row++) {
      let sum = 0; for (let d = 0; d < 8; d++) sum += (owner.f32LE(view, 16 + (row * 8 + d) * 4) - d / 8) ** 2;
      assert.equal(sum, 8 * ((row - 7) / 4) ** 2); assert.equal(guest.distance(token, row, 8), sum); scores.push(sum);
    }
    assert.equal(scores.indexOf(Math.min(...scores)), 7); owner.close(); guest.close();
  });
  check('Wasm bounds, stale generation and terminal lifecycle', () => {
    let token = guest.begin();
    for (const offset of [-1, 0.5, NaN, Infinity, vectors.length, Number.MAX_SAFE_INTEGER]) {
      guest.read_u8(token, offset); assert.equal(guest.last_error(), 3);
    }
    guest.u32le(token, vectors.length - 3); assert.equal(guest.last_error(), 3);
    const stale = token; token = guest.begin(); guest.read_u8(stale, 0); assert.equal(guest.last_error(), 2);
    guest.repeat(token, LIMITS.readBytes + 1); assert.equal(guest.last_error(), 5);
    token = guest.begin(); guest.close(); guest.read_u8(token, 0); assert.equal(guest.last_error(), 1);
  });
  const floatBytes = Buffer.alloc(16); floatBytes.writeFloatLE(-0, 0); floatBytes.writeFloatLE(Infinity, 4);
  floatBytes.writeFloatLE(NaN, 8); floatBytes.writeFloatLE(1.25, 12);
  const floatManifest = JSON.stringify(await createEmbeddedManifest([{ path: '/f', bytes: floatBytes }]));
  const floatRuntime = execution(catalogue(floatManifest, [{ id: 'float', path: '/f' }])), floatView = floatRuntime.map('float');
  const floats = new WebAssembly.Instance(new WebAssembly.Module(compile(floatBytes, 'raw', out).wasm)).exports;
  check('float32 finite values, signed zero and deterministic nonfinite rejection', () => {
    const token = floats.begin(); assert(Object.is(floats.f32le(token, 0), -0)); assert(Object.is(floatRuntime.f32LE(floatView, 0), -0));
    for (const at of [4, 8]) { floats.f32le(token, at); assert.equal(floats.last_error(), 4);
      assert.throws(() => floatRuntime.f32LE(floatView, at), { code: 'RESOURCE_NONFINITE' }); }
    assert.equal(floats.f32le(token, 12), 1.25); assert.equal(floatRuntime.f32LE(floatView, 12), 1.25);
    floats.close(); floatRuntime.close();
  });
  const measurements = checkpoint.measurements;
  for (const length of [0, 16384, 65536, 262144]) {
    const bytes = binary(length), checksum = bytes.reduce((sum, byte) => (sum + byte) >>> 0, 0);
    const bytesFile = path.join(out, `payload-${length}.bin`), manifestFile = path.join(out, `manifest-${length}.json`);
    fs.writeFileSync(bytesFile, bytes);
    fs.writeFileSync(manifestFile, JSON.stringify(await createEmbeddedManifest([{ path: '/payload', bytes }])));
    const artifacts = {};
    for (const mode of ['raw', 'base64', 'host-copy']) artifacts[mode] = compile(bytes, mode, out);
    const samples = [];
    for (const mode of ['native-raw', 'native-base64', 'native-host-copy', 'javascript-embedded', 'javascript-packaged', 'javascript-host-supplied']) {
      const artifact = artifacts[mode.slice(7)];
      const job = { mode, byteLength: length, checksum, bytes: bytesFile, manifest: manifestFile,
        sha256: hash(bytes), wasm: artifact?.file, wasmSha256: artifact?.sha256 };
      const jobFile = path.join(out, 'sample.json'); fs.writeFileSync(jobFile, JSON.stringify(job));
      for (let repeat = 0; repeat < 3; repeat++) samples.push(JSON.parse(execFileSync(process.execPath,
        ['--expose-gc', path.join(__dirname, 'sample.cjs'), jobFile], { cwd: root, encoding: 'utf8', timeout: 30000 })));
    }
    measurements.push({ byteLength: length, sha256: hash(bytes), manifestBytes: fs.statSync(manifestFile).size,
      artifacts: Object.fromEntries(Object.entries(artifacts).map(([mode, a]) => [mode, {
        bytes: a.bytes, gzipBytes: a.gzipBytes, sha256: a.sha256, sourceSha256: a.sourceSha256
      }])), samples });
    persist();
    process.stderr.write(`measured ${length} bytes\n`);
  }
  const maximum = await createEmbeddedManifest(Array.from({ length: 4 }, (_, i) => ({ path: `/p${i}`, bytes: binary(LIMITS.fileBytes) })));
  check('existing maximum manifest admitted with exact per-file and aggregate bounds', () => {
    assert.equal(catalogue(JSON.stringify(maximum), [{ id: 'max', path: '/p0' }]).entries.get('max').byteLength, LIMITS.fileBytes);
  });
  await assert.rejects(createEmbeddedManifest([{ path: '/too-big', bytes: binary(LIMITS.fileBytes + 1) }]));
  cases.push({ name: 'existing per-file maximum plus one rejected', status: 'passed' });
  await assert.rejects(createEmbeddedManifest([...Array.from({ length: 4 }, (_, i) => ({ path: `/p${i}`, bytes: binary(LIMITS.fileBytes) })), { path: '/extra', bytes: Buffer.from([1]) }]));
  cases.push({ name: 'existing aggregate maximum plus one byte rejected', status: 'passed' });
  await assert.rejects(createEmbeddedManifest(Array.from({ length: 257 }, (_, i) => ({ path: `/p${i}`, bytes: Buffer.alloc(0) }))));
  cases.push({ name: 'existing record-count maximum plus one rejected', status: 'passed' });
  const fastlyGuest = compile(vectors, 'raw', out, true);
  check('actual mapped guest through injected Fastly ABI', () => {
    const { executeFastlyNativePlatformCapabilities } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
    const result = executeFastlyNativePlatformCapabilities({ wasm: fastlyGuest.wasm }, { request: { method: 'GET', path: '/' } });
    assert.equal(result.response.status, 200); assert.deepEqual(Buffer.from(result.response.bodyBytes), Buffer.from([7]));
  });
  persist();
  let fastlyReality = { status: 'not-run' };
  if (process.argv.includes('--fastly-reality')) {
    const cli = require('../../../packages/provider-fastly/src/testing/fastly-cli.js');
    const artifact = fastlyGuest;
    const configFile = path.join(out, 'fastly.toml'); fs.writeFileSync(configFile, cli.renderFastlyLocalConfig({ name: 'b10-07-private-map' }));
    const launcher = cli.inspectFastlyComputeLauncher({ env: process.env });
    const server = await cli.startFastlyComputeServe({ launcher, packageRoot: out, wasmFile: artifact.file,
      manifestFile: configFile, env: process.env, startTimeoutMs: 60000, stopTimeoutMs: 5000 });
    try {
      const result = await cli.requestFastlyCompute(server, { method: 'GET', path: '/', timeoutMs: 10000 });
      assert.equal(result.status, 200); assert.deepEqual(Buffer.from(result.body), Buffer.from([7]));
      fastlyReality = { status: 'passed', wasmSha256: artifact.sha256, bytes: artifact.bytes, launcher };
    } finally { await server.stop(); }
  }
  const report = { version: 'pulse.b10-07-resource-proof.v1', status: 'passed',
    sourceRevision: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'),
    workingTree: git('status', '--porcelain'), lockfileSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    proofFiles: Object.fromEntries(['proof.cjs', 'model.cjs', 'sample.cjs', 'guest.as.ts'].map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])),
    node: process.version, platform: process.platform, arch: process.arch, assemblyscript: JSON.parse(fs.readFileSync(path.join(resolveAsc(path.join(root, 'wasm/packages/compiler')).packageRoot, 'package.json'))).version,
    limits: LIMITS, catalogueIdentity: catalog.identity,
    fixtures: { vector: { bytes: vectors.length, sha256: hash(vectors), nearestRow: 7 }, payload: { bytes: generic.length, sha256: hash(generic) } },
    cases, vectorGuest: { bytes: vectorGuest.bytes, sha256: vectorGuest.sha256, imports: vectorGuest.imports },
    measurements, fastlyGuest: { bytes: fastlyGuest.bytes, sha256: fastlyGuest.sha256, imports: fastlyGuest.imports }, fastlyReality,
    limitations: ['Private JS model and directly compiled AS guest; not public compiler/CLI resource support.',
      'Fresh-process RSS includes engine, module and input buffers; GC and retained heap are not a host quota guarantee.',
      'Base64 variant is an allocation-free scalar representation model, not the current Assets decoder or a full application.',
      'Packaged and host-supplied modes are Node harness experiments; no runtime filesystem or Fastly host-resource capability is implemented.'] };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, cases: cases.length, results: path.join(out, 'results.json'), fastly: fastlyReality.status }));
}
main().catch(error => {
  if (checkpointFile) { checkpoint.status = 'failed'; checkpoint.error = error.message; persist(); }
  console.error(error.stack); if (error.stderr) console.error(String(error.stderr)); if (error.detail) console.error(error.detail); process.exitCode = 1;
});
