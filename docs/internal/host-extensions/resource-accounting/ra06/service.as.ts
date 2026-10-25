// Private fixed cache profile. No production service registration or scheduler.
@external('ra06_proof','event') declare function cc_event(code:i32,index:i32,value:i32):void;
@external('fastly_http_body','close') declare function cc_body_close(h:i32):i32;
const CC_N:i32=/* WIDTH */;
const CC_WRITE:bool=/* WRITE */;
const cc_roots=new StaticArray<i32>(CC_N), cc_cache=new StaticArray<i32>(CC_N), cc_bodies=new StaticArray<i32>(CC_N);
const cc_cacheClaim=new StaticArray<i32>(CC_N), cc_bodyClaim=new StaticArray<i32>(CC_N), cc_bytesClaim=new StaticArray<i32>(CC_N);
const cc_tickets=new StaticArray<i32>(CC_N), cc_ready=new StaticArray<i32>(CC_N), cc_outcome=new StaticArray<i32>(CC_N);
const cc_tokens=new StaticArray<i32>(CC_N), cc_deliveryTokens=new StaticArray<i32>(CC_N), cc_accepted=new StaticArray<i32>(CC_N), cc_business=new StaticArray<i32>(CC_N);
let cc_grouped:bool=false, cc_denied:bool=false, cc_cancelled:bool=false, cc_finished:bool=false;
let cc_short:i32=0, cc_delivery:i32=-1, cc_disposals:i32=0, cc_cleanupErrors:i32=0, cc_commits:i32=0, cc_rejected:i32=0;
function cc_state(t:i32):i32 { if(t<=0)return 0;const c=(t-1)%NC;return cr(c,0)==(t-1)/NC?cr(c,1):0; }
function cc_unknown(t:i32):void { if(t>0 && cc_state(t)!=0) { na_observe(t,4,0); } }
function cc_fail(i:i32,stage:i32):void { cc_outcome[i]=2;__pulse_fastly_fail(PULSE_ERROR_HOSTCALL,stage,i);cc_event(12,i,stage); }
function cc_init():void { na_init(CC_N*5+2-cc_short,CC_N*384+64,CC_N*6+2,1024,1000);cc_event(1,-1,CC_N); }
function cc_budget():bool {
  const remaining=__request_remaining();
  na_now(max<i32>(0,1000-remaining));
  return __request_remaining()>0;
}
function cc_live(i:i32):bool {
  if(__pulse_fastly_last_error!=0)return false;
  if(cc_cancelled) { cc_fail(i,406);return false; }
  if(__pulse_invocation_closed || cc_tickets[i]<=0 || cc_tickets[i]!=unchecked(__pulse_invocation_tickets[i])) { cc_fail(i,407);return false; }
  return __request_check(i) && cc_budget();
}
function cc_admit():bool {
  if(cc_grouped)return !cc_denied;
  cc_grouped=true;
  for(let i=0;i<CC_N;i++) { const t=na_capture();cc_roots[i]=t;if(t<=0){cc_denied=true;return false;}na_member(i,t); }
  if(na_admit(CC_N)<0) { cc_denied=true;for(let i=0;i<CC_N;i++){na_deny(cc_roots[i]);cc_roots[i]=0;}return false; }
  cc_event(2,-1,CC_N);return true;
}
function cc_prepare(i:i32):i32 {
  if(!cc_live(i))return 0;
  const t=na_prepare(cc_roots[i],1,0,1,1);if(t<=0)cc_fail(i,400);return t;
}
function cc_adopt(i:i32,t:i32,h:i32,family:i32):bool {
  if(h<0 || h>=1000000 || na_adopt(t,family*1000000+h)<0) {
    cc_unknown(t);na_unexpected(h);cc_fail(i,408);return false;
  }
  return true;
}
function cc_release(t:i32):void { cw(claim(t),1,3);na_refund(t,1,0,1); }
function __pulse_extension_begin(index:i32):void {
  cc_tickets[index]=unchecked(__pulse_invocation_tickets[index]);
  if(!cc_live(index))return;
  if(!cc_admit()) {cc_fail(index,400);return;}
  // Conservative payload backing allowance, registered before UTF-8 allocation.
  const bytes=na_prepare(cc_roots[index],0,CC_WRITE?192:257,1,1);
  if(bytes<=0 || na_adopt(bytes,3000000+index)<0) {cc_fail(index,400);return;}
  cc_bytesClaim[index]=bytes;
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[index]));
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,'payload'));
  const key=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,'key')));
  if(key.byteLength<1 || key.byteLength>64) {cc_fail(index,401);return;}
  cc_begin_impl(index,key,payload);
}
function cc_resolve(index:i32):i32 { if(!cc_live(index))return 0;return cc_finish_impl(index); }
function cc_value(i:i32,status:string,value:string=''):i32 {
  if(!cc_live(i))return 0;
  unchecked(__pulse_fastly_pending_mode[i]=PULSE_FASTLY_PENDING_NONE);unchecked(__pulse_fastly_pending[i]=0);
  const token=host_value_object();
  host_value_object_set(token,__pulse_fastly_string_value('status'),__pulse_fastly_string_value(status));
  if(status=='hit')host_value_object_set(token,__pulse_fastly_string_value('value'),__pulse_fastly_string_value(value));
  cc_outcome[i]=1;cc_tokens[i]=token;cc_event(3,i,token);return token;
}
function cc_settle(i:i32,ticket:i32,result:i32):bool {
  if(i<0 || i>=CC_N || __pulse_invocation_closed || ticket<=0 || ticket!=cc_tickets[i] || cc_accepted[i]!=0 || result<=0) {cc_rejected++;return false;}
  const expected=cc_outcome[i]==1 ? !cc_cancelled && result==cc_tokens[i]
    : cc_outcome[i]==2 && __pulse_fastly_value(result).kind==PULSE_VALUE_UNDEFINED;
  if(!expected){cc_rejected++;return false;}
  cc_deliveryTokens[i]=result;return true;
}
function cc_result_guard(i:i32,result:i32):bool {
  if(i<0 || i>=CC_N || __pulse_invocation_closed || cc_delivery!=i || cc_accepted[i]!=0 || result<=0 || result!=cc_deliveryTokens[i]) {cc_rejected++;return false;}
  return true;
}
function cc_dispose_body(i:i32,commit:bool=false):bool {
  const t=cc_bodyClaim[i];if(cc_state(t)==0)return true;
  if(cc_state(t)!=2)return false;
  if(!cc_budget() || na_step(cc_roots[i],commit?1:2)<0) {cc_unknown(t);return false;}
  cw(claim(t),1,7);cc_disposals++;
  if(commit)cc_commits++;
  const status=cc_dispose_call(cc_bodies[i],commit);
  if(status==0){cc_release(t);return true;}
  cc_unknown(t);cc_cleanupErrors++;return false;
}
function cc_dispose_call(h:i32,commit:bool):i32 {
  // BEGIN putText
  if(!commit) { return cc_abandon(h); }
  // END putText
  return cc_body_close(h);
}
function cc_dispose_cache(i:i32):bool {
  // BEGIN getText
  const t=cc_cacheClaim[i];if(cc_state(t)==0)return true;
  if(cc_state(t)!=2)return false;
  if(!cc_budget()) {cc_unknown(t);return false;}
  if(cc_ready[i]==0) {
    const out=new StaticArray<i32>(1);
    const status=cc_is_ready(cc_cache[i],changetype<usize>(out));
    if(status!=0 || unchecked(out[0])!=1) {cc_unknown(t);return false;}
    cc_ready[i]=1;
  }
  if(!cc_budget() || na_step(cc_roots[i],2)<0) {cc_unknown(t);return false;}
  cw(claim(t),1,7);cc_disposals++;
  if(cc_cache_close(cc_cache[i])==0){cc_release(t);return true;}
  cc_unknown(t);cc_cleanupErrors++;return false;
  // END getText
  return true;
}
function cc_finish():void {
  if(cc_finished)return;cc_finished=true;cc_event(10,-1,0);
  for(let i=0;i<CC_N;i++) {
    // Known siblings are independent; one failed disposal does not skip another.
    cc_dispose_body(i);cc_dispose_cache(i);
    cc_unknown(cc_bodyClaim[i]);cc_unknown(cc_cacheClaim[i]);
    // Losing guest references is not proof of backing allocation reclamation.
    cc_unknown(cc_bytesClaim[i]);
    if(cc_roots[i]>0)na_finish(cc_roots[i]);
  }
  na_end();cc_event(11,-1,0);
}
// BEGIN getText
@external('fastly_cache','get_state') declare function cc_cache_state(h:i32,out:usize):i32;
@external('fastly_cache','get_body') declare function cc_get_body(h:i32,mask:i32,options:usize,out:usize):i32;
@external('fastly_cache','close') declare function cc_cache_close(h:i32):i32;
@external('fastly_async_io','is_ready') declare function cc_is_ready(h:i32,out:usize):i32;
@external('fastly_http_body','read') declare function cc_read(h:i32,p:usize,n:i32,out:usize):i32;
function cc_begin_impl(i:i32,key:ArrayBuffer,payload:__PulseFastlyValue):void {
  const t=cc_prepare(i);if(t<=0)return;cc_cacheClaim[i]=t;
  const out=new StaticArray<i32>(1);unchecked(out[0]=-1);
  if(__ro_get(changetype<usize>(key),key.byteLength,changetype<usize>(out))!=0) {cc_unknown(t);cc_fail(i,402);return;}
  cc_cache[i]=unchecked(out[0]);if(!cc_adopt(i,t,cc_cache[i],1))return;
  unchecked(__pulse_fastly_pending[i]=cc_cache[i]);unchecked(__pulse_fastly_pending_mode[i]=PULSE_FASTLY_PENDING_ASYNC);
}
function cc_finish_impl(i:i32):i32 {
  cc_ready[i]=1; // The original driver completed its readiness wait.
  const state=new StaticArray<i32>(1);
  if(cc_cache_state(cc_cache[i],changetype<usize>(state))!=0) {cc_fail(i,403);return 0;}
  if(!cc_live(i))return 0;
  if((unchecked(state[0])&3)!=3 || (unchecked(state[0])&4)!=0) {
    if(!cc_dispose_cache(i)){cc_fail(i,410);return 0;}
    return cc_value(i,'miss');
  }
  const t=cc_prepare(i);if(t<=0)return 0;cc_bodyClaim[i]=t;
  const opts=new StaticArray<u64>(2),out=new StaticArray<i32>(1);unchecked(out[0]=-1);
  if(cc_get_body(cc_cache[i],0,changetype<usize>(opts),changetype<usize>(out))!=0) {cc_unknown(t);cc_fail(i,404);return 0;}
  cc_bodies[i]=unchecked(out[0]);if(!cc_adopt(i,t,cc_bodies[i],2))return 0;
  const bytes=new Uint8Array(65),written=new StaticArray<i32>(1);let total:i32=0,steps:i32=0;
  while(true) {
    if(++steps>10){cc_fail(i,411);return 0;}
    if(!cc_live(i) || !__request_wait(cc_bodies[i],i) || !cc_live(i))return 0;
    unchecked(written[0]=-1);
    if(cc_read(cc_bodies[i],bytes.dataStart+total,65-total,changetype<usize>(written))!=0) {cc_fail(i,405);return 0;}
    const count=unchecked(written[0]);
    if(count<0 || count>65-total || total+count>64){cc_fail(i,412);return 0;}
    total+=count;if(count==0)break;
  }
  for(let j=0;j<total;j++)if(bytes[j]<32 || bytes[j]>126){cc_fail(i,413);return 0;}
  if(!cc_live(i))return 0;
  if(!cc_dispose_body(i)){cc_fail(i,409);return 0;}
  if(!cc_dispose_cache(i)){cc_fail(i,410);return 0;}
  return cc_value(i,'hit',String.UTF8.decodeUnsafe(bytes.dataStart,total));
}
// END getText
// BEGIN putText
@external('fastly_http_body','write') declare function cc_write(h:i32,p:usize,n:i32,end:i32,out:usize):i32;
@external('fastly_http_body','abandon') declare function cc_abandon(h:i32):i32;
function cc_begin_impl(i:i32,key:ArrayBuffer,payload:__PulseFastlyValue):void {
  const bytes=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,'value')));
  if(bytes.byteLength>64){cc_fail(i,414);return;}
  const t=cc_prepare(i);if(t<=0)return;cc_bodyClaim[i]=t;
  const out=new StaticArray<i32>(1);unchecked(out[0]=-1);
  if(__ro_put(changetype<usize>(key),key.byteLength,changetype<usize>(out))!=0){cc_unknown(t);cc_fail(i,415);return;}
  cc_bodies[i]=unchecked(out[0]);if(!cc_adopt(i,t,cc_bodies[i],2))return;
  unchecked(__pulse_fastly_pending[i]=cc_bodies[i]);unchecked(__pulse_fastly_pending_mode[i]=PULSE_FASTLY_PENDING_ASYNC);
}
function cc_finish_impl(i:i32):i32 {
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[i]));
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,'payload'));
  const bytes=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,'value')));
  const written=new StaticArray<i32>(1);let offset:i32=0,steps:i32=0;
  while(offset<bytes.byteLength) {
    if(++steps>4){cc_fail(i,416);return 0;}
    if(!cc_live(i) || !__request_wait(cc_bodies[i],i) || !cc_live(i))return 0;
    unchecked(written[0]=-1);
    if(cc_write(cc_bodies[i],changetype<usize>(bytes)+offset,bytes.byteLength-offset,0,changetype<usize>(written))!=0){cc_fail(i,417);return 0;}
    const count=unchecked(written[0]);if(count<=0 || count>bytes.byteLength-offset){cc_fail(i,418);return 0;}
    offset+=count;
  }
  if(!cc_live(i))return 0;
  if(!cc_dispose_body(i,true)){cc_fail(i,419);return 0;}
  return cc_value(i,'stored');
}
// END putText

// Diagnostic attack surface, excluded from any production API claim.
export function proof_control(short:i32):void{cc_short=short;}
export function proof_cancel():void{cc_cancelled=true;na_stop();}
export function proof_ticket(i:i32):i32{return unchecked(__pulse_invocation_tickets[i]);}
export function proof_settle(i:i32,ticket:i32,result:i32):i32{return __pulse_invocation_settle(i,ticket,result);}
export function proof_close():void{__pulse_invocation_close();}
export function proof_authority():i32{return __pulse_response_authority;}
export function proof_closed():i32{return __pulse_invocation_closed?1:0;}
export function proof_undefined():i32{return host_value_undefined();}
export function proof_forged():i32{return __pulse_fastly_string_value('forged');}
export function proof_respond():void{__pulse_fastly_jwt_send_error();__request_send_timeout();}
export function proof_query(k:i32,i:i32):i32 {
  if(k==0)return na_query(1,0);if(k==1)return na_query(1,1);if(k==2)return na_query(1,2);
  if(k==3)return cc_disposals;if(k==4)return cc_cleanupErrors;if(k==5)return cc_commits;
  if(k==6)return cc_rejected;if(k==7)return cc_delivery;if(k==8)return na_query(4,0);
  if(k==9)return na_query(10,0);if(k==10)return na_query(0,0);
  if(i<0 || i>=CC_N)return -1;
  if(k==11)return cc_accepted[i];if(k==12)return cc_business[i];if(k==13)return cc_outcome[i];
  if(k==14)return cc_state(cc_cacheClaim[i]);if(k==15)return cc_state(cc_bodyClaim[i]);
  return 0;
}
