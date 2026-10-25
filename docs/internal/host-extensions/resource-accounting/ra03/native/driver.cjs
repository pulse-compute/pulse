'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),b=require('./build.cjs');
const fixtureOwner=require(path.join(b.root,'docs/internal/host-extensions/ownership/prototype.cjs'));
const {create}=require(path.join(b.root,'docs/internal/host-extensions/ownership/fixture.cjs'));
const compiler=require(path.join(b.root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(b.root,'wasm/packages/compiler/src/canonical-native-plan'));
const platform=require(path.join(b.root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const output=path.resolve(process.argv[2]||'/tmp/hex-ra03-native-driver');fs.mkdirSync(output,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const files=['service.as.ts','build.cjs','driver.cjs','../../../ownership/host.cjs','../../../../../../packages/provider-fastly/src/build/native-platform-capabilities.js','../../../../../../packages/provider-fastly/src/build/effect-invocations.js'];
const inputs=()=>files.map(file=>({file,sha256:hash(fs.readFileSync(path.join(__dirname,file)))}));
const receipt={version:'hex.ra03-native-driver.v1',status:'running',node:process.version,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:b.root,encoding:'utf8'}).trim(),inputs:inputs(),cases:[],artifacts:[]};
const save=()=>fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
const hostFile=path.join(b.root,'docs/internal/host-extensions/ownership/host.cjs');let host=fs.readFileSync(hostFile,'utf8');
const anchor='clock_time_get:(_id,_p,out)=>{view().setBigUint64(out,expired?1000000000n:0n,true);return 0;}';assert.equal(host.split(anchor).length-1,1);
host=host.replace(anchor,`clock_time_get:(_id,_p,out)=>{event(_id===0?'wall-clock':'monotonic-clock');if(_id===0&&options.expireAfterWall)expired=true;view().setBigUint64(out,expired?1000000000n:0n,true);return 0;}`);
fs.writeFileSync(path.join(output,'injected-host.cjs'),host);const mod=new Module(hostFile);mod.filename=hostFile;mod.paths=Module._nodeModulePaths(path.dirname(hostFile));mod._compile(host,hostFile);const execute=mod.exports.execute;
function run(bytes,options={}){const r=execute(bytes,options),e=r.instance?.exports;const summary=e?.native_query?{committed:[0,1,2].map(d=>e.native_query(0,d)),carry:[0,1,2].map(d=>e.native_query(2,d)),used:e.native_query(4,0),tickets:e.native_tickets()}:null;delete r.instance;return{...r,summary};}
function check(name,fn){const detail=fn();receipt.cases.push({name,status:'passed',detail});console.log('ok - '+name);save();}
function compiled(n,kind,original){const source=kind==='base'||kind==='disabled'?b.bridge(original,n,{active:false}):kind==='unused-linked'?original+'\n'+b.source(n,1).replaceAll('export function','function'):b.bridge(original,n,{diagnostics:kind!=='plain'});const bytes=b.compile(source,output,kind+'-'+n);receipt.artifacts.push({width:n,kind,file:kind+'-'+n+'.wasm',bytes:bytes.length,sha256:hash(bytes),sourceSha256:hash(source),imports:WebAssembly.Module.imports(new WebAssembly.Module(bytes))});return bytes;}
try{
 for(const n of [8,16,32]){
  const dir=fs.mkdtempSync(path.join(b.root,'wasm/.test-results/hex-ra03-native-')),f=create(dir);
  const authored=`export default async function handler(ctx){const values=await ctx.parallel({${Array.from({length:n},(_,i)=>'k'+i+':ctx.time.now()').join(',')}});return ctx.json(values);}`;
  f.write(authored);const c=compiler.compileCanonicalProject(f.file,{rootDir:dir,workspaceRoot:dir,target:'native',packageTargetDescriptor:fixtureOwner.TARGET});const plan=buildCanonicalNativePlan(c);assert.equal(plan.effects.length,n);assert(plan.effects.every(e=>e.kind==='time.now'&&e.grouped===true));assert.equal(new Set(plan.effects.map(e=>e.continuationId)).size,1);
  const generated=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{cwd:b.root,canonicalBuild:true,requirePlatformCapability:false,bindings:{},maxDurationMs:1000});
  fs.writeFileSync(path.join(output,'authored-'+n+'.ts'),authored);fs.writeFileSync(path.join(output,'plan-'+n+'.json'),JSON.stringify(plan,null,2));
  const base=compiled(n,'base',generated.source),disabled=compiled(n,'disabled',generated.source),unused=compiled(n,'unused-linked',generated.source),plain=compiled(n,'plain',generated.source),test=compiled(n,'test',generated.source);
  if(n===8){const production=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:b.root,canonicalBuild:true,requirePlatformCapability:false,bindings:{},maxDurationMs:1000,reportCapture:false});assert.deepEqual(production.wasm,base,'recompile equals actual provider compiler');}
  check(`Native disabled and unreachable controls ${n}`,()=>{assert.deepEqual(base,disabled);const a=run(base),u=run(unused),p=run(plain);for(const r of [a,u,p]){assert.equal(r.thrown,null);assert.equal(r.error,0);assert.equal(r.status,200);assert.equal(r.trace.filter(t=>t.call==='wall-clock').length,n);}assert.deepEqual(p.json,a.json);assert.deepEqual(u.json,a.json);return{baseBytes:base.length,disabledDelta:disabled.length-base.length,unusedLinkedDelta:unused.length-base.length,accountingDelta:plain.length-base.length,testExportDelta:test.length-plain.length};});
  check(`Native full-group gate and qualified release ${n}`,()=>{const r=run(test);assert.equal(r.error,0);assert.deepEqual(r.summary,{committed:[2,64,2],carry:[0,0,0],used:n,tickets:n});return r;});
  check(`Native shortage dispatches zero members ${n}`,()=>{const r=run(test,{onUri:i=>i.exports.native_control(1,0)});assert.equal(r.thrown,null);assert.notEqual(r.error,0);assert.equal(r.trace.filter(t=>t.call==='wall-clock').length,0);assert.deepEqual(r.summary,{committed:[2,64,2],carry:[0,0,0],used:n,tickets:n});return r;});
  check(`Native unknown disposal stays charged after return ${n}`,()=>{const r=run(test,{onUri:i=>i.exports.native_control(0,1)});assert.equal(r.error,0);assert.deepEqual(r.summary.committed,[3*n+2,128*n+64,3*n+2]);assert.deepEqual(r.summary.carry,[n,64*n,n]);return r;});
  check(`Native deadline keeps first claim and suppresses siblings ${n}`,()=>{const r=run(test,{expireAfterWall:true});assert.equal(r.thrown,null);assert.equal(r.status,504);assert.equal(r.trace.filter(t=>t.call==='wall-clock').length,1);assert.deepEqual(r.summary.carry,[1,64,1]);assert.deepEqual(r.summary.committed,[5,192,5]);return r;});
 }
 receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.stack;process.exitCode=1;}
if(JSON.stringify(inputs())!==JSON.stringify(receipt.inputs)){receipt.status='failed';receipt.error='Inputs changed';process.exitCode=1;}save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,error:receipt.error,output}));
