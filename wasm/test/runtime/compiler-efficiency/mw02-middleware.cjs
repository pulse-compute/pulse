#!/usr/bin/env node
'use strict';
// Opt-in MW-02 proof: existing value operations and effects in one shared stage.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { compileProject } = require('../../../packages/cli/src/project-execution');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../../packages/compiler/src/canonical-native-plan');
const { compileFastlyNativePlatformCapabilitiesPlan } = require('../../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { inspect } = require('./o18-wasm-proof.cjs');
const root = path.resolve(__dirname, '../../../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const optimization = 'experimental-native-bounded-size';

function fixture(cwd, registrations) {
  for (const directory of ['src', '.pulse', 'node_modules/@pulse-compute']) fs.mkdirSync(path.join(cwd, directory), { recursive: true });
  for (const name of ['pulse', 'runtime', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  const stage = `import {crypto} from '@pulse-compute/crypto';
import type {PulseContext,RouterNext} from '@pulse-compute/runtime';
import type {RecordValue} from './types';
const stage=async(ctx:PulseContext,next:RouterNext)=>{
 const mode=ctx.req.header('x-mode')||'';
 if(mode==='early')return ctx.text('early',{status:409});
 const decoded=ctx.decodeJson<RecordValue>(ctx.req.header('x-record')||'','proof.Record');
 const note=decoded.note;
 let value:RecordValue={owner:decoded.owner,grants:[]};
 if(note!==undefined)value.note=note+':updated';
 for(let index=0;index<16&&index<decoded.grants.length;index++){
  const grant=decoded.grants[index];
  if(grant==='skip')continue;
  if(grant==='stop')break;
  value.grants[value.grants.length]=grant;
 }
 const encoded=ctx.encodeJson(value,'proof.Record');
 const visits=ctx.state.get('visits')||'';ctx.state.set('visits',visits+'x');
 const sample=await ctx.time.now();
 if(sample.status!=='ok')return ctx.text('clock-failed',{status:503});
 const digest=await crypto.digestText(ctx,encoded+'|'+sample.unixEpochMs);
 if(digest.status!=='ok')return ctx.text('digest-failed',{status:503});
 ctx.state.set('result',encoded+'|'+sample.unixEpochMs+'|'+digest.sha256);
 if(mode==='stop')return ctx.text('stopped|'+ctx.state.get('result'),{status:409});
 return next();
};export default stage;`;
  const entry = `import {Pulse} from '@pulse-compute/pulse';
import {Router} from '@pulse-compute/runtime';import stage from './stage';
const app=new Pulse({auto:true});const child=new Router();
child.use('/item/0',stage);
${registrations===3?"child.use('/item/0',stage);child.use('/item/1',stage);":''}
child.get('/item/0',async(ctx)=>ctx.text('0|'+ctx.state.get('visits')+'|'+ctx.state.get('result')));
${registrations===3?"child.get('/item/1',async(ctx)=>ctx.text('1|'+ctx.state.get('visits')+'|'+ctx.state.get('result')));":''}
app.mount('/chain',child);
export default app;`;
  const files = {
    'src/stage.ts': stage, 'src/index.ts': entry,
    'src/types.ts': 'export interface RecordValue{owner:string;note?:string;grants:string[]}',
    'src/schemas.ts': "import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {RecordValue} from './types';export default defineSchemaRegistry({schemas:{'proof.Record':schema<RecordValue>()}});",
    '.pulse/config.ts': "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false,crypto:['SHA-256']},native:{host:'node',target:'native'}}));"
  };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), content);
  return { fixtureSha256: hash(stableStringify(files)) };
}
function planFor(cwd, options) {
  const tc = acceptanceToolchain();
  return buildCanonicalNativePlan(compileProject(tc.resolveProject({ cwd, profile: 'native' }), { target: 'native' }), options);
}
module.exports = { fixture, planFor };

function rejectTampering(plan) {
  const checks = [];
  const reject = (name, mutate) => {
    const copy = JSON.parse(JSON.stringify(plan)); mutate(copy);
    const unsigned = { ...copy }; delete unsigned.planHash;
    copy.planHash = hash(stableStringify(unsigned));
    assert.throws(() => validateCanonicalNativePlan(copy), error => error.name === 'CanonicalNativePlanError', name);
    checks.push(name);
  };
  const loop = p => p.stages[0].body.find(s => s.kind === 'pure-loop');
  reject('loop counter ownership', p => { loop(p).localId = p.stages[0].inputs.routerLocals.cursor; });
  reject('loop cap', p => { loop(p).maxIterations = 65537; });
  reject('effect inside pure loop', p => {
    const body = p.stages[0].body, index = body.findIndex(s => s.kind === 'effect');
    loop(p).body.push(body.splice(index, 1)[0]);
  });
  reject('crossed registration effect', p => { p.stages[0].registrations[1].effectIds[0] = p.stages[0].registrations[0].effectIds[0]; });
  reject('crossed registration continuation', p => { p.stages[0].registrations[1].continuationIds[1] = p.stages[0].registrations[0].continuationIds[1]; });
  reject('wrong digest contract', p => { p.effects.find(e => e.kind === 'crypto.digestText').contractId = 'not-the-digest-contract'; });
  return checks;
}

function execute(built, { index = 0, record, cycles = 1, mode = '', pathname, clockFailed = false }) {
  const tc = acceptanceToolchain(); let clocks = 0;
  const url = 'https://app.test' + (pathname || '/chain/item/' + index);
  const result = tc.executeFastlyNativePlatformCapabilities(built, {
    request: { method: 'GET', path: new URL(url).pathname, url, headers: [['x-record', JSON.stringify(record)], ['x-mode', mode]] },
    realtimeClock() { clocks++; return { status: clockFailed ? 1 : 0, nanoseconds: BigInt(1000 + clocks) * 1000000n }; }
  });
  if (pathname) assert.deepEqual([result.response.status, result.response.body, clocks], [404, 'Not Found', 0]);
  else if (mode === 'early') assert.deepEqual([result.response.status, result.response.body, clocks], [409, 'early', 0]);
  else if (clockFailed) assert.deepEqual([result.response.status, result.response.body, clocks], [503, 'clock-failed', 1]);
  else {
    const clockCount = mode ? 1 : cycles;
    assert.equal(clocks, clockCount);
    const grants = [];
    for (const grant of record.grants.slice(0, 16)) { if (grant === 'stop') break; if (grant !== 'skip') grants.push(grant); }
    const expected = { owner: record.owner, grants };
    if (record.note !== undefined) expected.note = record.note + ':updated';
    const status = mode === 'stop' ? 409 : 200;
    const prefix = mode === 'stop' ? 'stopped|' : index + '|' + 'x'.repeat(cycles) + '|';
    assert.equal(result.response.status, status); assert.ok(result.response.body.startsWith(prefix));
    const [encoded, ms, digest] = result.response.body.slice(prefix.length).split('|');
    assert.deepEqual(JSON.parse(encoded), expected);
    assert.equal(ms, String(1000 + clockCount));
    // Digest of the encoded, updated record and this invocation's clock sample:
    // both effects and value work must occur before the terminal continuation.
    assert.equal(digest, hash(encoded + '|' + ms));
  }
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mw02-'));
  const sourceFiles = ['wasm/packages/compiler/src/shared-stage-plan.js', 'wasm/packages/contracts/src/handler/canonical-native-plan.js', 'wasm/packages/runtime-core-as/src/compiler/canonical-native.js', 'wasm/test/runtime/compiler-efficiency/mw02-middleware.cjs', 'wasm/test/runtime/compiler-efficiency/o18-wasm-proof.cjs'];
  const report = { status: 'running', scope: 'Tiny Native middleware value/effect proof and retained optimized Fastly Wasm; no deployment or application-size claim',
    sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])), cells: [] };
  const output = process.argv[2] && path.resolve(process.argv[2]);
  const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
  try {
    for (const registrations of [1, 3]) {
      const cwd = path.join(directory, 'fixture-' + registrations), source = fixture(cwd, registrations), plan = planFor(cwd);
      assert.equal(plan.stages.length, 1); assert.equal(plan.stages[0].registrations.length, registrations);
      assert.equal(plan.effects.length, registrations * 2);
      assert.equal(new Set(plan.effects.map(e => e.id)).size, registrations * 2);
      assert.equal(new Set(plan.continuations.map(c => c.id)).size, registrations * 2);
      for (const row of plan.stages[0].registrations) assert.deepEqual(row.effectIds.map(id => plan.effects.find(e => e.id === id).kind), ['time.now', 'crypto.digestText']);
      validateCanonicalNativePlan(JSON.parse(JSON.stringify(plan))); assert.equal(plan.planHash, planFor(cwd).planHash);
      if (registrations === 3) report.planRejections = rejectTampering(plan);
      const started = performance.now();
      const built = compileFastlyNativePlatformCapabilitiesPlan(plan, { cwd: root, canonicalBuild: true, requirePlatformCapability: false, emitWat: false, nativeOptimization: optimization, bindings: {} });
      const inspectionDir = path.join(directory, 'inspect-' + registrations); fs.mkdirSync(inspectionDir);
      const retained = inspect(built, 'fastly', inspectionDir, optimization, { maxPartitions: 4, allowSchemaRuntimeIndirect: true });
      let requests = 0;
      const run = options => { execute(built, options); requests++; };
      const record = { owner: 'first', note: 'present', grants: ['read', 'skip', 'write', 'stop', 'ignored'] };
      run({ record, cycles: registrations === 3 ? 2 : 1 });
      if (registrations === 3) {
        run({ index: 1, record: { owner: 'second', grants: ['fresh'] } });
        run({ record: { owner: 'bounded', grants: Array.from({ length: 20 }, (_, i) => 'g' + i) }, cycles: 2 });
        run({ record: { owner: 'empty', note: '', grants: [] }, cycles: 2 });
        for (const mode of ['early', 'stop']) run({ index: 1, record, mode });
        run({ index: 1, record, clockFailed: true });
        run({ record, pathname: '/miss' }); run({ record, pathname: '/chain/miss' });
        run({ record: { owner: 'after-failures', grants: [] }, cycles: 2 });
      }
      report.cells.push({ registrations, optimization, planHash: plan.planHash, ...source, wasmBytes: built.wasm.length, retained, requests, elapsedMs: Math.round(performance.now() - started) });
      save(); console.log('passed', registrations, optimization, built.wasm.length, 'bytes');
    }
    assert.equal(report.cells[0].retained.sharedBodyPartitions, report.cells[1].retained.sharedBodyPartitions);
    report.status = 'passed'; report.sameRequestReentry = true; report.freshRequestIsolation = true;
    save(); console.log(JSON.stringify(report));
  } catch (error) { report.status = 'failed'; report.failure = { name: error.name, message: error.message }; save(); throw error; }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); if (error.detail) { const { source, ...detail } = error.detail; console.error(detail); } if (error.diagnostics) console.error(error.diagnostics); process.exitCode = 1; });
