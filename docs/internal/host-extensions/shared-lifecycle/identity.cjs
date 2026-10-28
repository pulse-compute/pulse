'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../../..'),dir=process.argv[2];
if(!dir)throw new Error('Provide an output directory and optional baseline directory.');fs.mkdirSync(dir,{recursive:true});
const platform=require(path.join(root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const {compile}=require(path.join(root,'docs/internal/host-extensions/measure.cjs'));
const rows=[];
for(const name of ['absent','unused','generic','fanout','websocket','forwarding','fanout-budget']){
 let plan,options,native;
 if(name==='forwarding'){
  const {compileCanonicalSource}=require(path.join(root,'wasm/packages/compiler/src/canonical-api-compiler'));
  const {buildCanonicalNativePlan}=require(path.join(root,'wasm/packages/compiler/src/canonical-native-plan'));
  plan=buildCanonicalNativePlan(compileCanonicalSource("export default async function handler(ctx){return ctx.fetch('https://origin.example/upload',{method:'POST',body:ctx.req.body()});}"));
  options={cwd:root,canonicalBuild:true,requirePlatformCapability:false,maxDurationMs:2000,bodyForwarding:{requestMaxBytes:1048576,responseMaxBytes:1048576},bindings:{backends:{'https://origin.example':'origin'}}};
 }else{
  const b=compile(name==='fanout-budget'?'fanout':name);plan=b.plan;options=b.options;native=b.native;
  if(name==='fanout-budget'){options={...options,maxDurationMs:1000};native=null;}
 }
 native ||= platform.compileFastlyNativePlatformCapabilitiesPlan(plan,options);
 const source=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).source;
 fs.writeFileSync(path.join(dir,name+'.as.ts'),source);fs.writeFileSync(path.join(dir,name+'.wasm'),native.wasm);
 rows.push({name,bytes:native.wasm.length,sha256:crypto.createHash('sha256').update(native.wasm).digest('hex'),imports:native.inspection.imports,policy:native.manifest.hostExtensionPolicy||null});
 console.log(name+' '+native.wasm.length);
}
fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(rows,null,2)+'\n');
if(process.argv[3]){
 for(const row of rows)for(const ext of ['as.ts','wasm'])assert.deepEqual(fs.readFileSync(path.join(dir,row.name+'.'+ext)),fs.readFileSync(path.join(process.argv[3],row.name+'.'+ext)),row.name+' '+ext);
 assert.deepEqual(rows,JSON.parse(fs.readFileSync(path.join(process.argv[3],'receipt.json'))));console.log('all seven source/Wasm/import/policy pairs identical');
}
