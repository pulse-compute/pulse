'use strict';
// Copied into the isolated consumer: only installed public package exports load product code.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f));
const {materializePackagePrebuilt}=require('@pulse-compute/wasm-guest-link');
const root=process.cwd(), plan=read('dist-guest/guest-unit-plan.json');
const packageRoot=path.join(root,'node_modules/@pulse-compute/crypto');
const manifestFile='guests/es256-rustcrypto/pulse.guest-unit.json';
const synchronizedPackages=fs.readdirSync('node_modules/@pulse-compute').map(name=>{const p=read(`node_modules/@pulse-compute/${name}/package.json`);return {name:p.name,version:p.version};});
const workDirectory=path.join(root,'guest-inspection');fs.mkdirSync(workDirectory,{recursive:true});
const options={plan,packageRoot,manifestFile,projectRoot:root,synchronizedPackages,workDirectory};
const materialized=materializePackagePrebuilt(options);
assert.equal(materialized.reused,true);
assert.equal(materialized.relativeDirectory,`.pulse/guests/${plan.unit.id}/${plan.unit.artifact?.sha256||plan.unit.artifactSha256}/${plan.unit.manifestSha256}`);
// A manifest-only identity change must coexist with the old cache entry even
// when the guest Wasm itself is identical. Use a copied package, never edit installed bytes.
const alternateRoot=path.join(root,'guest-package-fixture');fs.cpSync(packageRoot,alternateRoot,{recursive:true});
const alternateBytes=Buffer.from(fs.readFileSync(path.join(packageRoot,manifestFile),'utf8')+'\n');
fs.writeFileSync(path.join(alternateRoot,manifestFile),alternateBytes);
const alternatePlan=structuredClone(plan);alternatePlan.unit.manifestSha256=hash(alternateBytes);
alternatePlan.materialization.directory=plan.materialization.directory.replace(plan.unit.manifestSha256,alternatePlan.unit.manifestSha256);
const alternateOptions={...options,packageRoot:alternateRoot,plan:alternatePlan};
const alternate=materializePackagePrebuilt(alternateOptions);
assert.equal(alternate.reused,false);assert.notEqual(alternate.relativeDirectory,materialized.relativeDirectory);
assert.equal(materializePackagePrebuilt(alternateOptions).reused,true);
assert.equal(hash(fs.readFileSync(materialized.manifestFile)),plan.unit.manifestSha256);
assert.deepEqual(fs.readFileSync(alternate.artifactFile),fs.readFileSync(materialized.artifactFile));
fs.rmSync(alternateRoot,{recursive:true,force:true});
let mixedPackage;
assert.throws(()=>materializePackagePrebuilt({...options,synchronizedPackages:synchronizedPackages.map(p=>p.name==='@pulse-compute/crypto'?{...p,version:'0.0.0'}:p)}),e=>{mixedPackage=e.code;return /OWNER|VERSION/.test(e.code);});
async function main(){
 const report={status:'passed',guest:{directory:materialized.relativeDirectory,reused:true,artifactSha256:hash(fs.readFileSync(materialized.artifactFile)),manifestSha256:hash(fs.readFileSync(materialized.manifestFile))},mixedPackageDiagnostic:mixedPackage,manifestOnlyCacheSeparation:true};
 if(process.argv.includes('--production')) {
  const {createNodeLauncher}=require('@pulse-compute/provider-node/server');
  const buildDir=path.join(root,'dist-app'),options={target:'native',buildDir,port:0,config:{name:'preserved'}};
  const launcher=createNodeLauncher(options);
  try {const {address}=await launcher.start();const response=await fetch(`http://127.0.0.1:${address.port}/health`);assert.equal(response.status,200);assert.equal(await response.text(),'preserved');}
  finally {await launcher.close();}
  const manifestFile=path.join(buildDir,'pulse-build.json'),original=fs.readFileSync(manifestFile),build=JSON.parse(original);
  try {fs.writeFileSync(manifestFile,JSON.stringify({...build,version:'pulse.project-execution.v0'}));assert.throws(()=>createNodeLauncher(options),/provider\/target mismatch/);}
  finally {fs.writeFileSync(manifestFile,original);}
  const planFile=path.join(buildDir,build.portable.plan),planBytes=fs.readFileSync(planFile);
  try {fs.copyFileSync(path.join(root,'dist-guest/canonical-native-plan.json'),planFile);assert.throws(()=>createNodeLauncher(options),/plan hash mismatch/);}
  finally {fs.writeFileSync(planFile,planBytes);}
  const wasmFile=path.join(buildDir,build.portable.wasm.file),wasm=fs.readFileSync(wasmFile);
  const poison=path.join(buildDir,'fallback.cjs');fs.writeFileSync(poison,"require('node:fs').writeFileSync('FALLBACK_USED','bad');throw Error('unexpected JavaScript fallback');");
  try {fs.writeFileSync(wasmFile,Buffer.concat([wasm,Buffer.from([1])]));fs.writeFileSync(manifestFile,JSON.stringify({...build,application:{sourcePackage:'fallback.cjs'}}));assert.throws(()=>createNodeLauncher(options),/Wasm hash mismatch/);assert.equal(fs.existsSync('FALLBACK_USED'),false);}
  finally {fs.writeFileSync(wasmFile,wasm);fs.writeFileSync(manifestFile,original);fs.unlinkSync(poison);}
  report.production={finiteHttp:'passed',mixedBuildRejected:true,mixedPlanRejected:true,corruptNativeRejected:true,javascriptFallbackUsed:false};
 }
 for(const file of Object.keys(require.cache)) if(file.includes('/node_modules/@pulse-compute/')) assert.ok(file.startsWith(root+'/node_modules/'));
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
