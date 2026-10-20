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
const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-context-start-'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = {status:'running',executions:0,largestToolBytes:0,largestMcpBytes:0};
async function main() {
  const built = B.construct(root), legacyRoot=path.join(root,'examples/12-pulse-context-mcp');
  assert.equal(B.run().changedFiles,0);
  fs.cpSync(path.join(legacyRoot,'application'),cwd,{recursive:true});
  const modules=path.join(cwd,'node_modules/@pulse-compute');fs.mkdirSync(modules,{recursive:true});
  for(const name of ['pulse','runtime','entities','mcp','provider-node','provider-fastly'])fs.symlinkSync(path.join(root,'packages',name),path.join(modules,name),'dir');
  fs.symlinkSync(path.join(root,'wasm/packages/contracts'),path.join(modules,'wasm-contracts'),'dir');
  execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(cwd,'tsconfig.json')],{stdio:'pipe'});
  const projects=['node-native','fastly-native','node-javascript'].map(profile=>resolveProject({cwd,profile}));
  for(const p of projects){assert(p.binaryResources);assert.equal(p.strict,true);}
  const project=projects[0], options={rootDir:cwd,workspaceRoot:root,strict:true,schemas:project.schemas,binaryResources:project.binaryResources};
  const compiled=compileCanonicalProject(project.entryFile,{...options,target:'native'}), plan=buildCanonicalNativePlan(compiled);
  assert.equal(plan.callables.length,1);assert.equal(compiled.callableSource.sites.length,1);
  const native=compileCanonicalNativePlan(plan,{cwd:root,emitWat:false,reportCapture:false});
  const fastly=compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000});
  const js=buildJavascriptApplicationPlan(project.entryFile,{...options,provider:'node'});
  assert(!js.graph.modules.some(m=>m.path?.includes('context-corpus')),'legacy full-text module is unreachable');
  const application=loadJavascriptApplication(js,{workspaceRoot:cwd,validateApplication:node.assertNodeJavascriptApplication,
    bindCallables:runtime.bindCallableApplication,allowedPackages:{'@pulse-compute/mcp/pulse':require('../../../packages/mcp/src/pulse.js')}}).application;
  const schemaCodecs=createCanonicalSchemaCodecs(compiled.schema.bundle.registry);
  const files=['vector','text','metadata'].map(name=>({id:'context.'+name,bytes:fs.readFileSync(path.join(legacyRoot,'context-data',name+'.bin'))}));
  const fullText=files.find(f=>f.id==='context.text').bytes;
  for(const artifact of [native,fastly]){
    // Optimizers split zero-filled ranges into separate data segments. Inspect
    // their materialized initial memory, rather than searching serialized Wasm.
    const module=new WebAssembly.Module(artifact.wasm), imports={};
    for(const entry of WebAssembly.Module.imports(module)){assert.equal(entry.kind,'function');(imports[entry.module]??={})[entry.name]=()=>0;}
    const memory=Buffer.from(new WebAssembly.Instance(module,imports).exports.memory.buffer);
    const at=memory.indexOf(fullText);assert(at>=0,'full text has a physical resource backing');
    assert.equal(memory.indexOf(fullText,at+1),-1,'only one full-text resource copy');
    for(const record of built.corpus.records.filter(r=>r.content.length>200))assert(!fs.readFileSync(path.join(cwd,'src/start.ts'),'utf8').includes(JSON.stringify(record.content)),'no full cited text in generated computation source');
  }
  const oracle=path.join(cwd,'oracle');fs.mkdirSync(path.join(oracle,'src'),{recursive:true});
  fs.writeFileSync(path.join(oracle,'package.json'),'{"type":"commonjs"}');
  const ts=require('typescript');
  for(const file of ['context-corpus.ts','corpus-version.ts','src/handlers.ts']){
    const source=fs.readFileSync(path.join(legacyRoot,file),'utf8');
    fs.writeFileSync(path.join(oracle,file.replace(/\.ts$/,'.js')),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
  }
  const legacy=require(path.join(oracle,'src/handlers.js'));
  const base={version:built.corpus.pulseVersion,goal:'schema-api',provider:'node',target:'native'};
  const cases=[];
  for(const goal of ['json-api','schema-api','fetch-api','router-api'])for(const target of ['native','javascript'])cases.push({...base,goal,target});
  for(const change of [{version:''},{version:'wrong'},{version:'x'.repeat(64)},{version:'x'.repeat(65)},{version:'é'.repeat(32)},{version:'é'.repeat(33)},{version:'😀'.repeat(16)},{version:'😀'.repeat(17)},{version:'\0'.repeat(64)},{goal:''},{goal:'x'.repeat(193)},{goal:'é'.repeat(97)},{provider:''},{target:''},{goal:'constructor'},{provider:'fastly'},{target:'automatic'},{goal:'missing',provider:'missing'}])cases.push({...base,...change});
  async function request(method,args){
    const tool=method==='tools/call';
    const params={_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}},...(tool?{name:'pulse.start',arguments:args}:{})};
    const req={method:'POST',path:'/mcp',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,...(tool?{'mcp-name':'pulse.start'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})};
    const responses=[(await executeCanonicalNativeModule(native,{request:req,maxDurationMs:5000})).response,executeFastlyNativePlatformCapabilities(fastly,{request:req}).response];
    const jr=await node.executeNodeJavascriptApplication(application,new Request('https://context.test/mcp',{method:'POST',headers:req.headers,body:req.body}),{schemaCodecs,binaryResources:runtime.createBinaryResourceStore(files),strict:true,maxDurationMs:5000});
    responses.push({status:jr.status,body:await jr.text()});
    return responses.map(r=>{assert.equal(r.status,200,r.body);assert(Buffer.byteLength(r.body)<=built.config.limits.mcpResponseBytes);receipt.largestMcpBytes=Math.max(receipt.largestMcpBytes,Buffer.byteLength(r.body));return JSON.parse(r.body);});
  }
  for(const input of cases){
    const expected=JSON.parse(JSON.stringify(legacy.start(null,input)));expected.meta.applicationVersion=built.config.applicationVersion;
    for(const reply of await request('tools/call',input)){
      assert(!reply.error,JSON.stringify(reply));assert.equal(reply.result.isError,false);
      const result=reply.result.structuredContent;assert.deepEqual(result,expected);
      assert.deepEqual(JSON.parse(reply.result.content[0].text),result);
      const bytes=Buffer.byteLength(JSON.stringify(result));assert(bytes<=built.config.limits.toolReplyBytes);receipt.largestToolBytes=Math.max(receipt.largestToolBytes,bytes);
      if(result.plan){assert(result.plan.dependencies.length>0&&result.plan.contracts.length>=8);for(const citation of result.plan.contracts){const source=built.corpus.records.find(r=>r.id===citation.id);assert.deepEqual(citation.source,source.source);assert.equal(citation.contentSha256,source.contentSha256);}}
      receipt.executions++;
    }
  }
  for(const reply of await request('tools/list')){
    assert(!reply.error);assert.deepEqual(reply.result.tools.map(t=>t.name),['pulse.start']);
    assert(reply.result.tools[0].outputSchema.properties.plan.properties.dependencies);
    assert(reply.result.tools[0].outputSchema.properties.plan.properties.configuration);
    assert(reply.result.tools[0].outputSchema.properties.plan.properties.contracts);receipt.executions++;
  }
  for(const reply of await request('tools/call',{...base,goal:42})){assert(reply.error||reply.result?.isError);receipt.executions++;}
  receipt.status='passed';receipt.cases=cases.length;receipt.profiles=projects.map(p=>({provider:p.provider,target:p.target}));
  receipt.corpusHash=built.corpus.corpusHash;receipt.planHash=plan.planHash;
  receipt.artifacts={node:{bytes:native.wasm.length,sha256:sha(native.wasm)},fastly:{bytes:fastly.wasm.length,sha256:sha(fastly.wasm)}};
  receipt.source={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})};
  console.log(JSON.stringify(receipt));
}
main().catch(error=>{console.error(error.stack||error,error.stdout?.toString(),error.cause?.diagnostics||error.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
