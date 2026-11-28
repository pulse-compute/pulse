'use strict';
// Executed in an isolated exact-tarball install. Only the Fastly ABI test host
// and its storage authority are borrowed from the checkout.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const {write,profiles,asset}=require('./fixture.cjs');
const root=fs.realpathSync(process.cwd()),output=path.resolve(process.argv[2]),workspace=fs.realpathSync(process.argv[3]);
const installed=createRequire(path.join(root,'package.json'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const load=name=>{assert(fs.realpathSync(installed.resolve(name)).startsWith(root+'/node_modules/'),'workspace product import');return installed(name);};
const {resolveProject}=load('@pulse-compute/cli/project-config');
const execution=load('@pulse-compute/cli/project-execution');
const {executeCanonicalNativeModule}=load('@pulse-compute/wasm-host-runtime/runtime/canonical-native-host');
const {executeNodeJavascriptApplication}=load('@pulse-compute/provider-node/javascript/runtime-host');
const {createNodeKvReference}=load(path.join(path.dirname(installed.resolve('@pulse-compute/provider-node/runtime/canonical-api-runtime')),'conditional-kv.js'));
const driver=load('@pulse-compute/provider-node/toolchain').createDriver();
const {createNodeProviderAdapter}=load('@pulse-compute/provider-node/runtime/canonical-api-runtime');
const fixturePath=path.join(workspace,'packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
const {executeFastlyNativePlatformCapabilities}=require(fixturePath);
const {createConditionalKvAuthority}=require(path.join(workspace,'packages/provider-fastly/src/testing/conditional-kv-host.js'));
const NOW=1700000000000,origin='https://consumer.test';
const secrets={INGRESS_KEY:crypto.randomBytes(32).toString('hex'),WORKER_KEY:crypto.randomBytes(32).toString('hex')};
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
function token(subject='reader',expired=false){
 const input=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture',typ:'JWT'})).toString('base64url')+'.'+
  Buffer.from(JSON.stringify({iss:'composed-fixture',aud:'consumer',sub:subject,iat:NOW/1000-60,exp:NOW/1000+(expired?-1:600)})).toString('base64url');
 return input+'.'+crypto.sign('sha256',Buffer.from(input),pair.privateKey).toString('base64url');
}
const bearer='Bearer '+token();
function request(route,body,options={}){
 const method=options.method||(body===undefined?'GET':'POST'),url=origin+route,issued=String(options.issued??NOW);
 const scope=options.scope||(route==='/worker'?'worker':'ingress');
 const tag=crypto.createHmac('sha256',secrets[scope==='worker'?'WORKER_KEY':'INGRESS_KEY'])
  .update(scope+'\n'+method+'\n'+(options.signedUrl||url)+'\n'+issued).digest('hex');
 const headers=[['x-proof-issued',issued],['x-proof',options.badProof?'0'.repeat(64):tag]];
 if(!options.noBearer)headers.push(['authorization',options.bearer||bearer]);
 if(body!==undefined)headers.push(['content-type','application/json']);
 return {method,path:route,url,headers:options.noProof?headers.filter(([key])=>key!=='x-proof'):headers,body:body===undefined?'':JSON.stringify(body)};
}
async function main(){
 const jwk={...pair.publicKey.export({format:'jwk'}),kid:'fixture'};
 write(root,jwk);
 const ts=load('typescript');
 const program=ts.createProgram(['app.ts','schemas.ts','.pulse/config.ts'].map(file=>path.join(root,file)),{noEmit:true,strict:true,skipLibCheck:false,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext});
 const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:n=>n,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
 const projects=Object.fromEntries(profiles.map(profile=>[profile,resolveProject({cwd:root,profile})]));
 const builds=[], admitted=[];let native,built,wasm;
 for(const target of profiles){
  if(target==='node-native'){
   native=execution.compileNativeProjectInMemory(projects[target]);
   const nodeBuild=execution.buildProject(projects[target]);assert.equal(nodeBuild.status,'built');
   assert.deepEqual(fs.readFileSync(path.join(nodeBuild.outDir,'canonical-native.wasm')),native.native.wasm);
  }
  if(target==='fastly-native'){built=execution.buildProject(projects[target]);assert.equal(built.status,'built');wasm=fs.readFileSync(path.join(built.outDir,'bin/main.wasm'));}
  builds.push({target,status:'admitted',...(target==='node-native'?{wasmSha256:hash(native.native.wasm)}:target==='fastly-native'?{wasmSha256:hash(wasm)}:{})});admitted.push(target);
 }
 assert.deepEqual(admitted,profiles);
 const compiled=execution.compileProject(projects['node-javascript']);
 const {createCanonicalSchemaCodecs}=load('@pulse-compute/wasm-schema-json/compiler/canonical-schema-codecs');
 const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
 const js=execution.prepareJavascriptApplication(projects['node-javascript'],{schemaBundle:compiled.schema.bundle});
 const jsBuild=execution.buildProject(projects['node-javascript']);assert.equal(jsBuild.status,'built');
 const cases=[],assetFailureCleanup=[];
 for(const target of admitted){
  console.log('stab03-installed - executing '+target);
  let fault=null,mutations=0,commits=0;
  const ref=createNodeKvReference({kvInstanceId:'composed',kv:{static:{'/index.html':asset},commands:{},views:{}},kvHooks:{
   prepare(effect){if(fault==='before-dispatch'&&effect.namespace==='commands')throw Error('fixture preparation failure');},
   dispatch(effect){if(effect.kind==='kv.insertIfAbsent')mutations++;},
   afterCommit(effect){commits++;if(fault==='lost-ack'&&effect.namespace==='commands')throw Error('fixture acknowledgement loss');}
  }});
  ref.kv('commands');ref.kv('views');
  const authority=createConditionalKvAuthority();for(const name of ['commands','views','static'])authority.stores.set(name,new Map());authority.seed('static','/index.html',Buffer.from(asset));
  const state=()=>target==='fastly-native'
   ? [...authority.stores].filter(([name])=>name!=='static').map(([name,items])=>[name,[...items].map(([key,value])=>[key,value.generation.toString(),value.wire.toString('hex')])])
   : {commits,values:[...ref.legacyStores()].filter(([name])=>name!=='static').map(([name,items])=>[name,[...items]])};
  async function run(id,req,status,expected,deny=false,missingKey=false){
   const before=JSON.stringify(state()),writes=mutations;let response,trace=[];
   const options={request:req,secrets:missingKey?{}:secrets,config:{VIEW_PREFIX:'qualified'},kvReference:ref,strict:false,maxDurationMs:15000,schemaCodecs,
    wallClock:()=>NOW,captureJwtWallClock:()=>({trusted:true,unixEpochSeconds:NOW/1000}),jwtCaptureWallClock:()=>({trusted:true,unixEpochSeconds:NOW/1000})};
   if(target==='node-native')({response,trace}=await executeCanonicalNativeModule(native.native,{...driver.executionOptions(projects[target].providerConfig,options),providerAdapter:createNodeProviderAdapter({wallClock:()=>NOW})}));
   else if(target==='node-javascript'){
    const r=await executeNodeJavascriptApplication(js.loaded.application,new Request(req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req.body})}),{...options,onEffectObservation:e=>trace.push(e)});
    response={status:r.status,body:await r.text()};
   }else{
    const r=executeFastlyNativePlatformCapabilities({wasm},{request:req,secrets:options.secrets,secretStore:'app_secrets',config:{VIEW_PREFIX:'qualified'},clockUnixSeconds:NOW/1000,allowHandledJwtError:true,conditionalKv:{authority,onCall(stage,detail){
     if(stage==='insert')mutations++;
     if(fault==='before-dispatch'&&stage==='open'&&detail.store==='commands')return {status:1};
     if(fault==='lost-ack'&&stage==='insert_wait')return {status:1,kvError:1};
    }}});
    ({response,trace}=r);
    assert.equal(r.kvEvidence.bodyFixtures.size,0,'owned read bodies released');
    assert.equal(r.kvEvidence.pending.size,0,'no pending KV work');
    if(id==='asset-get'||id==='asset-head')assert.equal(trace.filter(e=>e.module==='fastly_http_body'&&e.name==='close').length,1,'asset lookup body closes exactly once');
    if(id==='asset-head')assert.equal(trace.filter(e=>e.module==='fastly_http_body'&&e.name==='read').length,0,'HEAD does not read asset bytes');
    assert.equal(trace.filter(x=>x.module==='fastly_http_resp'&&x.name==='send_downstream').length,1,'one HTTP settlement');
   }
   if(response.bodyStream){
    const stream=response.bodyStream;
    const body=Array.isArray(stream.chunks)?Buffer.concat(stream.chunks.map(c=>Buffer.from(c))).toString('utf8'):await new Response(stream).text();
    response={...response,body};
   }
   if(req.method==='HEAD'){assert.equal(response.bodyStream,undefined);response={...response,body:response.body??''};}
   assert.equal(response.status,status,`${target}/${id}: ${response.body}`);
   if(expected!==undefined)assert.deepEqual(typeof expected==='string'?response.body:JSON.parse(response.body),expected,`${target}/${id}`);
   if(deny){assert.equal(mutations,writes,`${id}: unauthorized mutation`);assert.equal(JSON.stringify(state()),before,`${id}: unauthorized state change`);}
   const text=JSON.stringify(trace);for(const secret of [...Object.values(secrets),bearer,bearer.slice(7)])assert(!text.includes(secret),'credential in default trace');
   cases.push({id,target,status:'passed',httpStatus:status});return response;
  }
  const command={id:'item',value:'payload'};
  await run('missing-ingress-proof',request('/api/command',command,{noProof:true}),403,'proof denied',true);
  await run('bad-ingress-proof',request('/api/command',command,{badProof:true}),403,'proof denied',true);
  await run('expired-proof',request('/api/command',command,{issued:NOW-60001}),403,'stale proof',true);
  await run('future-proof',request('/api/command',command,{issued:NOW+1}),403,'stale proof',true);
  await run('wrong-target',request('/api/command',command,{signedUrl:origin+'/other'}),403,'proof denied',true);
  await run('worker-proof-is-not-ingress',request('/api/command',command,{scope:'worker'}),403,'proof denied',true);
  await run('missing-proof-secret',request('/api/command',command),403,'proof denied',true,true);
  await run('missing-bearer',request('/api/command',command,{noBearer:true}),401,'denied',true);
  await run('invalid-bearer',request('/api/command',command,{bearer:'Bearer malformed'}),401,'denied',true);
  await run('wrong-user',request('/api/command',command,{bearer:'Bearer '+token('other')}),403,'user denied',true);
  await run('expired-bearer',request('/api/command',command,{bearer:'Bearer '+token('reader',true)}),401,'denied',true);
  await run('asset-direct-denied',request('/static/index.html',undefined,{noProof:true}),403,'proof denied',true);
  await run('asset-get',request('/static/index.html',undefined,{noBearer:true}),200,asset,true);
  await run('asset-head',request('/static/index.html',undefined,{method:'HEAD',noBearer:true}),200,'',true);
  await run('command-accepted',request('/api/command',command),202,{status:'accepted'});
  const accepted=JSON.stringify(state());
  await run('exact-command-replay',request('/api/command',command),200,{status:'replayed'});assert.equal(JSON.stringify(state()),accepted);
  await run('changed-command-replay',request('/api/command',{...command,value:'different'}),409,{status:'conflict'});assert.equal(JSON.stringify(state()),accepted);
  await run('view-before-worker',request('/api/view'),404,'pending',true);
  await run('worker-direct-denied',request('/worker',{id:'item'},{noProof:true}),403,'proof denied',true);
  await run('ingress-proof-is-not-worker',request('/worker',{id:'item'},{scope:'ingress'}),403,'proof denied',true);
  await run('worker-projection',request('/worker',{id:'item'},{noBearer:true}),202,{status:'projected'});
  const projected=JSON.stringify(state());
  await run('worker-replay',request('/worker',{id:'item'},{noBearer:true}),200,{status:'replayed'});assert.equal(JSON.stringify(state()),projected);
  await run('authorized-projection-read',request('/api/view'),200,{value:'payload',prefix:'qualified'},true);
  const beforeUncertain=mutations;
  fault='lost-ack';await run('uncertain-command',request('/api/command',{id:'uncertain',value:'once'}),503,{status:'unknown'});fault=null;assert.equal(mutations,beforeUncertain+1,'uncertainty must not trigger automatic retries');
  const uncertain=JSON.stringify(state());
  await run('uncertain-exact-replay',request('/api/command',{id:'uncertain',value:'once'}),200,{status:'replayed'});assert.equal(JSON.stringify(state()),uncertain);
  await run('uncertain-changed-replay',request('/api/command',{id:'uncertain',value:'other'}),409,{status:'conflict'});assert.equal(JSON.stringify(state()),uncertain);
  await run('worker-after-uncertainty',request('/worker',{id:'uncertain'},{noBearer:true}),202,{status:'projected'});
  fault='before-dispatch';await run('pre-dispatch-failure',request('/api/command',{id:'not-sent',value:'later'}),503,{status:'unavailable'},true);fault=null;
  await run('retry-after-no-dispatch',request('/api/command',{id:'not-sent',value:'later'}),202,{status:'accepted'});
 }
 // Returned read failures must also release the acquired asset body.
 for(const stage of ['body_read','body_close']){
  const authority=createConditionalKvAuthority();authority.seed('static','/index.html',Buffer.from(asset));
  let closeCalls=0;
  assert.throws(()=>executeFastlyNativePlatformCapabilities({wasm},{request:request('/static/index.html',undefined,{noBearer:true}),secrets,secretStore:'app_secrets',clockUnixSeconds:NOW/1000,
   conditionalKv:{authority,onCall(name){if(name==='body_close')closeCalls++;if(name===stage)return {status:1};}}}),error=>error.code==='PULSE_FASTLY_NATIVE_PLATFORM_CAPABILITIES_MOCK_EXECUTION_FAILED');
  assert.equal(closeCalls,1,'asset read/close failure attempts exactly one close');
  assetFailureCleanup.push({stage,status:'passed',closeCalls});
 }
 const ids=cases.filter(c=>c.target===admitted[0]).map(c=>c.id);assert.equal(ids.length,29);assert.equal(new Set(ids).size,29);
 for(const target of admitted)assert.deepEqual(cases.filter(c=>c.target===target).map(c=>c.id),ids);
 const consumerFiles=['app.ts','schemas.ts','.pulse/config.ts'];
 const consumerSource=consumerFiles.map(file=>fs.readFileSync(path.join(root,file)));
 const controls=await require('./installed-composition.cjs').qualify({root,output,load,execution,resolveProject,driver,executeCanonicalNativeModule,executeFastlyNativePlatformCapabilities});
 consumerFiles.forEach((file,index)=>fs.writeFileSync(path.join(root,file),consumerSource[index]));
 const allowed=new Set([fixturePath,...['native-dynamic-backends-host.js','conditional-kv-host.js'].map(file=>path.join(workspace,'packages/provider-fastly/src/testing',file))]);
 for(const file of Object.keys(require.cache))if(file.startsWith(workspace+path.sep))assert(allowed.has(file),`workspace product loaded: ${file}`);
 if(built)fs.cpSync(built.outDir,path.join(output,'fastly-build'),{recursive:true});
 if(native)fs.writeFileSync(path.join(output,'node.wasm'),native.native.wasm);
 fs.cpSync(jsBuild.outDir,path.join(output,'node-javascript-build'),{recursive:true});
 for(const file of ['app.ts','schemas.ts','.pulse/config.ts'])fs.copyFileSync(path.join(root,file),path.join(output,path.basename(file)));
 const privateValues=[...Object.values(secrets),pair.privateKey.export({format:'jwk'}).d];
 const artifacts=[];function visit(dir,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=prefix+e.name;if(e.isDirectory())visit(path.join(dir,e.name),file+'/');else{const bytes=fs.readFileSync(path.join(dir,e.name));for(const secret of privateValues)assert(!bytes.includes(Buffer.from(secret)),'private material in build artifact');artifacts.push({file,sha256:hash(bytes)});}}}
 visit(output);
 fs.writeFileSync(path.join(output,'worker.json'),JSON.stringify({status:'passed',compositionStatus:'qualified',builds,controls,cases,assetFailureCleanup,publicTypes:true,artifacts,hostFixtureSha256:hash(fs.readFileSync(fixturePath)),fastlyEvidence:'compiled-wasm-injected-host',hostedQualified:false},null,2)+'\n');
 console.log(JSON.stringify({status:'passed',executions:cases.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
