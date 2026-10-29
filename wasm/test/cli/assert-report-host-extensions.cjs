#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const report = '../../packages/cli/src/internal/report/';
const { parseCapsule, createCapsule, serializeCapsule, stableReportId: id } = require(report + 'capsule');
const { canonicalJson: json, sha256 } = require(report + 'data');
const { compareCapsules, serializeComparison, parseComparison } = require(report + 'comparison');
const { renderReport, renderComparison } = require(report + 'viewer');
const host = require(report + 'host-evidence');
const cliBuild = require('../support/terminal-cli.cjs');
const fixture = require('../support/host-extension-fixture.cjs');
const { errorSummary } = require('../../packages/cli/src/internal/execution-error');
const { describeDiagnostic } = require('../../packages/cli/src/diagnostics');
const names = ['hostContributions', 'hostUseSites', 'hostAudits'];
const clone = value => JSON.parse(JSON.stringify(value));
const complete = n => ({ status: 'complete', observed: n, expected: n, reason: null });
const dirs = [];
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('ok - ' + name); }
function link(dir, name) { const file = path.join(dir, 'node_modules/@pulse-compute', name); fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.symlinkSync(path.join(root, 'packages', name), file); }
function build(source, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-host-report-'))) {
  if (!dirs.includes(dir)) dirs.push(dir);
  for (const name of ['grip', 'runtime']) link(dir, name);
  fs.writeFileSync(path.join(dir, 'app.ts'), source);
  const wasm = cliBuild(dir, root, false), out = path.join(dir, 'cli-out');
  assert(fs.existsSync(path.join(out, 'pulse-report-inventory.json')), JSON.stringify(JSON.parse(fs.readFileSync(path.join(out, 'pulse-build.json'))).reportEvidence));
  const capsule = parseCapsule(fs.readFileSync(path.join(out, 'pulse-report-inventory.json'), 'utf8'));
  return { dir, out, wasm, capsule };
}
function cli(dir, args) { return spawnSync(process.execPath, [path.join(root, 'wasm/scripts/pulse.cjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 90000 }); }
const author = op => `import { ${op} } from '@pulse-compute/grip/experimental';\n// PRIVATE_SOURCE_CANARY\nexport default async function handler(ctx) { return ${op}(ctx, 'edge'); }`;
function rehash(c) {
  const a = c.hostAudits[0];
  const contributions = c.hostContributions.map(r => ({ id:r.contributionId, package:r.package, contractId:r.contractId, version:r.protocol,
    operation:r.operation, target:r.target, service:r.service, entry:r.entry, sha256:r.sourceSha256 })).sort((a,b)=>a.id.localeCompare(b.id));
  const imports = [...new Map(c.hostContributions.flatMap(r=>r.declaredImports).map(i=>[json(i),i])).values()].sort((a,b)=>json(a)<json(b)?-1:1);
  a.policySha256 = sha256(json({ version:a.policyVersion, baselineSha256:a.baselineSha256, contributions, imports }));
  c.hostContributions.forEach(r=>r.policySha256=a.policySha256);
  return createCapsule(c);
}
try {
  const fanout = build(author('handoffFanout'));
  const websocket = build(`import {Router} from '@pulse-compute/runtime'; import {handoffWebSocket} from '@pulse-compute/grip/experimental';
const app=new Router(); app.get('/health', async ctx=>ctx.text('ordinary')); app.get('/ws', async ctx=>{return handoffWebSocket(ctx,'edge');}); export default app;`);
  const independent = fixture({ name:'@independent/report-terminal', version:'91.7.3', abi:'fastly_http_req', abiName:'redirect_to_grip_proxy_v2' });
  dirs.push(independent.root);
  fs.writeFileSync(path.join(independent.root,'package.json'),JSON.stringify({private:true,dependencies:{[independent.name]:'91.7.3'}}));
  const outside = build("import {transfer} from '@independent/report-terminal'; export default async function handler(ctx) {return transfer(ctx,'edge');}", independent.root);
  for (const [built, operation, imported] of [[fanout,'handoffFanout','redirect_to_grip_proxy_v2'], [websocket,'handoffWebSocket','redirect_to_websocket_proxy_v2'], [outside,'transfer','redirect_to_grip_proxy_v2']]) check(operation + ' exact capture and replay', () => {
    const c=built.capsule, contribution=c.hostContributions[0], audit=c.hostAudits[0], site=c.hostUseSites[0];
    assert.equal(c.hostContributions.length,1); assert.equal(c.hostUseSites.length,1); assert.equal(c.hostAudits.length,1);
    assert.equal(contribution.operation,operation); assert.equal(contribution.artifactId,c.context.primaryArtifactId);
    assert.equal(contribution.service,'terminal-request-backend.v1'); assert.equal(contribution.implementation,'fastly.native.terminal-request-backend.v1');
    assert.equal(contribution.target.targetId,'fastly-compute-native'); assert.equal(contribution.declaredImports[0].name,imported);
    assert.equal(site.source.file,'app.ts'); assert.equal(site.entryIds.length,1); assert.equal(site.contributionId,contribution.id);
    assert(audit.observedImports.some(i=>i.name===imported && i.parameters.join(',')==='i32,i32,i32'));
    assert(audit.observedImports.length>contribution.declaredImports.length); assert.equal(audit.importCoverage.status,'complete');
    assert.equal(audit.runtimeObservationCoverage.status,'unavailable'); assert.equal(audit.runtimeObservationCoverage.expected,null);
    assert(audit.lifecycle.selectedPoints.some(s=>s.points.some(p=>p.point==='effect.settle')));
    const wire=serializeCapsule(c), html=renderReport(c);
    for(const forbidden of ['PRIVATE_SOURCE_CANARY','edge_backend','@external(',built.dir]) {assert(!wire.includes(forbidden));assert(!html.includes(forbidden));}
    for(const code of html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)) if(!code[0].includes('application/json')) new vm.Script(code[1]);
    assert.equal(serializeCapsule(parseCapsule(wire)),wire);
    assert.equal(parseComparison(serializeComparison(compareCapsules(c,c))).sections.length,0);
    const replay=cli(built.dir,['report','--artifact','cli-out/pulse-report-inventory.json','--json']); assert.equal(replay.status,0,replay.stderr);
    assert.equal(parseCapsule(replay.stdout).evidenceHash.value,c.evidenceHash.value);
    assert.equal(sha256(built.wasm),c.artifacts.find(a=>a.id===c.context.primaryArtifactId).sha256);
  });
  check('independent identity and authored Router owner',()=>{
    assert.equal(outside.capsule.hostContributions[0].package,'@independent/report-terminal');assert.equal(outside.capsule.hostContributions[0].packageVersion,'91.7.3');
    const c=websocket.capsule, site=c.hostUseSites[0], route=c.routes.find(r=>r.path==='/ws');
    assert.deepEqual(site.entryIds,[route.entryId]); assert.equal(site.sourceBasis,'authored-entry');
    assert.equal(c.entries.find(e=>e.id===site.entryIds[0]).source.file,'app.ts');
  });
  check('unique contribution versus repeated report use sites',()=>{
    const c=clone(fanout.capsule), site=clone(c.hostUseSites[0]);site.canonicalId='another-site';site.id=id('host-use-site',site.canonicalId);
    c.hostUseSites.push(site);c.coverage.hostUseSites=complete(2);
    const report=createCapsule(c);assert.equal(report.hostContributions.length,1);assert.equal(report.hostUseSites.length,2);
    const diff=compareCapsules(fanout.capsule,report);assert.equal(diff.sections.find(s=>s.collection==='hostUseSites').changes[0].status,'added');
  });
  check('historical absence is unknown, never an addition from zero',()=>{
    const old=clone(fanout.capsule);for(const name of names){delete old[name];delete old.coverage[name];}
    const historical=createCapsule(old), diff=compareCapsules(historical,fanout.capsule);
    for(const name of names){const section=diff.sections.find(s=>s.collection===name);assert(section.changes.every(r=>r.status==='unresolved'));}
    assert(renderComparison(diff).includes('Host contributions'));
    assert.equal(compareCapsules(historical,historical).summary.inventories.some(i=>names.includes(i.collection)),false);
  });
  check('source, implementation, target and policy changes are visible',()=>{
    const changed=clone(fanout.capsule);changed.hostContributions[0].sourceSha256='a'.repeat(64);
    changed.hostContributions[0].implementation='fixture.implementation.v2';changed.hostContributions[0].target.targetId='fixture-target-v2';
    const diff=compareCapsules(fanout.capsule,rehash(changed));
    const paths=diff.sections.find(s=>s.collection==='hostContributions').changes.flatMap(r=>r.fields.map(f=>f.path));
    for(const field of ['/sourceSha256','/implementation','/target/targetId','/policySha256']) assert(paths.includes(field),field);
  });
  check('replay rejects mismatched policy, import, coverage, source and foreign links',()=>{
    for(const mutate of [c=>c.hostAudits[0].baselineSha256='0'.repeat(64),c=>c.hostAudits[0].policySha256='0'.repeat(64),
      c=>c.hostAudits[0].observedImports=c.hostAudits[0].observedImports.filter(i=>i.name!=='redirect_to_grip_proxy_v2'),
      c=>c.hostAudits[0].observedImports.find(i=>i.name==='redirect_to_grip_proxy_v2').parameters=['f64'],
      c=>c.hostAudits[0].observedImports.push({module:'private',name:'bad',kind:'function',parameters:[],results:[]}),
      c=>c.hostAudits[0].runtimeObservationCoverage=complete(0),c=>delete c.coverage.hostContributions,
      c=>c.hostUseSites[0].contributionId='missing',c=>c.hostUseSites[0].entryIds=['missing'],
      c=>c.hostUseSites[0].source.file='/private/source.ts',c=>c.hostContributions[0].artifactId='missing']){
      const c=clone(fanout.capsule);mutate(c);assert.throws(()=>createCapsule(c));
    }
  });
  check('capture binds exact bytes and declared import/source identities',()=>{
    const evidence=JSON.parse(fs.readFileSync(path.join(fanout.out,'fastly-native-manifest.json'))).hostExtensions;
    const contributions=JSON.parse(fs.readFileSync(path.join(fanout.out,'package-artifacts.json')));
    const artifact=fanout.capsule.artifacts.find(a=>a.id===fanout.capsule.context.primaryArtifactId);
    const captured=host.capture(evidence,contributions,artifact,fanout.wasm);assert.equal(captured.contributions.length,1);
    const ambiguous=clone(fanout.capsule);host.addInventory(ambiguous,{hostEvidence:captured,plan:JSON.parse(fs.readFileSync(path.join(fanout.out,'canonical-native-plan.json'))),reportPackageVersions:[{name:'@pulse-compute/grip',version:'1.0.0'},{name:'@pulse-compute/grip',version:'2.0.0'}]},ambiguous.hostContributions[0].evidenceIds,()=>null);
    assert.equal(createCapsule(ambiguous).hostContributions[0].packageVersion,null);
    assert.throws(()=>host.capture(evidence,contributions,{...artifact,sha256:'0'.repeat(64)},fanout.wasm));
    const bad=clone(evidence);bad.observedImports=[];assert.throws(()=>host.capture(bad,contributions,artifact,fanout.wasm));
    const source=clone(contributions);source[0].data.source+='private';assert.throws(()=>host.capture(evidence,source,artifact,fanout.wasm));
  });
  const ordinary=build("import {handoffFanout} from '@pulse-compute/grip/experimental'; export default async function handler(ctx){return ctx.text('ordinary');}");
  check('unused and absent controls produce known empty inventory without audit',()=>{
    const c=ordinary.capsule;for(const name of names){assert.equal(c[name].length,0);assert.deepEqual(c.coverage[name],complete(0));}
    const diff=compareCapsules(c,fanout.capsule);assert.equal(diff.sections.find(s=>s.collection==='hostContributions').changes[0].status,'added');
    const before=ordinary.wasm;assert.equal(sha256(cliBuild(ordinary.dir,root,false)),sha256(before));
    fs.writeFileSync(path.join(ordinary.dir,'app.ts'),"export default async function handler(ctx){return ctx.text('ordinary');}");
    const after=cliBuild(ordinary.dir,root,false);for(const bytes of [before,after]) assert(!WebAssembly.Module.imports(new WebAssembly.Module(bytes)).some(i=>i.name.includes('redirect_to_')));
  });
  check('catalogued errors expose only identities and relative authored location',()=>{
    for(const suffix of ['INVALID','PROTOCOL','OWNER','CONFLICT','TARGET','SOURCE','SIGNATURE','IMPORT','PLACEMENT','BINDING']){
      const code='PULSE_HOST_EXTENSION_'+suffix,d=describeDiagnostic(code);assert.equal(d.exitCode,3);assert.equal(d.scope,'public');assert(d.docs.includes('#pulse-host-extension-'));
      const error=Object.assign(new Error('PRIVATE_CANARY'),{code,detail:{package:'@outside/terminal',operation:'transfer',source:'PRIVATE_CANARY',backend:'PRIVATE_CANARY',loc:{file:path.join(fanout.dir,'app.ts'),line:3,column:2,text:'PRIVATE_CANARY'}}});
      const publicError=errorSummary(error,{},fanout.dir);assert.equal(publicError.detail.loc.file,'app.ts');assert(!JSON.stringify(publicError).includes('PRIVATE_CANARY'));assert(!JSON.stringify(publicError).includes(fanout.dir));
      assert(!JSON.stringify(errorSummary({code:'PULSE_PACKAGE_OPERATION_INVALID',message:'PRIVATE_CANARY',detail:{source:'PRIVATE_CANARY'},diagnostics:[error]}, {},fanout.dir)).includes('PRIVATE_CANARY'));
    }
  });
  check('real CLI placement diagnostics are authored and private-data free',()=>{
    fs.writeFileSync(path.join(fanout.dir,'app.ts'),author('handoffFanout').replace("return handoffFanout(ctx, 'edge');","const token=handoffFanout(ctx, 'PRIVATE_CANARY'); return token;"));
    const failed=cli(fanout.dir,['build','--json']);assert.notEqual(failed.status,0);const error=JSON.parse(failed.stderr).error;
    assert(!json(error).includes('PRIVATE_CANARY'));assert(!json(error).includes(fanout.dir));
    const diagnostic=error.diagnostics?.find(d=>d.code==='PULSE_HOST_EXTENSION_PLACEMENT') || error;
    assert.equal(diagnostic.code,'PULSE_HOST_EXTENSION_PLACEMENT');assert.equal(diagnostic.detail.loc.file,'app.ts');
  });
  check('Router binding error points at authored handler, not generated dispatcher',()=>{
    fs.writeFileSync(path.join(websocket.dir,'app.ts'),`import {Router} from '@pulse-compute/runtime'; import {handoffWebSocket} from '@pulse-compute/grip/experimental'; const app=new Router(); app.get('/ws',async ctx=>{return handoffWebSocket(ctx,'PRIVATE_CANARY');});export default app;`);
    const failed=cli(websocket.dir,['build','--json']);assert.equal(failed.status,3);const error=JSON.parse(failed.stderr).error;
    assert.equal(error.code,'PULSE_HOST_EXTENSION_BINDING');assert.equal(error.detail.loc.file,'app.ts');assert.equal(error.detail.loc.line,1);
    assert.equal(error.detail.sourceBasis,'authored-entry');assert(!JSON.stringify(error).includes('PRIVATE_CANARY'));
  });
  // The saved capsule remains sufficient after both authored and package code
  // disappear. This is retained evidence, not an installed transport claim.
  check('source-free historical replay',()=>{
    const current=cli(outside.dir,['report','--json']);assert.equal(current.status,0,current.stderr);
    const builder=path.join(independent.pkg,'builder.cjs');fs.appendFileSync(builder,'\n// PRIVATE_PACKAGE_CHANGE');
    const stale=cli(outside.dir,['report','--json']);assert.equal(stale.status,3);assert.equal(JSON.parse(stale.stderr).error.code,'PULSE_REPORT_STALE');
    const c=outside.capsule; fs.rmSync(independent.pkg,{recursive:true});fs.rmSync(path.join(outside.dir,'app.ts'));
    const result=cli(outside.dir,['report','--artifact','cli-out/pulse-report-inventory.json','--json']);assert.equal(result.status,0,result.stderr);
    assert.equal(parseCapsule(result.stdout).evidenceHash.value,c.evidenceHash.value);
  });
  console.log(JSON.stringify({status:'passed',checks,operations:2,independentPackages:1,runtimeObservation:'not-recorded'}));
} finally { for(const dir of dirs) fs.rmSync(dir,{recursive:true,force:true}); }
