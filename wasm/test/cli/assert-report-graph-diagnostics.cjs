'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const { parseGraph, captureGraph } = require('../../packages/build-support/src/report-direct-graph');
const { inspectWasm } = require('../../packages/build-support/src/wasm-evidence');
const { addSizeEvidence } = require(path.join(f.reportRoot, 'size'));
const { validateAttribution } = require(path.join(f.reportRoot, 'completion'));
const { createCapsule, serializeCapsule, validateCapsule } = require(path.join(f.reportRoot, 'capsule'));
const { sha256 } = require(path.join(f.reportRoot, 'data'));
const { GRAPH_DIAGNOSTICS } = require(path.join(f.reportRoot, 'schema'));
const funcs = inspectWasm(f.wasm).functions;
const wat = '(module (func $0 (call $2)) (func $1 (call $2)) (func $2))';
const base = { kind: 'pulse.report-attribution', attributionVersion: 1, artifactId: f.aid, artifactSha256: f.hash,
  stage: 'final', importedFunctions: 0, functions: funcs,
  handlerBodies: [0, 1].map(i => ({ entryId: 'entry-' + i, handlerId: 'shared', chunks: [i] })),
  chunkMappings: [0, 1].map(i => ({ chunk: i, functionIndex: i, reason: null })),
  graph: { state: 'available', reason: null, method: 'static-direct-calls-v1', edges: parseGraph(wat, funcs, 0).edges } };
const files = new Map([[f.aid, f.wasm]]);
const metrics = (report, name) => report.measurements.filter(row => row.metric === name);
const failure = (text, functions = funcs, imports = 0) => captureGraph({ readBinary: () => ({ emitText: () => text, dispose() {} }) }, f.wasm, functions, imports);
let negatives = 0;
function checkFailure(text, code, functions = funcs, imports = 0) {
  const graph = failure(text, functions, imports);
  assert.equal(graph.status, 'unavailable'); assert.equal(graph.diagnostic.code, code);
  assert.equal(graph.reason, GRAPH_DIAGNOSTICS[code]);
  const capture = { ...base, graph: { state: 'unavailable', reason: graph.reason,
    method: 'static-direct-calls-v1', edges: [], diagnostic: graph.diagnostic } };
  validateAttribution(capture);
  const report = addSizeEvidence(createCapsule(f.fixture()), files, capture);
  assert.deepEqual(metrics(report, 'handler-body').map(row => row.fact.value), [4, 4]);
  assert.ok(metrics(report, 'reachable').every(row => row.fact.value === null && row.fact.reason === graph.reason));
  assert.deepEqual(report.observations.find(row => row.code === 'REPORT_GRAPH_UNAVAILABLE').graphDiagnostic, graph.diagnostic);
  assert.ok(!serializeCapsule(report).includes('PRIVATE_CANARY')); negatives++;
  return capture;
}
function seedFor(bytes) {
  const seed = JSON.parse(JSON.stringify(f.fixture()).replaceAll(f.hash, sha256(bytes)));
  Object.assign(seed.artifacts[0], { bytes: bytes.length, sections: [], sectionCoverage: { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' } });
  seed.bodies = []; seed.measurements = []; seed.rootSets = [];
  return createCapsule(seed);
}
function denseGraph(n) {
  const uint = n => { const out = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n); return out; };
  const section = (id, payload) => Buffer.from([id, ...uint(payload.length), ...payload]);
  const calls = Array.from({ length: n }, (_, index) => [0x10, ...uint(index)]).flat();
  const body = [0, ...calls, 11], bodies = Array.from({ length: n }, () => Buffer.from([...uint(body.length), ...body]));
  const code = Buffer.concat([Buffer.from(uint(n)), ...bodies]);
  const wasm = Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0]), section(1, [1,96,0,0]),
    section(3, [...uint(n), ...Array(n).fill(0)]), Buffer.from([10, ...uint(code.length)]), code]);
  const edges = Array.from({ length: n }, (_, caller) => Array.from({ length: n }, (_, callee) => ({ caller, callee, sites: 1 }))).flat();
  return { wasm, edges };
}
async function main() {
  for (const [text, code] of [
    ['(module (table 1 funcref))', 'table'], ['(module (elem (i32.const 0) $0))', 'element-segment'],
    ['(module (table 1 funcref) (func $0 (call_indirect)))', 'indirect-call'],
    ['(module (func $0 (ref.func $0)))', 'reference-control'], ['(module (func $0 (call_ref)))', 'reference-control'],
    ...['return_call', 'return_call_indirect', 'return_call_ref'].map(op => ['(module (func $0 (' + op + ' $0)))', 'tail-call']),
    ['(module (func $0)', 'malformed-text'], ['(module (data "PRIVATE_CANARY))', 'malformed-text'],
    ['(module (; unclosed)', 'malformed-text'], ['(module)', 'definition-count'],
    [wat.replace('call $2', 'call 2'), 'direct-call-shape'],
    [wat.replace('(call $2)', 'call $2'), 'direct-call-shape'],
    [wat.replace('call $2', 'call $PRIVATE_CANARY'), 'direct-target'],
    [wat.replace('func $0', 'func $PRIVATE_CANARY'), 'function-name'],
    [wat.replace('(func $2)', '(func)'), 'function-name'],
    [wat.replace('(module', '(module (call $0)'), 'direct-call-scope']
  ]) checkFailure(text, code);
  checkFailure(wat, 'function-index', [{ ...funcs[0], index: 99 }, ...funcs.slice(1)]);
  checkFailure('(module (import "PRIVATE_CANARY" "f" (func)))', 'import-name', [], 1);
  checkFailure('(module)', 'import-count', [], 1);
  checkFailure('(module (import "x" "y" (func $same)) (import "x" "z" (func $same)))', 'duplicate-name', [], 2);
  checkFailure('(module (func $same) (func $same))', 'duplicate-name', [{ index: 0, bytes: 2, name: 'same' }, { index: 1, bytes: 2, name: 'same' }]);
  checkFailure(' '.repeat(32 * 1024 * 1024 + 1), 'text-byte-limit');
  checkFailure('(module)', 'function-limit', Array(100001).fill(funcs[0]));
  const calls = Array.from({ length: 317 }, (_, i) => '(call $' + i + ')').join('');
  const denseText = '(module' + Array.from({ length: 317 }, (_, i) => '(func $' + i + calls + ')').join('') + ')';
  // The diagnostic's caller index belongs to this larger artifact census.
  const edgeFailure = failure(denseText, Array.from({ length: 317 }, (_, index) => ({ index, bytes: 2 })));
  assert.equal(edgeFailure.diagnostic.code, 'edge-limit');
  assert.equal(edgeFailure.diagnostic.observed, 100001); assert.equal(edgeFailure.diagnostic.expected, 100000); negatives++;
  for (const phase of ['binaryen-read', 'binaryen-text']) {
    const boom = () => { throw Error('PRIVATE_CANARY'); };
    const graph = captureGraph({ readBinary: phase === 'binaryen-read' ? boom : () => ({ emitText: boom, dispose() {} }) }, f.wasm, funcs, 0);
    assert.equal(graph.diagnostic.code, phase); assert.ok(!JSON.stringify(graph).includes('PRIVATE_CANARY')); negatives++;
  }
  const unexpected = captureGraph({ readBinary: () => ({ emitText: () => null, dispose() {} }) }, f.wasm, funcs, 0);
  assert.equal(unexpected.diagnostic.code, 'unexpected-parser-failure'); negatives++;
  const decorated = '(module (; nested (; (call $PRIVATE_CANARY) ;) ;) ;; (table 1 funcref)\n'
    + '(memory 1)(data (i32.const 0) "(call $PRIVATE_CANARY) (table 1 funcref)\\22")'
    + '(func $0 (call $2)(call $2))(func $1 (call $2))(func $2))';
  assert.deepEqual(parseGraph(decorated, funcs, 0).edges, [{ caller: 0, callee: 2, sites: 2 }, { caller: 1, callee: 2, sites: 1 }]);
  assert.deepEqual(parseGraph('(module(import "env" "host"(func $host))(func $entry(call $host)(call $entry)))',
    [{ index: 1, bytes: 6, name: 'entry' }], 1).edges, [{ caller: 1, callee: 0, sites: 1 }, { caller: 1, callee: 1, sites: 1 }]);
  assert.deepEqual(parseGraph('(module(func $a\\20b(call $a\\20b)))', [{ index: 0, bytes: 4, name: 'a b' }], 0).edges,
    [{ caller: 0, callee: 0, sites: 1 }]);
  const cycle = { ...base, graph: { ...base.graph, edges: [...base.graph.edges, { caller: 2, callee: 0, sites: 1 }] } };
  const cycleReport = addSizeEvidence(createCapsule(f.fixture()), files, cycle);
  assert.deepEqual(metrics(cycleReport, 'reachable').map(row => row.fact.value).sort((a,b)=>a-b), [6,10]);
  assert.equal(cycleReport.bodies.reduce((n,row)=>n+row.bytes,0), 10);
  const absent = addSizeEvidence(createCapsule(f.fixture()), files);
  assert.equal(absent.observations.find(row => row.graphDiagnostic).graphDiagnostic.code, 'capture-absent');
  assert.ok(metrics(absent, 'reachable').every(row => row.fact.reason === 'missing-evidence'));
  const badCapture = checkFailure('(module (table 1 funcref))', 'table');
  for (const edit of [c => { c.graph.reason = 'graph-parser-mismatch'; }, c => { c.graph.state = 'available'; c.graph.reason = null; },
    c => { c.graph.diagnostic.code = 'PRIVATE_CANARY'; }, c => { c.graph.diagnostic.message = 'PRIVATE_CANARY'; },
    c => { c.graph.diagnostic.observed = 1; }, c => { c.graph.diagnostic.functionIndex = 99; },
    c => { delete c.graph.diagnostic; },
    c => { c.graph.reason='graph-budget-exhausted';c.graph.diagnostic={reason:c.graph.reason,code:'text-byte-limit',functionIndex:null,observed:9,expected:8}; }]) {
    const invalid = structuredClone(badCapture); edit(invalid); assert.throws(() => validateAttribution(invalid)); negatives++;
  }
  const report = addSizeEvidence(createCapsule(f.fixture()), files, badCapture);
  const v2 = { ...badCapture, attributionVersion: 2,
    entries: base.handlerBodies.map(row => ({ entryId: row.entryId, handlerId: row.handlerId,
      bodies: row.chunks.map(chunk => ({ chunk, relation: 'terminal-body' })), reason: null })),
    chunkMappings: base.chunkMappings.map((row, i) => ({ ...row, kind: 'terminal-body', implementationId: 'entry-' + i })) };
  delete v2.handlerBodies;
  assert.equal(addSizeEvidence(createCapsule(f.fixture()), files, v2).evidenceHash.value, report.evidenceHash.value);
  for (const reason of ['unsupported-call-graph', 'missing-evidence', 'prelink-only']) {
    const legacy = { ...base, graph: { state: 'unavailable', reason, method: 'static-direct-calls-v1', edges: [] } };
    assert.equal(validateAttribution(legacy).graph.reason, reason);
  }
  const invalid = JSON.parse(serializeCapsule(report)); invalid.observations.find(row => row.graphDiagnostic).graphDiagnostic.code = 'direct-target';
  assert.throws(() => createCapsule(invalid)); negatives++;
  const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|binaryen|typescript|child_process|report-capture|report-direct-graph/.test(name))throw Error(name);return load.call(this,name,...args)};const f=require(${JSON.stringify(path.join(__dirname,'report-fixtures.cjs'))});const s=require(${JSON.stringify(path.join(f.reportRoot,'size'))});process.stdout.write(s.addSizeEvidence(f.createCapsule(f.fixture()),new Map([[f.aid,f.wasm]]),${JSON.stringify(badCapture)}).evidenceHash.value);`;
  assert.equal(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }), report.evidenceHash.value);
  assert.equal(serializeCapsule(validateCapsule(JSON.parse(serializeCapsule(report)))), serializeCapsule(report));
  // Exercise the real one-million-operation traversal bound. Each exact direct
  // graph is dense and cyclic; complete earlier closures remain valid, while the
  // exhausted root must be unavailable, never a truncated reachable subset.
  const dense = denseGraph(316), denseSeed = JSON.parse(serializeCapsule(seedFor(dense.wasm)));
  denseSeed.routes = Array.from({ length: 11 }, (_, i) => ({ ...denseSeed.routes[i % 2], id: f.id('route','dense-'+i), canonicalId:'dense-'+i, order:i }));
  for (const row of [...denseSeed.schemas,...denseSeed.bindings]) row.routeIds=denseSeed.routes.map(r=>r.id);
  denseSeed.coverage.routes={status:'complete',observed:11,expected:11,reason:null};
  const denseHash=sha256(dense.wasm),denseId='artifact:'+denseHash;
  const denseCapture={...base,artifactId:denseId,artifactSha256:denseHash,functions:inspectWasm(dense.wasm).functions,
    graph:{...base.graph,edges:dense.edges}};
  const budgetReport=addSizeEvidence(createCapsule(denseSeed),new Map([[denseId,dense.wasm]]),denseCapture);
  assert.ok(metrics(budgetReport,'handler-body').every(row=>row.fact.state==='available'));
  assert.equal(metrics(budgetReport,'reachable').filter(row=>row.fact.state==='available').length,10);
  assert.equal(metrics(budgetReport,'reachable').filter(row=>row.fact.reason==='graph-budget-exhausted').length,1);
  assert.equal(budgetReport.observations.find(row=>row.graphDiagnostic).graphDiagnostic.code,'traversal-work-limit');
  assert.ok(budgetReport.rootSets[0].roots.every(row=>row.bodyIds.length===316));
  // Real Binaryen emission proves strings, empty bodies and final index joins.
  const ascRoot=path.dirname(require.resolve('assemblyscript/package.json',{paths:[path.resolve(__dirname,'../..')]}));
  const binaryen=(await import(pathToFileURL(require.resolve('binaryen',{paths:[ascRoot]})))).default;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-graph-diagnostics-'));const costs=[];
  try {
    for(const table of [false,true]) {
      const module=binaryen.parseText('(module '+(table?'(table 1 funcref)':'')+'(memory 1)(data (i32.const 0) "(table 1 funcref) (call_indirect) PRIVATE_CANARY")'+
        '(func $__pulse_chunk_0 (call $helper))(func $__pulse_chunk_1 (call $helper))(func $helper))');
      const previous=binaryen.getDebugInfo();binaryen.setDebugInfo(false);
      try {
        const production=Buffer.from(module.emitBinary());
        const Capture=require('../../packages/build-support/src/report-capture-transform.cjs');
        const file=path.join(directory,'capture.json');
        const observer=new Capture({file,prefix:'',ownership:{dispatcher:{strategy:'bounded-state-chunks'},handlerBodies:[0,1].map(i=>({id:'entry-'+i,handlerId:'shared',chunks:[i]}))}});
        observer.binaryen=binaryen;
        const emitter={emitBinary:()=>({binary:module.emitBinary()})};observer.afterCompile(emitter);
        const start=performance.now();assert.deepEqual(Buffer.from(emitter.emitBinary(null).binary),production);
        const captureMs=performance.now()-start;
        assert.equal(binaryen.getDebugInfo(),false);
        const capture=validateAttribution(fs.readFileSync(file));
        assert.equal(capture.graph.state,table?'unavailable':'available');
        if(table)assert.equal(capture.graph.diagnostic.code,'table');
        const actual=addSizeEvidence(seedFor(production),new Map([[capture.artifactId,production]]),capture);
        assert.ok(metrics(actual,'handler-body').every(row=>row.fact.state==='available'));
        assert.ok(metrics(actual,'reachable').every(row=>row.fact.state===(table?'unavailable':'available')));
        assert.ok(!JSON.stringify(capture).includes('PRIVATE_CANARY'));assert.ok(!serializeCapsule(actual).includes('PRIVATE_CANARY'));
        costs.push({table,captureMs,wasmBytes:production.length,sidecarBytes:fs.statSync(file).size});
      } finally {binaryen.setDebugInfo(previous);module.dispose();}
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
  console.log(JSON.stringify({status:'passed',negativeCases:negatives,cyclesAndSharing:true,passiveReplay:true,traversalBudget:1000000,costs}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
