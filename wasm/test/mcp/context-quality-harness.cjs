'use strict';
// Test-only construction and observation. No runtime, compiler or app mutation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../../..');
const B=require('../../../scripts/pulse-context-build.cjs');
const F=require('../../../scripts/pulse-context-format.cjs');
const START=require('../../../scripts/pulse-context-start.cjs');
const {canonical,render}=require('../../../scripts/pulse-context-corpus.cjs');
const {createResourceManifest}=require('../../packages/contracts/src/resources/embedded');
const host=require('../../packages/host-runtime/src/runtime/canonical-native-host');
const {NativeValueBudget}=require('../../packages/host-runtime/src/runtime/native-value-budget');
const runtime=require('../../../packages/runtime/src/host');
const node=require('../../../packages/provider-node/src/javascript/runtime-host');
const {compileFastlyNativePlatformCapabilitiesPlan}=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities}=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function growth(built){
  const corpus=structuredClone(built.corpus);
  const bytes=fs.readFileSync(__filename), source={path:'wasm/test/mcp/context-quality-harness.cjs',selection:'06B synthetic growth rows; retains every production row',sha256:sha(bytes),url:'https://api.github.com/repos/pulse-compute/pulse/git/blobs/'+crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};
  corpus.sources.push(source);
  // Fill the admitted row ceiling; overlapping 800-term rows stress scoring.
  // 1,200 additional vocabulary terms, escaped text, maximum text row and ties
  // coexist with the complete production corpus under all joint byte budgets.
  const terms=Array.from({length:1200},(_,i)=>'growth'+String(i).padStart(4,'0'));
  const shared=built.corpus.records[0];
  for(let i=corpus.records.length;i<512;i++){
    const n=i-built.corpus.records.length;
    let content=(n===0?terms.slice(0,1022):n<60?terms.slice(0,800):terms.slice(800+((n-60)*4)%400,804+((n-60)*4)%400)).join(' ');
    if(n===0){content+='\n😀é雪\0"\\'.repeat(700);content+=' '.repeat(24576-Buffer.byteLength(content));}
    corpus.records.push({id:'zzgrowth/'+String(n).padStart(3,'0'),title:n<5?'"'.repeat(1200):'Growth record',category:'guide',tags:[],applicability:shared.applicability,pulseVersion:corpus.pulseVersion,status:corpus.status,source:{...source,selection:'06B growth row '+n},content,contentSha256:sha(content)});
  }
  corpus.records.sort((a,b)=>F.compare(a.id,b.id));
  const {corpusHash,...snapshot}=corpus;corpus.corpusHash=sha(JSON.stringify(canonical(snapshot),null,2));
  F.validateCorpus(corpus,built.config.limits);
  return corpus;
}
function request(input,name='pulse.search'){
 const method='tools/call';return {method:'POST',path:'/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,'mcp-name':name},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},name,arguments:input}})};
}
function legacy(cwd,corpus){
 const folder=path.join(cwd,'legacy');fs.mkdirSync(path.join(folder,'src'),{recursive:true});fs.writeFileSync(path.join(folder,'package.json'),'{"type":"commonjs"}');
 const ts=require('typescript');
 for(const file of ['context-corpus.ts','corpus-version.ts','src/handlers.ts']){
  const source=file==='context-corpus.ts'?render(corpus):fs.readFileSync(path.join(root,'examples/12-pulse-context-mcp',file),'utf8');
  fs.writeFileSync(path.join(folder,file.replace(/\.ts$/,'.js')),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
 }
 return require(path.join(folder,'src/handlers.js'));
}
function build(built,corpus,repeat=1){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-context-quality-'));
 try{
  fs.cpSync(path.join(root,START.APP),cwd,{recursive:true});
  const encoded=F.encode(corpus,built.config.limits);const dimensions=F.validateFiles(encoded.files,corpus,built.config.limits);
  const manifest=createResourceManifest(F.FILES.map(name=>({path:'/'+name,bytes:encoded.files[name]})),built.manifest.dimensions.budgets);
  const generated=START.generate(corpus,built.config,encoded.files,manifest,file=>fs.readFileSync(path.join(root,file)));
  for(const [file,bytes]of generated.outputs)fs.writeFileSync(path.join(cwd,file.slice(START.APP.length+1)),bytes);
  if(repeat>1){
   const file=path.join(cwd,'src/index.ts');let source=fs.readFileSync(file,'utf8');
   const call="ctx.call(computeSearch, input, {\n    inputSchema: 'context.SearchInput', outputSchema: 'context.SearchOutput',\n  })";
   if(!source.includes('return '+call))throw Error('Search call fixture drift');
   source=source.replace('return '+call,Array.from({length:repeat-1},(_,i)=>`const repeated${i} = ${call}\n  `).join('')+'return '+call);fs.writeFileSync(file,source);
  }
  const modules=path.join(cwd,'node_modules/@pulse-compute');fs.mkdirSync(modules,{recursive:true});
  for(const name of ['pulse','runtime','entities','mcp','provider-node','provider-fastly'])fs.symlinkSync(path.join(root,'packages',name),path.join(modules,name),'dir');
  fs.symlinkSync(path.join(root,'wasm/packages/contracts'),path.join(modules,'wasm-contracts'),'dir');
  const {resolveProject}=require('../../packages/cli/src/project-config');
  const project=resolveProject({cwd,profile:'node-native'}),options={rootDir:cwd,workspaceRoot:root,strict:true,schemas:project.schemas,binaryResources:project.binaryResources};
  const compiled=require('../../packages/compiler/src/canonical-project-compiler').compileCanonicalProject(project.entryFile,{...options,target:'native'});
  const plan=require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(compiled);
  const started=performance.now();const native=require('../../packages/compiler/src/canonical-native-compiler').compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});const nodeCompileMs=performance.now()-started;
  const before=performance.now();const fastly=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});const fastlyCompileMs=performance.now()-before;
  const js=require('../../packages/compiler/src/javascript-application-plan').buildJavascriptApplicationPlan(project.entryFile,{...options,provider:'node'});
  const application=require('../../packages/cli/src/typescript-module-loader').loadJavascriptApplication(js,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,bindCallables:runtime.bindCallableApplication,allowedPackages:{'@pulse-compute/mcp/pulse':require('../../../packages/mcp/src/pulse.js')}}).application;
  const schemaCodecs=require('../../packages/schema-json/src/compiler/canonical-schema-codecs').createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const files=F.FILES.map(name=>({id:'context.'+name.split('.')[0],bytes:encoded.files[name]}));
  const receipt={repeat,corpusHash:corpus.corpusHash,dimensions,planHash:plan.planHash,sourceSha256:sha(fs.readFileSync(path.join(cwd,'src/index.ts'))),node:{bytes:native.wasm.length,sha256:sha(native.wasm),compileMs:nodeCompileMs},fastly:{bytes:fastly.wasm.length,sha256:sha(fastly.wasm),compileMs:fastlyCompileMs},resources:files.map(f=>({id:f.id,bytes:f.bytes.length,sha256:sha(f.bytes)}))};
  for(const [target,artifact]of Object.entries({node:native,fastly})){
   const module=new WebAssembly.Module(artifact.wasm),imports={};for(const entry of WebAssembly.Module.imports(module))(imports[entry.module]??={})[entry.name]=()=>0;
   const memory=Buffer.from(new WebAssembly.Instance(module,imports).exports.memory.buffer);
   receipt[target].initialGuestBytes=memory.length;
   receipt[target].citationHashBackings=corpus.records.map(r=>{const bytes=Buffer.from(r.contentSha256,'utf16le');let count=0,at=-1;while((at=memory.indexOf(bytes,at+1))>=0)count++;return {id:r.id,utf16LiteralCopies:count};});
   receipt[target].resourceBackings=files.map(f=>{let count=0,at=-1;while((at=memory.indexOf(f.bytes,at+1))>=0)count++;return {id:f.id,physicalFullCopies:count};});
  }
  return {cwd,corpus,config:built.config,native,fastly,application,schemaCodecs,files,receipt,legacy:legacy(cwd,corpus)};
 }catch(e){fs.rmSync(cwd,{recursive:true,force:true});throw e;}
}
async function execute(app,target,input,extra={},name='pulse.search'){
 const req=request(input,name);
 if(target==='node')return host.executeCanonicalNativeModule(app.native,{request:req,maxDurationMs:5000,...extra});
 if(target==='fastly')return executeFastlyNativePlatformCapabilities(app.fastly,{request:req,...extra});
 const r=await node.executeNodeJavascriptApplication(app.application,new Request('https://context.test/mcp',{method:'POST',headers:req.headers,body:req.body}),{schemaCodecs:app.schemaCodecs,binaryResources:runtime.createBinaryResourceStore(app.files),strict:true,maxDurationMs:5000,...extra});
 return {response:{status:r.status,body:await r.text()}};
}
// Transparent test observer around host imports. Timing samples use execute()
// without this observer. Phase labels come from schema identities and ABI calls.
async function observe(app,input,fault){
 const Original=WebAssembly.Instance,charge=NativeValueBudget.prototype.charge;
 let instance,phase='request',expired=false,triggered=false,clockCalls=0;
 const strings=new Map(),phases={},transfers={guestToHostUtf16Bytes:0,hostToGuestUtf16Bytes:0,hostToGuestAllocations:0};
 const entry=()=>phases[phase]??=( {clockChecks:0,charges:0,chargedBytes:0,chargedValues:0,imports:0} );
 const set=p=>{phase=p;entry();if(fault?.kind==='deadline'&&phase===fault.phase){expired=true;triggered=true;}};
 const clock={now(){entry().clockChecks++;if(++clockCalls>1&&fault?.kind==='deadline'&&phase===fault.phase){expired=true;triggered=true;}return expired?5001:0;},setTimeout:()=>0,clearTimeout(){}};
 WebAssembly.Instance=class extends Original{
  constructor(module,imports){
   const wrapped=Object.fromEntries(Object.entries(imports).map(([namespace,funcs])=>[namespace,Object.fromEntries(Object.entries(funcs).map(([name,fn])=>[name,(...args)=>{
    const schema=strings.get(args[1]);
    if(name==='schema_encode'&&schema==='context.SearchInput')set('callable-input');
    if(name==='schema_encode'&&schema==='context.SearchOutput')set('callable-output');
    if(name==='value_json'&&phase==='callable-output')set('mcp-serialization');
    entry().imports++;
    const result=fn(...args);
    if(name==='value_string'){
     const value=host.decodeAssemblyScriptString(instance.exports.memory,args[0],args[1]);strings.set(result,value);transfers.guestToHostUtf16Bytes+=args[1]*2;
    }
    if(name==='value_json'){const size=new DataView(instance.exports.memory.buffer).getUint32(result-4,true);transfers.hostToGuestUtf16Bytes+=size;transfers.hostToGuestAllocations++;}
    if(name==='schema_decode'&&schema==='context.SearchInput'&&phase==='callable-input')set('computation');
    return result;
   }]))]));
   super(module,wrapped);instance=this;
  }
 };
 NativeValueBudget.prototype.charge=function(values,bytes){
  const p=entry();p.charges++;p.chargedBytes+=bytes;p.chargedValues+=values;
  if(fault?.kind==='allocation'&&phase===fault.phase&&!triggered){triggered=true;this.policy={...this.policy,maxBytes:this.bytes,maxValues:this.values};}
  return charge.call(this,values,bytes);
 };
 try{
  const result=await execute(app,'node',input,{requestClock:clock});
  return {result,observation:{phases,transfers,triggered,fault,guestCommittedBytes:result.guestMemoryBytes,retained:result.memory}};
 }catch(error){return {error,observation:{phases,transfers,triggered,fault,error:{code:error.code,message:error.message,responseStatus:error.execution?.responseStatus},guestCommittedBytes:error.execution?.guestMemoryBytes,retained:error.execution?.memory}};}
 finally{WebAssembly.Instance=Original;NativeValueBudget.prototype.charge=charge;}
}
module.exports={root,B,F,sha,growth,build,execute,observe,request};
