// One ledger is bound to this Wasm instance's single managed invocation. Raw
// memory/ABI access is trusted; no scalar resource identity crosses the host ABI.
// The entry guard prevents reuse; this closed, one-cohort profile never recycles
// slots. Descriptor positions/generation 1 are validated at the commit boundary.
let __fwd_ra: PulseResourceLedger | null = null;
let __fra_origin: i64 = 0;
let __fra_clock_failed: bool = false;
let __fra_reaped: bool = false;
function __fra_ns(slot: i32): u32 {
  return slot == 0 || slot == 2 ? 1 : slot == 4 ? 4 : slot == 5 || slot == 7 || slot == 9 ? 2 : 3;
}
function __fra_now(): u64 {
  if (__fra_clock_failed) return PRL_SAFE + 1;
  const now = __request_clock();
  if (now < __fra_origin || __request_expired) { __fra_clock_failed = true; return PRL_SAFE + 1; }
  return u64(now - __fra_origin);
}
function __fra_ok(ok: bool): bool {
  if (!ok) __fwd_fail(__request_expired ? 504 : 502);
  return ok;
}
function __fra_start(): bool {
  if (__fwd_ra !== null || __request_deadline < 0 || __request_last_clock < 0) return false;
  __fra_origin = __request_deadline - i64(__FRA_DURATION);
  const ledger = new PulseResourceLedger(1, 15, 11, __FRA_BACKING, 12, 1, __FRA_DURATION, __FRA_STORAGE);
  __fwd_ra = ledger;
  if (!ledger.begin(1, __fra_now(), 10, 2, 1, true)) return __fra_ok(false);
  for (let i = 0; i < 11; i++)
    if (!ledger.stageRecord(1, 1, __fra_ns(i), 1, i >= 9 ? 3 : 1, 0)) return __fra_ok(false);
  if (!ledger.stageRecord(1, 2, 0, 1, 1, 33920)
    || !ledger.stageRecord(1, 2, 0, 1, 1, __FRA_ENCODING)
    || !ledger.stageRecord(1, 2, 0, 1, 3, 64)
    || !ledger.stageRecord(1, 3, 0, 1, 1, 0)
    || !ledger.commit(1, __fra_now())) return __fra_ok(false);
  for (let i = 0; i < 15; i++)
    if (ledger.reservedSlot(i) != i || ledger.reservedGeneration(i) != 1) return __fra_ok(false);
  // Static scratch is present in the artifact, charged once before first use.
  // Encoding allowance is consumed before any request/header UTF-8 allocation.
  return __fra_ok(ledger.consume(1,11,1,1,33920,false,__fra_now())
    && ledger.consume(1,12,1,1,__FRA_ENCODING,false,__fra_now()));
}
function __fra_acquire(slot: i32): bool {
  return __fwd_ra !== null && __fra_ok(__fwd_ra!.beginAcquire(1,slot,1,__fra_ns(slot),1,slot >= 9,__fra_now()));
}
function __fra_acquired(slot: i32, status: i32, handle: i32): i32 {
  const ledger = __fwd_ra!;
  if (status == 0) __fra_ok(ledger.acquired(1,slot,1,__fra_ns(slot),1,u32(handle)));
  else { ledger.noAcquisition(1,slot,1,__fra_ns(slot),1,false); __fwd_fail(502); }
  return status;
}
function __fra_incoming(request: usize, body: usize): i32 {
  if (!__fra_start() || !__fra_acquire(0) || !__fra_acquire(1)) return 1;
  const status = fastly_http_req_body_downstream_get(request,body);
  __fra_acquired(0,status,load<i32>(request)); __fra_acquired(1,status,load<i32>(body));
  return status;
}
function __fra_new(slot: i32, out: usize): i32 {
  if (!__fra_acquire(slot)) return 1;
  const ns = __fra_ns(slot);
  const status = ns == 1 ? fastly_http_req_new(out) : ns == 2 ? fastly_http_resp_new(out) : fastly_http_body_new(out);
  return __fra_acquired(slot,status,load<i32>(out));
}
function __fra_dispose(slot: i32, abandon: bool = false): i32 {
  if (__fwd_ra === null) return 1;
  const ledger = __fwd_ra!, at = slot * 8;
  if (ledger.bank[at+5] != PRL_LIVE) return 1;
  // Disposal does not replace a primary error and never replenishes time.
  if (!ledger.beginDispose(1,slot,1,__fra_ns(slot),1,__fra_now())) return 1;
  const handle = i32(ledger.bank[at+6]), ns = __fra_ns(slot);
  const status = ns == 1 ? __pulse_fetch_close_request(handle) : ns == 2 ? __pulse_fetch_close_response(handle)
    : abandon ? __fwd_abandon(handle) : __pulse_fetch_close_body(handle);
  ledger.disposed(1,slot,1,ns,1,status == 0);
  return status;
}
function __fra_dispatch(request: i32, body: i32, backend: usize, length: i32, out: usize): i32 {
  if (__pulse_invocation_count != 1 || __pulse_invocation_tickets[__fwd_index] != 1
    || !__fra_acquire(4) || !__fra_acquire(5) || !__fra_acquire(6)) { __fwd_fail(502); return 1; }
  const ledger = __fwd_ra!;
  // Fence the possibly consumed request before send; upload stays guest-owned.
  if (!ledger.beginDispose(1,2,1,1,1,__fra_now())) return 1;
  const status = __fwd_dispatch(request,body,backend,length,out);
  ledger.disposed(1,2,1,1,1,status == 0);
  return __fra_acquired(4,status,load<i32>(out));
}
function __fra_poll(): i32 {
  const ledger = __fwd_ra!;
  // Outputs are fenced before dispatch and retained across qualified not-ready
  // results. A failed/invalid poll is never retried, including during cleanup.
  const status = __pulse_fetch_poll(__fwd_pending,__fwd_detail,__fwd_done,__fwd_response_out,__fwd_body_out);
  const done = load<i32>(__fwd_done);
  if (status != 0 || (done != 0 && done != 1)) {
    ledger.uncertain(1,4,1,4,1);
    ledger.noAcquisition(1,5,1,2,1,false); ledger.noAcquisition(1,6,1,3,1,false);
    return status == 0 ? 1 : status;
  }
  if (done == 1) {
    ledger.transferred(1,4,1,4,1);
    __fra_acquired(5,0,load<i32>(__fwd_response_out)); __fra_acquired(6,0,load<i32>(__fwd_body_out));
  }
  return 0;
}
function __fra_send(response: i32, body: i32, streaming: i32): i32 {
  const ledger = __fwd_ra!, r = streaming == 1 ? 7 : 9, b = streaming == 1 ? 8 : 10;
  if (!ledger.beginDispose(1,r,1,2,1,__fra_now())) return 1;
  if (streaming == 0 && !ledger.beginDispose(1,b,1,3,1,__fra_now())) return 1;
  const status = fastly_http_resp_send_downstream(response,body,streaming);
  ledger.disposed(1,r,1,2,1,status == 0);
  if (streaming == 0) ledger.disposed(1,b,1,3,1,status == 0);
  return status;
}
function __fra_cleanup(final: bool = false): void {
  if (__fwd_ra === null) return;
  const ledger = __fwd_ra!;
  ledger.close(1);
  // One reserved, nonblocking observation may adopt already-fenced outputs.
  // Never retry unknown outcomes, acquire new claims, or extend the deadline.
  if (!__fra_reaped && ledger.bank[4*8+5] == PRL_LIVE) {
    __fra_reaped = true;
    if (ledger.cleanupStep(1,false,__fra_now())) {
      __pulse_send_error_detail_reset(__fwd_detail); store<i32>(__fwd_done,0);
      __fra_poll();
    }
  }
  // No pending-request cancel ABI. Remaining claims stay held for host teardown.
  for (let slot = 0; slot < 11; slot++) {
    const state = ledger.bank[slot*8+5];
    if (state == PRL_RESERVED && (slot < 9 || final)) ledger.unused(1,slot,1,__fra_ns(slot),1);
    else if (state == PRL_LIVE && slot != 4) __fra_dispose(slot,slot == 3 || slot == 8);
  }
}
function __fra_error(status: i32): void {
  if (__fwd_ra === null || !__pulse_response_owned()) return;
  const ledger = __fwd_ra!;
  if (!ledger.consume(1,13,1,1,64,true,__fra_now())) return;
  // A fixed exit body uses the already-reserved scratch, without serialization
  // or an application value allocation. Authority fences the one final send.
  const text = status == 413 ? 'Payload Too Large' : status == 504 ? 'Gateway Timeout' : status == 400 ? 'Bad Request' : 'Bad Gateway';
  if (__fra_new(9,__fwd_io+52) != 0) return;
  const response = load<i32>(__fwd_io+52);
  if (__fra_new(10,__fwd_io+52) != 0) return;
  const body = load<i32>(__fwd_io+52);
  if (__fra_now() >= __FRA_DURATION || fastly_http_resp_status_set(response,status) != 0) return;
  for (let i = 0; i < text.length; i++) store<u8>(__fwd_buffer+i,u8(text.charCodeAt(i)));
  let offset = 0;
  while (offset < text.length) {
    if (__fra_now() >= __FRA_DURATION) return;
    const status = fastly_http_body_write(body,__fwd_buffer+offset,text.length-offset,0,__fwd_io+52);
    const written = load<i32>(__fwd_io+52);
    if (status != 0 || written <= 0 || written > text.length-offset) return;
    offset += written;
  }
  if (__fra_send(response,body,0) == 0) __pulse_fastly_last_error = 0; // delivery handled; ledger primary remains
}
