'use strict';
// Explicitly invoked analysis only. Never return an available production graph.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { parseCapsule } = require('../../../wasm/packages/cli/src/internal/report/capsule');
const { validateAttribution } = require('../../../wasm/packages/cli/src/internal/report/completion');
const { inspectWasm, functionNames } = require('../../../wasm/packages/build-support/src/wasm-evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_RECORDS=100000, MAX_WORK=1000000, MAX_TEXT=160*1024*1024;
// Reuse the pinned parser's masking, identity reconciliation and direct-call
// checks, without changing its production exports or rejection policy.
const file=path.resolve(__dirname,'../../../wasm/packages/build-support/src/report-direct-graph.js');
const parserModule=new Module(file,module);parserModule.filename=file;
parserModule.paths=Module._nodeModulePaths(path.dirname(file));
parserModule._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.scanner={maskText,moduleFields};',file);
const {parseGraph,scanner:{maskText,moduleFields}}=parserModule.exports;
const opaque = token => ['call_indirect','call_ref','return_call','return_call_indirect','return_call_ref'].includes(token)
  || token.startsWith('ref.') || token.startsWith('table.');
function parseContainment(wat, functions, importedCount) {
  assert.ok(Buffer.byteLength(wat)<=MAX_TEXT,'text budget exceeded');
  assert.ok(functions.length<=MAX_RECORDS,'function budget exceeded');
  const masked=maskText(wat),fields=moduleFields(masked);
  const definitions=fields.filter(row=>/^\(\s*func\b/.test(row));
  const blockers=[];let sites=0;
  for(let ordinal=0;ordinal<definitions.length;ordinal++) {
    const counts=new Map();
    for(const match of definitions[ordinal].matchAll(/[^\s()]+/g)) if(opaque(match[0])) {
      assert.ok(++sites<=MAX_RECORDS,'opaque-site budget exceeded');
      counts.set(match[0],(counts.get(match[0])||0)+1);
    }
    if(counts.size) blockers.push({functionIndex:importedCount+ordinal,operations:[...counts].map(([op,sites])=>({op,sites}))});
  }
  // Unknown executable control outside a function cannot be contained. Element
  // references identify possible table contents, never guessed call targets.
  for(const field of fields.filter(row=>!/^\(\s*func\b/.test(row))) {
    const element=/^\(\s*elem\b/.test(field);
    for(const match of field.matchAll(/[^\s()]+/g)) if(opaque(match[0]))
      assert.ok(element && match[0]==='ref.func','unsupported module-scope control');
  }
  // This text is a direct-edge projection, not valid rewritten Wasm. Opaque
  // sites were retained above. The original artifact remains unsupported.
  const directText=masked.replace(/[^\s()]+/g,token=>opaque(token)||token==='table'||token==='elem'?'rpt816_opaque':token);
  const graph=parseGraph(directText,functions,importedCount);
  const callers=new Map();
  for(const {caller,callee} of graph.edges) {
    if(!callers.has(callee))callers.set(callee,[]);
    callers.get(callee).push(caller);
  }
  for(const blocker of blockers){
    blocker.bodyBytes=functions[blocker.functionIndex-importedCount].bytes;
    blocker.directCallerIndices=[...new Set(callers.get(blocker.functionIndex)||[])].sort((a,b)=>a-b);
  }
  const affected=new Set(blockers.map(row=>row.functionIndex)),queue=[...affected];let work=0;
  for(let i=0;i<queue.length;i++) for(const caller of callers.get(queue[i])||[]) {
    assert.ok(++work<=MAX_WORK,'containment work budget exceeded');
    if(!affected.has(caller)){affected.add(caller);queue.push(caller);}
  }
  return {status:'diagnostic-only',method:'direct-edge-containment-experiment-v1',
    importedFunctions:importedCount,definedFunctions:functions.length,edges:graph.edges,
    blockers,opaqueSites:sites,affectedFunctionIndices:[...affected].sort((a,b)=>a-b),
    directOnlyFunctionIndices:functions.map(row=>row.index).filter(index=>!affected.has(index)),
    tableDeclarations:fields.filter(row=>/^\(\s*table\b/.test(row)||/^\(\s*import\b/.test(row)&&/\(\s*table\b/.test(row)).length,
    elementSegments:fields.filter(row=>/^\(\s*elem\b/.test(row)).length,
    scope:'Defined direct-call bodies only; unknown targets, imported implementation bytes, data and execution frequency excluded. No complete endpoint reachability claim.'};
}
function closure(analysis,functions,roots) {
  const byIndex=new Map(functions.map(row=>[row.index,row])),affected=new Set(analysis.affectedFunctionIndices);
  if(!roots.length||roots.some(index=>!byIndex.has(index))) return {status:'unavailable',reason:'missing-root-mapping'};
  if(roots.some(index=>affected.has(index)))return {status:'unavailable',reason:'opaque-control-in-direct-closure'};
  const outgoing=new Map();for(const edge of analysis.edges){if(!outgoing.has(edge.caller))outgoing.set(edge.caller,[]);outgoing.get(edge.caller).push(edge.callee);}
  const seen=new Set(),imports=new Set(),queue=[...roots];let work=0;
  for(let i=0;i<queue.length;i++) {
    assert.ok(++work<=MAX_WORK,'closure work budget exceeded');
    const index=queue[i];if(seen.has(index)||imports.has(index))continue;
    if(index<analysis.importedFunctions){imports.add(index);continue;}
    assert.ok(byIndex.has(index),'unknown direct target');seen.add(index);
    queue.push(...(outgoing.get(index)||[]));
  }
  const bodyIndices=[...seen].sort((a,b)=>a-b);
  return {status:'proven-direct-closure',bodyIndices,bodyBytes:bodyIndices.reduce((n,index)=>n+byIndex.get(index).bytes,0),
    importedFunctionIndices:[...imports].sort((a,b)=>a-b),additiveAcrossRoots:false};
}
async function analyzeArtifact(wasmPath,attributionPath,capsulePath) {
  const bytes=fs.readFileSync(wasmPath),census=inspectWasm(bytes),artifactSha256=hash(bytes);
  const sidecar=attributionPath?validateAttribution(fs.readFileSync(attributionPath)):null;
  if(sidecar){assert.equal(sidecar.artifactSha256,artifactSha256,'sidecar must match exact artifact');assert.deepEqual(sidecar.functions,census.functions);assert.equal(sidecar.importedFunctions,census.importedFunctions);}
  const ascRoot=path.dirname(require.resolve('assemblyscript/package.json',{paths:[path.resolve(__dirname,'../../../wasm')]}));
  const binaryen=(await import(pathToFileURL(require.resolve('binaryen',{paths:[ascRoot]})))).default;
  const namesSections=WebAssembly.Module.customSections(new WebAssembly.Module(bytes),'name');
  assert.ok(namesSections.length<=1,'ambiguous names');
  const names=namesSections.length?functionNames(Buffer.from(namesSections[0])):new Map();
  const functions=census.functions.map(row=>({...row,name:names.get(row.index)??null}));
  const mod=binaryen.readBinary(bytes);let analysis;
  try {analysis=parseContainment(mod.emitText(),functions,census.importedFunctions);}finally{mod.dispose();}
  assert.equal(hash(fs.readFileSync(wasmPath)),artifactSha256,'read-only analysis');
  const blocked=new Set(analysis.affectedFunctionIndices), mappings=new Map(sidecar?.chunkMappings.map(row=>[row.chunk,row.functionIndex])||[]);
  const summarize=entries=>entries.reduce((out,entry)=>{
    const roots=entry.bodies.map(body=>mappings.get(body.chunk));
    const key=!roots.length||roots.some(index=>index==null)?'missingMappings':roots.some(index=>blocked.has(index))?'affected':'directOnly';
    out[key]++;return out;
  },{directOnly:0,affected:0,missingMappings:0});
  const entrySummary=sidecar?.entries?summarize(sidecar.entries):null;
  let registrationSummary=null;
  if(capsulePath){
    assert.ok(sidecar?.entries,'registration analysis requires entry attribution');
    const capsule=parseCapsule(fs.readFileSync(capsulePath,'utf8'));
    assert.equal(capsule.artifacts.find(row=>row.id===capsule.context.primaryArtifactId).sha256,artifactSha256);
    const canonical=new Map(capsule.entries.map(row=>[row.id,row.canonicalId]));
    const captured=new Map(sidecar.entries.map(row=>[row.entryId,row]));
    registrationSummary=summarize(capsule.routes.map(route=>captured.get(canonical.get(route.entryId))||{bodies:[]}));
  }
  return {artifactSha256,artifactBytes:bytes.length,...analysis,entrySummary,registrationSummary};
}
module.exports={parseContainment,closure,analyzeArtifact};
if(require.main===module)analyzeArtifact(process.argv[2],process.argv[3],process.argv[4]).then(result=>console.log(JSON.stringify(result,null,2)))
  .catch(error=>{console.error(error.diagnostic||error.message);process.exitCode=1;});
