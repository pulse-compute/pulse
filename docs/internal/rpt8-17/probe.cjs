'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {prepare,build,execute,loadObserved}=require('../../../wasm/test/cli/assert-report-entry-proof.cjs');
const {stripMap,locate,codeBodies,decode}=require('./locations.cjs');
const {collectCanonicalReportReferences}=require('../../../wasm/packages/compiler/src/canonical-native-plan');
const {counterexample}=require('./shared-origin.cjs');
const harness=loadObserved('wasm/test/cli/assert-report-entry-proof.cjs',(_id,value)=>value,source=>{
  const before='return spawnSync(executable, selected, { ...options,';
  assert.equal(source.split(before).length,2);
  return source.replace(before,"selected.push('--sourceMap', 'rpt817.map', '--transform', path.join(root,'docs/internal/rpt8-17/map-capture.cjs'));\n      "+before);
});
async function main(){
 const previousMap=process.env.RPT817_MAP_FILE;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-rpt817-'));const cells=[];
 try{
  assert.deepEqual(decode({version:3,sources:['fixture'],mappings:'AAAA,EACA,C'}),[
   {offset:0,source:0,line:0,column:0},{offset:2,source:0,line:1,column:0},{offset:3,source:null}]);
  assert.throws(()=>decode({version:3,sources:[],mappings:'AAAA'}));
  const {compiled,plan}=prepare(),before=JSON.stringify(plan);
  const continuing=collectCanonicalReportReferences(compiled,plan).routeBehaviors.filter(row=>row.kind==='continuing').map(row=>row.entryId);
  for(const [target,optimization] of [['portable',undefined],['fastly',undefined],['portable','experimental-native-bounded-size'],['fastly','experimental-native-bounded-size']]){
   console.error('RPT8-17 '+target+' '+(optimization||'default'));
   const start=performance.now(),baseline=build(plan,target,true,optimization,directory),baselineMs=performance.now()-start;
   const mapFile=path.join(directory,'map.json');fs.rmSync(mapFile,{force:true});process.env.RPT817_MAP_FILE=mapFile;
   const mappedStart=performance.now(),mapped=harness.build(plan,target,true,optimization,directory),mappedMs=performance.now()-mappedStart;
   const raw=fs.readFileSync(mapFile,'utf8'),sourceMap=JSON.parse(raw),stripped=stripMap(mapped.artifact.wasm);
   assert.equal(mapped.generated.source,baseline.generated.source);
   assert.deepEqual(stripped.bytes,baseline.artifact.wasm,'byte-identical shipped artifact after removing only map URL');
   const codeEnd=Math.max(...codeBodies(mapped.artifact.wasm).map(body=>body.end));
   assert.ok(stripped.removed.every(section=>section.offset>=codeEnd),'stripping map URL must not shift code offsets');
   const location=locate(sourceMap,mapped.artifact.wasm,mapped.generated.source,mapped.control.blocks,plan);
   const continuingLocated=continuing.filter(id=>location.entriesWithCaseLocations.includes(id)).length;
   assert.equal(continuingLocated,2,'both conditional/error continuing entries have final location anchors');
   const requests=await execute(baseline.artifact,target)+await execute(mapped.artifact,target);
   cells.push({target,optimization:optimization||'default',baselineBytes:baseline.artifact.wasm.length,mappedBytes:mapped.artifact.wasm.length,
    strippedBytes:stripped.bytes.length,removedSections:stripped.removed.length,byteIdentical:stripped.bytes.equals(baseline.artifact.wasm),
    sourceMapBytes:Buffer.byteLength(raw),sources:sourceMap.sources.length,mappingCharacters:sourceMap.mappings.length,
    compileMs:{baseline:Math.round(baselineMs),mapped:Math.round(mappedMs)},continuingLocated,location,requests});

  }
  assert.equal(JSON.stringify(plan),before);
  const sharing=counterexample(directory);
  console.log(JSON.stringify({status:'passed',cells,sharing,decision:'byte-identity-go; exact-owner-attribution-no-go; no-Catalog-run'},null,2));
 }finally{fs.rmSync(directory,{recursive:true,force:true});if(previousMap===undefined)delete process.env.RPT817_MAP_FILE;else process.env.RPT817_MAP_FILE=previousMap;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
