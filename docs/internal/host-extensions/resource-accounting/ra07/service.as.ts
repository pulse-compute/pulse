// One shared ledger, one root per original operation; fixed depth-one child plan.
const JQ_N:i32=/* ROOT_COUNT */,JQ_S:i32=/* SLOT_COUNT */;
const jq_roots=new StaticArray<i32>(JQ_N),jq_children=new StaticArray<i32>(JQ_S);
const jq_tickets=new StaticArray<i32>(JQ_S),jq_tokens=new StaticArray<i32>(JQ_S),jq_outcome=new StaticArray<i32>(JQ_S);
const jq_accepted=new StaticArray<i32>(JQ_S),jq_business=new StaticArray<i32>(JQ_S),jq_deliveryToken=new StaticArray<i32>(JQ_S);
let jq_shortH:i32=0,jq_shortB:i32=0,jq_effectLimit:i32=1024,jq_delivery:i32=-1;
let jq_admitted:bool=false,jq_stopped:bool=false,jq_finished:bool=false;
let jq_rejected:i32=0;
function jq_fail(i:i32,stage:i32):void{jq_stopped=true;na_stop();__pulse_fastly_fail(PULSE_ERROR_STATE,stage,i);}
function jq_init():void{
 na_init(JQ_N*5+2-jq_shortH,JQ_N*262849+64-jq_shortB,JQ_N*8+2,jq_effectLimit,1000);
 for(let i=0;i<JQ_N;i++){const t=na_capture();jq_roots[i]=t;if(t<=0){jq_fail(i,420);return;}na_member(i,t);}
 if(na_admit(JQ_N)<0){for(let i=0;i<JQ_N;i++){na_deny(jq_roots[i]);jq_roots[i]=0;}jq_fail(-1,420);return;}
 jq_admitted=true;
 /* ASSIGN ROOTS */
}
function jq_dispatch(i:i32):bool{
 jq_tickets[i]=unchecked(__pulse_invocation_tickets[i]);
 if(!jq_admitted || jq_stopped || __pulse_fastly_last_error!=0){jq_fail(i,421);return false;}
 const parent=__bc_owner(i);
 if(parent>=0){
  const p=__bc_parents[parent];if(p===null || p.phase!=__bc_phase(i) || p.ticket!=unchecked(__pulse_invocation_tickets[parent]) || jq_children[i]!=0){jq_fail(i,422);return false;}
  const t=na_child(jq_roots[parent]);if(t<=0){jq_fail(i,423);return false;}jq_children[i]=t;
 }
 return true;
}
function __pulse_fastly_resolve_effect(i:i32):i32{
 if(jq_stopped){jq_outcome[i]=2;return host_value_undefined();}
 const result=jq_resolve_raw(i);
 if(result<=0 || __pulse_fastly_last_error!=0){jq_outcome[i]=2;jq_stopped=true;na_stop();}
 else{jq_outcome[i]=1;jq_tokens[i]=result;}
 cc_event(20,i,result);return result;
}
function jq_settle(i:i32,ticket:i32,result:i32):bool{
 if(i<0 || i>=JQ_S || __pulse_invocation_closed || ticket<=0 || ticket!=jq_tickets[i] || jq_accepted[i]!=0 || result<=0){jq_rejected++;return false;}
 const parent=__bc_owner(i);
 if(parent>=0){const p=__bc_parents[parent];if(p===null || p.phase!=__bc_phase(i) || p.ticket!=unchecked(__pulse_invocation_tickets[parent]) || jq_children[i]<=0){jq_rejected++;return false;}}
 const valid=jq_outcome[i]==1?result==jq_tokens[i]:jq_outcome[i]==2&&__pulse_fastly_value(result).kind==PULSE_VALUE_UNDEFINED;
 if(!valid){jq_rejected++;return false;}jq_deliveryToken[i]=result;return true;
}
function jq_result(i:i32,result:i32):bool{
 if(i<0 || i>=JQ_S || __pulse_invocation_closed || jq_delivery!=i || result<=0 || result!=jq_deliveryToken[i]){jq_rejected++;return false;}return true;
}
function jq_delivered(i:i32,accepted:i32,result:i32):void{
 jq_delivery=-1;jq_accepted[i]=accepted;jq_business[i]=accepted==1&&jq_outcome[i]==1?1:0;
 if(accepted!=1)return;
 const parent=__bc_owner(i);
 if(parent>=0){if(na_settle_child(jq_roots[parent],jq_children[i])<0){jq_fail(i,424);return;}jq_children[i]=0;__bc_child_done(i,result);}
}
function jq_finish():void{
 if(jq_finished)return;jq_finished=true;cc_event(30,-1,0);
 cc_finish();rf_finish();
 for(let i=0;i<JQ_S;i++)if(jq_children[i]>0){const parent=__bc_owner(i);na_settle_child(jq_roots[parent],jq_children[i]);jq_children[i]=0;}
 // RETAIN BACKING
 for(let i=0;i<JQ_N;i++)if(jq_roots[i]>0)na_finish(jq_roots[i]);
 na_end();cc_event(31,-1,0);
}
export function proof_control(h:i32,b:i32,effects:i32):void{jq_shortH=h;jq_shortB=b;jq_effectLimit=effects;}
export function proof_cancel():void{jq_stopped=true;cc_cancelled=true;na_stop();}
export function proof_ticket(i:i32):i32{return unchecked(__pulse_invocation_tickets[i]);}
export function proof_settle(i:i32,t:i32,r:i32):i32{return __pulse_invocation_settle(i,t,r);}
export function proof_forged():i32{return __pulse_fastly_string_value('forged');}
export function proof_close():void{__pulse_invocation_close();}
export function proof_respond():void{__pulse_fastly_jwt_send_error();__request_send_timeout();}
export function proof_closed():i32{return __pulse_invocation_closed?1:0;}
export function proof_authority():i32{return __pulse_response_authority;}
export function proof_phase(i:i32,phase:i32):void{__bc_dispatch(i,phase);}
export function proof_query(k:i32,i:i32):i32{
 if(k==0)return na_query(1,0);if(k==1)return na_query(1,1);if(k==2)return na_query(1,2);
 if(k==3)return __pulse_invocation_count;if(k==4)return na_query(4,0);if(k==5)return na_query(5,0);
 if(k==6)return jq_rejected;if(k==7)return jq_delivery;if(k==8)return __bc_passes;if(k==9)return na_query(10,0);
 if(k==10)return na_query(0,0);if(k==11)return jq_accepted[i];if(k==12)return jq_business[i];if(k==13)return jq_outcome[i];
 if(k==14)return rf_closed;if(k==15)return cc_disposals;if(k==16)return cc_cleanupErrors;
 if(k==17)return na_query(8,0);return 0;
}
