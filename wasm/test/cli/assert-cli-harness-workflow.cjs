#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repoRoot } = require('./helpers.cjs');
const owner = path.join(repoRoot, 'wasm/packages/cli');
const harness = require(path.join(owner, 'src/internal/harness-assertion'));
const { errorSummary } = require(path.join(owner, 'src/internal/execution-error'));
const secret = 'PRIVATE_ASSERTION_CANARY';
function failure(expectation, actual, expected, testCase = {}, response) {
  let error;
  try { harness.check({ name: 'safe case', ...testCase }, expectation, () => assert.deepEqual(actual, expected), response); }
  catch (caught) { error = caught; }
  assert(error);
  return errorSummary(error, { key: secret });
}
const circular = {}; circular.self = circular;
for (const value of [secret.repeat(10000), Buffer.from(secret), circular, [secret]]) {
  const out = failure('response.json', value, 'different');
  assert.equal(out.code, 'PULSE_TEST_ASSERTION'); assert.equal(out.category, 'test');
  assert(!JSON.stringify(out).includes(secret)); assert(JSON.stringify(out).length < 4096);
}
for (const name of ['authorization', 'cookie', 'set-cookie', 'x-api-key']) {
  const out = failure('response.headers.' + name, secret, 'expected', { request: { headers: [[name, secret]] } }, { status: 200 });
  assert.equal(out.detail.actual, '<redacted>'); assert.equal(out.detail.request.header.values, '<redacted>');
  assert(!JSON.stringify(out).includes(secret));
}
assert(!JSON.stringify(failure('response.headers.x-test', 'prefix' + secret + 'suffix', 'expected')).includes(secret));
assert.equal(failure('event.result', { private: secret }, {}).detail.kind, 'http');
assert.equal(failure('event.status', 'failed', 'completed', { kind: 'event' }).detail.kind, 'event');
assert.equal(failure('error.code', 'ACTUAL', 'EXPECTED').detail.expectation, 'error.code');
assert.equal(errorSummary(new assert.AssertionError({ message: 'application assertion' })).category, 'internal');
assert.equal(errorSummary({code:'UNRECOGNIZED', message:'application'}).scope, 'fallback');

fs.mkdirSync(path.join(repoRoot, 'wasm/.test-results'), { recursive: true });
const temp = fs.mkdtempSync(path.join(repoRoot, 'wasm/.test-results/harness-diagnostic-'));
function child(args, cwd = temp) {
  const result = spawnSync(process.execPath, args, {cwd, encoding:'utf8', timeout:60000, maxBuffer:4*1024*1024});
  assert.ifError(result.error); return result;
}
try {
  const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd:owner, encoding:'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const installed = path.join(temp, 'packed-cli'); fs.mkdirSync(installed);
  const unpacked = spawnSync('tar', ['-xzf', path.join(temp, JSON.parse(packed.stdout)[0].filename), '--strip-components=1', '-C', installed]);
  assert.equal(unpacked.status, 0);
  // Exercise the packed CLI with the checkout's restored dependency bundle.
  fs.symlinkSync(path.join(owner, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
  const project = path.join(temp, 'project');
  for (const dir of ['.pulse', 'src', 'tests']) fs.mkdirSync(path.join(project, dir), { recursive:true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({name:'harness-diagnostic', private:true, type:'module'}));
  fs.writeFileSync(path.join(project, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig(_=>({pulse:{entry:'src/index.ts',tests:'tests/pulse.harness.ts',defaultProfile:'local'},local:{host:'node',target:'native'}}));`);
  fs.writeFileSync(path.join(project, 'src/index.ts'), `export default async function handler(ctx) { return ctx.text('PRIVATE_ASSERTION_CANARY', {headers:{'x-test':'actual',authorization:'PRIVATE_ASSERTION_CANARY'}}); }`);
  fs.writeFileSync(path.join(project, 'tests/pulse.harness.ts'), `const request=(header='helper-default')=>({method:'GET',path:'/',headers:header===null?{}:{'x-test':header}}); export default [
    {name:'status mismatch',request:request(),expect:{status:201}},
    {name:'body mismatch',request:request(),expect:{text:'different'}},
    {name:'header default',request:request(undefined),expect:{headers:{'x-test':null}}},
    {name:'header omitted',request:request(null),expect:{headers:{'x-test':null}}},
    {name:'sensitive header',request:request(),expect:{headers:{authorization:'expected'}}},
    {name:'missing error',request:request(),expect:{error:{name:'AssertionError'}}}
  ];`);
  for (const cli of [path.join(repoRoot,'wasm/scripts/pulse.cjs'), path.join(installed,'bin/pulse.js')]) {
    const json = child([cli,'test','--json'], project);
    assert.equal(json.status, 1, json.stderr || json.stdout);
    assert(json.stdout, json.stderr);
    const out = JSON.parse(json.stdout);
    assert.deepEqual(out.summary, {total:6,passed:0,failed:6});
    for (const row of out.cases) { assert.equal(row.error.code, 'PULSE_TEST_ASSERTION'); assert.equal(row.error.detail.case, row.name); }
    assert.equal(out.cases[0].error.detail.actual, 200); assert.equal(out.cases[0].error.detail.expected, 201);
    assert.equal(out.cases[1].error.detail.actual.type, 'string');
    assert.equal(out.cases[2].error.detail.request.header.present, true);
    assert.deepEqual(out.cases[2].error.detail.request.header.values, ['helper-default']);
    assert.equal(out.cases[3].error.detail.request.header.present, false);
    assert.equal(out.cases[4].error.detail.actual, '<redacted>');
    assert.equal(out.cases[5].error.detail.expectation, 'error.present');
    assert(!json.stdout.includes(secret));
    const human = child([cli,'test'], project);
    assert.equal(human.status, 1, human.stderr || human.stdout);
    assert(human.stdout.includes('expected: 201')); assert(human.stdout.includes('actual: 200'));
    assert(human.stdout.includes('response.headers.x-test')); assert(human.stdout.includes('helper-default'));
    assert(!human.stdout.includes(secret));
  }
  const eventProject = path.join(temp, 'event-project');
  fs.cpSync(path.join(repoRoot, 'wasm/test/fixtures/projects/events-cli'), eventProject, {recursive:true});
  const scope = path.join(eventProject, 'node_modules/@pulse-compute'); fs.mkdirSync(scope, {recursive:true});
  for (const name of ['pulse', 'runtime', 'provider-node', 'provider-fastly']) fs.symlinkSync(path.join(repoRoot, 'packages', name), path.join(scope, name), 'dir');
  const eventHarness = path.join(eventProject, 'tests/pulse.harness.ts');
  fs.writeFileSync(eventHarness, fs.readFileSync(eventHarness, 'utf8').replace('result: { accepted: true, sequence: 7 }', 'result: { accepted: true, sequence: 8 }'));
  for (const cli of [path.join(repoRoot,'wasm/scripts/pulse.cjs'), path.join(installed,'bin/pulse.js')]) {
    const result = child([cli, 'test', '--profile', 'node-javascript', '--json'], eventProject);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.summary, {total:2,passed:1,failed:1});
    const error = out.cases[1].error;
    assert.equal(error.code, 'PULSE_TEST_ASSERTION'); assert.equal(error.detail.kind, 'event');
    assert.equal(error.detail.expectation, 'event.result');
    assert.equal(error.detail.actual.type, 'object');
  }
  console.log('ok - owned harness diagnostics, private bounded values, header omission/default, preserved failure counts, source and packed CLI JSON/human output');
} finally { fs.rmSync(temp, {recursive:true,force:true}); }
