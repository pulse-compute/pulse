'use strict';
// Runs only against exact installed packages, after deleting authored inputs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const settings=JSON.parse(fs.readFileSync(process.argv[2]));
async function main(){
 assert(process.permission);for(const file of [settings.checkoutProbe,...settings.removedSources]){assert.equal(process.permission.has('fs.read',file),false);assert.throws(()=>fs.readFileSync(file),{code:'ERR_ACCESS_DENIED'});}
 const local=require('node:module').createRequire(path.join(settings.consumer,'package.json'));
 const {createNodeLauncher}=local('@pulse-compute/provider-node/server');const targets=[];
 for(const target of ['native','javascript']){
  const launcher=createNodeLauncher({buildDir:path.join(settings.consumer,'dist-'+target),target,host:'127.0.0.1',port:0,networkFetch:false});
  try{const started=await launcher.start();for(let i=0;i<3;i++){const response=await fetch(`http://127.0.0.1:${started.address.port}/`);assert.equal(response.status,200);assert.deepEqual(await response.json(),settings.expected);}targets.push({target,requests:3,originalSourcesRemoved:true});}finally{await launcher.close();}
 }
 fs.writeFileSync(settings.result,JSON.stringify({status:'passed',targets,checkoutReadsDenied:true,authoredSourceReadsDenied:true,providerReality:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
