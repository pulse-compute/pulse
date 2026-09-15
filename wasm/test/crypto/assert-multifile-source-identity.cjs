#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const ts = require('typescript');
const { buildPlainHandlerIr } = require('../../packages/compiler/src/spine/handler-ir.js');
const { emitCanonicalHandlerGenerator } = require('../../packages/compiler/src/spine/handler-ir-emitter.js');
const { CANONICAL_PACKAGE_EFFECT_VERSION } = require('../../packages/contracts/src/handler/canonical-runtime.js');

function assertSourceIndexes() {
  const source = 'const handler = (ctx) => { const value = operation(ctx); return ctx.text(value); };';
  const files = ['src/first.ts', 'src/other.ts'].map(file => ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true));
  const handlerFor = file => file.statements[0].declarationList.declarations[0].initializer;
  const callFor = file => handlerFor(file).body.statements[0].declarationList.declarations[0].initializer;
  const inputs = files.map(file => ({
    range: { start: callFor(file).getStart(file), end: callFor(file).getEnd() },
    loc: { file: file.fileName, start: { line: 1, column: 41 } }
  }));
  const effects = inputs.map((input, index) => ({ ...input, version: CANONICAL_PACKAGE_EFFECT_VERSION, kind: `test.effect${index}`, placement: 'variable' }));
  const intrinsics = inputs.map((input, index) => ({ ...input, intrinsic: 'request.header', staticArguments: [index ? 'other' : 'first'], argumentIndexes: [] }));
  function build(file, options) {
    const diagnostics = [];
    const ir = buildPlainHandlerIr({ frontend: 'canonical-source', fileName: file.fileName, sourceFile: file, handler: handlerFor(file), analysis: {}, schemaBundle: {}, diagnostics }, options);
    return { ir, diagnostics };
  }
  for (const reverse of [false, true]) {
    for (const [index, file] of files.entries()) {
      const ordered = values => reverse ? [...values].reverse() : values;
      const effect = build(file, { packageEffects: ordered(effects) });
      assert.deepEqual(effect.diagnostics, []);
      assert.equal(effect.ir.effectSites[0].kind, `test.effect${index}`);
      const intrinsic = build(file, { packageIntrinsics: ordered(intrinsics) });
      assert.deepEqual(intrinsic.diagnostics, []);
      assert.deepEqual(intrinsic.ir.packageIntrinsics, [intrinsics[index]], 'Only the owning source reaches the emitter');
      const generated = ts.createPrinter().printNode(ts.EmitHint.Unspecified, emitCanonicalHandlerGenerator(intrinsic.ir).generator, file);
      assert.match(generated, new RegExp(`ctx.req.header\\("${index ? 'other' : 'first'}"\\)`));
    }
  }
  for (const [field, entries, code] of [
    ['packageEffects', effects, 'PULSE_CANONICAL_PACKAGE_EFFECT_RANGE_INVALID'],
    ['packageIntrinsics', intrinsics, 'PULSE_CANONICAL_PACKAGE_INTRINSIC_RANGE_INVALID']
  ]) {
    const duplicate = { ...entries[0], loc: { ...entries[0].loc, file: 'src\\first.ts' } };
    assert.ok(build(files[0], { [field]: [entries[0], duplicate] }).diagnostics.some(entry => entry.code === code), 'Same-file duplicates retain their diagnostic');
    assert.ok(build(files[0], { [field]: [{ ...entries[0], range: { start: 1.5 } }] }).diagnostics.some(entry => entry.code === code));
    const single = build(files[0], { [field]: [{ ...entries[0], loc: undefined }] });
    assert.deepEqual(single.diagnostics, [], 'Legacy single-source inputs retain their implicit owner');
    const foreignOnly = build(files[0], { [field]: [entries[1]] });
    assert.equal(foreignOnly.ir.effectSites.length, 0);
    assert.equal(foreignOnly.ir.packageIntrinsics.length, 0, 'A foreign offset cannot recognize a local call');
  }
  const linked = build(files[0], { packageIntrinsics: intrinsics, packageIntrinsicForCall: call => call === callFor(files[0]) ? intrinsics[1] : undefined });
  assert.deepEqual(linked.diagnostics, []);
  assert.equal(linked.ir.packageIntrinsics[0].loc.file, 'src/other.ts', 'Generated-call rebasing retains original source ownership');
}

async function main() {
  assertSourceIndexes();
  const tc = acceptanceToolchain();
  const root = path.resolve(__dirname, '../../..');
  const cwd = fs.mkdtempSync(path.join(__dirname, '.multifile-'));
  let executions = 0;
  try {
    fs.cpSync(path.join(__dirname, '../fixtures/projects/multifile-digest'), path.join(cwd, 'src'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
    for (const name of ['pulse', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
    fs.mkdirSync(path.join(cwd, '.pulse'));
    const config = { pulse: { entry: 'src/index.ts', defaultProfile: 'node-native', strict: false, crypto: ['SHA-256'] } };
    for (const [host, target] of [['node', 'native'], ['node', 'javascript'], ['fastly', 'native']]) config[`${host}-${target}`] = { host, target };
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope) => (${JSON.stringify(config)}));`);
    const resolve = profile => tc.resolveProject({ cwd, profile });
    const first = fs.readFileSync(path.join(cwd, 'src/first.ts'), 'utf8');
    const other = fs.readFileSync(path.join(cwd, 'src/other.ts'), 'utf8');
    assert.equal(first.indexOf('crypto.digestText(ctx'), other.indexOf('crypto.digestText(ctx'));
    // Preserve the original minimal collision before strengthening the response oracle.
    tc.compileNativeProjectInMemory(resolve('node-native'));
    for (const name of ['first', 'other']) {
      const source = fs.readFileSync(path.join(cwd, `src/${name}.ts`), 'utf8');
      fs.writeFileSync(path.join(cwd, `src/${name}.ts`), source.replace('crypto.digestText(ctx,raw)', `crypto.digestText(ctx,raw + '${name}')`).replace('return ctx.text(result.status)', "if(result.status==='ok')return ctx.text(result.sha256);return ctx.text(result.reason)"));
    }
    for (const names of [['first', 'other'], ['other', 'first']]) {
      fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';\n${names.map(name => `import ${name} from './${name}';`).join('\n')}\nconst app=new Pulse({auto:true});${names.map(name => `app.post('/${name}',${name});`).join('')}export default app;`);
      const node = tc.compileNativeProjectInMemory(resolve('node-native'));
      const fastly = tc.compileFastly(resolve('fastly-native'));
      const js = tc.prepareJavascriptApplication(resolve('node-javascript'));
      const sites = node.compiled.metadata.effectSites.filter(site => site.kind === 'crypto.digestText');
      assert.equal(sites.length, 2);
      assert.deepEqual(sites.map(site => site.position.file).sort(), ['src/first.ts', 'src/other.ts']);
      for (const name of ['first', 'other']) {
        const body = 'exact\u0000é😀';
        const request = { method: 'POST', path: `/${name}`, url: `https://identity.test/${name}`, headers: [], body };
        const expected = createHash('sha256').update(body + name).digest('hex');
        for (const profile of ['node-native', 'node-javascript', 'fastly-native']) {
          let response;
          if (profile === 'node-native') ({ response } = await tc.executeCanonicalNativeModule(node.native, tc.driver.executionOptions(resolve(profile).providerConfig, { request, strict: false })));
          else if (profile === 'fastly-native') ({ response } = tc.executeFastlyNativePlatformCapabilities(fastly, { request }));
          else {
            const result = await tc.executeNodeJavascriptApplication(js.loaded.application, new Request(request.url, { method: 'POST', body }), { strict: false });
            response = { status: result.status, body: await result.text() };
          }
          assert.equal(response.status, 200, `${profile}: ${name}`);
          assert.equal(response.body, expected, `${profile}: ${name}, order ${names}`);
          executions++;
        }
      }
    }
    console.log(JSON.stringify({ status: 'passed', executions, sourceOrders: 2, providerReality: false }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.stack || error); console.error(JSON.stringify(error.diagnostics)); process.exitCode = 1; });
