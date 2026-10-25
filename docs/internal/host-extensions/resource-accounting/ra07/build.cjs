'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const b=require('../ra03/native/build.cjs'),p=require('../../composition/prototype.cjs'),{create}=require('../../composition/fixture.cjs');
const {root}=b, compiler=require(path.join(root,'wasm/packages/compiler/src/canonical-project-compiler'));
const {buildCanonicalNativePlan}=require(path.join(root,'wasm/packages/compiler/src/canonical-native-plan'));
const platform=require(path.join(root,'packages/provider-fastly/src/build/native-platform-capabilities'));
const owner=require(path.join(root,'packages/provider-fastly/src/build/host-extensions'));
const contract=require(path.join(root,'wasm/packages/contracts/src/provider/host-extension'));
function replace(s,a,v){assert.equal(s.split(a).length-1,1,'checked anchor: '+a);return s.replace(a,v);}
function fn(s,name,replacement){const start=s.indexOf('function '+name+'(');assert(start>=0,name);let at=s.indexOf('{',start),depth=1,end=at+1;while(depth){if(s[end]==='{')depth++;if(s[end]==='}')depth--;end++;assert(end<=s.length,name);}return s.slice(0,start)+replacement+s.slice(end);}
function ledger(n){
  let s=fs.readFileSync(path.join(__dirname,'../ra03/native/service.as.ts'),'utf8').replaceAll('export function','function')
    .replace('/* ROOTS */',n*2).replace('/* EFFECTS */',4).replace('/* ROOT_BYTES */',n*2*60)
    .replace('/* CLAIM_BYTES */',(n*2*8+2)*32).replace('/* CHILD_BYTES */',n*2*24);
  s=s.replaceAll('NR*6','NR*8').replaceAll('r*6','r*8').replaceAll('c/6','c/8').replaceAll('r*8+6','r*8+8').replaceAll('lane==1?4:6','lane==1?6:8');
  s=replace(s,'d==0?3:d==1?192:4','d==0?3:d==1?262785:6');
  s=replace(s,'committed(1)+n*256','committed(1)+n*262849');s=replace(s,'committed(2)+n*6','committed(2)+n*8');
  return replace(s,'if(cr(c,1)!=3)return bad(23);','if(cr(c,1)!=3&&cr(c,1)!=5&&cr(c,1)!=6)return bad(23);if(cr(c,1)!=3&&b!=0)return bad(23);');
}
function services(plan,mutation){
  const roots=plan.composition.roots,n=plan.effects.length,count=roots.length+(plan.effects.some(e=>e.kind==='fetch'&&!e.composition)?1:0);
  const cacheSlots=plan.effects.map((e,i)=>[e,i]).filter(([e])=>['getText','putText'].includes(e.operation));
  const fetchSlots=plan.effects.map((e,i)=>[e,i]).filter(([e])=>e.kind==='fetch');
  let cc=fs.readFileSync(path.join(__dirname,'../ra06/service.as.ts'),'utf8').replaceAll('/* WIDTH */',n);
  cc=replace(cc,'const CC_WRITE:bool=/* WRITE */;','');
  cc=cc.replace(/\/\/ BEGIN (getText|putText)\n([\s\S]*?)\/\/ END \1/g,(_,op,code)=>code.replaceAll('cc_begin_impl','cc_begin_'+op).replaceAll('cc_finish_impl','cc_finish_'+op));
  cc=fn(cc,'cc_init','');cc=fn(cc,'cc_admit','function cc_admit():bool{return jq_admitted && !jq_stopped;}');
  cc=replace(cc,'CC_WRITE?192:257','cc_write_slot(index)?192:257');
  cc=replace(cc,'3000000+index','9000000+index');
  cc=replace(cc,'family*1000000+h','(family==1?6:family)*1000000+h');
  cc=replace(cc,'cc_begin_impl(index,key,payload);','if(cc_write_slot(index))cc_begin_putText(index,key,payload);else cc_begin_getText(index,key,payload);');
  cc=replace(cc,'return cc_finish_impl(index);','return cc_write_slot(index)?cc_finish_putText(index):cc_finish_getText(index);');
  cc=replace(cc,'cc_dispose_call(cc_bodies[i],commit)','cc_dispose_call(cc_bodies[i],commit,cc_write_slot(i))');
  cc=replace(cc,'function cc_dispose_call(h:i32,commit:bool):i32','function cc_dispose_call(h:i32,commit:bool,writer:bool):i32');
  cc=replace(cc,'if(!commit) { return cc_abandon(h); }','if(writer && !commit) { return cc_abandon(h); }');
  cc=replace(cc,'function __pulse_extension_begin(index:i32):void {','function __pulse_extension_begin(index:i32):void { if(__bc_parent(index)){__bc_begin(index);return;}');
  cc=replace(cc,'if(cc_roots[i]>0)na_finish(cc_roots[i]);','');cc=replace(cc,'na_end();cc_event(11,-1,0);','cc_event(11,-1,0);');
  cc=cc.slice(0,cc.indexOf('// Diagnostic attack surface'));
  cc+=`\nfunction cc_slot(i:i32):bool{return ${cacheSlots.map(([,i])=>'i=='+i).join(' || ')};}\nfunction cc_write_slot(i:i32):bool{return ${cacheSlots.filter(([e])=>e.operation==='putText').map(([,i])=>'i=='+i).join(' || ')};}\n`;
  let rf=fs.readFileSync(path.join(__dirname,'../ra05/adapter.as.ts'),'utf8').replace('/* TABLE_BYTES */',n*52).replace('/* COUNT */',n);
  rf=fn(rf,'rf_group','');rf=replace(rf,'  na_finish(rt);','');rf=replace(rf,' na_end();','');
  rf=replace(rf,'function rf_prepare(i:i32,role:i32):i32{','function rf_prepare(i:i32,role:i32):i32{if(jq_stopped){jq_fail(i,421);return 0;}');
  rf=replace(rf,'function rf_read(h:i32):bool{','function rf_read(h:i32):bool{if(jq_stopped){jq_fail(-1,421);return false;}');
  rf=rf.slice(0,rf.indexOf('export function ra05_control'));
  let bc=fs.readFileSync(path.join(__dirname,'../../composition/service.as.ts'),'utf8')
    .replaceAll('__ro_fail','jq_fail').replace('/* PARENTS */',roots.map(r=>`case ${r.parent}: return true;`).join('\n'))
    .replace('/* CHILD PARENT */',roots.flatMap(r=>r.children.map(i=>`case ${i}: return ${r.parent};`)).join('\n'))
    .replace('/* CHILD PHASE */',roots.flatMap(r=>r.children.map((i,j)=>`case ${i}: return ${j};`)).join('\n'))
    .replace('/* CHILD INDEX */',roots.map(r=>`case ${r.parent}: return phase==0?${r.children[0]}:phase==1?${r.children[1]}:${r.children[2]};`).join('\n'))
    .replace('/* ARM CHILD */',roots.flatMap(r=>r.children.map(i=>`case ${i}: __pulse_effect_pending_${i}=1;__pulse_effect_ready_${i}=0;__pulse_effect_result_${i}=0;return;`)).join('\n'));
  bc=replace(bc,'if(__bc_failed){','if(jq_stopped || __bc_failed){');
  bc=replace(bc,'  if(!__bc_live(parent))return','  if(jq_stopped || !__bc_live(parent))return');
  const assignments=[...cacheSlots.map(([,i])=>`cc_roots[${i}]=jq_roots[${plan.effects[i].composition.parent}];`),
    ...fetchSlots.map(([e,i])=>`fw(${i},0,jq_roots[${e.composition?.parent??i}]);`)].join('\n');
  let joint=fs.readFileSync(path.join(__dirname,'service.as.ts'),'utf8').replaceAll('/* ROOT_COUNT */',count).replaceAll('/* SLOT_COUNT */',n).replace('/* ASSIGN ROOTS */',assignments);
  if(mutation==='separate-budget')joint=replace(joint,'JQ_N*5+2-jq_shortH','JQ_N*5+2');
  if(mutation==='no-fetch-cleanup')joint=replace(joint,'rf_finish();','');
  if(mutation==='no-cache-cleanup')joint=replace(joint,'cc_finish();','');
  if(mutation==='new-deadline')bc=replace(bc,'  r.phase=phase','  __request_deadline+=i64(37000000);\n  r.phase=phase');
  if(mutation==='skip-child-retirement')joint=replace(joint,'na_settle_child(jq_roots[parent],jq_children[i])<0','false');
  if(mutation==='refund-backing')joint=replace(joint,'// RETAIN BACKING',`for(let c=0;c<NC;c++)if(cr(c,1)!=0&&cr(c,5)>0){cw(c,1,3);na_refund(cr(c,0)*NC+c+1,0,cr(c,5),cr(c,6));}`);
  return ledger(count)+'\n'+cc+'\n'+rf+'\n'+bc+'\n'+joint;
}
function hooks(mutation,reverse=false){let hs=[
 {point:'request.acquired',owner:'proof.composed',order:20,body:'  jq_init();'},
 {point:'effect.settle',owner:'proof.composed',order:20,body:'  return jq_settle(index,ticket,result);'},
 {point:'effect.result',owner:'proof.composed',order:20,body:'  return jq_result(effectIndex,handle);'},
 {point:'effect.deliver',owner:'proof.composed',order:20,before:'  jq_delivery=index;',after:'  jq_delivered(index,accepted,result);'},
 {point:'invocation.closed',owner:'proof.composed',order:20,body:'  jq_finish();'}];
 if(mutation==='no-result-guard')hs=hs.filter(h=>h.point!=='effect.result');
 return reverse?hs.reverse():hs;
}
function instrument(input,plan){
  let s=input,glue='';const once=(a,v)=>{s=replace(s,a,v);};
  function wrap(name,raw,params,args,body){once('declare function '+name+'(','declare function '+raw+'(');glue+=`\nfunction ${name}(${params}):i32{return ${body||raw+'('+args+')'};}\n`;}
  wrap('fastly_http_req_new','raw_req_new','out:usize','out');wrap('fastly_http_body_new','raw_body_new','out:usize','out');
  wrap('fastly_http_req_send_async','raw_send','r:i32,b:i32,p:usize,n:i32,out:usize','r,b,p,n,out','rf_send(r,b,p,n,out)');
  wrap('fastly_http_req_pending_req_wait_v2','raw_wait','h:i32,d:usize,r:usize,b:usize','h,d,r,b','rf_wait(h,d,r,b)');
  wrap('__pulse_fetch_poll','raw_poll','h:i32,d:usize,done:usize,r:usize,b:usize','h,d,done,r,b','rf_poll(h,d,done,r,b)');
  wrap('__pulse_fetch_close_request','raw_close_req','h:i32','h','rf_close_req(h)');wrap('__pulse_fetch_close_body','raw_close_body','h:i32','h','rf_close_body(h)');wrap('__pulse_fetch_close_response','raw_close_resp','h:i32','h','rf_close_resp(h)');
  wrap('__pulse_response_send_raw','raw_downstream','r:i32,b:i32,stream:i32','r,b,stream','rf_downstream(r,b,stream)');
  once('let status = fastly_http_req_new(changetype<usize>(requestOut))','let status = rf_new_req(effectIndex,changetype<usize>(requestOut))');
  once('status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71','status = rf_new_body(effectIndex,changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71');
  once('    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();','    if(!rf_read(handle))return "";\n    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();');
  once('    total += count;','    total += count;if(!rf_body_limit(handle,total))return "";');
  once('  if (!__pulse_invocation_begin(effectIndex)) return;','  if (!__pulse_invocation_begin(effectIndex)) return;\n  if(!jq_dispatch(effectIndex))return;');
  once('function __pulse_fastly_wait_ready(effectIndex: i32): i32 {','function __pulse_fastly_wait_ready(effectIndex: i32): i32 { if(cc_slot(effectIndex))return cc_resolve(effectIndex);');
  once('function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {','function jq_resolve_raw(effectIndex: i32): i32 {');
  once('  while (runStatus == 1) {','  while (runStatus == 1) {\n    const passTicket=__pulse_invocation_count,before=__bc_progress;__bc_passes++;');
  for(let i=0;i<plan.effects.length;i++)once(`    if (__pulse_effect_pending_${i} != 0) {`,`    if (__pulse_effect_pending_${i} != 0 && __pulse_effect_ready_${i}==0 && unchecked(__pulse_fastly_pending_mode[${i}])!=__BC_WAIT_CHILD && unchecked(__pulse_invocation_tickets[${i}])<=passTicket) {`);
  once('  let failure = __pulse_fastly_last_error','  let failure = __pulse_fastly_last_error\n  if(failure!=0){jq_stopped=true;na_stop();}');
  once('  if (__pulse_invocation_settle(index, invocation, result) != 1) {','  if(failure!=0){jq_stopped=true;na_stop();jq_outcome[index]=2;}\n  if (__pulse_invocation_settle(index, invocation, result) != 1) {');
  once('  __pulse_fastly_last_error = failure; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effect','  if(__pulse_fastly_last_error!=0 && failure==0){failure=__pulse_fastly_last_error;stage=__pulse_fastly_error_stage;effect=__pulse_fastly_error_effect;fatal=true;}\n  __pulse_fastly_last_error = failure; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effect');
  once('    if (fatal) { __pulse_fastly_jwt_send_error(); return }','    if (fatal && !__bc_active_children()) { __pulse_fastly_jwt_send_error(); return }');
  once('    runStatus = pulse_resume()','    if(!__pulse_ready_for_resume()){if(before==__bc_progress){jq_fail(-1,425);break;}continue;}\n    runStatus = pulse_resume()');
  return s+'\n'+glue;
}
function authored(n,core=false,unused=false){const call=i=>`cache.getOrSetText(ctx,'k${i}','https://origin.example/value')`;return `import {cache} from '${p.PACKAGE}';\nexport default async function handler(ctx){\n`+(unused?`return ctx.text('ok');`:n===1&&!core?`const value=await ${call(0)};return ctx.json(value);`:`const value=await ctx.parallel({${Array.from({length:n},(_,i)=>'k'+i+':'+call(i)).concat(core?["core:ctx.fetch('https://origin.example/value').text()"]:[]).join(',')}});return ctx.json(value);`)+'\n}\n';}
function build(out,name,n=1,{core=false,unused=false,absent=false,mutation,production=false}={}){
 fs.mkdirSync(out,{recursive:true});const dir=path.join(root,'wasm/.test-results/hex-ra07-'+p.hash(path.resolve(out)+':'+(unused?'controls':name)).slice(0,12));assert(!fs.existsSync(dir));fs.mkdirSync(dir,{recursive:true});
 try{
  const fixture=create(dir);const canonical=source=>{fixture.write(source);return buildCanonicalNativePlan(compiler.compileCanonicalProject(fixture.file,{rootDir:dir,workspaceRoot:dir,target:'native',packageTargetDescriptor:p.TARGET}));};
  const fetch=canonical("export default async function handler(ctx){const value=await ctx.fetch('https://origin.example/value').text();return ctx.text(value);}").effects[0];
  const source=authored(n,core,unused).replace(absent?`import {cache} from '${p.PACKAGE}';\n`:'\0','');
  const canonicalPlan=canonical(source),plan=p.expand(canonicalPlan,fetch);assert(n+(core?1:0)<=32);
  if(!unused){assert.equal(plan.composition.roots.length,n);assert.equal(canonicalPlan.effects.length,n+(core?1:0));assert.equal(plan.effects.length,n*4+(core?1:0));}
  const options={cwd:root,canonicalBuild:true,requirePlatformCapability:false,maxDurationMs:1000,bindings:{backends:{'https://origin.example':'origin'}},realizationArtifacts:p.artifacts()};
  let generated,policy=null;const saved=Object.getOwnPropertyDescriptors(owner);
  try {
   if(production)generated=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(canonicalPlan,options);
   else generated=p.withPrototype(()=>{
    owner.source=selected=>selected.length?[...new Map(selected.map(x=>[x.artifact.id,x.artifact])).values()].map(a=>a.data.source).join('\n')+'\n'+services(plan,mutation):'';
    owner.hooks=selected=>selected.length?hooks(mutation):[];
    const gen=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options);
    if(!unused){owner.hooks=()=>hooks(mutation,true);assert.equal(gen.source,platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,options).source);
     const selected=[...new Map(owner.select(plan,options).map(x=>[x.artifact.id,x.artifact])).values()];
     policy=contract.composeImportPolicy([...platform.FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS.map(([module,name])=>({module,name,kind:'function'})),{module:'ra06_proof',name:'event',kind:'function'}],selected);
     return {...gen,source:instrument(gen.source,plan)};
    }return gen;
   });
  }finally{for(const key of Reflect.ownKeys(owner))if(!Object.hasOwn(saved,key))delete owner[key];Object.defineProperties(owner,saved);}
  const wasm=b.compile(generated.source,out,name);if(policy)contract.auditWasm(wasm,policy);
  for(const [suffix,value] of [['ts',source],['canonical-plan.json',canonicalPlan],['plan.json',plan],['policy.json',policy],['contributions.json',p.artifacts()]])fs.writeFileSync(path.join(out,name+'.'+suffix),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  return {wasm,source:generated.source,plan,canonicalPlan,policy,imports:WebAssembly.Module.imports(new WebAssembly.Module(wasm))};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={...b,build,ledger};
