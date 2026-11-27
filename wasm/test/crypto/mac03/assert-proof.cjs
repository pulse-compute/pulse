'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cases, probe, run } = require('./hosted.cjs');
const { bearer } = require('./fixture.cjs');
const { hash, load, harness } = require('./bundle.cjs');
const corpus = require('../mac-text-v1.json');
async function main() {
  const rows = cases(Buffer.alloc(32, 42));
  assert.equal(rows.length, 18);
  let count = 0;
  const reply = async (url, options) => {
    const row = rows[count++];
    assert.equal(options.headers.authorization, bearer);
    assert.equal(options.headers['x-request-proof'], row.tag);
    assert.equal(JSON.parse(options.body).message, row.message);
    assert.equal(url.pathname, row.route || '/');
    assert.equal(options.redirect, 'error');
    return Response.json({ status: row.expected, authorizationPreserved: true, existingBearer: true });
  };
  assert.equal((await probe('https://example.invalid/', rows, reply)).length, 18);
  for (const body of [{ status: 'valid', authorizationPreserved: false, existingBearer: true }, { status: 'valid', authorizationPreserved: true, existingBearer: true, key: 'must-not-leak' }, { status: 'invalid-authenticator', authorizationPreserved: true, existingBearer: true }]) {
    await assert.rejects(probe('https://example.invalid/', rows.slice(0, 1), async () => Response.json(body)), error => !error.message.includes('must-not-leak'));
  }
  await assert.rejects(probe('https://example.invalid/', rows.slice(0, 1), async () => new Response('x'.repeat(1025))), /oversized response/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mac03-evidence-contract-'));
  try {
    fs.mkdirSync(path.join(directory, 'build/bin'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'build/bin/main.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    fs.writeFileSync(path.join(directory, 'candidate.tgz'), 'fixture only');
    const included = corpus.cases.filter(c => !c.overrides?.algorithm && !c.overrides?.state && !['malformed-secret', 'tag-newline'].includes(c.id));
    const data = { version: 'pulse.mac03-installed.v1', status: 'passed', candidate: { sourceRevision: '1'.repeat(40), sourceTree: '2'.repeat(40), workingTree: '' }, packageClosureVerified: true, outsideCheckout: true, hostedQualified: false, publicTypes: true, bindingControls: 3, fastlyEvidence: 'compiled-wasm-injected-host',
      corpusSha256: hash(fs.readFileSync(path.join(__dirname, '../mac-text-v1.json'))),
      cases: [...corpus.vectors.map(c => ({ ...c, expected: 'valid' })), ...included].flatMap(c => ['node-native', 'node-javascript', 'fastly-native', 'fastly-javascript'].map(target => ({ id: c.id, target, status: 'passed', outcome: c.expected }))),
      packages: [{ name: 'fixture', file: 'candidate.tgz', sha256: hash('fixture only') }], artifacts: [{ file: 'build/bin/main.wasm', sha256: hash(fs.readFileSync(path.join(directory, 'build/bin/main.wasm'))) }], harness: Object.fromEntries(harness.map(file => [file, hash(fs.readFileSync(path.join(__dirname, file)))])) };
    const save = value => fs.writeFileSync(path.join(directory, 'installed.json'), JSON.stringify(value));
    save(data); load(directory);
    for (const mutate of [d => d.cases.pop(), d => d.candidate.workingTree = 'dirty', d => d.hostedQualified = true, d => d.harness['hosted.cjs'] = '0'.repeat(64), d => d.artifacts[0].sha256 = '0'.repeat(64), d => d.packages[0].sha256 = '0'.repeat(64), d => d.artifacts[0].file = '../escape']) {
      const altered = structuredClone(data); mutate(altered); save(altered); assert.throws(() => load(directory));
    }
    save(data);
    await assert.rejects(run(directory, null, path.join(directory, 'blocked.json')), /required/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'blocked.json'))).status, 'blocked');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  console.log(JSON.stringify({ status: 'passed', hostedCases: rows.length, evidenceMutationsRejected: 7, hostedExecution: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
