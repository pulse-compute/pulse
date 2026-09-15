#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
// Optional fresh installed-package root replays these same public consumer cases.
const installedRoot = process.argv[2];
const root = installedRoot ? path.resolve(installedRoot)
  : fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'schema-kv-'));
function write(relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
if (!installedRoot) {
  write('package.json', JSON.stringify({ name: 'schema-kv-parity-consumer', private: true,
    dependencies: Object.fromEntries(PACKAGE_SET.map(({ name }) => [name, RELEASE_VERSION])) }));
  fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
  for (const entry of PACKAGE_SET) fs.symlinkSync(path.join(repoRoot, entry.dir),
    path.join(root, 'node_modules', entry.name), process.platform === 'win32' ? 'junction' : 'dir');
}
const request = createRequire(path.join(root, 'package.json'));
const cli = path.resolve(path.dirname(request.resolve('@pulse-compute/cli')), '../bin/pulse.js');
function run(command, profile) {
  const result = spawnSync(process.execPath, [cli, command, '--profile', profile, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
async function main() {
  if (installedRoot) for (const { name } of PACKAGE_SET) {
    const packageRoot = path.join(root, 'node_modules', name);
    assert.equal(fs.lstatSync(packageRoot).isSymbolicLink(), false);
    assert.ok(fs.realpathSync(packageRoot).startsWith(`${root}${path.sep}`));
  }
  write('.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', schema: 'src/schemas.ts', tests: 'tests/pulse.harness.ts', strict: true, defaultProfile: 'javascript' },
  javascript: { host: 'node', target: 'javascript', outDir: 'dist/javascript' },
  native: { host: 'node', target: 'native', outDir: 'dist/native' },
  fastly: { host: 'fastly', target: 'native', outDir: 'dist/fastly', fastly: { bindings: { kv: { authority: 'authority' } } } }
}));`);
  write('src/schemas.ts', `import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema';
export interface Input { id: string; title: string; version: number }
export interface Nested { id: string; version: number; rows: Input[]; note: string | null }
export default defineSchemaRegistry({ schemas: { 'app.Input': schema<Input>(), 'app.Nested': schema<Nested>() } });`);
  write('src/index.ts', `import { Pulse } from '@pulse-compute/pulse';
import type { Input, Nested } from './schemas.js';
const app = new Pulse({ auto: true });
app.post('/roundtrip', async (ctx) => {
  const input = await ctx.req.json<Input>('app.Input');
  const store = ctx.kv<Input>('authority');
  const created = await store.insertIfAbsent(input.id, input);
  if (created.status !== 'stored') return ctx.text(created.status, { status: 500 });
  const value = await store.getVersioned(input.id);
  if (value.status === 'found') return ctx.json(value.value, { schema: 'app.Input' });
  return ctx.text(value.status, { status: 500 });
});
app.post('/nested', async (ctx) => {
  const input = await ctx.req.json<Nested>('app.Nested');
  const store = ctx.kv<Nested>('authority');
  const created = await store.insertIfAbsent(input.id, input);
  if (created.status !== 'stored') return ctx.text(created.status, { status: 500 });
  const before = await store.getVersioned(input.id);
  if (before.status !== 'found') return ctx.text(before.status, { status: 500 });
  const replaced = await store.compareAndSwap(input.id, before.generation, input);
  if (replaced.status !== 'stored') return ctx.text(replaced.status, { status: 500 });
  const stale = await store.compareAndSwap(input.id, before.generation, input);
  if (stale.status !== 'conflict') return ctx.text(stale.status, { status: 500 });
  const after = await store.getVersioned(input.id);
  if (after.status === 'found') return ctx.json(after.value, { schema: 'app.Nested' });
  return ctx.text(after.status, { status: 500 });
});
app.post('/encoded', async (ctx) => {
  const input = await ctx.req.json<Input>('app.Input');
  const encoded = ctx.encodeJson(input, 'app.Input');
  const store = ctx.kv<string>('authority');
  const created = await store.insertIfAbsent(input.id, encoded);
  if (created.status !== 'stored') return ctx.text(created.status, { status: 500 });
  const value = await store.getVersioned(input.id);
  if (value.status === 'found') return ctx.text(value.value);
  return ctx.text(value.status, { status: 500 });
});
export default app;`);
  const input = { id: 'r1', title: 'x', version: 1 };
  const nested = { id: 'nested-private-key', version: 2, rows: [{ id: 'private-row', title: '雪"\\\n', version: 3 }], note: null };
  const encoded = '{"id":"bytes","title":"雪\\\"\\\\\\n","version":1}';
  const cases = [
    { name: 'schema-kv-strict', path: '/roundtrip', value: input, expected: JSON.stringify(input) },
    { name: 'schema-kv-nested-cas', path: '/nested', value: nested, expected: JSON.stringify(nested) },
    { name: 'schema-kv-encoded-bytes', path: '/encoded', value: { id: 'bytes', title: '雪"\\\n', version: 1 }, expected: encoded }
  ].map(({ name, path, value, expected }) => ({ name,
    request: { method: 'POST', path, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...value, ignored: 'drop-before-kv' }) },
    expect: { status: 200, text: expected }
  }));
  write('tests/pulse.harness.ts', `export default ${JSON.stringify(cases)};`);
  for (const profile of ['javascript', 'native', 'fastly']) {
    const result = run('test', profile);
    assert.deepEqual(result.summary, { total: 3, passed: 3, failed: 0 });
    assert.equal(result.project.target, profile === 'javascript' ? 'javascript' : 'native');
    console.log(`ok - ${profile}: schema/KV response, nested CAS conflict, encoded bytes (local execution)`);
  }
  const built = run('build', 'javascript');
  const application = request(built.files.entry);
  const schemaCodecs = request(built.files.schemaCodecs);
  const { executeNodeJavascriptTestCase } = request('@pulse-compute/provider-node/javascript/test-runtime');
  for (const testCase of cases) {
    const observations = [];
    const result = await executeNodeJavascriptTestCase(application,
      { ...testCase, request: { ...testCase.request, headers: Object.entries(testCase.request.headers) } },
      { strict: true, schemaCodecs, onEffectObservation(e) { observations.push(e); } });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.body, testCase.expect.text);
    assert.ok(observations.length > 0);
    const trace = JSON.stringify(observations);
    for (const privateValue of ['nested-private-key', 'private-row', 'drop-before-kv']) assert.equal(trace.includes(privateValue), false);
  }
  console.log('ok - built Node JavaScript schema/KV consumer preserves response bytes and redacted observations');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!installedRoot) fs.rmSync(root, { recursive: true, force: true });
});
