'use strict';
// Matched local generation/compilation against a named Git base. No checkout
// mutation: only changed provider modules and their AS source read use the base.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Module=require('node:module'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');
const base=process.argv[2]||'41d9f6b5d577e444c5135fdb098da120596f76fd';
const output=process.argv[3]||'/tmp/lifecycle-measure.json';
const build=path.join(root,'packages/provider-fastly/src/build');
const sha=b=>createHash('sha256').update(b).digest('hex');
const oldFiles=new Set(['native-platform-capabilities.js','host-extensions.js','native-body-forwarding.js','native-body-forwarding.as.ts']);
const originals=new Map([...oldFiles].map(name=>[path.join(build,name),execFileSync('git',['show',`${base}:packages/provider-fastly/src/build/${name}`],{cwd:root})]));
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
 const req=Module.createRequire(file);
 m.require=id=>{
  if(id==='node:fs')return {...fs,readFileSync:(p,options)=>originals.has(String(p))?(typeof options==='string'||options?.encoding?originals.get(String(p)).toString(typeof options==='string'?options:options.encoding):originals.get(String(p))):fs.readFileSync(p,options)};
  const resolved=req.resolve(id);return originals.has(resolved)&&resolved.endsWith('.js')?load(resolved):req(id);
 };
 m._compile(originals.get(file).toString(),file);return m.exports;
}
const baseline=load(path.join(build,'native-platform-capabilities.js'));
const current=require(path.join(build,'native-platform-capabilities.js'));
const {compileCanonicalProject,packageRealizationArtifactsForCompiled}=require(path.join(root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(root,'wasm/packages/compiler/src/canonical-native-plan'));
const target=require(path.join(root,'packages/provider-fastly/src/toolchain')).createDriver().targets.native;
const rows=[];
for(const name of ['absent','unused','generic','fanout','websocket','forwarding']){
 let plan,options;
 if(name==='forwarding'){
  const {compileCanonicalSource}=require(path.join(root,'wasm/packages/compiler/src/canonical-api-compiler'));
  plan=buildCanonicalNativePlan(compileCanonicalSource("export default async function handler(ctx){return ctx.fetch('https://origin.example/upload',{method:'POST',body:ctx.req.body()});}"));
  options={cwd:root,canonicalBuild:true,requirePlatformCapability:false,maxDurationMs:2000,bodyForwarding:{requestMaxBytes:1048576,responseMaxBytes:1048576},bindings:{backends:{'https://origin.example':'origin'}}};
 }else{
  const c=compileCanonicalProject(path.join(__dirname,'../fixtures',name+'.ts'),{rootDir:root,target:'native',packageTargetDescriptor:target});
  plan=buildCanonicalNativePlan(c);options={cwd:root,canonicalBuild:true,requirePlatformCapability:false,bindings:{backends:{fanout:'fanout_backend'}},realizationArtifacts:packageRealizationArtifactsForCompiled(c)};
 }
 const old=baseline.compileFastlyNativePlatformCapabilitiesPlan(plan,options),now=current.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
 const oldSource=baseline.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).source,newSource=current.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).source;
 const row={name,baseBytes:old.wasm.length,bytes:now.wasm.length,delta:now.wasm.length-old.wasm.length,baseSha256:sha(old.wasm),sha256:sha(now.wasm),sourceIdentical:oldSource===newSource,wasmIdentical:old.wasm.equals(now.wasm),importsIdentical:JSON.stringify(old.inspection.imports)===JSON.stringify(now.inspection.imports),policyIdentical:JSON.stringify(old.manifest.hostExtensionPolicy)===JSON.stringify(now.manifest.hostExtensionPolicy)};
 if(['absent','unused','generic'].includes(name)){assert(row.sourceIdentical);assert(row.wasmIdentical);}
 row.importSetIdentical=JSON.stringify([...old.inspection.imports].sort((a,b)=>(a.module+':'+a.name).localeCompare(b.module+':'+b.name)))===JSON.stringify([...now.inspection.imports].sort((a,b)=>(a.module+':'+a.name).localeCompare(b.module+':'+b.name)));
 if(!row.importSetIdentical) console.log({oldImports:old.inspection.imports,newImports:now.inspection.imports});
 assert(row.importSetIdentical);assert(row.policyIdentical);rows.push(row);console.log(row);
}
fs.writeFileSync(output,JSON.stringify({kind:'matched local binary-size evidence; not runtime cost or Fastly acceptance',base,node:process.version,rows},null,2)+'\n');
