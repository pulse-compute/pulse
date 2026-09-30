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
 if (mode === 'middleware') {
  source += `app.use(async(ctx,next)=>{${caller.replace("return ctx.text('after:'+result.value);", "ctx.state.set('lookup',''+result.value);return next();")}});\n`;
 }
 for (let i = 0; i < count; i++) source += mode === 'middleware' ? `app.get('/lookup/${i}',async(ctx)=>ctx.text('after:'+ctx.state.get('lookup')));\n` : mode === 'expanded' ? `app.get('/lookup/${i}',stage);\n` : `app.get('/lookup/${i}',async(ctx)=>{${caller}});\n`;
 source += 'export default app;\n';
 fs.writeFileSync(path.join(cwd, 'src/index.ts'), source);
 return { entrySha256: hash(source), helperSha256: hash(helper), helperBytes: Buffer.byteLength(helper) };
}

function errorRecord(error) {
 return { code: error.code, message: error.message, diagnostics: error.diagnostics, detail: error.detail };
}

async function semantics(tc, cwd, report, native) {
 const project = tc.resolveProject({ cwd, profile: 'javascript' });
 const prepared = native ? null : tc.prepareJavascriptApplication(project);
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
  const executeRequest = native ? async (_application, request, options) => {
   const result = await tc.executeCanonicalNativeModule(native, { strict: false, schemaCodecs,
    request: { method: request.method, url: request.url, path: new URL(request.url).pathname, headers: Object.fromEntries(request.headers) },
    providerAdapter: { id: 'o25-injected-host', async dispatchEffect(effect) {
     if (effect.kind === 'crypto.digestText') {
      try { const bytes = new TextEncoder().encode(effect.payload.text); const digest = await subtle.digest('SHA-256', bytes); return { status: 'ok', sha256: Buffer.from(digest).toString('hex'), byteLength: bytes.length }; }
      catch { return { status: 'unavailable' }; }
     }
     assert.equal(effect.kind, 's3.getText');
     const response = await options.fetchImplementation(new Request('https://objects.test/' + effect.payload.key));
     return response.status === 404 ? { status: 'not-found' } : { status: 'found', text: await response.text() };
    } } });
   return new Response(result.response.body, { status: result.response.status });
  } : tc.executeNodeJavascriptApplication;
  const response = await executeRequest(prepared?.loaded.application,
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
 report[native ? 'native' : 'javascript'] = { status: 'passed', checks, completedChecks: checks.length,
  scope: native ? 'Compiled Native helper with injected storage and SHA-256 effects; not deployed provider qualification' : 'Original source graph on explicit JavaScript target; not Native shared-frame evidence',
  pending: native ? ['Work-limit and caller bulk-result qualification'] : ['Native helper suspension/resumption', 'Native request-frame isolation', 'Native work-limit and caller bulk-result qualification'] };
}

module.exports = { fixture, semantics };
if (require.main === module) require('./o25-helper-unblocked.cjs');
