#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { acceptanceToolchain } = require('../../s3/acceptance-toolchain.cjs');
const { buildCanonicalNativePlan } = require('../../../packages/compiler/src/canonical-native-plan');
const { createCanonicalSchemaCodecs } = require('../../../packages/schema-json/src/compiler/canonical-schema-codecs');
const root = path.resolve(__dirname, '../../../..');
const fixtureRoot = path.join(root, 'wasm/test/fixtures/projects/shared-history-helper');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(fixtureRoot, 'src', name), 'utf8');
const digestKey = key => hash('catalog-history-key-v1|' + key);

function fixture(cwd, count, mode = 'helper') {
 fs.cpSync(path.join(fixtureRoot, 'src'), path.join(cwd, 'src'), { recursive: true });
 fs.cpSync(path.join(fixtureRoot, '.pulse'), path.join(cwd, '.pulse'), { recursive: true });
 fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
 for (const name of ['pulse', 'runtime', 's3', 'crypto']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
 const helper = read('lookup.ts');
 const caller = `const result=await lookup(ctx,ctx.req.header('x-owner')||'owner',ctx.req.header('x-root')||'',0,ctx.req.header('x-key')||'key');
 if(result.code!=='')return ctx.req.header('x-bulk')==='1'?ctx.text('bulk:'+result.code,{status:207}):ctx.text(result.code,{status:result.status});
 return ctx.text('after:'+result.value);`;
 let source = `import {Pulse} from '@pulse-compute/pulse';\nimport {lookup} from './lookup';\nconst app=new Pulse({auto:true});\n`;
 if (mode === 'same-file') source = helper.replace('export const lookup=', 'const lookup=') + '\n' + source.replace("import {lookup} from './lookup';", '');
 if (mode === 'expanded') {
  // Existing handler lowering is the control. No helper result/return is silently
  // reinterpreted: explicitly map every error to its existing terminal response.
  const body = helper.slice(helper.indexOf('=>{') + 3, helper.lastIndexOf('}'))
   .replace(/return \{code:('([^']*)'|ixError),status:(\d+),value:''\};/g, (_all, code, _literal, status) => `return ctx.text(${code},{status:${status}});`)
   .replace("return {code:'',status:200,value:ixResults[0]};", "return ctx.text('after:'+ixResults[0]);");
  assert.ok(!body.includes('return {code:'), 'Every helper outcome must map explicitly');
  source = helper.slice(0, helper.indexOf('export const lookup=')) + `\nimport {Pulse} from '@pulse-compute/pulse';\nconst app=new Pulse({auto:true});\nconst stage=async(ctx)=>{const owner=ctx.req.header('x-owner')||'owner',rootHash=ctx.req.header('x-root')||'',rootNode=0,key=ctx.req.header('x-key')||'key';${body}};\n`;
 }
 for (let i = 0; i < count; i++) source += mode === 'expanded' ? `app.get('/lookup/${i}',stage);\n` : `app.get('/lookup/${i}',async(ctx)=>{${caller}});\n`;
 source += 'export default app;\n';
 fs.writeFileSync(path.join(cwd, 'src/index.ts'), source);
 return { entrySha256: hash(source), helperSha256: hash(helper), helperBytes: Buffer.byteLength(helper) };
}

function errorRecord(error) {
 return { code: error.code, message: error.message, diagnostics: error.diagnostics, detail: error.detail };
}

async function semantics(tc, cwd, report) {
 const project = tc.resolveProject({ cwd, profile: 'javascript' });
 const prepared = tc.prepareJavascriptApplication(project);
 const registry = require('../../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd, 'src/schemas.ts'), { projectRoot: cwd }).registry;
 const schemaCodecs = createCanonicalSchemaCodecs(registry);
 const secrets = { S3_ID: 'fixture-id', S3_KEY: 'fixture-secret-012345678901234567890123456789' };
 const pack = (key, value, owner = 'owner') => JSON.stringify({ schemaVersion: 1, owner, nodes: [{ prefix: digestKey(key), key, value, children: [] }] });
 const found = pack('key', 'record-A'), missing = pack('other', 'record-B'), wrongOwner = pack('key', 'record-A', 'wrong');
 const objects = { [hash(found)]: found }; let child = hash(found);
 for (let depth = 63; depth >= 0; depth--) {
  const children = Array.from({ length: 16 }, () => ({ hash: '', node: -1 }));
  const slot = parseInt(digestKey('key')[depth], 16), other = (slot + 1) % 16;
  children[slot] = { hash: child, node: 0 }; children[other] = { hash: '', node: 1 };
  const text = JSON.stringify({ schemaVersion: 1, owner: 'owner', nodes: [
   { prefix: digestKey('key').slice(0, depth), key: '', value: '', children },
   { prefix: (digestKey('key').slice(0, depth) + other.toString(16)).padEnd(64, '0'), key: 'unselected-' + depth, value: 'other', children: [] }
  ] });
  child = hash(text); objects[child] = text;
 }
 const cases = [
  { name: 'found', text: found, expected: [200, 'after:record-A'], reads: 1 },
  { name: '65-packs-two-rounds', text: objects[child], objects, expected: [200, 'after:record-A'], reads: 65 },
  { name: 'not-found', text: missing, expected: [200, 'after:'], reads: 1 },
  { name: 'malformed-root', text: found, root: 'invalid', expected: [503, 'HISTORY_INDEX_INVALID'], reads: 0 },
  { name: 'corrupt-pack', text: found + ' ', root: hash(found), expected: [503, 'HISTORY_INDEX_CORRUPT'], reads: 1 },
  { name: 'wrong-owner', text: wrongOwner, expected: [503, 'HISTORY_INDEX_INVALID'], reads: 1 },
  { name: 'missing-object', text: found, missing: true, expected: [503, 'HISTORY_INDEX_UNAVAILABLE'], reads: 1 },
  { name: 'digest-failure', text: found, digestFailure: true, expected: [503, 'HISTORY_INDEX_UNAVAILABLE'], reads: 0 },
  { name: 'caller-bulk-failure', text: wrongOwner, bulk: true, expected: [207, 'bulk:HISTORY_INDEX_INVALID'], reads: 1 }
 ];
 const checks = [];
 async function execute(row, index = 0, pause) {
  const rootHash = row.root || hash(row.text), key = row.key || 'key'; let reads = 0, digests = 0;
  const subtle = { async digest(...args) { digests++; if (pause?.kind === 'digest') await pause.wait(); if (row.digestFailure) throw Error('fixture digest failure'); return webcrypto.subtle.digest(...args); } };
  const response = await tc.executeNodeJavascriptApplication(prepared.loaded.application,
   new Request('https://proof.test/lookup/' + index, { headers: { 'x-root': rootHash, 'x-key': key, 'x-bulk': row.bulk ? '1' : '0' } }),
   { strict: false, schemaCodecs, secrets, digestSubtle: subtle, s3: project.providerConfig.bindings.s3,
    fetchImplementation: async request => {
     reads++; const url = String(request.url || request), requested = /\/catalog\/history\/index\/([a-f0-9]{64})\.json$/.exec(url)?.[1];
     assert.ok(requested, url); if (!row.objects) assert.equal(requested, rootHash);
     const text = row.objects ? row.objects[requested] : row.text; assert.notEqual(text, undefined);
     if (pause?.kind === 'storage') await pause.wait();
     return new Response(row.missing ? '' : text, { status: row.missing ? 404 : 200 });
    } });
  const actual = [response.status, await response.text()];
  assert.deepEqual(actual, row.expected, row.name); assert.equal(reads, row.reads, row.name + ' reads');
  if (row.expected[0] !== 200) assert.ok(!actual[1].startsWith('after:'), 'Failure must fence success continuation');
  return { name: row.name, registration: index, status: 'passed', reads, digests, response: actual };
 }
 for (const row of cases) checks.push(await execute(row));
 for (const index of [1, 15]) checks.push(await execute(cases[0], index));
 for (const kind of ['storage', 'digest']) {
  let release, arrived; const held = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { arrived = resolve; });
  let paused = false;
  const first = execute(cases[0], 0, { kind, wait: async () => { if (!paused) { paused = true; arrived(); await held; } } });
  try {
   await Promise.race([waiting, first.then(() => { throw Error('Request A never suspended at ' + kind); })]);
   checks.push(await execute({ name: 'interleaved-B-' + kind, text: pack('b', 'record-B'), key: 'b', expected: [200, 'after:record-B'], reads: 1 }, 15));
  } finally { release(); }
  checks.push({ ...await first, name: 'resumed-A-' + kind });
 }
 checks.push(await execute(cases[0], 0));
 report.javascript = { status: 'passed', checks, completedChecks: checks.length,
  scope: 'Original source graph on explicit JavaScript target; not Native shared-frame evidence',
  pending: ['Native helper suspension/resumption', 'Native request-frame isolation', 'Native work-limit and caller bulk-result qualification'] };
}

async function main() {
 const at = process.argv.indexOf('--output'), output = at >= 0 ? path.resolve(process.argv[at + 1]) : null;
 if (output) assert.ok(!fs.existsSync(output), 'Refuse to overwrite evidence');
 const report = { version: 'pulse.o25.history-helper-proof.v1', status: 'running', startedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim()),
  node: process.version,
  proofInputs: ['wasm/test/runtime/compiler-efficiency/o25-history-helper.cjs', 'wasm/test/suite/registry.cjs',
   ...['lookup.ts', 'index.ts', 'types.ts', 'schemas.ts'].map(name => 'wasm/test/fixtures/projects/shared-history-helper/src/' + name),
   'wasm/test/fixtures/projects/shared-history-helper/.pulse/config.ts']
   .map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  cells: [], nativeSharingQualified: false, nativeRuntimeQualified: false, nativeCompilerInvocations: 0 };
 const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
 const tc = acceptanceToolchain(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-o25-'));
 try {
  for (const count of [1, 2, 16]) {
   const cwd = path.join(tmp, 'helper-' + count); fs.mkdirSync(cwd); const source = fixture(cwd, count);
   const cell = { count, source, helper: { status: 'pending' }, expanded: { status: 'pending' } }; report.cells.push(cell); save();
   try { tc.compileProject(tc.resolveProject({ cwd, profile: 'node' })); cell.helper = { status: 'admitted', sharing: 'unmeasured' }; }
   catch (error) { cell.helper = { status: 'rejected', ...errorRecord(error) }; }
   const expanded = path.join(tmp, 'expanded-' + count); fs.mkdirSync(expanded); fixture(expanded, count, 'expanded');
   const compiled = tc.compileProject(tc.resolveProject({ cwd: expanded, profile: 'node' }));
   const plan = buildCanonicalNativePlan(compiled), entries = compiled.metadata.router.entries.filter(e => e.kind === 'route');
   assert.equal(entries.length, count); assert.equal(new Set(entries.map(e => e.handlerId)).size, 1);
   cell.expanded = { status: 'planned', planHash: plan.planHash, stageBodies: plan.stages?.length || 0,
    privateBodies: plan.handlers?.length || 0, registrations: entries.length, effects: plan.effects.length, continuations: plan.continuations.length,
    loweredBodyBytes: entries.reduce((sum, e) => sum + Buffer.byteLength(compiled.router.sourceText.slice(e.generatedRange.start, e.generatedRange.end)), 0),
    statements: plan.summary.statementCount, wasmBytes: null, reasonWasmNotMeasured: 'Helper admission fails before Native planning; do not spend builds measuring an ineligible candidate.' };
   save();
   if (count === 16) await semantics(tc, cwd, report);
  }
  const same = path.join(tmp, 'same-file'); fs.mkdirSync(same); fixture(same, 1, 'same-file');
  try { tc.compileProject(tc.resolveProject({ cwd: same, profile: 'node' })); report.sameFile = { status: 'admitted', sharing: 'unmeasured' }; }
  catch (error) { report.sameFile = { status: 'rejected', ...errorRecord(error) }; }
  report.status = 'blocked';
  const expectedBoundary = report.cells.every(c => c.helper.diagnostics?.some(d => d.code === 'PULSE_PROJECT_RUNTIME_VALUE_IMPORT_UNSUPPORTED'))
   && report.sameFile.diagnostics?.some(d => d.code === 'PULSE_NATIVE_AWAIT_UNSUPPORTED');
  report.blocker = expectedBoundary
   ? 'Native has no admitted callable effectful-helper boundary. Imported helpers fail runtime-value linking; same-file awaited helpers are not trusted effect sites. Expanded handlers do not establish helper sharing.'
   : 'Native admission changed; inspect recorded outcomes and implement the remaining sharing/Native gates before claiming success.';
  report.pendingGates = ['One retained compiled helper body', '1/2/16 binding/frame/continuation growth', 'Native behavior parity and work-limit refusal', 'Native suspended-frame and request isolation', 'Final-Wasm attribution'];
  process.exitCode = 2;
 } catch (error) { report.status = 'failed'; report.failure = errorRecord(error); process.exitCode = 1; }
 finally { report.completedAt = new Date().toISOString(); save(); fs.rmSync(tmp, { recursive: true, force: true }); }
 console.log(JSON.stringify({ status: report.status, cells: report.cells.map(c => ({ count: c.count, helper: c.helper.status, expanded: c.expanded })), javascriptChecks: report.javascript?.completedChecks, failure: report.failure, output }));
}
// Standalone awaited effect tests must not disappear with an unresolved Promise.
// The registered task and documented direct invocation both have a 90s deadline.
const keepAlive = setInterval(() => {}, 1000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
