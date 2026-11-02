'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,assertCoverage,hash,assertHarness}=require('./bundle.cjs');
const pins=require('./engines.json');
function verify(directory,local,hosted){
 const bundle=load(directory);assertHarness(bundle,['verify.cjs','bundle.cjs','engines.json']);
 for(const [lane,receipt] of [['local',local],['hosted',hosted]]){
  assertCoverage(receipt,lane);assert.equal(receipt.bundleSha256,bundle.sha256,'Receipt belongs to another installed bundle');
  for(const cell of receipt.cases)assert.equal(cell.artifactSha256,bundle.data.artifacts.find(a=>a.id===cell.id).sha256,'Transport executed another artifact');
 }
 assert.deepEqual(local.engines,[{version:'viceroy '+pins.viceroy.version,sha256:pins.viceroy.binarySha256},{version:'pushpin '+pins.pushpin.version,sha256:pins.pushpin.binaries[0].sha256}]);
 assert.deepEqual(hosted.deployments.map(d=>d.id).sort(),bundle.data.artifacts.filter(a=>a.abi).map(a=>a.id).sort());
 for(const d of hosted.deployments){assert.match(d.filesHash,/^[a-f0-9]{128}$/);assert.match(d.packageSha256,/^[a-f0-9]{64}$/);assert.equal(d.artifactSha256,bundle.data.artifacts.find(a=>a.id===d.id).sha256);}
 return {version:'pulse.terminal-qualification.v1',status:'passed',candidate:bundle.data.candidate,bundleSha256:bundle.sha256,localReceiptSha256:hash(Buffer.from(JSON.stringify(local))),hostedReceiptSha256:hash(Buffer.from(JSON.stringify(hosted))),qualification:'Installed package and terminal transport only; not a release seal'};
}
if(require.main===module){const [bundle,local,hosted,output]=process.argv.slice(2);assert(output,'Usage: verify.cjs BUNDLE LOCAL HOSTED OUTPUT');const receipt=verify(bundle,JSON.parse(fs.readFileSync(local)),JSON.parse(fs.readFileSync(hosted)));fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');}
module.exports={verify};
