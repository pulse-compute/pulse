'use strict';
// Executes retained installed-consumer Wasm, never a rebuilt standalone probe.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), net = require('node:net'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function ready(p, child, logs) {
  for (let n = 0; n < 200; n++) {
    if (child.exitCode !== null) throw Error(logs());
    const ok = await new Promise(resolve => { const s = net.connect(p, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
    if (ok) return; await delay(50);
  }
  throw Error('Local engine startup timeout: ' + logs());
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await Promise.race([closed, delay(1500)]);
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await closed; }
}
async function websocket(p) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(p, '127.0.0.1'); let buffer = Buffer.alloc(0), upgraded = false;
    const timer = setTimeout(() => socket.destroy(Error('WebSocket frame timeout')), 5000);
    socket.on('error', reject); socket.on('close', () => { clearTimeout(timer); reject(Error('WebSocket closed before the expected frame')); });
    socket.on('connect', () => socket.write('GET /fanout HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
    socket.on('data', bytes => {
      buffer = Buffer.concat([buffer, bytes]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
        if (!buffer.subarray(0, end).toString().startsWith('HTTP/1.1 101')) return socket.destroy(Error(buffer.toString()));
        upgraded = true; buffer = buffer.subarray(end + 4);
        const payload = Buffer.from('hex04-frame'), mask = Buffer.from([1, 2, 3, 4]);
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]));
      }
      if (buffer.length >= 2 && buffer.length >= 2 + (buffer[1] & 127)) {
        const body = buffer.subarray(2, 2 + (buffer[1] & 127)).toString();
        socket.destroy(); resolve({ status: 101, frame: body });
      }
    });
  });
}
async function run(proofDir, viceroy, pushpinRoot, output) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hex04-local-'));
  const env = { ...process.env, LD_LIBRARY_PATH: path.join(pushpinRoot, 'usr/lib/x86_64-linux-gnu'), PATH: path.join(pushpinRoot, 'usr/bin') + ':' + process.env.PATH };
  const pushpin = path.join(pushpinRoot, 'usr/bin/pushpin');
  const proof = { status: 'running', kind: 'installed Pulse local transport acceptance; not hosted Fastly acceptance',
    installedProofSha256: hash(fs.readFileSync(path.join(proofDir, 'proof.json'))), engines: [], cases: [], logs: {} };
  const save = () => fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
  for (const [binary, expected] of [[viceroy, 'viceroy 0.18.0'], [pushpin, 'pushpin 1.42.0']]) {
    const version = execFileSync(binary, ['--version'], { env, encoding: 'utf8' }).trim(); assert.equal(version, expected);
    proof.engines.push({ version, sha256: hash(fs.readFileSync(binary)) });
  }
  let originCount = 0, held = false, proxy, engine;
  const sockets = new Set();
  const origin = http.createServer((req, res) => {
    originCount++;
    if (req.headers['x-hex04-hold']) { held = true; res.setHeader('Grip-Hold', 'response'); res.setHeader('Grip-Channel', 'hex04'); res.setHeader('Grip-Timeout', '10'); res.end('timed-out'); }
    else res.end('hex04-origin');
  });
  origin.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  origin.on('upgrade', (req, socket) => {
    originCount++;
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let buffer = Buffer.alloc(0);
    socket.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); if (buffer.length < 6 || buffer.length < 6 + (buffer[1] & 127)) return;
      const n = buffer[1] & 127, payload = Buffer.from(buffer.subarray(6, 6 + n).map((b, i) => b ^ buffer[2 + i % 4]));
      socket.end(Buffer.concat([Buffer.from([0x81, payload.length]), payload])); });
  });
  function start(binary, args, label, childEnv = process.env) {
    proof.logs[label] = ''; const child = spawn(binary, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', bytes => proof.logs[label] += bytes); child.stderr.on('data', bytes => proof.logs[label] += bytes); return child;
  }
  try {
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    const originPort = origin.address().port, proxyPort = await port(), publishPort = await port();
    fs.mkdirSync(path.join(tmp, 'run')); fs.mkdirSync(path.join(tmp, 'logs'));
    let config = fs.readFileSync(path.join(pushpinRoot, 'usr/share/pushpin/pushpin.conf'), 'utf8')
      .replace('include={libdir}/internal.conf', 'include=' + path.join(pushpinRoot, 'usr/lib/pushpin/internal.conf'))
      .replace('rundir=/var/run/pushpin', 'rundir=' + path.join(tmp, 'run')).replace('logdir=/var/log/pushpin', 'logdir=' + path.join(tmp, 'logs'))
      .replace('accept_pushpin_route=false', 'accept_pushpin_route=true').replace('push_in_http_port=5561', 'push_in_http_port=' + publishPort);
    const conf = path.join(tmp, 'pushpin.conf'); fs.writeFileSync(conf, config);
    fs.writeFileSync(path.join(tmp, 'routes'), `*,id=fanout_backend 127.0.0.1:${originPort}\n`);
    proxy = start(pushpin, ['--config', conf, '--port', '127.0.0.1:' + proxyPort, '--merge-output'], 'pushpin', env);
    let pushpinReady = false;
    try { await ready(proxyPort, proxy, () => proof.logs.pushpin); await ready(publishPort, proxy, () => proof.logs.pushpin); pushpinReady = true; }
    catch (error) { proof.pushpin = { status: 'not-run', reason: 'Pinned engine could not start in this environment', startupError: error.message }; await stop(proxy); proxy = null; }
    if (pushpinReady) proof.pushpin = { status: 'running' };
    const toml = path.join(tmp, 'fastly.toml'); fs.writeFileSync(toml, `[local_server.backends.fanout_backend]\nurl = "http://127.0.0.1:${originPort}"\n`);
    for (const fixture of ['fanout', 'websocket']) {
      const wasm = path.join(proofDir, fixture + '.wasm'), artifactSha256 = hash(fs.readFileSync(wasm)), address = await port();
      assert.equal(artifactSha256, JSON.parse(fs.readFileSync(path.join(proofDir, 'proof.json'))).fixtures[fixture].sha256);
      engine = start(viceroy, [wasm, '--addr', '127.0.0.1:' + address, '-C', toml, '--local-pushpin-proxy-port', String(proxyPort)], fixture);
      await ready(address, engine, () => proof.logs[fixture]);
      const request = async (route, headers = {}) => { const r = await fetch(`http://127.0.0.1:${address}${route}`, { headers, signal: AbortSignal.timeout(7000) }); return { status: r.status, body: await r.text() }; };
      const before = originCount, ordinary = await request('/ordinary'); assert.deepEqual(ordinary, { status: 200, body: 'ordinary response' }); assert.equal(originCount, before);
      proof.cases.push({ fixture, scenario: 'ordinary branch bypasses origin', artifactSha256, response: ordinary });
      if (fixture === 'fanout' && !pushpinReady) { await stop(engine); engine = null; save(); continue; }
      const response = await request('/fanout'); assert.deepEqual(response, { status: 200, body: 'hex04-origin' });
      proof.cases.push({ fixture, scenario: 'HTTP handoff', artifactSha256, response });
      if (fixture === 'fanout') {
        let finished = false; const pending = request('/fanout', { 'x-hex04-hold': 'yes' }).then(r => { finished = true; return r; });
        for (let n = 0; n < 100 && !held; n++) await delay(20); assert(held);
        await delay(250); assert.equal(finished, false, 'Pushpin must hold the response');
        const published = await fetch(`http://127.0.0.1:${publishPort}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: [{ channel: 'hex04', formats: { 'http-response': { body: 'hex04-published' } } }] }), signal: AbortSignal.timeout(3000) });
        assert.equal(published.status, 200); const response = await pending; assert.deepEqual(response, { status: 200, body: 'hex04-published' });
        proof.cases.push({ fixture, scenario: 'GRIP hold and publish via real Pushpin', artifactSha256, response });
      } else { const response = await websocket(address); assert.deepEqual(response, { status: 101, frame: 'hex04-frame' }); proof.cases.push({ fixture, scenario: 'WebSocket upgrade and bidirectional frame', artifactSha256, response }); }
      await stop(engine); engine = null; save();
    }
    if (pushpinReady) proof.pushpin.status = 'passed';
    proof.status = pushpinReady ? 'passed' : 'passed-with-unavailable-lane';
  } catch (error) { proof.status = 'failed'; proof.error = error.stack; throw error; }
  finally { await stop(engine); await stop(proxy); for (const socket of sockets) socket.destroy(); await new Promise(resolve => origin.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); proof.cleanup = !fs.existsSync(tmp); save(); }
}
if (require.main === module) { const args = process.argv.slice(2); assert.equal(args.length, 4, 'Usage: probe-hex04-local.cjs PROOF_DIR VICEROY PUSHPIN_ROOT OUTPUT'); run(...args.map(p => path.resolve(p))).catch(error => { console.error(error); process.exitCode = 1; }); }
module.exports = { run };
