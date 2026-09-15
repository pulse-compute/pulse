#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { PACKAGE_SET, RELEASE_VERSION } = require('../../../scripts/package-support.cjs');

const repo = path.resolve(__dirname, '../../..');
const installed = process.argv[2];
const root = installed ? path.resolve(installed) : fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'digest-consumer-'));
function write(file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
}
if (!installed) {
  write('package.json', JSON.stringify({ private: true, dependencies: Object.fromEntries(PACKAGE_SET.map(p => [p.name, RELEASE_VERSION])) }));
  fs.mkdirSync(path.join(root, 'node_modules/@pulse-compute'), { recursive: true });
  for (const p of PACKAGE_SET) fs.symlinkSync(path.join(repo, p.dir), path.join(root, 'node_modules', p.name), process.platform === 'win32' ? 'junction' : 'dir');
}
const request = createRequire(path.join(root, 'package.json'));
const cli = path.resolve(path.dirname(request.resolve('@pulse-compute/cli')), '../bin/pulse.js');
function run(command, profile) {
  const result = spawnSync(process.execPath, [cli, command, '--profile', profile, '--json'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function main() {
  write('.pulse/config.ts', `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', strict: true, crypto: ['SHA-256'] },
  javascript: { host: 'node', target: 'javascript', outDir: 'dist/javascript' },
  native: { host: 'node', target: 'native', outDir: 'dist/native' },
  fastly: { host: 'fastly', target: 'native', outDir: 'dist/fastly' },
  fastlyjs: { host: 'fastly', target: 'javascript', outDir: 'dist/fastlyjs' }
}));`);
  write('src/index.ts', `import { Pulse } from '@pulse-compute/pulse';
import crypto, { digestText, type TextDigestResult } from '@pulse-compute/crypto';
const app = new Pulse({ auto: true });
app.get('/digest', async ctx => {
  const result: TextDigestResult = await crypto.digestText(ctx, 'abc');
  if (result.status !== 'ok' || result.byteLength !== 3 || result.sha256 !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') return ctx.text('failed', {status: 500});
  const { first, empty } = await ctx.parallel({ first: crypto.digestText(ctx, 'abc'), empty: digestText(ctx, '') });
  if (first.status !== 'ok' || first.sha256 !== result.sha256 || empty.status !== 'ok' || empty.byteLength !== 0 || empty.sha256 !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') return ctx.text('failed', {status: 500});
  return ctx.text('digest ready');
});
export default app;`);
  write('tests/pulse.harness.ts', `export default [{ name: 'public digest and grouped hashes', request: { method: 'GET', path: '/digest' }, expect: { status: 200, text: 'digest ready' } }];`);
  const ts = createRequire(request.resolve('@pulse-compute/wasm-compiler'))('typescript');
  const program = ts.createProgram([path.join(root, 'src/index.ts')], { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  for (const profile of ['native', 'javascript', 'fastly', 'fastlyjs']) {
    run('inspect', profile);
    const result = run('test', profile);
    assert.deepEqual(result.summary, { total: 1, passed: 1, failed: 0 });
    console.log(`ok - ${profile}: public digest inspect and local consumer`);
  }
  const built = run('build', 'javascript');
  const application = request(built.files.entry);
  const { executeNodeJavascriptApplication } = request('@pulse-compute/provider-node/javascript/runtime-host');
  const response = await executeNodeJavascriptApplication(application, new Request('https://digest.test/digest'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'digest ready');
  run('build', 'native');
  run('build', 'fastly');
  run('build', 'fastlyjs');
  console.log('ok - built JavaScript execution and Node/Fastly Native and Fastly JavaScript builds; no source dependency mutation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
