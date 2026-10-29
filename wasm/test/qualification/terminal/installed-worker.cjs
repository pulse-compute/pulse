'use strict';
// Copied into the outside-checkout consumer. Product code resolves exclusively
// through that installation; injected host evidence is retained separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {hash,terminalCases}=require('./bundle.cjs');
const root=fs.realpathSync(process.cwd()),out=path.resolve(process.argv[2]);
const installed=createRequire(path.join(root,'package.json'));
function load(name){const file=fs.realpathSync(installed.resolve(name));assert(file.startsWith(root+path.sep),'Workspace product import');return installed(name);}
const cliRoot=fs.realpathSync(path.join(root,'node_modules/@pulse-compute/cli'));
const cli=path.join(cliRoot,'bin/pulse.js');assert(cli.startsWith(root+path.sep));
const reportRoot=path.join(cliRoot,'src/internal/report');
const parseCapsule=require(path.join(reportRoot,'capsule')).parseCapsule;
const compare=require(path.join(reportRoot,'comparison')).compareCapsules;
const execute=require('./terminal-host.cjs');
const {compileCanonicalProject,packageRealizationArtifactsForCompiled}=load('@pulse-compute/wasm-compiler/canonical-project-compiler');
const {buildCanonicalNativePlan}=load('@pulse-compute/wasm-compiler/canonical-native-plan');
const platformFile=path.join(path.dirname(installed.resolve('@pulse-compute/provider-fastly/build/canonical-target')),'native-platform-capabilities.js');
assert(fs.realpathSync(platformFile).startsWith(root+path.sep));const platform=require(platformFile);
const fixtureName='@independent/rc-terminal',fixtureVersion='91.7.3';
const sources={};
for(const operation of ['handoffFanout','handoffWebSocket']){
 const id=operation==='handoffFanout'?'fanout':'websocket';const prefix=`import {${operation} as transfer} from '@pulse-compute/grip/experimental';`;
 sources[id]=prefix+`export default async function handler(ctx){if(ctx.req.path==='/ordinary')return ctx.text('ordinary response');return transfer(ctx,'edge');}`;
 sources[id+'-router']=`import {Router} from '@pulse-compute/runtime';${prefix}const app=new Router();app.get('/ordinary',async ctx=>ctx.text('ordinary response'));app.get('/handoff',async ctx=>{return transfer(ctx,'edge');});export default app;`;
}
sources.independent=`import {transfer} from '${fixtureName}';export default async function handler(ctx){if(ctx.req.path==='/ordinary')return ctx.text('ordinary response');return transfer(ctx,'edge');}`;
sources.absent="export default async function handler(ctx){return ctx.text('ordinary response');}";
sources.unused="import {handoffFanout} from '@pulse-compute/grip/experimental';"+sources.absent;
sources.generic="import {handoff} from '@pulse-compute/grip';export default async function handler(ctx){return handoff({channel:'ordinary'});}";
const env={...process.env,NODE_PATH:'',npm_config_ignore_scripts:'true'};delete env.NODE_OPTIONS;
const artifacts=[],injected=[],negative=[];
const options={requireAsync:true,strict:true,applicationProjectMetadata:{selectedProfile:{name:'local',source:'fixture'},strict:true,target:'native',host:'fastly',projectHash:'3'.repeat(64),configPlanHash:'4'.repeat(64),bindings:{config:[],secret:[]},fragments:{}}};
function config(host='fastly',target='native') {
 const profile={host,target,outDir:'out'};
 if(host==='fastly')profile.fastly={bindings:{backends:{edge:'terminal_origin'}},build:{name:'terminal-qualification'}};
 return "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((scope)=> ("+JSON.stringify({pulse:{entry:'app.ts',defaultProfile:'local',strict:true},local:profile})+"));";
}
function compile(source,dir){fs.writeFileSync(path.join(dir,'app.ts'),source);const compiled=compileCanonicalProject(path.join(dir,'app.ts'),{...options,rootDir:dir,workspaceRoot:dir});return {compiled,plan:buildCanonicalNativePlan(compiled),realizationArtifacts:packageRealizationArtifactsForCompiled(compiled)};}
function run(args,dir){return spawnSync(process.execPath,[cli,...args],{cwd:dir,env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});}
for(const [id,source] of Object.entries(sources)){
 const dir=root;fs.rmSync(path.join(dir,'out'),{recursive:true,force:true});fs.mkdirSync(path.join(dir,'.pulse'),{recursive:true});
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({private:true,dependencies:{...JSON.parse(fs.readFileSync(path.join(root,'package.json'))).dependencies,[fixtureName]:fixtureVersion}}));
 fs.writeFileSync(path.join(dir,'app.ts'),source);fs.writeFileSync(path.join(dir,'.pulse/config.ts'),config());
 const result=run(['build','--json'],dir);assert.equal(result.status,0,result.stderr);
 const wasm=fs.readFileSync(path.join(dir,'out/bin/main.wasm')),reportBytes=fs.readFileSync(path.join(dir,'out/pulse-report-inventory.json'));
 const report=parseCapsule(reportBytes.toString()),imports=WebAssembly.Module.imports(new WebAssembly.Module(wasm));
 const abi=id.startsWith('websocket')?'redirect_to_websocket_proxy_v2':'redirect_to_grip_proxy_v2';
 if(terminalCases.includes(id)){
  assert.equal(report.hostContributions.length,1);assert.equal(report.hostUseSites.length,1);assert.equal(report.hostContributions[0].declaredImports[0].name,abi);
  assert.equal(report.hostAudits[0].runtimeObservationCoverage.status,'unavailable');
  if(id==='independent'){assert.equal(report.hostContributions[0].package,fixtureName);assert.equal(report.hostContributions[0].packageVersion,fixtureVersion);}
  const r=execute(wasm,{abi:'fastly_http_req',abiName:abi,path:'/handoff'});assert.ifError(r.trap);assert.equal(r.calls,1);assert.equal(r.sends.length,0);
  for(const failure of [{status:7},{trap:true},{closeStatus:7}]) {
   const failed=execute(wasm,{abi:'fastly_http_req',abiName:abi,path:'/handoff',...failure});
   assert.equal(failed.calls,1);assert.equal(failed.sends.length,0);
   if(failure.trap)assert(failed.trap instanceof WebAssembly.RuntimeError);
   else assert.equal(failed.stage,failure.closeStatus?285:281);
   assert.equal(failed.closes.length,failure.closeStatus?2:0);
   failed.instance.exports._start();assert.equal(failed.calls,1);
   injected.push({id,scenario:failure.trap?'dispatch-trap':failure.closeStatus?'cleanup-failure':'nonzero-status',status:'passed',artifactSha256:hash(wasm)});
  }
  injected.push({id,scenario:'success',status:'passed',scope:'injected ABI success; not transport',artifactSha256:hash(wasm)});
 }else {assert.equal(report.hostContributions.length,0);assert(!imports.some(i=>/redirect_to_(grip|websocket)_proxy/.test(i.name)));}
 const file=id+'.wasm',reportFile=id+'.report.json';fs.writeFileSync(path.join(out,file),wasm);fs.writeFileSync(path.join(out,reportFile),reportBytes);
 artifacts.push({id,file,sha256:hash(wasm),bytes:wasm.length,abi:terminalCases.includes(id)?abi:null,report:{file:reportFile,sha256:hash(reportBytes)}});
 assert.equal(compare(report,report).sections.length,0);
 const replay=run(['report','--artifact',path.join(out,reportFile),'--json'],dir);assert.equal(replay.status,0,replay.stderr);assert.equal(parseCapsule(replay.stdout).evidenceHash.value,report.evidenceHash.value);
}
const dir=root;fs.mkdirSync(path.join(dir,'.pulse'),{recursive:true});fs.writeFileSync(path.join(dir,'.pulse/config.ts'),config());
const prefix="import {handoffFanout as transfer} from '@pulse-compute/grip/experimental';";
const bad=[['surrounding-effect',"await ctx.fetch('https://example.invalid');return transfer(ctx,'edge');"],['escaped-token',"const t=transfer(ctx,'edge');return t;"],['parallel',"const t=await ctx.parallel({a:transfer(ctx,'edge'),b:transfer(ctx,'edge')});return ctx.text('bad');"],['helper',"return helper(ctx);"],['dynamic-backend',"return transfer(ctx,ctx.req.path);"]];
for(const [id,body] of bad){assert.throws(()=>{const c=compile(prefix+`export default async function handler(ctx){${body}}`+(id==='helper'?"async function helper(ctx){return transfer(ctx,'edge');}":''),dir);platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(c.plan,{cwd:root,bindings:{backends:{edge:'terminal_origin'}},realizationArtifacts:c.realizationArtifacts});},e=>Boolean(e.code||e.diagnostics?.length));negative.push({id,status:'passed'});}
const routed=sources['fanout-router'].replace("app.get('/handoff'","app.use(async(ctx,next)=>next());app.get('/handoff'");
assert.throws(()=>{const c=compile(routed,dir);platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(c.plan,{cwd:root,bindings:{backends:{edge:'terminal_origin'}},realizationArtifacts:c.realizationArtifacts});});negative.push({id:'middleware',status:'passed'});
for(const [host,target] of [['node','native'],['node','javascript'],['fastly','javascript']])for(const id of ['fanout','websocket','independent']){
 const c=compile(sources[id],dir);const contract=load('@pulse-compute/wasm-contracts/provider/toolchain').hostExtensions;
 assert.throws(()=>contract.select(c.plan.effects,c.realizationArtifacts,{provider:host,target,targetId:host+'-'+target}),{code:'PULSE_HOST_EXTENSION_TARGET'});
 negative.push({id:id+'-'+host+'-'+target,status:'passed'});
}
// Omitted declarations cannot change the artifact for an identical plan.
const absent=compile(sources.absent,dir),unused=compile(sources.fanout,dir).realizationArtifacts;
const emit=extras=>platform.compileFastlyNativePlatformCapabilitiesPlan(absent.plan,{cwd:root,requirePlatformCapability:false,realizationArtifacts:extras});
assert.deepEqual(emit([]).wasm,emit(unused).wasm);
// Runtime facade/type identity remains distinct from old generic GRIP methods.
fs.writeFileSync(path.join(out,'injected.json'),JSON.stringify({version:'pulse.terminal-injected.v1',status:'passed',cases:injected,transportQualified:false},null,2)+'\n');
fs.writeFileSync(path.join(out,'worker.json'),JSON.stringify({status:'passed',artifacts,negative,unusedDeclarationsByteIdentical:true},null,2)+'\n');
console.log(JSON.stringify({status:'passed',artifacts:artifacts.length,negative:negative.length}));
