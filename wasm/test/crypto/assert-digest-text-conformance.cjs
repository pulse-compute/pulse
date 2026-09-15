#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const expected = text => ({ status: 'ok', sha256: createHash('sha256').update(text, 'utf8').digest('hex'), byteLength: Buffer.byteLength(text, 'utf8') });

async function main(options = {}) {
  const toolchain = acceptanceToolchain(options.packedRoot);
  const { resolveProject, inspectProject, compileProject, compileNativeProjectInMemory, prepareJavascriptApplication,
    executeCanonicalNativeModule, executeNodeJavascriptApplication, compileFastly,
    executeFastlyNativePlatformCapabilities, driver } = toolchain;
  const load = options.packedRoot ? createRequire(path.join(options.packedRoot, 'package.json')) : require;
  const cryptoRoot = options.packedRoot ? path.dirname(path.dirname(load.resolve('@pulse-compute/crypto'))) : path.join(root, 'packages/crypto');
  const corpus = JSON.parse(fs.readFileSync(path.join(cryptoRoot, 'conformance/digest-text.json'), 'utf8'));
  const { executeFastlyJavascriptApplication } = load(options.packedRoot
    ? '@pulse-compute/provider-fastly/javascript/runtime-host'
    : '../../../packages/provider-fastly/src/javascript/runtime-host.js');
  const cwd = options.cwd || fs.mkdtempSync(path.join(__dirname, '.digest-'));
  try {
    if (!options.packedRoot) {
      fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
      for (const name of ['pulse', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    }
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'digest-consumer.ts'), path.join(cwd, 'src/index.ts'));
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['SHA-256'] } };
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) config[`${host}-${target}`] = { host, target, schemas: { maxBytes: 262144 } };
    const configFile = path.join(cwd, '.pulse/config.ts');
    const writeConfig = () => fs.writeFileSync(configFile, `import { defineConfig } from '@pulse-compute/pulse'\nexport default defineConfig((_scope) => (${JSON.stringify(config)}))`);
    writeConfig();
    const projects = Object.fromEntries(Object.keys(config).filter(name => name !== 'pulse').map(profile => [profile, resolveProject({ cwd, profile })]));
    for (const profile of ['node-javascript', 'fastly-javascript']) {
      const inspection = inspectProject(projects[profile]);
      assert.equal(inspection.provider.targetSupport.project.status, 'eligible', JSON.stringify(inspection.provider.targetSupport));
    }
    const node = compileNativeProjectInMemory(projects['node-native']);
    const fastly = compileFastly(projects['fastly-native']);
    assert.equal(fastly.inspection.imports.some(({ module }) => /pulse_host|js[_-]?compute/i.test(module)), false);
    const js = prepareJavascriptApplication(projects['node-javascript']);
    const rows = corpus.vectors.map(({ text, sha256, byteLength }) => ({ text, expected: { status: 'ok', sha256, byteLength } }));
    for (const text of ['a'.repeat(32768), 'é'.repeat(16384), '😀'.repeat(8192), '\u0000'.repeat(32768)]) rows.push({ text, expected: expected(text) });
    for (const text of ['a'.repeat(32769), 'é'.repeat(16385), '😀'.repeat(8193)]) rows.push({ text, expected: { status: 'failed', reason: 'too-large' } });
    for (const text of ['\ud800', '\udc00', 'a\ud800b', null, 17]) rows.push({ text, expected: { status: 'failed', reason: 'invalid-text' } });
    rows.push({ text: 'grouped', route: '/parallel', expected: { first: expected('grouped'), empty: expected('') } });
    let executions = 0;
    for (const row of rows) for (const mode of Object.keys(projects)) {
      const route = row.route || '/digest';
      const request = { method: 'POST', path: route, url: `https://digest.test${route}`, headers: [], body: JSON.stringify({ text: row.text }) };
      let result;
      if (mode === 'fastly-native') result = executeFastlyNativePlatformCapabilities(fastly, { request });
      else if (mode === 'node-native') result = await executeCanonicalNativeModule(node.native, driver.executionOptions(projects[mode].providerConfig, { request, strict: false, maxRequestBodyBytes: 262144, maxStructuredBodyBytes: 262144 }));
      else {
        const execute = mode === 'node-javascript' ? executeNodeJavascriptApplication : executeFastlyJavascriptApplication;
        const trace = [];
        const response = await execute(js.loaded.application, new Request(request.url, { method: 'POST', body: request.body }), { strict: false, maxRequestBodyBytes: 262144, maxStructuredBodyBytes: 262144, onEffectObservation: event => trace.push(event) });
        result = { response: { status: response.status, body: await response.text() }, trace };
      }
      assert.equal(result.response.status, 200, mode);
      assert.deepEqual(JSON.parse(result.response.body), row.expected, `${mode}: ${rows.indexOf(row)}`);
      assert.ok(result.trace.length > 0, `${mode}: real effect observations`);
      if (row.expected.sha256) assert.equal(JSON.stringify(result.trace).includes(row.expected.sha256), false, `${mode}: digest omitted from observations`);
      executions++;
    }
    // Strict authoring admits only the imported, proven call; ambient access
    // elsewhere and inside digest arguments remains outside guest authority.
    config.pulse.strict = true;
    writeConfig();
    const entryFile = path.join(cwd, 'src/index.ts');
    const writeHandler = (imported, body) => fs.writeFileSync(entryFile, `import {Pulse} from '@pulse-compute/pulse'; import ${imported} from '@pulse-compute/crypto'; const app = new Pulse({auto:true}); app.get('/', async ctx => { ${body} }); export default app;`);
    for (const [imported, call] of [['{crypto}', 'crypto.digestText'], ['c', 'c.digestText'], ['{digestText as hash}', 'hash']]) {
      writeHandler(imported, `const r = await ${call}(ctx, 'abc'); if (r.status === 'ok') return ctx.text(r.sha256); return ctx.text(r.reason);`);
      const compiled = compileProject(resolveProject({ cwd, profile: 'node-native' }));
      assert.ok(compiled.metadata.capabilities.includes('crypto.digestText'));
    }
    for (const body of ["const r = await crypto.digestText(ctx, globalThis.payload); return ctx.text('bad');", "const r = await crypto.getRandomValues(value); return ctx.text('bad');", "const c = crypto; const r = await c.digestText(ctx, 'abc'); return ctx.text('bad');", "const crypto = other; const r = await crypto.digestText(ctx, 'abc'); return ctx.text('bad');"]) {
      writeHandler('{crypto}', body);
      assert.throws(() => compileProject(resolveProject({ cwd, profile: 'node-native' })), undefined, body);
    }
    config.pulse.crypto = ['HS256'];
    writeConfig();
    writeHandler('{crypto}', "const c = crypto; const r = await c.mac.verify({ algorithm: 'HS256', key: { type: 'hmac-key-bytes', bytes: new Uint8Array(32) }, data: new Uint8Array(), tag: new Uint8Array(32) }); return ctx.text(r.status);");
    const verification = compileProject(resolveProject({ cwd, profile: 'node-javascript' }));
    assert.equal(verification.ok, true, 'Existing ordinary JavaScript verification aliases remain admissible.');
    writeHandler('{crypto}', "const r = await crypto.digestText(ctx, 'abc'); return ctx.text(r.status);");
    // Reachable digest demand requires an explicit SHA-256 selection.
    config.pulse.crypto = [];
    writeConfig();
    for (const profile of Object.keys(projects)) assert.throws(() => inspectProject(resolveProject({ cwd, profile })), /SHA-256/);
    const evidence = { status: 'passed', cases: rows.length, executions, targets: Object.keys(projects), providerReality: false };
    if (!options.quiet) console.log(JSON.stringify(evidence));
    return evidence;
  } finally { if (!options.cwd) fs.rmSync(cwd, { recursive: true, force: true }); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack || error); console.error(JSON.stringify({ detail: error.detail, diagnostics: error.diagnostics })); process.exitCode = 1; });
