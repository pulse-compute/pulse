// Private nonterminal probe. No production admission, queue, retry or cancel ABI.
@external('nonterminal_proof', 'acquire') declare function nl_acquire(out:usize):i32;
@external('nonterminal_proof', 'complete') declare function nl_host_complete(pending:i32,out:usize):i32;
@external('nonterminal_proof', 'read') declare function nl_read(handle:i32):i32;
@external('nonterminal_proof', 'close') declare function nl_close(handle:i32):i32;
@external('nonterminal_proof', 'event') declare function nl_event(code:i32,a:i32,b:i32):void;

let nl_root:i32=0, nl_pendingClaim:i32=0, nl_leaseClaim:i32=0;
let nl_pending:i32=-1, nl_handle:i32=-1, nl_ticket:i32=0, nl_token:i32=0;
let nl_cancelled:bool=false, nl_finished:bool=false, nl_delivering:bool=false;
let nl_outcome:i32=0, nl_deliveryToken:i32=0, nl_business:bool=false;
let nl_accepted:i32=0, nl_rejected:i32=0, nl_cleanupAttempts:i32=0, nl_lateCount:i32=0;
let nl_short:i32=0, nl_rejectSettle:bool=false, nl_rejectResult:bool=false;

function nl_state(t:i32):i32 {
  if(t<=0)return 0;
  const c=(t-1)%NC;
  return cr(c,0)==(t-1)/NC ? cr(c,1) : 0;
}
function nl_unknown(t:i32):void { if(t>0 && nl_state(t)!=0) na_observe(t,4,0); }
function nl_failure(stage:i32):void {
  nl_outcome=2;
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL,stage,0);
  nl_event(12,stage,0);
}
function nl_init():void {
  // Two logical handle claims; no guest-memory or host-byte capacity claim.
  na_init(7-nl_short,320,8,8,1000);
  nl_event(1,0,0);
}
function nl_begin(index:i32):void {
  nl_ticket=unchecked(__pulse_invocation_tickets[index]);
  if(index!=0 || nl_root!=0 || !__request_check(index)) { nl_failure(390); return; }
  nl_root=na_capture();
  na_member(0,nl_root);
  if(nl_root<=0 || na_admit(1)<0) { if(nl_root>0)na_deny(nl_root); nl_root=0; nl_failure(390); return; }
  nl_pendingClaim=na_prepare(nl_root,1,0,1,1);
  nl_leaseClaim=na_prepare(nl_root,1,0,1,1);
  if(nl_pendingClaim<=0 || nl_leaseClaim<=0) { nl_failure(390); return; }
  const out=new StaticArray<i32>(1);
  const status=nl_acquire(changetype<usize>(out));
  if(status!=0) { nl_unknown(nl_pendingClaim); nl_unknown(nl_leaseClaim); nl_failure(391); return; }
  nl_pending=unchecked(out[0]);
  if(nl_pending<0 || na_adopt(nl_pendingClaim,nl_pending)<0) { nl_unknown(nl_pendingClaim); nl_unknown(nl_leaseClaim); nl_failure(391); return; }
  unchecked(__pulse_fastly_pending[index]=nl_pending);
  unchecked(__pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_ASYNC);
  nl_event(2,nl_ticket,nl_pending);
}
function nl_complete(index:i32):i32 {
  // The original driver has already awaited readiness under its request budget.
  if(nl_cancelled) { nl_failure(394); return 0; }
  if(index!=0 || __pulse_invocation_closed || !__request_check(index)) return 0;
  const out=new StaticArray<i32>(1);
  // State 7 is a fixture-local in-flight fence, as in RA-05. A trap retains it.
  cw(claim(nl_pendingClaim),1,7);
  const status=nl_host_complete(nl_pending,changetype<usize>(out));
  unchecked(__pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_NONE);
  unchecked(__pulse_fastly_pending[index]=0);
  if(status!=0) { nl_unknown(nl_pendingClaim); nl_unknown(nl_leaseClaim); nl_failure(392); return 0; }
  // Only the fixture's successful completion proves consumption of this pending.
  cw(claim(nl_pendingClaim),1,3);
  na_refund(nl_pendingClaim,1,0,1);
  nl_handle=unchecked(out[0]);
  if(nl_handle<0 || na_adopt(nl_leaseClaim,nl_handle)<0) { nl_unknown(nl_leaseClaim); nl_failure(392); return 0; }
  if(nl_cancelled) { nl_failure(394); return 0; }
  if(__pulse_invocation_closed || !__request_check(index)) return 0;
  const value=nl_read(nl_handle);
  if(value<0) { nl_failure(393); return 0; }
  nl_token=__pulse_fastly_string_value(value.toString());
  nl_outcome=1;
  nl_event(3,nl_ticket,nl_token);
  return nl_token;
}
function nl_settle(index:i32,ticket:i32,result:i32):bool {
  if(index!=0) return true;
  nl_event(4,unchecked(__pulse_invocation_tickets[0]),ticket);
  if(nl_rejectSettle || __pulse_invocation_closed || nl_accepted!=0
    || ticket!=nl_ticket || ticket<=0 || result<=0) { nl_rejected++; return false; }
  // The existing application-error driver drains a failed effect with undefined.
  // Permit that shape only after this service observed failure, never as success.
  const expected=nl_outcome==1 ? (!nl_cancelled && result==nl_token)
    : nl_outcome==2 && __pulse_fastly_value(result).kind==PULSE_VALUE_UNDEFINED;
  if(!expected) { nl_rejected++; return false; }
  nl_deliveryToken=result;
  return true;
}
function nl_result(index:i32,result:i32):bool {
  if(index!=0) return true;
  nl_event(6,unchecked(__pulse_invocation_tickets[0]),nl_delivering ? 1 : 0);
  if(nl_rejectResult || __pulse_invocation_closed || !nl_delivering
    || nl_accepted!=0 || result!=nl_deliveryToken || result<=0) { nl_rejected++; return false; }
  return true;
}
function nl_finish():void {
  nl_event(10,unchecked(__pulse_invocation_tickets[0]),__pulse_invocation_closed ? 1 : 0);
  if(nl_finished) return;
  nl_finished=true;
  if(nl_root==0) { na_end(); return; }
  if(nl_state(nl_pendingClaim)!=0) nl_unknown(nl_pendingClaim);
  if(nl_state(nl_leaseClaim)==2 && __request_remaining()>0 && na_step(nl_root,2)>=0) {
    nl_cleanupAttempts++;
    cw(claim(nl_leaseClaim),1,7); // Fence before a potentially consuming/trapping call.
    const status=nl_close(nl_handle);
    if(status==0) { cw(claim(nl_leaseClaim),1,3); na_refund(nl_leaseClaim,1,0,1); }
    else nl_unknown(nl_leaseClaim);
  } else if(nl_state(nl_leaseClaim)!=0) nl_unknown(nl_leaseClaim);
  na_finish(nl_root);
  na_end();
}

// Test-only observation/attack surface. These exports are not package APIs.
export function proof_control(short:i32,settle:i32,result:i32):void { nl_short=short; nl_rejectSettle=settle!=0; nl_rejectResult=result!=0; }
export function proof_cancel():void { nl_cancelled=true; na_stop(); }
export function proof_undefined():i32 { return host_value_undefined(); }
export function proof_forged_success():i32 { return __pulse_fastly_string_value('forged'); }
export function proof_settle(ticket:i32,result:i32):i32 { return __pulse_invocation_settle(0,ticket,result); }
export function proof_close_again():void { __pulse_invocation_close(); }
export function proof_late(handle:i32):void {
  // Post-closure observation is not authority to reenter the driver or dispose.
  // The preregistered unknown output claim remains charged, covering one result.
  if(!__pulse_invocation_closed || handle<0 || nl_lateCount!=0) return;
  nl_lateCount++; nl_handle=handle; nl_event(11,handle,0);
}
export function proof_query(k:i32):i32 {
  if(k==0)return na_query(1,0);
  if(k==1)return na_query(1,2);
  if(k==2)return nl_cleanupAttempts;
  if(k==3)return nl_accepted;
  if(k==4)return nl_delivering ? 1 : 0;
  if(k==5)return nl_rejected;
  if(k==6)return nl_ticket;
  if(k==7)return nl_token;
  if(k==8)return nl_state(nl_pendingClaim);
  if(k==9)return nl_state(nl_leaseClaim);
  if(k==10)return nl_lateCount;
  if(k==11)return nl_business ? 1 : 0;
  if(k==12)return nl_outcome;
  return 0;
}
