'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const reportRoot = path.join(root, 'wasm/packages/cli/src/internal/report');
const { fixture, writeProject, hash } = require('../runtime/binary-resource-closure-fixture.cjs');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { compileNativeProjectInMemory } = require('../../packages/cli/src/project-execution');
const { collectInventory } = require('../../packages/cli/src/internal/report/inventory');
const { addSizeEvidence } = require('../../packages/cli/src/internal/report/size');
const { createCapsule, serializeCapsule, parseCapsule, artifactId } = require('../../packages/cli/src/internal/report/capsule');

function main() {
  // Content-addressed matching is conservative for ambiguous representations.
  const { observeResourceBytes } = require('../../packages/cli/src/internal/report/resource-bytes');
  const uleb = n => { const out=[]; do { const b=n&127;n>>>=7;out.push(b|(n?128:0)); } while(n);return out; };
  const sample = Buffer.from(Array.from({length:80},(_,i)=>i+40));
  function observation(payload, backings) {
    const segment=Buffer.from([1,0,0x41,0,0x0b,...uleb(payload.length),...payload]);
    const wasm=Buffer.from([0,97,115,109,1,0,0,0,5,3,1,0,1,11,...uleb(segment.length),...segment]);
    const blobs=backings.map(bytes=>({id:hash(bytes)+':'+bytes.length,sha256:hash(bytes),byteLength:bytes.length,data:bytes.toString('base64')}));
    const capsule={binaryResources:{backings:blobs.map(b=>({...b,selected:true})),observedBackingBytes:{value:null}},
      artifacts:[{id:artifactId(hash(wasm)),sha256:hash(wasm),bytes:wasm.length}],evidence:[]};
    observeResourceBytes(capsule,{native:{wasm},compiled:{binaryResources:{blobs}}});return capsule.binaryResources;
  }
  assert.equal(observation(sample,[sample]).observedBackingBytes.value,80);
  assert.equal(observation(sample,[sample.subarray(0,8)]).observedBackingBytes.value,null);
  assert.equal(observation(Buffer.concat([sample,sample]),[sample]).observedBackingBytes.value,null);
  assert.equal(observation(sample,[sample,sample.subarray(8,48)]).observedBackingBytes.value,null);
  assert.equal(observation(Buffer.alloc(80),[sample]).observedBackingBytes.value,null);
  assert.equal(observation(Buffer.alloc(0),[Buffer.alloc(0)]).observedBackingBytes.value,0);
  const cwd = fs.mkdtempSync(path.join(root, 'wasm/.test-results/report-computation-')), data = fixture();
  try {
    writeProject(cwd, data);
    fs.writeFileSync(path.join(cwd, 'src/helper.ts'), '\n\nexport function zero(value:number):number{return value*0;}');
    const first = path.join(cwd, 'src/first.ts');
    fs.writeFileSync(first, "// Original source canary\n\nimport {zero} from './helper';\n\n" + fs.readFileSync(first, 'utf8').replace('+input.value', '+zero(input.value)'));
    const project = resolveProject({ cwd, profile: 'native', metadataOnly: true });
    const prepared = compileNativeProjectInMemory(project, { emitWat: false });
    assert.ok(!JSON.stringify(prepared.plan).includes('reportSource'));
    assert.ok(!JSON.stringify(prepared.plan).includes('reportHelpers'));
    const id = artifactId(hash(prepared.native.wasm));
    const artifacts = [{ id, sha256: hash(prepared.native.wasm), bytes: prepared.native.wasm.length, stage: 'final', target: 'portable-native-wasm' }];
    const inventory = collectInventory(project, prepared, artifacts, id, 'default');
    const report = addSizeEvidence(inventory, new Map([[id, prepared.native.wasm]]));
    const { computation: c, binaryResources: b } = report;
    assert.equal(c.callees.length, 2); assert.equal(c.sites.length, 3);
    const firstCallee = c.callees.find(row => row.name === 'first');
    assert.equal(firstCallee.source.value.file, 'src/first.ts'); assert.equal(firstCallee.source.value.start.line, 5);
    assert.equal(firstCallee.helpers[0].source.value.file, 'src/helper.ts');
    assert.equal(firstCallee.helpers[0].source.value.start.line, 3);
    assert.equal(c.sites.filter(row => row.calleeId === firstCallee.id).length, 2);
    assert.ok(c.sites.every(row => row.source.value.file === 'src/index.ts' && row.entryIds.length === 1));
    assert.equal(b.bindingCount, 6); assert.equal(b.uniqueBackingCount, 4);
    assert.equal(b.selectedBindingCount, 5); assert.equal(b.selectedUniqueBackingCount, 3);
    assert.deepEqual(b.budgets, data.budgets); assert.equal(b.source.decodedBytes, data.manifest.byteLength);
    assert.equal(b.source.serializedBytes, Buffer.byteLength(data.serialized));
    assert.equal(b.selectedBackingBytes.value, data.shared.length + data.distinct.length);
    assert.equal(b.observedBackingBytes.value, b.selectedBackingBytes.value);
    assert.equal(b.observedRanges.length, 2); assert.equal(b.observedArtifactId, id);
    const shared = b.backings.find(row => row.byteLength === data.shared.length);
    assert.equal(shared.resourceIds.length, 3);
    assert.equal(report.resources.find(row => row.name === 'unused').binary.selected, false);
    assert.equal(report.coverage.resources.status, 'partial'); assert.equal(report.provenance.revision, null);
    assert.equal(b.instanceMemoryBytes.value, null); assert.equal(b.processMemoryBytes.value, null);
    assert.ok(c.callees.every(row => row.bodyBytes.value === null));
    const ledger = report.artifacts[0].ledger;
    assert.equal(ledger.dataPayloadBytes.value - ledger.unattributedDataPayloadBytes.value, b.observedBackingBytes.value);
    const serialized = serializeCapsule(report);
    for (const value of [data.shared.toString('base64'), data.unused.toString('base64'), 'Original source canary', 'return value*0', cwd]) assert.ok(!serialized.includes(value));
    assert.equal(serializeCapsule(parseCapsule(serialized)), serialized);
    const passive = `const M=require('node:module'),load=M._load;M._load=function(n,...a){if(/compiler|provider-|binaryen|typescript|child_process/.test(n))throw Error(n);return load.call(this,n,...a)};const c=require(${JSON.stringify(path.join(reportRoot, 'capsule'))});process.stdout.write(c.serializeCapsule(c.parseCapsule(require('node:fs').readFileSync(0,'utf8'))));`;
    assert.equal(execFileSync(process.execPath, ['-e', passive], { input: serialized, encoding: 'utf8' }), serialized);
    const overview = require('../../packages/cli/src/internal/report/command').terminalOverview({ capsule: report, kind: 'historical-capsule', missingOptionalSidecars: [] });
    assert.match(overview, /2 callees.*3 authored call sites/); assert.match(overview, /1052676 bytes/);
    const html = require('../../packages/cli/src/internal/report/viewer').renderReport(report);
    assert.ok(html.includes('Binary resource closure') && html.includes('Shared computations'));
    let negatives = 0;
    for (const mutate of [
      c => c.binaryResources.selectedBindingCount++, c => c.binaryResources.selectedBackingBytes.value++,
      c => c.binaryResources.backings[0].resourceIds.pop(), c => c.binaryResources.backings[0].selected = !c.binaryResources.backings[0].selected,
      c => c.binaryResources.observedRanges[1].offset = c.binaryResources.observedRanges[0].offset,
      c => c.computation.sites[0].calleeId = 'missing', c => c.computation.callees[0].source.value.file = '../private.ts',
      c => c.computation.callees[0].entryIds = [], c => c.binaryResources.instanceMemoryBytes = c.binaryResources.observedBackingBytes,
      c => c.resources.find(r => r.name === 'unused').binary.calleeIds = [c.computation.callees[0].id]
    ]) { const changed = structuredClone(report); mutate(changed); assert.throws(() => createCapsule(changed)); negatives++; }
    const forged = structuredClone(inventory); forged.binaryResources.observedRanges[0].offset++;
    assert.throws(() => addSizeEvidence(createCapsule(forged), new Map([[id, prepared.native.wasm]])), e => e.code === 'REPORT_RESOURCE_METRICS'); negatives++;
    const absent = collectInventory(project, { ...prepared, reportReferences: undefined }, artifacts, id, 'default');
    assert.equal(absent.computation, undefined); assert.equal(absent.binaryResources, undefined);
    const unlocated=structuredClone(prepared.reportReferences);
    for(const callee of unlocated.computation.callees){callee.source=null;callee.entryIds=[];callee.entriesComplete=false;}
    for(const site of unlocated.computation.sites){site.source=null;site.entryIds=[];site.managed=true;}
    const unknown=collectInventory(project,{...prepared,reportReferences:unlocated},artifacts,id,'default');
    assert.ok(unknown.computation.callees.every(row=>row.source.value===null && row.entryCoverage.status==='partial'));
    const old = require('./report-fixtures.cjs').fixture(false);
    const legacy = serializeCapsule(createCapsule(old)); assert.equal(serializeCapsule(parseCapsule(legacy)), legacy);
    // Shared Router registration consumers come from canonical plan bodies,
    // never an offset guess; two registrations still retain one authored site.
    const index = path.join(cwd, 'src/index.ts');
    const handler = fs.readFileSync(index, 'utf8').replace('export default async function handler', 'export async function handler');
    fs.writeFileSync(path.join(cwd, 'src/handler.ts'), handler);
    fs.writeFileSync(index, "import {Router} from '@pulse-compute/runtime';import {handler} from './handler';const app=new Router();app.get('/a',handler);app.get('/b',handler);export default app;");
    const routed = compileNativeProjectInMemory(resolveProject({ cwd, profile: 'native', metadataOnly: true }), { emitWat: false });
    assert.equal(routed.reportReferences.computation.callees.length, 2);
    assert.ok(routed.reportReferences.computation.sites.every(site => site.entryIds.length === 2));
    console.log(JSON.stringify({ version: 'pulse.report-computation-proof.v1', status: 'passed', callees: c.callees.length,
      authoredSites: c.sites.length, bindings: b.bindingCount, selectedBindings: b.selectedBindingCount,
      selectedUniqueBackings: b.selectedUniqueBackingCount, selectedBackingBytes: b.selectedBackingBytes.value,
      observedBackingBytes: b.observedBackingBytes.value, artifactSha256: hash(prepared.native.wasm), negatives }));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
module.exports = main;
if (require.main === module) main();
