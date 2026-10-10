'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const { addSizeEvidence, verifyAttribution, census } = require(path.join(f.reportRoot, 'size'));
const { createCapsule, serializeCapsule } = require(path.join(f.reportRoot, 'capsule'));
const files = new Map([[f.aid, f.wasm]]);
const capture = { kind: 'pulse.report-attribution', attributionVersion: 1, artifactId: f.aid,
  artifactSha256: f.hash, stage: 'final', importedFunctions: 0, functions: census(f.wasm).functions,
  handlerBodies: [0,1].map(i => ({ entryId: 'entry-' + i, handlerId: 'shared', chunks: [i] })),
  chunkMappings: [0,1].map(i => ({ chunk: i, functionIndex: i, reason: null })),
  graph: { state: 'available', reason: null, method: 'static-direct-calls-v1', edges: [{caller:0,callee:2,sites:1},{caller:1,callee:2,sites:1}] } };
const seed = () => createCapsule(f.fixture());
const measured = (value, metric) => value.measurements.filter(row => row.metric === metric);
let negativeCases = 0;
function bad(change) { const value = structuredClone(capture); change(value); negativeCases++; assert.throws(() => addSizeEvidence(seed(), files, value)); }
const result = addSizeEvidence(seed(), files, capture);
assert.equal(result.artifacts[0].ledger.codeBodyBytes, 10);
assert.equal(result.artifacts[0].ledger.codeFramingBytes, 6);
assert.equal(result.bodies.reduce((n,row) => n + row.bytes,0),10);
assert.deepEqual(measured(result, 'handler-body').map(row => row.fact.value), [4,4]);
assert.deepEqual(measured(result, 'reachable').map(row => row.fact.value), [6,6]);
assert.ok(measured(result,'own').every(row => row.fact.value === null));
assert.ok(measured(result,'shared').every(row => row.fact.value === null));
assert.equal(result.resources[0].inputBytes.value,12);
assert.equal(result.resources[0].retainedPayloadBytes.value,null);
bad(c => c.functions[0].bytes++); bad(c => c.importedFunctions++);
bad(c => c.handlerBodies[0].handlerId = 'wrong'); bad(c => c.stage = 'prelink');
bad(c => { c.artifactSha256 = '0'.repeat(64); c.artifactId = 'artifact:' + c.artifactSha256; });
bad(c => c.artifactSha256 = '0'.repeat(64)); bad(c => c.chunkMappings[0].functionIndex = 999);
bad(c => c.chunkMappings.push(c.chunkMappings[0])); bad(c => c.graph.edges.push(c.graph.edges[0]));
bad(c => c.graph.edges[0].callee = 999); bad(c => c.attributionVersion = 2);
const partial = structuredClone(capture);
partial.handlerBodies[0].chunks.push(2); partial.chunkMappings.push({chunk:2,functionIndex:null,reason:'incomplete-mapping'});
const partialRow = measured(addSizeEvidence(seed(),files,partial),'handler-body').find(row => row.subjectId === f.id('route','route-0'));
assert.equal(partialRow.fact.value,4); assert.equal(partialRow.fact.coverage,'partial'); assert.equal(partialRow.expectedChunks,2);
assert.equal(measured(addSizeEvidence(seed(),files,partial),'reachable').find(row=>row.subjectId===partialRow.subjectId).fact.value,null);
const merged = structuredClone(capture); merged.chunkMappings[1].functionIndex = 0;
const mergedRows = measured(addSizeEvidence(seed(),files,merged),'handler-body');
assert.deepEqual(mergedRows[0].bodyIds, mergedRows[1].bodyIds, 'shared physical body, never counted twice in census');
const cycle = structuredClone(capture); cycle.graph.edges.push({caller:2,callee:0,sites:2});
assert.deepEqual(measured(addSizeEvidence(seed(),files,cycle),'reachable').map(row => row.fact.value).sort((a,b)=>a-b),[6,10]);
const unsupported = structuredClone(capture); unsupported.graph = {state:'unavailable',reason:'unsupported-call-graph',method:'static-direct-calls-v1',edges:[]};
assert.ok(measured(addSizeEvidence(seed(),files,unsupported),'reachable').every(row=>row.fact.value===null));
assert.ok(measured(addSizeEvidence(seed(),files),'handler-body').every(row=>row.fact.value===null));
const missing = structuredClone(capture); missing.handlerBodies=[]; missing.chunkMappings=[];
assert.ok(measured(addSizeEvidence(seed(),files,missing),'handler-body').every(row=>row.fact.value===null));
// v2 keeps entry identity separate from implementation sharing and final indices.
const v2 = { ...structuredClone(capture), attributionVersion: 2,
  entries: capture.handlerBodies.map(row => ({ entryId: row.entryId, handlerId: row.handlerId,
    bodies: row.chunks.map(chunk => ({ chunk, relation: 'shared-stage-body' })), reason: null })),
  chunkMappings: capture.chunkMappings.map(row => ({ ...row, kind: 'shared-stage-body', implementationId: 'stage:shared' })) };
delete v2.handlerBodies;
const v2Result = addSizeEvidence(seed(), files, v2);
assert.deepEqual(v2Result.measurements, result.measurements, 'v2 implementation metadata does not change measurements');
assert.equal(result.implementations, undefined, 'v1 does not infer implementation origins');
require('./report-implementation-cases.cjs')();
function badV2(change) { const value = structuredClone(v2); change(value); negativeCases++; assert.throws(() => addSizeEvidence(seed(), files, value)); }
badV2(c => c.entries.push(c.entries[0]));
badV2(c => c.entries[0].entryId = 'foreign');
badV2(c => c.entries[0].handlerId = 'foreign');
badV2(c => c.entries[0].bodies.push(c.entries[0].bodies[0]));
badV2(c => c.entries[0].bodies[0].chunk = 999);
badV2(c => c.entries[0].bodies[0].relation = 'terminal-body');
badV2(c => c.entries[0].reason = 'entry-ownership-not-retained');
badV2(c => c.entries[0].bodies = []);
badV2(c => c.chunkMappings[0].functionIndex = 999);
badV2(c => c.chunkMappings[0].implementationId = null);
badV2(c => c.chunkMappings[0].reason = 'final-symbol-not-surviving');
badV2(c => c.attributionVersion = 3);
const many = structuredClone(v2);
many.entries[0].bodies.push({ chunk: 1, relation: 'shared-stage-body' });
const manyRow = measured(addSizeEvidence(seed(), files, many), 'handler-body').find(row => row.subjectId === f.id('route', 'route-0'));
assert.deepEqual([manyRow.fact.value, manyRow.mappedChunks, manyRow.expectedChunks], [8, 2, 2]);
many.chunkMappings[1].functionIndex = 0;
const sharedMany = addSizeEvidence(seed(), files, many);
assert.deepEqual(measured(sharedMany, 'handler-body').map(row => row.fact.value), [4, 4]);
assert.equal(sharedMany.artifacts[0].ledger.codeBodyBytes, 10, 'many logical joins count physical code once');
many.chunkMappings[1].functionIndex = null; many.chunkMappings[1].reason = 'final-symbol-not-surviving';
const missingSymbol = addSizeEvidence(seed(), files, many);
const partialV2 = measured(missingSymbol, 'handler-body').find(row => row.subjectId === f.id('route', 'route-0'));
assert.deepEqual([partialV2.fact.value, partialV2.fact.coverage, partialV2.mappedChunks, partialV2.expectedChunks], [4, 'partial', 1, 2]);
assert.equal(measured(missingSymbol, 'handler-body').find(row => row.subjectId !== partialV2.subjectId).fact.reason, 'final-symbol-not-surviving');
assert.ok(measured(missingSymbol, 'reachable').every(row => row.fact.value === null));
const carrier = structuredClone(v2);
carrier.entries[0].bodies[0].relation = carrier.chunkMappings[0].kind = 'dispatcher-carrier';
carrier.chunkMappings[0].implementationId = null;
const carrierReport = addSizeEvidence(seed(), files, carrier);
for (const metric of ['handler-body', 'reachable']) {
  const row = measured(carrierReport, metric).find(row => row.subjectId === f.id('route', 'route-0'));
  assert.equal(row.fact.value, null); assert.equal(row.fact.reason, 'dispatcher-carrier');
}
carrier.entries[0].bodies = []; carrier.entries[0].reason = 'entry-ownership-not-retained';
assert.equal(measured(addSizeEvidence(seed(), files, carrier), 'handler-body')
  .find(row => row.subjectId === f.id('route', 'route-0')).fact.reason, 'entry-ownership-not-retained');
for(const bytes of [Buffer.alloc(0),f.wasm.subarray(0,-1),Buffer.concat([f.wasm,Buffer.from([0,255,255,255,255,127])])]) {
  negativeCases++; assert.throws(()=>census(bytes));
}
// A custom section with a multi-byte length is counted including its framing.
const custom = Buffer.concat([f.wasm,Buffer.from([0,130,1,1,120]),Buffer.alloc(128)]);
assert.equal(census(custom).sections.at(-1).bytes,133);
const data = Buffer.from([0,97,115,109,1,0,0,0,5,3,1,0,1,11,9,1,0,65,0,11,3,1,2,3]);
assert.equal(census(data).dataPayloadBytes,3);
const globalOffset = Buffer.from([0,97,115,109,1,0,0,0,2,8,1,1,109,1,103,3,127,0,5,3,1,0,1,11,9,1,0,35,0,11,3,1,2,3]);
assert.equal(census(globalOffset).dataPayloadBytes,null,'unsupported data offset retains exact sections');
// Imported function indices must shift body ordinals.
const imported = Buffer.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,7,1,1,104,1,102,0,0,3,2,1,0,10,6,1,4,0,16,0,11]);
assert.deepEqual(census(imported).functions,[{index:1,bytes:4}]);
const invalidLedger = structuredClone(result); invalidLedger.artifacts[0].ledger.codeBodyBytes++;
negativeCases++; assert.throws(()=>createCapsule(invalidLedger));
// A compiler-free reader must stay compiler-free after the adapter is added.
const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|binaryen|typescript|child_process|report-capture|report-direct-graph/.test(name))throw Error(name);return load.call(this,name,...args)};const f=require(${JSON.stringify(path.join(__dirname,'report-fixtures.cjs'))});const s=require(${JSON.stringify(path.join(f.reportRoot,'size'))});process.stdout.write(s.addSizeEvidence(f.createCapsule(f.fixture()),new Map([[f.aid,f.wasm]]),${JSON.stringify(capture)}).evidenceHash.value);`;
assert.equal(execFileSync(process.execPath,['-e',script],{encoding:'utf8'}),result.evidenceHash.value);
assert.equal(execFileSync(process.execPath,['-e',script.replace(JSON.stringify(capture), JSON.stringify(v2))],{encoding:'utf8'}),v2Result.evidenceHash.value);
// A retained portable/prelink map must never label the final artifact.
const prelinkSeed=f.fixture(); prelinkSeed.measurements=[];prelinkSeed.rootSets=[];
prelinkSeed.artifacts[0].stage='prelink';
const finalHash=require('../../packages/cli/src/internal/report/data').sha256(custom), finalId='artifact:'+finalHash;
prelinkSeed.artifacts.push({...prelinkSeed.artifacts[0],id:finalId,sha256:finalHash,bytes:custom.length,stage:'final',
  sections:census(custom).sections.map(({offset,...row})=>row),sectionCoverage:f.coverage(4)});
prelinkSeed.context.primaryArtifactId=finalId;prelinkSeed.evidence[0].artifactIds.push(finalId);
const prelinkReport=addSizeEvidence(createCapsule(prelinkSeed),new Map([[f.aid,f.wasm],[finalId,custom]]),{...capture,stage:'prelink'});
assert.ok(prelinkReport.measurements.filter(row=>row.artifactId===finalId&&row.metric==='handler-body').every(row=>row.fact.value===null&&row.fact.reason==='prelink-only'));
assert.ok(prelinkReport.measurements.filter(row=>row.artifactId===f.aid&&row.metric==='handler-body').every(row=>row.fact.value===4&&row.stage==='prelink'));
const prelinkV2 = addSizeEvidence(createCapsule(prelinkSeed), new Map([[f.aid, f.wasm], [finalId, custom]]), { ...v2, stage: 'prelink' });
assert.ok(prelinkV2.implementations.length > 0 && prelinkV2.implementations.every(row => row.artifactId === f.aid));
assert.ok(prelinkV2.implementations.flatMap(row => row.bodyIds).every(id => id.startsWith('body:' + f.hash + ':')));
assert.ok(prelinkV2.measurements.filter(row => row.artifactId === finalId).every(row => row.fact.value === null));
const {parseGraph}=require('../../packages/build-support/src/report-direct-graph');
for(const text of ['(module (table 1 funcref))','(module (call_indirect))','(module (return_call $a))']) {
  negativeCases++;assert.throws(()=>parseGraph(text,[],0));
}
// Capture failures are optional, and the global debug setting is restored.
const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pulse-capture-failure-'));
try {
  const file=path.join(temp,'capture.json'); fs.writeFileSync(file,'stale');
  const Capture=require('../../packages/build-support/src/report-capture-transform.cjs');
  const observer=new Capture({file,ownership:{},prefix:'test/'});let debug=false,emissions=0;
  observer.binaryen={getDebugInfo:()=>debug,setDebugInfo:value=>{debug=value}};
  const module={emitBinary(){emissions++;if(debug)throw Error('optional serializer failure');return {binary:f.wasm}}};
  observer.afterCompile(module);
  assert.deepEqual(module.emitBinary().binary,f.wasm); assert.equal(emissions,1);
  assert.deepEqual(module.emitBinary(null).binary,f.wasm);assert.equal(debug,false);assert.equal(fs.existsSync(file),false);
  const args=[];const read=require('../../packages/build-support/src/report-capture').prepareReportCapture(args,temp,{},'unsupported','test/');
  assert.equal(read(f.wasm),null);assert.deepEqual(args,[]);
} finally {fs.rmSync(temp,{recursive:true,force:true})}
console.log(JSON.stringify({status:'passed',negativeCases,physicalBytes:f.wasm.length,functionBodyBytes:10,codeFramingBytes:6,sharedBodyDeduplicated:true,compilerFree:true}));
