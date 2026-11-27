'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const harness = ['installed.cjs', 'worker.cjs', 'fixture.cjs', 'bundle.cjs', 'hosted.cjs'];
function read(root, file) {
  assert.equal(typeof file, 'string');
  assert(!path.isAbsolute(file) && !file.includes('\\') && !file.split('/').some(p => !p || p === '.' || p === '..'));
  const target = path.resolve(root, file);
  assert.equal(fs.realpathSync(target), target, 'Bundle links are forbidden');
  return fs.readFileSync(target);
}
function load(directory) {
  const root = fs.realpathSync(directory), bytes = read(root, 'installed.json'), data = JSON.parse(bytes);
  assert.equal(data.version, 'pulse.mac03-installed.v1');
  assert.equal(data.status, 'passed');
  assert.match(data.candidate.sourceRevision, /^[a-f0-9]{40}$/);
  assert.match(data.candidate.sourceTree, /^[a-f0-9]{40}$/);
  assert.equal(data.candidate.workingTree, '');
  assert.equal(data.packageClosureVerified, true);
  assert.equal(data.outsideCheckout, true);
  assert.equal(data.hostedQualified, false);
  assert.equal(data.publicTypes, true);
  assert.equal(data.bindingControls, 3);
  assert.equal(data.fastlyEvidence, 'compiled-wasm-injected-host');
  const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, '../mac-text-v1.json')));
  assert.equal(data.corpusSha256, hash(fs.readFileSync(path.join(__dirname, '../mac-text-v1.json'))));
  const included = corpus.cases.filter(c => !c.overrides?.algorithm && !c.overrides?.state && !['malformed-secret', 'tag-newline'].includes(c.id));
  const expected = [...corpus.vectors.map(c => ({ ...c, expected: 'valid' })), ...included]
    .flatMap(c => ['node-native', 'node-javascript', 'fastly-native', 'fastly-javascript'].map(target => ({ id: c.id, target, status: 'passed', outcome: c.expected })));
  assert.deepEqual(data.cases, expected, 'Incomplete installed coverage');
  assert(data.packages.length > 0);
  assert.equal(new Set(data.packages.map(p => p.name)).size, data.packages.length);
  for (const p of data.packages) assert.equal(hash(read(root, p.file)), p.sha256, 'Changed candidate tarball');
  for (const a of data.artifacts) assert.equal(hash(read(root, a.file)), a.sha256, 'Changed artifact');
  const wasm = data.artifacts.find(a => a.file === 'build/bin/main.wasm');
  assert(wasm && WebAssembly.validate(read(root, wasm.file)));
  for (const file of harness) assert.equal(hash(fs.readFileSync(path.join(__dirname, file))), data.harness[file], 'Harness changed; prepare a fresh bundle');
  return { root, data, sha256: hash(bytes), wasm };
}
module.exports = { hash, read, load, harness };
