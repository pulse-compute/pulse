'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {root:oracleRoot,hash,json,write}=require('./common.cjs');
const [phase,root,cwd,mode,out]=process.argv.slice(2);
const load=file=>require(path.join(root,file));
const nativeOptimization=mode==='default'?undefined:mode;
const started=performance.now();
async function main(){
 if(phase==='compile'){
  const {resolveProject}=load('wasm/packages/cli/src/project-config.js');
  const {compileProject}=load('wasm/packages/cli/src/project-execution.js');
  const {buildCanonicalNativePlan}=load('wasm/packages/compiler/src/canonical-native-plan.js');
  const {compileCanonicalNativePlan}=load('wasm/packages/compiler/src/canonical-native-compiler.js');
  const plan=buildCanonicalNativePlan(compileProject(resolveProject({cwd,profile:'node'})));
  const built=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,nativeOptimization,timeoutMs:300000});
  const compileWallMs=performance.now()-started;
  fs.writeFileSync(out+'.wasm',built.wasm);fs.writeFileSync(out+'.ts',built.source);
  write(out+'.plan.json',plan);write(out+'.manifest.json',built.manifest);write(out+'.artifacts.json',built.realizationArtifacts);
  console.log(JSON.stringify({compileWallMs,wasmBytes:built.wasm.length,wasmSha256:hash(built.wasm),sourceBytes:Buffer.byteLength(built.source),sourceSha256:hash(built.source),planHash:plan.planHash,canonicalHelpers:plan.helpers?.length||0,compilerVersion:built.compilerVersion}));return;
 }
 const built={wasm:fs.readFileSync(out+'.wasm'),plan:json(out+'.plan.json'),manifest:json(out+'.manifest.json'),source:fs.readFileSync(out+'.ts','utf8'),realizationArtifacts:json(out+'.artifacts.json')};
 if(phase==='structure'){
  const {binarySections,functionNames}=require(path.join(oracleRoot,'wasm/test/runtime/compiler-efficiency/b03-handler-functions.cjs'));
  const {resolveAsc}=load('wasm/packages/build-support/src/assemblyscript-compile.js');
  const {appendAssemblyScriptOptimizationArgs}=load('wasm/packages/build-support/src/native-optimization.js');
  const {runTool}=load('wasm/packages/wasm-guest-link/src/toolchain.js');
  const directory=out+'-named';fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'canonical-native.as.ts'),built.source);
  const asc=resolveAsc(path.join(root,'wasm'));
  const args=[asc.script,'canonical-native.as.ts','--outFile','named.wasm','--runtime',built.manifest.schemaCodecs?.active?'incremental':'stub','--noAssert','--optimize','--debug'];
  appendAssemblyScriptOptimizationArgs(args,nativeOptimization);
  if(built.plan.effects.some(e=>e.kind==='crypto.digestText'||e.kind.startsWith('s3.')))args.push('--maximumMemory','4096');
  if(built.manifest.schemaCodecs?.active){const compiler=path.join(root,'wasm/packages/compiler');const transform=require.resolve('json-as',{paths:[compiler]});args.push('--exportRuntime','--transform',transform,'--path',path.join(compiler,'node_modules'),'--path',path.dirname(path.resolve(transform,'../../..')));}
  const r=require('node:child_process').spawnSync(asc.executable,args,{cwd:directory,encoding:'utf8',timeout:300000,maxBuffer:1024*1024,env:{...process.env,JSON_STRICT:'true',JSON_USE_FAST_PATH:'0',JSON_MODE:'NAIVE'}});assert.equal(r.status,0,r.stderr);
  const named=fs.readFileSync(path.join(directory,'named.wasm')),binary=binarySections(built.wasm);assert.deepEqual(binary.sections,binarySections(named).sections,'named companion preserves every final production section');
  runTool('wasm-dis',[path.join(directory,'named.wasm'),'--mvp-features','--enable-mutable-globals','--enable-sign-ext','--enable-nontrapping-float-to-int','--enable-bulk-memory','-o',path.join(directory,'named.wat')]);
  const symbol=s=>s.replace(/\\([a-f0-9]{2})/gi,(_,b)=>String.fromCharCode(parseInt(b,16)));
  const wat=fs.readFileSync(path.join(directory,'named.wat'),'utf8');
  const mod=new WebAssembly.Module(named),names=functionNames(Buffer.from(WebAssembly.Module.customSections(mod,'name')[0])),imports=WebAssembly.Module.imports(mod).filter(i=>i.kind==='function').length;
  const functions=[...wat.matchAll(/^ \(func \$([^\s(]+)([\s\S]*?)^ \)/gm)].map((m,i)=>({name:symbol(m[1]),bytes:binary.bodies[i],calls:[...m[2].matchAll(/\bcall \$([^\s()]+)/g)].map(m=>symbol(m[1]))}));
  assert.equal(functions.length,binary.bodies.length);functions.forEach((f,i)=>assert.equal(f.name,names.get(imports+i)??String(i)));
  const roots=functions.filter(f=>/\/__pulse_(?:pure|shared)_helper_\d+$/.test(f.name));
  assert.ok(roots.length>0,'fixture must retain an actual helper body');
  const reachable=new Set(),queue=[...wat.matchAll(/\(export "[^"]+" \(func \$([^\s()]+)/g)].map(m=>symbol(m[1])),byName=new Map(functions.map(f=>[f.name,f]));
  for(let i=0;i<queue.length;i++){const n=queue[i];if(reachable.has(n))continue;reachable.add(n);queue.push(...(byName.get(n)?.calls||[]));}
  const retained=roots.map(f=>({name:f.name,bytes:f.bytes,directCallSites:functions.reduce((n,c)=>n+c.calls.filter(x=>x===f.name).length,0),reachable:reachable.has(f.name)}));assert.ok(retained.every(f=>f.reachable&&f.directCallSites>0));
  console.log(JSON.stringify({namedCompanionSectionsByteExact:true,retainedBodies:retained}));return;
 }
 assert.ok(['startup','runtime'].includes(phase));
 const {instantiateCanonicalNativeModule,executeCanonicalNativeModule}=load('wasm/packages/host-runtime/src/runtime/canonical-native-host.js');
 const moduleLoadMs=performance.now()-started;
 if(phase==='startup'){console.log(JSON.stringify({moduleLoadMs}));return;}
 const isHistory=cwd.endsWith('history');
 const text=JSON.stringify({schemaVersion:1,owner:'owner',nodes:[{prefix:hash('catalog-history-key-v1|key'),key:'key',value:'record-A',children:[]}]});
 const request=isHistory?{method:'GET',path:'/lookup/0',url:'https://proof.test/lookup/0',headers:{'x-root':hash(text)}}:{method:'POST',path:'/',url:'https://proof.test/',headers:{'content-type':'application/json'},body:JSON.stringify({subjectKind:'item',subjectId:'abc',partition:0,revision:1,root:{hash:'hash',node:0},counters:Array(10).fill(0)})};
 const options={request,strict:false,providerAdapter:{id:'b6-measurement',async dispatchEffect(e){if(e.kind==='crypto.digestText')return {status:'ok',sha256:hash(e.payload.text),byteLength:Buffer.byteLength(e.payload.text)};assert.equal(e.kind,'s3.getText');return {status:'found',text};}}};
 const instantiate=[];for(let i=0;i<10;i++){const t=performance.now();const c=instantiateCanonicalNativeModule(built,options);instantiate.push(performance.now()-t);c.close();}
 const requests=[];for(let i=0;i<40;i++){const t=performance.now(),r=await executeCanonicalNativeModule(built,options);const elapsed=performance.now()-t;assert.equal(r.response.status,200);assert.equal(r.response.body,isHistory?'after:record-A':'true|true');if(i>=10)requests.push(elapsed);}
 const stats=values=>{values.sort((a,b)=>a-b);return {samples:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1]};};
 console.log(JSON.stringify({moduleLoadMs,instantiate:stats(instantiate),requestLifecycle:stats(requests),requestIncludesInstantiation:true,provider:'injected Node effects; no network',semantics:'passed'}));
}
main().catch(e=>{console.error(e,e.diagnostics);process.exitCode=1;});
