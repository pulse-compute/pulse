'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const repo=process.cwd(),root=process.argv[2]||'/tmp/rc-h05';
const {verifyClosure}=require(repo+'/wasm/test/release/assert-request-deadline-packages.cjs');
const read=p=>JSON.parse(fs.readFileSync(p));
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const previous=repo+'/wasm/test/release/rc-h04/live',pack=root+'/terminal-bundle-2/packages';
const old=read(previous+'/terminal-installed.json'),fresh=read(root+'/terminal-bundle-2/installed.json');
const manifest=read(pack+'/pulse-release-manifest.json');
verifyClosure(root+'/provider-binding/consumer',pack,manifest);
assert.equal(manifest.packages.length,20);
for(const p of manifest.packages)assert.equal(p.version,'1.0.0-rc.1');
const artifacts=[];
for(const a of fresh.artifacts){
 const prior=old.artifacts.find(x=>x.id===a.id);assert(prior);
 const actual=digest(root+'/terminal-bundle-2/'+a.file);
 assert.equal(actual,a.sha256);assert.equal(actual,prior.sha256);
 artifacts.push({kind:'terminal',id:a.id,sha256:actual,bytes:a.bytes,previousFile:prior.file,currentFile:a.file,identical:true});
}
for(const id of ['k4','origin']){
 const a=read(root+'/provider-binding/'+id+'-build/artifact.json'),prior=read(previous+'/'+id+'-artifact.json');
 const actual=digest(root+'/provider-binding/'+id+'-build/main.wasm');
 assert.equal(actual,a.wasmSha256);assert.equal(actual,prior.wasmSha256);
 if(id==='k4'){assert.equal(a.uninstrumentedSha256,prior.uninstrumentedSha256);assert.equal(a.originalConsumerSha256,prior.originalConsumerSha256);assert.equal(a.sourceSha256,prior.sourceSha256);assert.equal(a.instrumentedSourceSha256,prior.instrumentedSourceSha256);}
 artifacts.push({kind:id,id,sha256:actual,identical:true});
}
const currentSource=require(repo+'/scripts/release-feature-acceptance.cjs').candidateIdentity(repo);
assert.deepEqual(fresh.candidate,currentSource);
const k4=read(root+'/k4-2/kv-k4-acceptance.json');
assert.equal(k4.packages.length,fresh.packages.length);
for(const p of k4.packages){const expected=fresh.packages.find(x=>x.name===p.name);assert(expected);assert.equal(p.version,expected.version);assert.equal(p.sha256,expected.sha256);}
assert.equal(k4.acceptance.status,'accepted-with-known-viceroy-discrepancy');
assert.equal(k4.acceptance.releaseBlocking,false);
assert.equal(k4.installedBytesUnchanged,true);
const result={schemaVersion:'pulse.rc-h05-provider-binding.v1',status:'verified-byte-equality',reviewStatus:'pending-human-release-review',candidate:currentSource,priorCandidate:old.candidate,
 packageClosureVerifiedAfterBuild:true,packages:fresh.packages,artifacts,
 localK4:{rawSemanticStatus:k4.status,acceptance:k4.acceptance},
 observations:{terminal:'complete 15-cell hosted replay; earlier failed attempts retained',kv:'58 deployed requests across IAD/LHR; zero mutation retries',origins:'16 live S3/fetch cases'},
 limitations:['No new deployment or remote traffic occurred in this binding.','The original deployed source/version identities remain unchanged.','Release-owner review must accept this explicit exact-byte binding; it is not self-approved.','The earlier held-response timeout remains unexplained.','A matching fixture does not prove every program or global provider behavior.','The aggregate seal must independently qualify all RC package bytes; compare its accepted package hashes before relying on this binding.']};
fs.writeFileSync(root+'/evidence/provider-binding.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,artifacts:artifacts.length,packageClosureVerified:true,candidate:currentSource}));
