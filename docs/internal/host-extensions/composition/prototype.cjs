'use strict';
// Investigation-only plan expansion and source bridges. Production files stay unchanged.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ro=require('../ownership/prototype.cjs');
const {root,PACKAGE,CONTRACT,hash}=ro;
const contract=require(path.join(root,'wasm/packages/contracts/src/provider/host-extension'));
const owner=require(path.join(root,'packages/provider-fastly/src/build/host-extensions'));
const SERVICE='investigation-bounded-composition.v0';
const specs={...ro.specs,getOrSetText:{capability:'cache.compose',resources:[],source:'function __bc_entry():i32 { return 0 }',imports:[]}};
function artifacts(){return [...ro.artifacts().map(a=>({...a,data:{...a.data,service:SERVICE}})),{version:contract.VERSION,id:PACKAGE+':getOrSetText',kind:'host-extension',mediaType:'text/assemblyscript',package:PACKAGE,contractId:CONTRACT,data:{target:{provider:'fastly',target:'native',targetId:'fastly-compute-native'},operation:'getOrSetText',service:SERVICE,source:specs.getOrSetText.source,sha256:hash(specs.getOrSetText.source),entry:'__bc_entry',imports:ro.artifacts()[0].data.imports}}];}
const ADMISSION=contract.normalizeAdmission({version:contract.ADMISSION_VERSION,protocols:[contract.VERSION],services:[SERVICE]});
const TARGET={...ro.TARGET,hostExtensions:ADMISSION};
const unique=s=>[...new Map(s.map(x=>[x.artifact.id,x.artifact])).values()];
function expand(original,fetchTemplate){
  const plan=structuredClone(original),roots=[];
  for(let parent=0;parent<original.effects.length;parent++){
    const effect=original.effects[parent];if(effect.operation!=='getOrSetText')continue;
    const payload=effect.inputs.find(i=>i.name==='payload').value;
    const url=payload.entries.find(i=>i.key.value==='value').value.value;
    assert.equal(typeof url,'string','literal loader URL');
    const loader=structuredClone(fetchTemplate);
    loader.resource={kind:'literal',value:url,origin:new URL(url).origin};
    loader.inputs.find(i=>i.name==='url').value.value=url;
    const children=[];
    for(const [phase,template] of [['lookup',{...effect,operation:'getText'}],['loader',loader],['insert',{...effect,operation:'putText'}]]){
      assert(template,'canonical fetch template required');
      const index=plan.effects.length;
      plan.effects.push({...structuredClone(template),id:effect.id+':'+phase,source:effect.source,composition:{parent,phase,synthetic:true,runtimeInputs:phase==='insert'?'parent key + loader text':phase==='loader'?'parent literal URL':'parent key'},grouped:false});children.push(index);
    }
    roots.push({parent,children});
  }
  // This is a separate experimental identity, not a claim that the canonical compiler emitted it.
  plan.composition={version:'hex.bounded-composition.v0',roots,maxDepth:1,maxChildren:3,originalHash:original.planHash};
  if(roots.length){plan.canonical=false;plan.planHash=hash(JSON.stringify({...plan,planHash:undefined}));}
  return plan;
}
function select(plan,options){
  const effects=plan.effects.filter(e=>e.kind==='host.extension');if(!effects.length)return [];
  const admitted=contract.select(effects,options.realizationArtifacts||[],TARGET);
  return effects.map(effect=>{const artifact=admitted.find(a=>contract.matches(effect,a));assert(artifact);assert(specs[effect.operation]);assert.equal(artifact.data.service,SERVICE);return {effect,artifact,index:plan.effects.indexOf(effect),plan};});
}
function source(selected){
  if(!selected.length)return '';
  const plan=selected[0].plan,roots=plan.composition?.roots||[],primitives=selected.filter(s=>s.effect.operation!=='getOrSetText');
  let service=fs.readFileSync(path.join(__dirname,'../ownership/service.as.ts'),'utf8');
  const ops=new Set(primitives.map(s=>s.effect.operation));
  service=service.replace(/\/\/ BEGIN (getText|putText)\n([\s\S]*?)\/\/ END \1/g,(_,op,code)=>ops.has(op)?code:'');
  service=service.replace('/* SLOT */',primitives.map(s=>`index == ${s.index}`).join(' || ')||'false')
    .replace('/* BEGIN DISPATCH */',primitives.map(s=>`case ${s.index}: __ro_begin_${s.effect.operation}(index,key); break;`).join('\n'))
    .replace('/* RESOLVE DISPATCH */',primitives.map(s=>`case ${s.index}: return __ro_finish_${s.effect.operation}(index);`).join('\n'));
  let composition='';
  if(roots.length){
    composition=fs.readFileSync(path.join(__dirname,'service.as.ts'),'utf8')
      .replace('/* PARENTS */',roots.map(r=>`case ${r.parent}: return true;`).join('\n'))
      .replace('/* CHILD PARENT */',roots.flatMap(r=>r.children.map(i=>`case ${i}: return ${r.parent};`)).join('\n'))
      .replace('/* CHILD PHASE */',roots.flatMap(r=>r.children.map((i,n)=>`case ${i}: return ${n};`)).join('\n'))
      .replace('/* CHILD INDEX */',roots.map(r=>`case ${r.parent}: return phase == 0 ? ${r.children[0]} : phase == 1 ? ${r.children[1]} : ${r.children[2]};`).join('\n'))
      .replace('/* ARM CHILD */',roots.flatMap(r=>r.children.map(i=>`case ${i}: __pulse_effect_pending_${i}=1; __pulse_effect_ready_${i}=0; __pulse_effect_result_${i}=0; return;`)).join('\n'));
    service=service.replace('function __pulse_extension_begin(index:i32):void {','function __pulse_extension_begin(index:i32):void { if(__bc_parent(index)){__bc_begin(index);return;}');
  }
  return unique(selected).map(a=>a.data.source).join('\n')+'\n'+service+'\n'+composition;
}
function instrument(input,selected){
  if(!selected.length)return input;
  let source=input;const roots=selected[0].plan.composition?.roots||[];
  const replace=(a,b)=>{assert.equal(source.split(a).length-1,1,'one source anchor: '+a);source=source.replace(a,b);};
  replace('export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {','export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {\n if ((__ro_slot(effectIndex)'+(roots.length?' || __bc_parent(effectIndex) || __bc_owner(effectIndex)>=0':'')+') && __ro_delivery != effectIndex) return 0;');
  replace('return pulse_set_effect_result(index, result)','__ro_delivery = index\n const accepted = pulse_set_effect_result(index, result)\n __ro_delivery = -1\n'+(roots.length?' if(accepted==1 && __bc_owner(index)>=0) __bc_child_done(index,result);\n':'')+' return accepted');
  replace('function __pulse_fastly_wait_ready(effectIndex: i32): i32 {','function __pulse_fastly_wait_ready(effectIndex: i32): i32 { if (__ro_slot(effectIndex)) return __ro_resolve(effectIndex);');
  replace('function __pulse_invocation_close(): void {','function __pulse_invocation_close(): void { __pulse_invocation_closed = true; __ro_cleanup_all();');
  if(roots.length){
    replace('  while (runStatus == 1) {','  while (runStatus == 1) {\n    const passTicket=__pulse_invocation_count; const before=__bc_progress; __bc_passes++;');
    for(let i=0;i<selected[0].plan.effects.length;i++)replace(`    if (__pulse_effect_pending_${i} != 0) {`,`    if (__pulse_effect_pending_${i} != 0 && __pulse_effect_ready_${i} == 0 && unchecked(__pulse_fastly_pending_mode[${i}]) != __BC_WAIT_CHILD && unchecked(__pulse_invocation_tickets[${i}])<=passTicket) {`);
    replace('  if (__pulse_invocation_settle(index, invocation, result) != 1) {','  __bc_failed = failure != 0;\n  if (__pulse_invocation_settle(index, invocation, result) != 1) {');
    replace('  __pulse_fastly_last_error = failure; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effect','  if(__pulse_fastly_last_error!=0 && failure==0){failure=__pulse_fastly_last_error;stage=__pulse_fastly_error_stage;effect=__pulse_fastly_error_effect;fatal=true;}\n  __pulse_fastly_last_error = failure; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effect');
    replace('    if (fatal) { __pulse_fastly_jwt_send_error(); return }','    if (fatal && !__bc_active_children()) { __pulse_fastly_jwt_send_error(); return }');
    replace('    runStatus = pulse_resume()','    if(!__pulse_ready_for_resume()) { if(before==__bc_progress){__pulse_fastly_fail(PULSE_ERROR_STATE,365,-1);break;} continue; }\n    runStatus = pulse_resume()');
  }
  return source;
}
function policy(s,b){return contract.composeImportPolicy(b.map(([module,name])=>({module,name,kind:'function'})),unique(s));}
function withPrototype(callback,testSource=''){
  const saved={...owner};Object.assign(owner,{ADMISSION,TARGET,select,matches:contract.matches,source:s=>source(s)+testSource,instrument,policy,imports:s=>unique(s).flatMap(a=>a.data.imports),auditSignatures:(bytes,s,b)=>s.length?contract.auditWasm(bytes,policy(s,b)):undefined});
  try{return callback();}finally{Object.assign(owner,saved);}
}
module.exports={root,PACKAGE,CONTRACT,SERVICE,TARGET,specs,artifacts,expand,withPrototype,hash};
