'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const B = require('../../../scripts/pulse-context-build.cjs');
const {resolveProject} = require('../../packages/cli/src/project-config');
const {compileCanonicalProject} = require('../../packages/compiler/src/canonical-project-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-compiler');
const {executeCanonicalNativeModule} = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const {buildJavascriptApplicationPlan} = require('../../packages/compiler/src/javascript-application-plan');
const {loadJavascriptApplication} = require('../../packages/cli/src/typescript-module-loader');
const {createCanonicalSchemaCodecs} = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
const node = require('../../../packages/provider-node/src/javascript/runtime-host');
const runtime = require('../../../packages/runtime/src/host');
const {compileFastlyNativePlatformCapabilitiesPlan} = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const {executeFastlyNativePlatformCapabilities} = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
let cwd;
const F = require('../../../scripts/pulse-context-format.cjs');
const SEARCH = require('./context-search-oracle.cjs');
const START = require('../../../scripts/pulse-context-start.cjs');
const {canonical,render} = require('../../../scripts/pulse-context-corpus.cjs');
const {createResourceManifest} = require('../../packages/contracts/src/resources/embedded');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = {status:'running',executions:0,largestToolBytes:0,largestMcpBytes:0,largestToolResultBytes:0,runs:[]};
async function main(synthetic) {
  cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-context-tools-'));
  const run={synthetic,executions:0};
  const built = B.construct(root), legacyRoot=path.join(root,'examples/12-pulse-context-mcp');
  let fixtureFiles;
  const changed=[];
  if(synthetic){
    const set=(id,content)=>{const r=built.corpus.records.find(r=>r.id===id);assert(r);r.content=content;r.contentSha256=F.hash(content);changed.push(id);};
    const unit='\ufeff😀é雪\0\b\t\n\f\r"\\ ';
    let maxText=unit.repeat(Math.floor(24576/Buffer.byteLength(unit)));
    maxText+=' '.repeat(24576-Buffer.byteLength(maxText));
    set('contract/transport-limits',maxText);
    set('command/report','');
    set('example/01-hello-json/src/index.ts','x '.repeat(12288));
    set('example/02-request-schema/src/index.ts','x '.repeat(4000));
    set('example/02-request-schema/src/schemas.ts','y '.repeat(4000));
    const diagnostics=built.corpus.records.filter(r=>r.category==='diagnostic');
    set(diagnostics[0].id,JSON.stringify({code:diagnostics[0].id.slice(11),category:'schema',summary:'Synthetic bound',remediation:['"'.repeat(9000)]}));
    set(diagnostics[1].id,JSON.stringify({code:diagnostics[1].id.slice(11),category:'async-effect',summary:'Exact 雪😀\n summary',remediation:['first','second \t check']}));
    // Five equal-score rows, scalar-boundary excerpts and a page whose complete
    // duplicated MCP envelope exceeds 24 KiB while each metadata row is admitted.
    const tied=built.corpus.records.filter(r=>r.category==='guide').slice(-5);
    assert.equal(tied.length,5);
    for(const [i,r] of tied.entries()){
      r.title='"'.repeat(1200);
      set(r.id,'searchtie '+('a '.repeat(185))+'😀é雪\0\n"\\ '+i);
    }
    const {corpusHash,...snapshot}=built.corpus;built.corpus.corpusHash=F.hash(JSON.stringify(canonical(snapshot),null,2));
    fixtureFiles=F.encode(built.corpus,built.config.limits).files;
    F.validateFiles(fixtureFiles,built.corpus,built.config.limits);
  }
  assert.equal(B.run().changedFiles,0);
  fs.cpSync(path.join(legacyRoot,'application'),cwd,{recursive:true});
  if(synthetic){
    const manifest=createResourceManifest(F.FILES.map(name=>({path:'/'+name,bytes:fixtureFiles[name]})),built.manifest.dimensions.budgets);
    const generated=START.generate(built.corpus,built.config,fixtureFiles,manifest,file=>fs.readFileSync(path.join(root,file)));
    for(const [file,bytes] of generated.outputs)fs.writeFileSync(path.join(cwd,file.slice(START.APP.length+1)),bytes);
  }
  const modules=path.join(cwd,'node_modules/@pulse-compute');fs.mkdirSync(modules,{recursive:true});
  for(const name of ['pulse','runtime','entities','mcp','provider-node','provider-fastly'])fs.symlinkSync(path.join(root,'packages',name),path.join(modules,name),'dir');
  fs.symlinkSync(path.join(root,'wasm/packages/contracts'),path.join(modules,'wasm-contracts'),'dir');
  execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(cwd,'tsconfig.json')],{stdio:'pipe'});
  const projects=['node-native','fastly-native','node-javascript'].map(profile=>resolveProject({cwd,profile}));
  for(const p of projects){assert(p.binaryResources);assert.equal(p.strict,true);}
  const project=projects[0], options={rootDir:cwd,workspaceRoot:root,strict:true,schemas:project.schemas,binaryResources:project.binaryResources};
  const compiled=compileCanonicalProject(project.entryFile,{...options,target:'native'}), plan=buildCanonicalNativePlan(compiled);
  assert.equal(plan.callables.length,5);assert.equal(compiled.callableSource.sites.length,5);
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
  const fastly=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
  const js=buildJavascriptApplicationPlan(project.entryFile,{...options,provider:'node'});
  assert(!js.graph.modules.some(m=>m.path?.includes('context-corpus')),'legacy full-text module is unreachable');
  const application=loadJavascriptApplication(js,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,
    bindCallables:runtime.bindCallableApplication,allowedPackages:{'@pulse-compute/mcp/pulse':require('../../../packages/mcp/src/pulse.js')}}).application;
  const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const files=['vector','text','metadata'].map(name=>({id:'context.'+name,bytes:fixtureFiles?fixtureFiles[name+'.bin']:fs.readFileSync(path.join(legacyRoot,'context-data',name+'.bin'))}));
  console.log(JSON.stringify({checkpoint:'compiled',synthetic,nodeBytes:native.wasm.length,fastlyBytes:fastly.wasm.length}));
  const fullText=files.find(f=>f.id==='context.text').bytes;
  for(const artifact of [native,fastly]){
    // Optimizers split zero-filled ranges into separate data segments. Inspect
    // their materialized initial memory, rather than searching serialized Wasm.
    const module=new WebAssembly.Module(artifact.wasm), imports={};
    for(const entry of WebAssembly.Module.imports(module)){assert.equal(entry.kind,'function');(imports[entry.module]??={})[entry.name]=()=>0;}
    const memory=Buffer.from(new WebAssembly.Instance(module,imports).exports.memory.buffer);
    const at=memory.indexOf(fullText);assert(at>=0,'full text has a physical resource backing');
    assert.equal(memory.indexOf(fullText,at+1),-1,'only one full-text resource copy');
    for(const file of ['start','search','read','example','diagnostic']){const source=fs.readFileSync(path.join(cwd,'src/'+file+'.ts'),'utf8');for(const record of built.corpus.records.filter(r=>r.content.length>200))assert(!source.includes(JSON.stringify(record.content)),'no full cited text in generated computation source');}
  }
  const oracle=path.join(cwd,'oracle');fs.mkdirSync(path.join(oracle,'src'),{recursive:true});
  fs.writeFileSync(path.join(oracle,'package.json'),'{"type":"commonjs"}');
  const ts=require('typescript');
  for(const file of ['context-corpus.ts','corpus-version.ts','src/handlers.ts']){
    const source=file==='context-corpus.ts'?render(built.corpus):fs.readFileSync(path.join(legacyRoot,file),'utf8');
    fs.writeFileSync(path.join(oracle,file.replace(/\.ts$/,'.js')),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
  }
  const legacy=require(path.join(oracle,'src/handlers.js'));
  const base={version:built.corpus.pulseVersion,goal:'schema-api',provider:'node',target:'native'};
  const cases=[];
  for(const goal of ['json-api','schema-api','fetch-api','router-api'])for(const target of ['native','javascript'])cases.push({...base,goal,target});
  for(const change of [{version:''},{version:'wrong'},{version:'x'.repeat(64)},{version:'x'.repeat(65)},{version:'é'.repeat(32)},{version:'é'.repeat(33)},{version:'😀'.repeat(16)},{version:'😀'.repeat(17)},{version:'\0'.repeat(64)},{goal:''},{goal:'x'.repeat(193)},{goal:'é'.repeat(97)},{provider:''},{target:''},{goal:'constructor'},{provider:'fastly'},{target:'automatic'},{goal:'missing',provider:'missing'}])cases.push({...base,...change});
  async function request(method,args,name='pulse.start'){
    const tool=method==='tools/call';
    const params={_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},...(tool?{name,arguments:args}:{})};
    const req={method:'POST',path:'/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...(tool?{'mcp-name':name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})};
    const responses=[(await executeCanonicalNativeModule(native,{request:req,maxDurationMs:5000})).response,executeFastlyNativePlatformCapabilities(fastly,{request:req}).response];
    const jr=await node.executeNodeJavascriptApplication(application,new Request('https://context.test/mcp',{method:'POST',headers:req.headers,body:req.body}),{schemaCodecs,binaryResources:runtime.createBinaryResourceStore(files),strict:true,maxDurationMs:5000});
    responses.push({status:jr.status,body:await jr.text()});
    return responses.map((r,target)=>{assert.equal(r.status,200,JSON.stringify({name,args,target,body:r.body}));assert(Buffer.byteLength(r.body)<=built.config.limits.mcpResponseBytes);receipt.largestMcpBytes=Math.max(receipt.largestMcpBytes,Buffer.byteLength(r.body));const decoded=JSON.parse(r.body);if(tool&&decoded.result){const bytes=Buffer.byteLength(JSON.stringify(decoded.result));assert(bytes<=24576);receipt.largestToolResultBytes=Math.max(receipt.largestToolResultBytes,bytes);}return decoded;});
  }
  for(const input of cases){
    const expected=JSON.parse(JSON.stringify(legacy.start(null,input)));expected.meta.applicationVersion=built.config.applicationVersion;
    for(const reply of await request('tools/call',input)){
      assert(!reply.error,JSON.stringify(reply));assert.equal(reply.result.isError,false);
      const result=reply.result.structuredContent;assert.deepEqual(result,expected);
      assert.deepEqual(JSON.parse(reply.result.content[0].text),result);
      const bytes=Buffer.byteLength(JSON.stringify(result));assert(bytes<=built.config.limits.toolReplyBytes);receipt.largestToolBytes=Math.max(receipt.largestToolBytes,bytes);
      if(result.plan){assert(result.plan.dependencies.length>0&&result.plan.contracts.length>=8);for(const citation of result.plan.contracts){const source=built.corpus.records.find(r=>r.id===citation.id);assert.deepEqual(citation.source,source.source);assert.equal(citation.contentSha256,source.contentSha256);}}
      receipt.executions++;run.executions++;
    }
  }
  for(const reply of await request('tools/list')){
    assert(!reply.error);assert.deepEqual(reply.result.tools.map(t=>t.name),['pulse.diagnostic','pulse.example','pulse.read','pulse.search','pulse.start']);
    assert(reply.result.tools.find(t=>t.name==='pulse.start').outputSchema.properties.plan.properties.dependencies);
    assert(reply.result.tools.find(t=>t.name==='pulse.start').outputSchema.properties.plan.properties.configuration);
    assert(reply.result.tools.find(t=>t.name==='pulse.start').outputSchema.properties.plan.properties.contracts);receipt.executions++;run.executions++;
  }
  for(const reply of await request('tools/call',{...base,goal:42})){assert(reply.error||reply.result?.isError);receipt.executions++;run.executions++;}
  const names={read:'read',example:'example',diagnostic:'explainDiagnostic'};
  // Independent oracle: serialize the actual public result envelope. Do not
  // reuse the generator's byte-cost arithmetic or resource slicing algorithm.
  function wholeBytes(value){return Buffer.byteLength(JSON.stringify({
    resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':{name:'pulse-context',version:built.corpus.pulseVersion}},
    isError:false,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,
  }));}
  function boundedV2(tool,result,input){
    if(result.status!=='ok')return result;
    const bound=24576;
    if(tool==='read'&&wholeBytes(result)>bound){
      const points=Array.from(result.record.content),ends=[0];for(const p of points)ends.push(ends.at(-1)+p.length);
      const candidate=n=>({...result,record:{...result.record,content:result.record.content.slice(0,ends[n]),truncated:true,nextOffset:result.record.offset+ends[n]},truncated:true,nextOffset:result.record.offset+ends[n]});
      let lo=0,hi=points.length;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(wholeBytes(candidate(mid))<=bound)lo=mid;else hi=mid-1;}
      assert(lo>0,'metadata admission permits a nonempty read page');return candidate(lo);
    }
    if(tool==='example'){
      const page=[];
      for(const record of result.records){
        const interim={...result,records:[...page,record],truncated:true,nextOffset:result.totalRecords};
        if(wholeBytes(interim)>bound)break;page.push(record);
      }
      if(page.length===0&&(input.offset??0)<result.totalRecords)return {meta:result.meta,status:'response-too-large',error:{code:'record-requires-read',message:'Retrieve the selected file as bounded pulse.read chunks using its corpus ID.'},availableIds:result.availableIds,records:[],totalRecords:0,truncated:false};
      const next=(input.offset??0)+page.length,truncated=next<result.totalRecords;
      const {nextOffset,...rest}=result;return {...rest,records:page,truncated,...(truncated?{nextOffset:next}:{})};
    }
    if(tool==='diagnostic'&&wholeBytes(result)>bound)return {meta:result.meta,status:'response-too-large',error:{code:'response-too-large',message:'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.'}};
    return result;
  }
  async function parity(tool,input){
    let expected=JSON.parse(JSON.stringify(legacy[names[tool]](null,input)));
    expected.meta.applicationVersion=built.config.applicationVersion;
    expected=boundedV2(tool,expected,input);
    for(const reply of await request('tools/call',input,'pulse.'+tool)){
      assert(!reply.error,JSON.stringify({tool,input,reply}));assert.equal(reply.result.isError,false);
      assert.deepEqual(reply.result.structuredContent,expected,JSON.stringify({tool,input}));
      assert.deepEqual(JSON.parse(reply.result.content[0].text),expected);
      const bytes=Buffer.byteLength(JSON.stringify(expected));assert(bytes<=built.config.limits.toolReplyBytes);
      receipt.largestToolBytes=Math.max(receipt.largestToolBytes,bytes);
      receipt.executions++;run.executions++;
    }
    return expected;
  }
  const version=built.corpus.pulseVersion;
  const readIds=synthetic?changed:built.corpus.records.map(r=>r.id);
  for(const id of readIds){
    const original=built.corpus.records.find(r=>r.id===id);
    let offset=0,reconstructed='',pages=0;
    for(;;){
      assert(pages++<20,'bounded reconstruction');
      const result=await parity('read',{version,id,offset});assert.equal(result.status,'ok');
      assert.equal(result.record.offset,offset);assert.equal(result.record.totalBytes,Buffer.byteLength(original.content));
      reconstructed+=result.record.content;
      if(!result.truncated){assert.equal(result.nextOffset,undefined);assert.equal(result.record.nextOffset,undefined);break;}
      assert(result.nextOffset>offset);offset=result.nextOffset;
    }
    assert.equal(reconstructed,original.content);
    await parity('read',{version,id,offset:original.content.length});
  }
  console.log(JSON.stringify({checkpoint:'read-parity',synthetic,executions:run.executions}));
  const diagnostics=synthetic?changed.filter(id=>id.startsWith('diagnostic/')):built.corpus.records.filter(r=>r.category==='diagnostic').map(r=>r.id);
  for(const id of diagnostics)await parity('diagnostic',{version,code:id.slice(11)});
  for(const id of ['01-hello-json','02-request-schema','03-fetch-composition','09-router-lowering']){
    const available=built.corpus.records.filter(r=>r.id.startsWith('example/'+id+'/')).map(r=>r.id);
    let offset=0,seen=[];
    for(let page=0;page<10;page++){
      const result=await parity('example',{version,id,offset});
      if(result.status!=='ok'){assert(synthetic);break;}
      seen.push(...result.records.map(r=>r.id));
      if(!result.truncated){assert.deepEqual(seen,available);break;}
      assert(result.nextOffset>offset);offset=result.nextOffset;
    }
    await parity('example',{version,id,offset:available.length});
    await parity('example',{version,id,offset:available.length+1});
    for(const files of [[],available.slice(0,6),[available[0],available[0]],['https://bad.test'],['../index.ts'],['x'.repeat(193)],[''],['constructor']])await parity('example',{version,id,files});
    for(const files of [available.slice(0,1),available.slice(1,4).reverse(),available.slice(-5)]){
      await parity('example',{version,id,files});await parity('example',{version,id,files,offset:files.length});
    }
    for(const selection of [{provider:'node',target:'native'},{provider:'node',target:'javascript'},{provider:''},{target:'native'},{provider:'fastly',target:'native'}])await parity('example',{version,id,...selection});
  }
  const valid={read:{id:'contract/transport-limits'},example:{id:'01-hello-json'},diagnostic:{code:diagnostics[0].slice(11)}};
  for(const tool of Object.keys(names)){
    for(const v of ['', 'wrong', 'x'.repeat(64),'x'.repeat(65),'é'.repeat(32),'é'.repeat(33),'😀'.repeat(16),'😀'.repeat(17),'\0'.repeat(64)])await parity(tool,{version:v,...valid[tool]});
    const key=tool==='diagnostic'?'code':'id';
    for(const id of ['', 'unknown','constructor','x'.repeat(192),'x'.repeat(193),'é'.repeat(97)])await parity(tool,{version,[key]:id});
    for(const reply of await request('tools/call',{version,[key]:42},'pulse.'+tool)){assert(reply.error||reply.result?.isError);receipt.executions++;run.executions++;}
  }
  for(const offset of [-1,2147483647])await parity('read',{version,id:'contract/transport-limits',offset});
  if(synthetic){
    assert.equal((await parity('read',{version,id:'contract/transport-limits',offset:2})).error.code,'invalid-offset');
    assert.equal((await parity('example',{version,id:'01-hello-json',files:['example/01-hello-json/src/index.ts']})).error.code,'record-requires-read');
    assert.equal((await parity('diagnostic',{version,code:diagnostics[0].slice(11)})).status,'response-too-large');
    const bounded=await parity('example',{version,id:'02-request-schema',files:['example/02-request-schema/src/index.ts','example/02-request-schema/src/schemas.ts']});
    assert.equal(bounded.records.length,1);assert.equal(bounded.nextOffset,1);
  }
  for(const selection of [{provider:'node',target:'native'},{provider:'node',target:'javascript'},{provider:'fastly',target:'native'},{provider:'fastly',target:'javascript'},{provider:'none',target:'native'},{provider:''},{target:'native'},{provider:'unknown',target:'native'}]){
    for(const id of ['contract/application','example/01-hello-json/src/index.ts'])await parity('read',{version,id,...selection});
  }
  for(const offset of [0.5,2147483648])for(const reply of await request('tools/call',{version,id:'contract/application',offset},'pulse.read')){assert(reply.error||reply.result?.isError);receipt.executions++;run.executions++;}
  async function searchParity(args){
    const input={version,...args},expected=SEARCH.search(built.corpus,built.config,input);
    for(const reply of await request('tools/call',input,'pulse.search')){
      assert(!reply.error,JSON.stringify({input,reply}));assert.equal(reply.result.isError,false);
      assert.deepEqual(reply.result.structuredContent,expected,JSON.stringify(input));
      assert.deepEqual(JSON.parse(reply.result.content[0].text),expected);
      receipt.executions++;run.executions++;
    }
    return expected;
  }
  const queries=synthetic?['searchtie']:['schema','managed async','PARALLEL parallel','@pulse-compute/pulse','schema.compile','pulse_schema_compile_failed','report','target'];
  // Every production corpus ID is searched against the direct field-presence
  // oracle. IDs outside the 8-token query envelope must reject explicitly.
  if(!synthetic)queries.push(...built.corpus.records.map(r=>r.id));
  for(const query of queries)await searchParity({query});
  for(const query of ['schema','searchtie','zzzz_unknown_term']){
    const first=await searchParity({query,limit:2});
    if(first.status==='ok'){
      const order=[...first.results.map(r=>r.id)];let next=first.nextOffset;
      for(let page=0;next!==undefined&&page<256;page++){
        const reply=await searchParity({query,limit:2,offset:next});
        assert.equal(reply.status,'ok');order.push(...reply.results.map(r=>r.id));next=reply.nextOffset;
      }
      assert.equal(order.length,first.totalMatches);assert.equal(new Set(order).size,order.length);
      await searchParity({query,offset:first.totalMatches});
      await searchParity({query,offset:first.totalMatches+1});
    }
  }
  for(const category of [...new Set(built.corpus.records.map(r=>r.category))])await searchParity({query:'pulse',category});
  for(const pair of [{provider:'node',target:'native'},{provider:'node',target:'javascript'},{provider:'fastly',target:'native'},{provider:'fastly',target:'javascript'},{provider:'none',target:'native'},{provider:'node'},{target:'native'},{provider:''},{provider:'unknown',target:'native'}])await searchParity({query:'schema',...pair});
  for(const query of ['', ' ', '---', 'é', '😀', '\0', '\x7f', 'a'.repeat(64), 'a'.repeat(65), 'x '.repeat(8), 'x '.repeat(9), ' '.repeat(250)+'schema', ' '.repeat(251)+'schema', 'schema\tSCHEMA\r\n'])await searchParity({query});
  for(const change of [{limit:0},{limit:6},{offset:-1},{offset:2147483647},{category:''},{category:'private'},...['','latest','é'.repeat(33),'\0'.repeat(64)].map(version=>({version}))])await searchParity({query:'schema',...change});
  for(const change of [{query:42},{limit:1.5},{offset:2147483648}])for(const reply of await request('tools/call',{version,query:'schema',...change},'pulse.search')){assert(reply.error||reply.result?.isError);receipt.executions++;run.executions++;}
  if(synthetic){
    assert.equal((await searchParity({query:'searchtie'})).status,'response-too-large');
    const single=await searchParity({query:'searchtie',limit:1});assert.equal(single.status,'ok');
    assert.equal(single.results[0].excerptTruncated,true);
  }
  console.log(JSON.stringify({checkpoint:'search-parity',synthetic,executions:run.executions}));
  run.corpusHash=built.corpus.corpusHash;run.planHash=plan.planHash;
  run.artifacts={node:{bytes:native.wasm.length,sha256:sha(native.wasm)},fastly:{bytes:fastly.wasm.length,sha256:sha(fastly.wasm)}};
  receipt.runs.push(run);console.log(JSON.stringify({checkpoint:synthetic?'synthetic':'production',...run}));
  fs.rmSync(cwd,{recursive:true,force:true});
}
(async()=>{await main(false);await main(true);receipt.status='passed';receipt.source={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})};console.log(JSON.stringify(receipt));})().catch(error=>{console.error(error.stack||error,error.stdout?.toString(),error.cause?.diagnostics||error.diagnostics);process.exitCode=1;}).finally(()=>{if(cwd)fs.rmSync(cwd,{recursive:true,force:true});});
