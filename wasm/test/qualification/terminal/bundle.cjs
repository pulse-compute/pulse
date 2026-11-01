'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const terminalCases = ['fanout', 'websocket', 'fanout-router', 'websocket-router', 'independent'];
const controls = ['absent', 'unused', 'generic'];
function read(root, file) {
  assert.equal(typeof file, 'string'); assert(!path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(p=>!p||p==='.'||p==='..'));
  const target=path.resolve(root,file); assert.equal(fs.realpathSync(target),target,'Bundle links are forbidden');
  return fs.readFileSync(target);
}
function assertHarness(bundle,files) {
  for(const file of files)assert.equal(hash(fs.readFileSync(path.join(__dirname,file))),bundle.data.harness[file],'Harness changed; prepare a new candidate bundle');
}
function load(root) {
  root=fs.realpathSync(root); const bytes=read(root,'installed.json'), data=JSON.parse(bytes);
  assert.equal(data.version,'pulse.terminal-installed.v1'); assert.equal(data.status,'passed');
  assert.match(data.candidate.sourceRevision,/^[0-9a-f]{40}$/);assert.match(data.candidate.sourceTree,/^[0-9a-f]{40}$/);assert.equal(data.candidate.workingTree,'');
  assert.equal(data.packageClosureVerified,true);assert.equal(data.outsideCheckout,true);
  assert.deepEqual(data.artifacts.map(a=>a.id).sort(),[...terminalCases,...controls].sort());
  assert(data.packages.length>0); assert.equal(new Set(data.packages.map(p=>p.name)).size,data.packages.length);
  for(const p of data.packages) assert.equal(hash(read(root,p.file)),p.sha256,'Candidate tarball changed');
  assert.equal(hash(read(root,data.fixture.file)),data.fixture.sha256,'Fixture tarball changed');
  for(const a of data.artifacts){const wasm=read(root,a.file);assert(WebAssembly.validate(wasm));assert.equal(hash(wasm),a.sha256);assert.equal(wasm.length,a.bytes);assert.equal(hash(read(root,a.report.file)),a.report.sha256);}
  assert(data.harness&&typeof data.harness==='object');
  for(const file of ['prepare.cjs','installed-worker.cjs','bundle.cjs','local.cjs','hosted.cjs','origin.cjs','verify.cjs','engines.json'])assert.match(data.harness[file],/^[a-f0-9]{64}$/);
  assert.equal(hash(read(root,data.injected.file)),data.injected.sha256);
  return {root,data,sha256:hash(bytes)};
}
function assertCoverage(receipt, lane, ids=terminalCases) {
  assert.equal(receipt.version,'pulse.terminal-transport.v1');assert.equal(receipt.lane,lane);assert.equal(receipt.status,'passed');assert.equal(receipt.cleanup,true);
  const expected=ids.flatMap(id=>[id+':ordinary',id+':handoff',id+':'+(id.startsWith('websocket')?'bidirectional-websocket':'hold-publish')]);
  assert.deepEqual(receipt.cases.map(c=>c.id+':'+c.scenario).sort(),expected.sort());
  assert(receipt.cases.every(c=>c.status==='passed'&&/^[a-f0-9]{64}$/.test(c.artifactSha256)));
}
module.exports={hash,read,load,assertHarness,terminalCases,controls,assertCoverage};
