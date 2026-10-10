'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {parseContainment,closure,analyzeArtifact}=require('./containment.cjs');
const {inspectWasm}=require('../../../wasm/packages/build-support/src/wasm-evidence');
const {parseGraph}=require('../../../wasm/packages/build-support/src/report-direct-graph');
const funcs=Array.from({length:5},(_,index)=>({index,bytes:2}));
const wat='(module (table 1 funcref)(elem (i32.const 0) $4)'
  +'(func $0 (call $1))(func $1 (call $0)(call $2))(func $2 (call_indirect (type $t)(i32.const 0)))'
  +'(func $3 (call $4)(call $4))(func $4))';
async function main(){
  const result=parseContainment(wat,funcs,0);
  assert.equal(result.status,'diagnostic-only');
  assert.deepEqual(result.blockers,[{functionIndex:2,operations:[{op:'call_indirect',sites:1}],bodyBytes:2,directCallerIndices:[1]}]);
  assert.deepEqual(result.affectedFunctionIndices,[0,1,2]);
  assert.deepEqual(result.directOnlyFunctionIndices,[3,4]);
  assert.equal(result.edges.find(row=>row.caller===3).sites,2);
  assert.equal(closure(result,funcs,[0]).reason,'opaque-control-in-direct-closure');
  assert.deepEqual(closure(result,funcs,[3,3]).bodyIndices,[3,4]);
  assert.equal(closure(result,funcs,[3]).bodyBytes,4);
  assert.equal(closure(result,funcs,[]).reason,'missing-root-mapping');
  assert.equal(closure(result,funcs,[999]).reason,'missing-root-mapping');
  assert.throws(()=>parseGraph(wat,funcs,0),error=>error.diagnostic.code==='indirect-call','production proof stays closed');
  const decorated=wat.replace('(module','(module (; nested (; call_indirect ;) ;) (memory 1)(data (i32.const 0) "call_ref PRIVATE_CANARY")');
  assert.deepEqual(parseContainment(decorated,funcs,0),result);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CANARY'));
  let negatives=0;
  for(const text of [wat.replace('call $1','call $unknown'),wat.replace('call $1','call 1'),wat.slice(0,-1),
    wat.replace('(func $4)','(func $4)(call $0)'),wat.replace('(module','(module (call_indirect)'),
    wat.replace('(func $4)','(func $PRIVATE_CANARY)')]){
    assert.throws(()=>parseContainment(text,funcs,0));negatives++;
  }
  for(const op of ['call_ref','return_call','return_call_indirect','return_call_ref','ref.func','table.get','table.set']){
    assert.equal(parseContainment(wat.replace('call_indirect',op),funcs,0).blockers[0].operations[0].op,op);
  }
  const onlyTable=parseContainment('(module(table 1 funcref)(func $0))',[funcs[0]],0);
  assert.equal(onlyTable.tableDeclarations,1);assert.deepEqual(onlyTable.affectedFunctionIndices,[]);
  const imported=parseContainment('(module(import "env" "host"(func $host))(func $0(call $host)))',[{index:1,bytes:4}],1);
  assert.deepEqual(closure(imported,[{index:1,bytes:4}],[1]).importedFunctionIndices,[0]);
  assert.equal(closure(imported,[{index:1,bytes:4}],[1]).bodyBytes,4);
  const ascRoot=path.dirname(require.resolve('assemblyscript/package.json',{paths:[path.resolve(__dirname,'../../../wasm')]}));
  const binaryen=(await import(pathToFileURL(require.resolve('binaryen',{paths:[ascRoot]})))).default;
  const mod=binaryen.parseText('(module(type $t(func(result i32)))(table 1 funcref)(elem(i32.const 0)$callee)'
    +'(func $callee(result i32)(i32.const 7))(func $safe(result i32)(i32.const 9))'
    +'(func $dynamic(param $i i32)(result i32)(call_indirect(type $t)(local.get $i)))'
    +'(export "safe"(func $safe))(export "dynamic"(func $dynamic)))');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-rpt816-'));
  try{
    const bytes=Buffer.from(mod.emitBinary()),file=path.join(dir,'fixture.wasm');fs.writeFileSync(file,bytes);
    const analyzed=await analyzeArtifact(file);
    assert.equal(analyzed.blockers.length,1);assert.equal(analyzed.opaqueSites,1);
    assert.equal(analyzed.directOnlyFunctionIndices.length,2);
    assert.deepEqual(fs.readFileSync(file),bytes);
    const instance=new WebAssembly.Instance(new WebAssembly.Module(bytes));
    assert.equal(instance.exports.safe(),9);assert.equal(instance.exports.dynamic(0),7);
    assert.throws(()=>instance.exports.dynamic(1),WebAssembly.RuntimeError);
    const badSidecar=path.join(dir,'bad.json'),wrongHash='0'.repeat(64);
    const sidecar={kind:'pulse.report-attribution',attributionVersion:2,artifactId:'artifact:'+wrongHash,
      artifactSha256:wrongHash,stage:'final',...inspectWasm(bytes),entries:[],chunkMappings:[],
      graph:{state:'unavailable',reason:'unsupported-call-graph',method:'static-direct-calls-v1',edges:[]}};
    delete sidecar.sections;delete sidecar.dataPayloadBytes;
    fs.writeFileSync(badSidecar,JSON.stringify(sidecar));
    await assert.rejects(analyzeArtifact(file,badSidecar),/sidecar must match exact artifact/);negatives++;
    console.log(JSON.stringify({status:'passed',negativeCases:negatives,cycleContainment:true,unknownTargetsExplicit:true,
      productionPolicyUnchanged:true,realArtifact:{definedFunctions:analyzed.definedFunctions,opaqueSites:analyzed.opaqueSites,
        affected:analyzed.affectedFunctionIndices.length,directOnly:analyzed.directOnlyFunctionIndices.length},artifactUnchanged:true}));
  }finally{mod.dispose();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
