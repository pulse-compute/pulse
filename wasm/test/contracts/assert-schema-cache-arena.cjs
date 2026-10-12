#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareProject } = require('../performance/baseline.cjs');
const { fixtures } = require('../performance/fixtures.cjs');
const { verifyBehavior } = require('../performance/rust-behavior.cjs');
const Transform = require('../../packages/build-support/src/schema-cache-arena-transform.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
async function assertSchemaCacheArena() {
  assert.throws(() => new Transform().afterParse({ sources: [] }), /pinned json-as/);
  assert.throws(() => new Transform().afterParse({ sources: [{ internalPath: '~lib/json-as/lib/as-bs', text: 'changed' }] }), /pinned json-as/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-arena-proof-'));
  const fixture = fixtures.find(f => f.id === 'schema-effect'), results = [];
  try {
    for (const cache of [null, 'false', 'true', '65536', '1']) {
      const built = {};
      for (const variant of ['unpatched', 'patched']) {
        const project = path.join(directory, String(cache) + '-' + variant), receipt = project + '.json';
        prepareProject(project, fixture, 'native');
        const env = { ...process.env }; delete env.JSON_CACHE;
        if (cache !== null) env.JSON_CACHE = cache;
        const child = spawnSync(process.execPath, [path.join(__dirname, 'json-cache-flag-worker.cjs'), variant, project, receipt], { env, encoding: 'utf8', timeout: 120000 });
        assert.equal(child.status, 0, child.stderr || child.error?.message);
        const b = read(receipt), manifest = read(path.join(b.outDir, 'pulse-build.json'));
        const wasm = fs.readFileSync(path.join(b.outDir, manifest.portable.wasm.file));
        const module = new WebAssembly.Module(wasm);
        const imports = Object.fromEntries([...new Set(WebAssembly.Module.imports(module).map(i => i.module))].map(name => [name, {}]));
        for (const i of WebAssembly.Module.imports(module)) { assert.equal(i.kind, 'function'); imports[i.module][i.name] = () => { throw new Error('Unexpected startup host call'); }; }
        built[variant] = { ...b, wasm, initialBytes: new WebAssembly.Instance(module, imports).exports.memory.buffer.byteLength };
      }
      await verifyBehavior(built.unpatched.outDir, built.patched.outDir, fixture);
      if (cache === null || cache === 'false') {
        assert.equal(built.unpatched.initialBytes, 1245184);
        assert.equal(built.patched.initialBytes, 65536);
        assert.notDeepEqual(built.unpatched.wasm, built.patched.wasm);
      } else assert.deepEqual(built.unpatched.wasm, built.patched.wasm, 'Enabled-cache artifact changed');
      results.push({ cache, ...Object.fromEntries(Object.entries(built).map(([variant, b]) => [variant, { bytes: b.wasm.length, sha256: b.artifactSha256, initialBytes: b.initialBytes }])) });
    }
    console.log(JSON.stringify({ status: 'passed', results }, null, 2));
    console.log('ok - disabled arena removed; enabled artifacts identical; strict behavior parity; source drift rejected');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) assertSchemaCacheArena().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { assertSchemaCacheArena };
