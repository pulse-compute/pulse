'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {performance}=require('node:perf_hooks');
const F=require('./context-native-fixture.cjs');
const R=require('../../packages/contracts/src/resources/embedded');
const {compileCanonicalSource}=require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-compiler');
const host=require('../../packages/host-runtime/src/runtime/canonical-native-host');
const platform=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const fastlyHost=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const runtime=require('../../../packages/runtime/src/host');
const jsHost=require('../../../packages/provider-node/src/javascript/runtime-host');
const {createCanonicalSchemaCodecs}=require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
// Experiment ceilings fixed before the workloads run, not Fastly platform claims.
const acceptance={requestMs:5000,compileMs:120000,artifactBytes:8*1024*1024,guestCommittedBytes:128*1024*1024,nodeValueHandles:1048576,toolBytes:24576,mcpWrappedBytes:131072};
const budgets={files:3,bindings:3,fileBytes:5242880,totalBytes:8388608,serializedBytes:16777216};
const request=(d,h)=>({method:'GET',path:'/',url:'https://proof.test/',body:'',headers:Object.entries({version:d.pulseVersion,...h})});
const handler=s=>new Function(s.replace('export default','return'))();
function clip(s,max=384){let out='';for(const char of s){if(Buffer.byteLength(out+char)>max)break;out+=char;}return out;}
function oracle(d,h){
 const terms=[...new Set(F.tokens(h.query))];
 return d.records.filter(r=>(!h.category||r.category===h.category)&&(!h.provider||r.applicability.some(p=>p.provider===h.provider&&p.target===h.target))).map(record=>{
  const fields=[record.id,record.title,record.tags.join(' '),record.content].map(F.tokens);let score=0;
  for(let i=0;i<fields.length;i++)for(const t of terms)if(fields[i].includes(t))score+=[8,6,4,1][i];
  return {record,score,excerpt:clip(record.content),matches:terms.every(t=>fields.some(f=>f.includes(t)))};
 }).filter(r=>r.matches).sort((a,b)=>b.score-a.score||(a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0));
}
function growth(){
 const terms=Array.from({length:4096},(_,i)=>'term'+String(i).padStart(4,'0'));
 const sourceBytes=fs.readFileSync(__filename),sha=F.digest(sourceBytes),blob=require('node:crypto').createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex');
 const records=Array.from({length:512},(_,i)=>{
  let content=(i===0?terms.slice(0,1024):[...terms.slice(0,i<160?1017:8),...terms.slice(1024+(i-1)*7,1024+i*7)]).join(' ');
  if(i===0){content+='\u0000'.repeat(8000)+'\n雪😀"\\'.repeat(736);content+=' '.repeat(24576-Buffer.byteLength(content));}
  const id=terms[i];return {id,title:id,category:'contract',tags:[],applicability:[{provider:'fastly',target:'native'}],pulseVersion:'proof',status:'candidate',content,contentSha256:F.digest(Buffer.from(content)),source:{path:'wasm/test/runtime/assert-context-native-proof.cjs',selection:'generated-growth-row:'+i,sha256:sha,url:'https://api.github.com/repos/pulse-compute/pulse/git/blobs/'+blob}};
 });
 assert.equal(Buffer.byteLength(records[0].content),24576);
 assert(records.every(r=>Buffer.byteLength(r.content)<=24576));
 const canonical=JSON.stringify(records);assert(Buffer.byteLength(canonical)<2097152);
 return F.fixture({records,pulseVersion:'proof',corpusHash:F.digest(canonical)});
}
async function prove(d,name,cases){
 const source=F.source(d),bundle=F.schemaBundle();
 const catalogue=R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest(d.files.map(({path,bytes})=>({path,bytes})),budgets)),d.files.map(({id,path})=>({id,path})),budgets);
 const plan=buildCanonicalNativePlan(compileCanonicalSource(source,{fileName:'context-native-proof.ts',strict:false,target:'native',schemaBundle:bundle}),{binaryResources:catalogue});
 const started=performance.now();const native=compileCanonicalNativePlan(plan,{emitWat:false,reportCapture:false});const nativeCompileMs=performance.now()-started;
 const beforeFastly=performance.now();const fastly=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:F.root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});const fastlyCompileMs=performance.now()-beforeFastly;
 assert(nativeCompileMs<acceptance.compileMs&&fastlyCompileMs<acceptance.compileMs);assert(native.wasm.length<acceptance.artifactBytes&&fastly.wasm.length<acceptance.artifactBytes);
 assert(!fastly.inspection.imports.some(i=>/pulse_host|js-compute|^env$/.test(i.module)));
 const schemaCodecs=createCanonicalSchemaCodecs(bundle.registry),binaryResources=runtime.createBinaryResourceStore(d.files.map(({id,bytes})=>({id,bytes}))),app=handler(source);
 const runs=[];let executions=0;
 async function execute(headers,check=true){
  const req=request(d,headers),start=performance.now();const n=await host.executeCanonicalNativeModule(native,{strict:false,request:req,maxDurationMs:5000});const nodeMs=performance.now()-start;
  const fastlyStart=performance.now();const f=fastlyHost.executeFastlyNativePlatformCapabilities(fastly,{request:req});const fastlyMs=performance.now()-fastlyStart;
  const work={resourceReads:0,resourceBytes:0,utf8Reads:0,utf8Bytes:0,workspaceReads:0,workspaceWrites:0,metadataDecodes:0,metadataBytes:0,serializationCalls:0,serializedBytes:0};
  const observed=ctx=>app(new Proxy(Object.create(null),{get(_target,key){
   if(key==='resources')return {map(id){const view=ctx.resources.map(id);return new Proxy(Object.create(null),{get(_v,operation){if(operation==='byteLength')return view.byteLength;return (...args)=>{work.resourceReads++;work.resourceBytes+=operation==='readUtf8'?args[1]:operation==='readU8'?1:4;if(operation==='readUtf8'){work.utf8Reads++;work.utf8Bytes+=args[1];}return view[operation](...args);};}});}};
   if(key==='workspace')return {numbers(capacity){const cells=ctx.workspace.numbers(capacity);return new Proxy(Object.create(null),{get(_c,index){work.workspaceReads++;return cells[index];},set(_c,index,value){work.workspaceWrites++;cells[index]=value;return true;}});}};
   if(key==='decodeJson')return (...args)=>{work.metadataDecodes++;work.metadataBytes+=Buffer.byteLength(args[0]);return ctx.decodeJson(...args);};
   if(key==='encodeJson')return (...args)=>{const value=ctx.encodeJson(...args);work.serializationCalls++;work.serializedBytes+=Buffer.byteLength(value);return value;};
   return ctx[key];
  }}));
  const j=await jsHost.executeNodeJavascriptApplication(observed,new Request(req.url,{headers:Object.fromEntries(req.headers)}),{strict:false,binaryResources,schemaCodecs});
  const result=JSON.parse(n.response.body);assert.deepEqual(result,JSON.parse(f.response.body));assert.deepEqual(result,await j.json());
  const responseBytes=Buffer.byteLength(n.response.body),wrappedBytes=Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:'x'.repeat(32768),result:{content:[{type:'text',text:n.response.body}],structuredContent:result}}));
  assert(responseBytes<=acceptance.toolBytes);assert(wrappedBytes<=acceptance.mcpWrappedBytes);assert(nodeMs<5000&&fastlyMs<5000);
  assert(n.valueHandleCount<=acceptance.nodeValueHandles);assert(f.instance.exports.memory.buffer.byteLength<=acceptance.guestCommittedBytes);
  if(check&&result.status==='ok'){
   const ranked=oracle(d,headers),offset=Number(headers.offset||0),limit=Number(headers.limit||5);
   assert.equal(result.totalMatches,ranked.length);
   assert.deepEqual(result.results,ranked.slice(offset,offset+limit).map(({matches,record:{content,...record},...r})=>({...r,record})));
   for(const hit of result.results){assert.equal(hit.record.contentSha256,F.digest(d.records.find(r=>r.id===hit.record.id).content));assert(Buffer.byteLength(hit.excerpt)<=384);}
   if(result.comparisons!==undefined)assert(result.comparisons<=45056);
   if(result.heapSteps!==undefined)assert(result.heapSteps<=9216);
  }
  runs.push({headers,work,nodeMs,fastlyMs,nodeValueHandles:n.valueHandleCount,fastlyGuestCommittedBytes:f.instance.exports.memory.buffer.byteLength,responseBytes,wrappedBytes,status:result.status||'page',comparisons:result.comparisons,heapSteps:result.heapSteps,dictionaryComparisons:result.dictionaryComparisons,dictionaryBytes:result.dictionaryBytes});executions+=3;
  return result;
 }
 for(const h of cases)await execute(h);
 // Repeat against the same artifacts to check reset/freshness; each provider host creates a fresh invocation.
 await execute(cases[0]);await execute(cases[0]);
 for(const h of [{query:'compile',version:'wrong'},{query:''},{query:'é'},{query:'a '.repeat(129)},{query:'...'},{query:'a b c d e f g h i'},{query:'a'.repeat(65)},{query:'compile',limit:'6'},{query:'compile',offset:'513'},{query:'compile',provider:'fastly'},{query:'compile',category:'unknown'},{query:'zzzz_missing',offset:'1'}]){
  const result=await execute(h,false);assert.notEqual(result.status,'ok');
 }
 const row=name==='growth'?0:d.records.reduce((best,r,i)=>r.content.length>d.records[best].content.length?i:best,0);
 let offset=0,reconstructed='',pages=0;
 for(let attempt=0;attempt<16;attempt++){
  const result=await execute({'read-row':String(row),'read-offset':String(offset)},false);
  assert.equal(result.totalBytes,Buffer.byteLength(d.records[row].content));assert(Buffer.byteLength(result.chunk)<=12288);assert(Buffer.byteLength(JSON.stringify(result.chunk))-2<=16384);
  reconstructed+=result.chunk;pages++;assert.equal(result.nextOffset,reconstructed.length);offset=result.nextOffset;if(result.done)break;
 }
 assert.equal(reconstructed,d.records[row].content);
 if(name==='growth'){
  const emoji=d.records[row].content.indexOf('😀');assert(emoji>=0);
  assert.equal((await execute({'read-row':String(row),'read-offset':String(emoji+1)},false)).status,'invalid-offset');
 }
 // Use a clock that expires at several points without relying on a timer callback.
 let checkCount=0;
 await host.executeCanonicalNativeModule(native,{strict:false,request:request(d,cases[0]),maxDurationMs:30000,requestClock:{now:()=>{checkCount++;return 0;},setTimeout:()=>0,clearTimeout(){}}});
 for(const deadline of [1,7500,15000,22500]){
  let ticks=0;const requestClock={now:()=>++ticks*30000/checkCount,setTimeout:()=>0,clearTimeout(){}};
  await assert.rejects(host.executeCanonicalNativeModule(native,{strict:false,request:request(d,cases[0]),maxDurationMs:deadline,requestClock}),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
 }
 let fastlyCheckCount=0;
 fastlyHost.executeFastlyNativePlatformCapabilities(fastly,{request:request(d,cases[0]),monotonicClock:()=>{fastlyCheckCount++;return {nanoseconds:0n};}});
 for(const fraction of [0.01,0.25,0.5,0.75]){let tick=0;const expired=fastlyHost.executeFastlyNativePlatformCapabilities(fastly,{request:request(d,cases[0]),monotonicClock:()=>({nanoseconds:BigInt(Math.ceil(++tick*5000000000/(fastlyCheckCount*fraction)))})});assert.equal(expired.response.status,504);}
 const receipt={name,catalogueSha256:F.digest(JSON.stringify(catalogue)),fastlyDeadlineClockChecks:fastlyCheckCount,deadlineClockChecks:checkCount,deadlineFractions:[0,0.25,0.5,0.75],corpusHash:d.corpusHash,sourceSha256:F.digest(source),planHash:plan.planHash,records:d.records.length,dimensions:d.terms.length,nonzeros:d.entries,handles:3,workspaceSlots:1040,resourceBudgets:budgets,sourceWorkCounters:'instrumented JavaScript execution of the identical source; result equality against both Native paths',
  files:d.files.map(({id,bytes})=>({id,bytes:bytes.length,sha256:F.digest(bytes)})),native:{bytes:native.wasm.length,sha256:F.digest(native.wasm),compileMs:nativeCompileMs},fastly:{bytes:fastly.wasm.length,sha256:F.digest(fastly.wasm),compileMs:fastlyCompileMs,numericRegions:fastly.manifest?.numericRegions},executions,pages,runs};
 return receipt;
}
async function main(){
 const actual=F.fixture();assert(actual.records.length>=244);
 const ordinary=await prove(actual,'actual',[
  {query:'schema declarations'},{query:'compile'},{query:'PULSE_BINARY_RESOURCE_INVALID'},{query:'parallel'},{query:'fetch json'},{query:'pulse'},{query:'pulse',offset:'10'},{query:'schema',category:'contract',provider:'fastly',target:'native'},{query:'PARALLEL parallel'},{query:'@pulse-compute/pulse'},{query:'zzzz_missing'}
 ]);
 const grown=growth();assert.equal(grown.records.length,512);assert.equal(grown.terms.length,4096);assert.equal(Math.max(...grown.rows.map(r=>r.size)),1024);
 const stress=await prove(grown,'growth',[{query:'term0000 term0001 term0002 term0003 term0004 term0005 term0006 term0007'},{query:'term0000',offset:'507'},{query:'term0000',offset:'512'},{query:'term0000',offset:'511',limit:'1'}]);
 const git=(...args)=>cp.execFileSync('git',args,{cwd:F.root,encoding:'utf8'}).trim();
 const base=git('rev-parse','HEAD');
 // Other suites may leave untracked hidden fixture directories; they are not producer inputs.
 const untracked=git('ls-files','--others','--exclude-standard').split('\n').filter(p=>!p.split('/').some(part=>part.startsWith('.')));
 const changed=[...new Set([...git('diff','--name-only',base).split('\n'),...untracked].filter(Boolean))].filter(p=>!p.startsWith('docs/internal/b10-mcp-02/'));
 const receipt={version:'pulse.context-native-proof.v1',claim:'isolated Native query-to-citation; Fastly injected ABI, not CLI/Viceroy or MCP transport',node:process.version,base,lockfileSha256:F.digest(fs.readFileSync(path.join(F.root,'pnpm-lock.yaml'))),dirtySources:changed.map(p=>({path:p,sha256:F.digest(fs.readFileSync(path.join(F.root,p)))})),acceptance,workloads:[ordinary,stress],processPeakRssBytes:process.resourceUsage().maxRSS*1024,limitations:['Packed/installed and seal gates remain 03/07/09','MCP transport/client and real Fastly CLI/Viceroy remain 04/10','Guest committed memory is a Wasm page high-water measure, not live-object memory','Process RSS includes compiler, fixture and harness allocations','MCP wrapper byte accounting is calculated outside the prototype transport']};
 const out=path.join(F.root,'wasm/.test-results/b10-mcp-02-proof.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:'passed',receipt:out,workloads:receipt.workloads.map(w=>({name:w.name,records:w.records,dimensions:w.dimensions,executions:w.executions,nativeBytes:w.native.bytes,fastlyBytes:w.fastly.bytes,maxFastlyGuestBytes:Math.max(...w.runs.map(r=>r.fastlyGuestCommittedBytes))}))}));
}
module.exports={growth};
if(require.main===module)main().catch(e=>{console.error(e.message,e.diagnostics||e.detail?.stderr||e.detail||e.stack);process.exitCode=1;});
