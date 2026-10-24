// Fixed acyclic recipe, depth one. All children use ordinary host_effect_begin,
// invocation tickets, pending tables, resolver dispatch and the existing driver.
const __BC_WAIT_CHILD:i32=3
class __BcParent { ticket:i32=0; phase:i32=-1; key:string=""; url:string=""; value:string="" }
const __bc_parents=new Array<__BcParent|null>(PULSE_FASTLY_EFFECT_COUNT)
let __bc_progress:i32=0
let __bc_passes:i32=0
let __bc_failed:bool=false
function __bc_active_children():bool {
  for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++)if(__bc_owner(i)>=0 && unchecked(__pulse_invocation_tickets[i])>0)return true
  return false
}
function __bc_parent(index:i32):bool { switch(index){ /* PARENTS */ } return false }
function __bc_owner(index:i32):i32 { switch(index){ /* CHILD PARENT */ } return -1 }
function __bc_phase(index:i32):i32 { switch(index){ /* CHILD PHASE */ } return -1 }
function __bc_child(index:i32,phase:i32):i32 { switch(index){ /* CHILD INDEX */ } return -1 }
function __bc_arm(index:i32):void { switch(index){ /* ARM CHILD */ } __ro_fail(index,360) }
function __bc_live(index:i32):bool {
  const r=__bc_parents[index]
  if(r===null || __pulse_invocation_closed || __request_expired || r.ticket<=0 || unchecked(__pulse_invocation_tickets[index])!=r.ticket) {__ro_fail(index,361);return false;}
  return __request_check(index)
}
function __bc_field(object:i32,key:string,value:string):void {host_value_object_set(object,__pulse_fastly_string_value(key),__pulse_fastly_string_value(value));}
function __bc_dispatch(parent:i32,phase:i32):void {
  if(!__bc_live(parent))return
  const r=__bc_parents[parent]!
  if(phase!=r.phase+1 || phase>2){__ro_fail(parent,362);return;}
  r.phase=phase
  const child=__bc_child(parent,phase),payload=host_value_object()
  if(phase==1){__bc_field(payload,"url",r.url);host_value_object_set(payload,__pulse_fastly_string_value("init"),host_value_object());}
  else {const fields=host_value_object();__bc_field(fields,"key",r.key);__bc_field(fields,"value",r.value);host_value_object_set(payload,__pulse_fastly_string_value("payload"),fields);}
  __bc_arm(child);__bc_progress++
  host_effect_begin(child,payload)
}
function __bc_begin(index:i32):void {
  const r=new __BcParent();r.ticket=unchecked(__pulse_invocation_tickets[index]);__bc_parents[index]=r
  if(!__bc_live(index))return
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[index]))
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,"payload"))
  r.key=__pulse_fastly_string(__pulse_fastly_payload_field(payload,"key"))
  r.url=__pulse_fastly_string(__pulse_fastly_payload_field(payload,"value"))
  unchecked(__pulse_fastly_pending_mode[index]=__BC_WAIT_CHILD)
  __bc_dispatch(index,0)
}
function __bc_complete(index:i32,status:string,value:string):void {
  if(!__bc_live(index))return
  const result=host_value_object();__bc_field(result,"status",status);__bc_field(result,"value",value)
  __pulse_fastly_ready_effect(index,result);__bc_progress++
}
function __bc_child_done(index:i32,result:i32):void {
  const parent=__bc_owner(index);if(parent<0 || !__bc_live(parent))return
  const r=__bc_parents[parent]!,phase=__bc_phase(index)
  if(phase!=r.phase){__ro_fail(index,363);return;}
  __bc_progress++
  if(__bc_failed){__pulse_fastly_ready_effect(parent,host_value_undefined());return;}
  if(phase==0){
    const output=__pulse_fastly_value(result)
    const status=__pulse_fastly_string(__pulse_fastly_payload_field(output,"status"))
    if(status=="hit"){__bc_complete(parent,"hit",__pulse_fastly_string(__pulse_fastly_payload_field(output,"value")));return;}
    if(status!="miss"){__ro_fail(index,364);return;}
    __bc_dispatch(parent,1)
  } else if(phase==1){
    const output=__pulse_fastly_value(result)
    if(output.kind!=PULSE_VALUE_STRING){__ro_fail(index,364);return;}
    r.value=output.text
    __bc_dispatch(parent,2)
  } else {
    const output=__pulse_fastly_value(result)
    if(__pulse_fastly_string(__pulse_fastly_payload_field(output,"status"))!="stored"){__ro_fail(index,364);return;}
    __bc_complete(parent,"stored",r.value)
  }
}
