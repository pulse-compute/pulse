'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hash,load,terminalCases,controls}=require('./bundle.cjs');
const {verify}=require('./verify.cjs');
const pins=require('./engines.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'terminal-bundle-contract-'));
// Synthetic receipt validation tests are not engine or hosted observations.
try {
 const put=(file,bytes)=>{fs.writeFileSync(path.join(root,file),bytes);return hash(bytes);};
 const wasm=Buffer.from([0,97,115,109,1,0,0,0]);
 const artifacts=[...terminalCases,...controls].map(id=>({id,file:id+'.wasm',sha256:put(id+'.wasm',wasm),bytes:wasm.length,abi:terminalCases.includes(id)?'test':null,report:{file:id+'.json',sha256:put(id+'.json','{}')}}));
 const data={version:'pulse.terminal-installed.v1',status:'passed',candidate:{sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),workingTree:''},packageClosureVerified:true,outsideCheckout:true,
 harness:Object.fromEntries(['prepare.cjs','installed-worker.cjs','bundle.cjs','local.cjs','hosted.cjs','origin.cjs','verify.cjs','engines.json'].map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))])),
 packages:[{name:'test',file:'package.tgz',sha256:put('package.tgz','test')}],fixture:{file:'fixture.tgz',sha256:put('fixture.tgz','fixture')},artifacts,injected:{file:'injected.json',sha256:put('injected.json','{}')}};
 put('installed.json',JSON.stringify(data));const bundle=load(root);
 const cases=terminalCases.flatMap(id=>['ordinary','handoff',id.startsWith('websocket')?'bidirectional-websocket':'hold-publish'].map(scenario=>({id,scenario,status:'passed',artifactSha256:hash(wasm)})));
 const base={version:'pulse.terminal-transport.v1',status:'passed',cleanup:true,bundleSha256:bundle.sha256,cases};
 const local={...base,lane:'local',engines:[{version:'viceroy '+pins.viceroy.version,sha256:pins.viceroy.binarySha256},{version:'pushpin '+pins.pushpin.version,sha256:pins.pushpin.binaries[0].sha256}]};
 const hosted={...base,lane:'hosted',deployments:terminalCases.map(id=>({id,filesHash:'c'.repeat(128),packageSha256:'d'.repeat(64),artifactSha256:hash(wasm)}))};
 assert.equal(verify(root,local,hosted).status,'passed');
 for(const mutate of [r=>r.status='blocked',r=>r.lane='injected',r=>r.cleanup=false,r=>r.cases.pop(),r=>r.cases.push(r.cases[0]),r=>r.cases[0].artifactSha256='e'.repeat(64),r=>r.bundleSha256='e'.repeat(64),r=>r.deployments.pop()]){
  const changed=structuredClone(hosted);mutate(changed);assert.throws(()=>verify(root,local,changed));
 }
 const changed=structuredClone(local);changed.engines[0].sha256='f'.repeat(64);assert.throws(()=>verify(root,changed,hosted));
 for(const file of ['package.tgz','fixture.tgz','fanout.wasm','fanout.json','injected.json']){const saved=fs.readFileSync(path.join(root,file));put(file,'altered');assert.throws(()=>load(root));put(file,saved);}
 const changedData=structuredClone(data);changedData.artifacts[0].file='../escaped';put('installed.json',JSON.stringify(changedData));assert.throws(()=>load(root));
 console.log('ok - terminal receipt binding, pins, coverage, tamper and containment rejection');
}finally{fs.rmSync(root,{recursive:true,force:true});}
