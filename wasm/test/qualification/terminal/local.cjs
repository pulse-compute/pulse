'use strict';
// Executes retained installed-consumer Wasm, never a rebuilt standalone probe.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), net = require('node:net'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const {hash,load,terminalCases,assertCoverage,assertHarness} = require('./bundle.cjs');
const pins = require('./engines.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function ready(p, child, logs) {
  for (let n = 0; n < 200; n++) {
    if (child.startupError || (child.exitCode !== null || child.signalCode !== null)) throw Error(logs());
    const ok = await new Promise(resolve => { const s = net.connect(p, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
    if (ok) return; await delay(50);
  }
  throw Error('Local engine startup timeout: ' + logs());
}
async function stop(child) {
  if (!child || !child.pid || (child.exitCode !== null || child.signalCode !== null)) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await Promise.race([closed, delay(1500)]);
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await closed; }
}
async function websocket(address) {
  const url=typeof address==='number'?`ws://127.0.0.1:${address}/handoff`:address;
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url),messages=['terminal-'+crypto.randomBytes(12).toString('hex'),'terminal-'+crypto.randomBytes(12).toString('hex')];let count=0;
    const timer=setTimeout(()=>finish(Error('WebSocket timeout')),7000);
    function finish(error){clearTimeout(timer);socket.onclose=null;socket.onerror=null;socket.close();error?reject(error):resolve({status:101,frames:count});}
    socket.onopen=()=>socket.send(messages[0]);
    socket.onerror=()=>finish(Error('WebSocket transport error'));
    socket.onclose=()=>finish(Error('WebSocket closed before echo'));
    socket.onmessage=event=>{if(event.data!==messages[count])return finish(Error('Unexpected WebSocket payload'));if(++count===messages.length)finish();else socket.send(messages[count]);};
  });
}
async function run(proofDir, viceroy, pushpinRoot, output) {
  assert(!fs.existsSync(output),'Use a fresh transport receipt path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-terminal-local-'));
  const env = { ...process.env, LD_LIBRARY_PATH: path.join(pushpinRoot, 'usr/lib/x86_64-linux-gnu'), PATH: path.join(pushpinRoot, 'usr/bin') + ':' + process.env.PATH };
  const pushpin = path.join(pushpinRoot, 'usr/bin/pushpin');
  const bundle=load(proofDir);
  assertHarness(bundle,['local.cjs','bundle.cjs','origin.cjs','engines.json']);
  const proof = {version:'pulse.terminal-transport.v1',lane:'local',status:'running',bundleSha256:bundle.sha256,engines:[],cases:[],logs:{}};
  const save = () => fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
  let originCount = 0, held = false, proxy, engine;
  const sockets = new Set();
  const origin=require('./origin.cjs').createOrigin(()=>originCount++,()=>{held=true;});
  origin.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  function start(binary, args, label, childEnv = process.env) {
    proof.logs[label] = ''; const child = spawn(binary, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', bytes => proof.logs[label] = (proof.logs[label] + bytes).slice(-16000)); child.stderr.on('data', bytes => proof.logs[label] = (proof.logs[label] + bytes).slice(-16000)); child.on('error',error=>{child.startupError=error;}); return child;
  }
  try {
  assert.equal(hash(fs.readFileSync(viceroy)),pins.viceroy.binarySha256);
  for(const pin of pins.pushpin.binaries)assert.equal(hash(fs.readFileSync(path.join(pushpinRoot,'usr/bin',pin.name))),pin.sha256);
  for (const [binary, expected] of [[viceroy, 'viceroy 0.18.0'], [pushpin, 'pushpin 1.42.0']]) {
    const version = execFileSync(binary, ['--version'], { env, encoding: 'utf8' }).trim(); assert.equal(version, expected);
    proof.engines.push({ version, sha256: hash(fs.readFileSync(binary)) });
  }
    await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
    const originPort=origin.address().port;
    for (const fixture of terminalCases) {
    const cell=path.join(tmp,fixture);fs.mkdirSync(cell);
    const channel='pulse-terminal-'+crypto.randomBytes(12).toString('hex'),publishedBody='published-'+crypto.randomBytes(12).toString('hex');
    const proxyPort=await port(),publishPort=await port();
    fs.mkdirSync(path.join(cell, 'run')); fs.mkdirSync(path.join(cell, 'logs'));
    let config = fs.readFileSync(path.join(pushpinRoot, 'usr/share/pushpin/pushpin.conf'), 'utf8')
      .replace('include={libdir}/internal.conf', 'include=' + path.join(pushpinRoot, 'usr/lib/pushpin/internal.conf'))
      .replace('rundir=/var/run/pushpin', 'rundir=' + path.join(cell, 'run')).replace('logdir=/var/log/pushpin', 'logdir=' + path.join(cell, 'logs'))
      .replace('accept_pushpin_route=false', 'accept_pushpin_route=true').replace('push_in_http_port=5561', 'push_in_http_port=' + publishPort);
    const conf = path.join(cell, 'pushpin.conf'); fs.writeFileSync(conf, config);
    fs.writeFileSync(path.join(cell, 'routes'), `*,id=terminal_origin 127.0.0.1:${originPort}\n`);
    proxy = start(pushpin, ['--config', conf, '--port', '127.0.0.1:' + proxyPort, '--merge-output'], fixture+'-pushpin', env);
    await ready(proxyPort,proxy,()=>proof.logs[fixture+'-pushpin']);await ready(publishPort,proxy,()=>proof.logs[fixture+'-pushpin']);
    const toml = path.join(cell, 'fastly.toml'); fs.writeFileSync(toml, `[local_server.backends.terminal_origin]\nurl = "http://127.0.0.1:${originPort}"\n`);
      const wasm = path.join(proofDir, fixture + '.wasm'), artifactSha256 = hash(fs.readFileSync(wasm)), address = await port();
      assert.equal(artifactSha256, bundle.data.artifacts.find(a=>a.id===fixture).sha256);
      engine = start(viceroy, [wasm, '--addr', '127.0.0.1:' + address, '-C', toml, '--local-pushpin-proxy-port', String(proxyPort)], fixture);
      await ready(address, engine, () => proof.logs[fixture]);
      const request = async (route, headers = {}) => { const r = await fetch(`http://127.0.0.1:${address}${route}`, { headers, signal: AbortSignal.timeout(7000) }); return { status: r.status, body: await r.text() }; };
      const before = originCount, ordinary = await request('/ordinary'); assert.deepEqual(ordinary, { status: 200, body: 'ordinary response' }); assert.equal(originCount, before);
      proof.cases.push({ id:fixture,status:'passed',scenario:'ordinary', artifactSha256, response: ordinary });
      const response = await request('/handoff'); assert.deepEqual(response, { status: 200, body: 'terminal-origin' });
      proof.cases.push({ id:fixture,status:'passed',scenario:'handoff', artifactSha256, response });
      if (!fixture.startsWith('websocket')) {
        held=false;
        let finished = false; const pending = request('/handoff', { 'x-pulse-terminal-hold': channel }).then(r => { finished = true; return r; });pending.catch(()=>{});
        for (let n = 0; n < 100 && !held; n++) await delay(20); assert(held);
        await delay(250); assert.equal(finished, false, 'Pushpin must hold the response');
        const published = await fetch(`http://127.0.0.1:${publishPort}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: [{ channel, formats: { 'http-response': { body: publishedBody } } }] }), signal: AbortSignal.timeout(3000) });
        assert.equal(published.status, 200); const response = await pending; assert.deepEqual(response, { status: 200, body: publishedBody });
        proof.cases.push({ id:fixture,status:'passed',scenario:'hold-publish', artifactSha256, response });
      } else { const response = await websocket(address); assert.deepEqual(response, {status:101,frames:2}); proof.cases.push({ id:fixture,status:'passed',scenario:'bidirectional-websocket', artifactSha256, response }); }
      await stop(engine); engine = null; await stop(proxy);proxy=null;save();
    }
    assert.equal(load(proofDir).sha256,bundle.sha256);
    proof.status='passed';
  } catch (error) { proof.status = 'failed'; proof.error = error.stack; throw error; }
  finally { await stop(engine); await stop(proxy); for (const socket of sockets) socket.destroy(); await new Promise(resolve => origin.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); proof.cleanup = !fs.existsSync(tmp); if(proof.status==='passed')assertCoverage(proof,'local'); save(); }
}
if (require.main === module) { const args = process.argv.slice(2); assert.equal(args.length, 4, 'Usage: local.cjs PROOF_DIR VICEROY PUSHPIN_ROOT OUTPUT'); run(...args.map(p => path.resolve(p))).catch(error => { console.error(error); process.exitCode = 1; }); }
module.exports = {run,websocket};
