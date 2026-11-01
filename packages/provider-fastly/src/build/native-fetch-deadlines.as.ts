// Per-invocation, per-admission header deadlines. A reused effect site gets a new
// clock sample; waiting on an earlier group member cannot replenish this budget.
@external('fastly_async_io', 'select')
declare function __pulse_fetch_select(handles: usize, count: i32, timeout: i32, done: usize): i32
@external('fastly_http_req', 'pending_req_poll_v2')
declare function __pulse_fetch_poll(handle: i32, detail: usize, done: usize, response: usize, body: usize): i32
@external('fastly_http_resp', 'close')
declare function __pulse_fetch_close_response(handle: i32): i32
const __pulse_fetch_timeout = new StaticArray<f64>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_fetch_started = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_fetch_completed = new StaticArray<bool>(PULSE_FASTLY_EFFECT_COUNT)
// Zero = headers, positive = Fastly status, -1 = timeout, -2 = protocol/clock.
const __pulse_fetch_outcome = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_fetch_retired = new Array<i32>()
let __pulse_fetch_last_clock: i64 = -1
let __pulse_fetch_retired_total: i32 = 0
export function pulse_fastly_fetch_retired(): i32 { return __pulse_fetch_retired_total }
export function pulse_fastly_fetch_unreaped(): i32 { return /*ACCOUNTING_UNREAPED*/ }
/*ACCOUNTING_CLOCK_STORAGE*/
function __pulse_fetch_clock(index: i32): i64 {
  const out = /*ACCOUNTING_CLOCK_OUT*/
  if (wasi_snapshot_preview1_clock_time_get(1, 1, changetype<usize>(out)) != 0
    || out[0] < 0 || out[0] < __pulse_fetch_last_clock) {
    /*ACCOUNTING_CLOCK_FAILURE*/
    __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 272, index); return -1
  }
  __pulse_fetch_last_clock = out[0]; return out[0]
}
function __pulse_fetch_begin_deadline(index: i32, init: __PulseFastlyValue): void {
  __pulse_fetch_timeout[index] = 0; __pulse_fetch_completed[index] = false; __pulse_fetch_outcome[index] = 0
  const field = __pulse_fastly_find(init, 'timeoutMs')
  if (field < 0) return
  const value = __pulse_fastly_value(unchecked(init.values[field]))
  if (value.kind == PULSE_VALUE_UNDEFINED) return
  const ms = value.number
  if (value.kind != PULSE_VALUE_NUMBER || ms <= 0 || ms > 9007199254740991 || Math.floor(ms) != ms) {
    __pulse_fastly_fail(PULSE_ERROR_VALUE, 270, index); return
  }
  __pulse_fetch_timeout[index] = ms
  __pulse_fetch_started[index] = __pulse_fetch_clock(index)
}
function __pulse_fetch_remaining(index: i32, now: i64): f64 {
  if (__pulse_fetch_timeout[index] == 0) return 2147483647.0
  // Subtract elapsed nanoseconds before converting. Do not overflow by adding
  // a safe-integer millisecond option to an i64 nanosecond clock.
  return __pulse_fetch_timeout[index] - f64(now - __pulse_fetch_started[index]) / 1000000.0
}
function __pulse_fetch_before_send(index: i32): bool {
  if (__pulse_fastly_effect_kind(index) != 1 || __pulse_fetch_timeout[index] == 0) return true
  const now = __pulse_fetch_clock(index)
  if (now < 0) return false
  if (__pulse_fetch_remaining(index, now) > 0) return true
  __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 271, index); return false
}
function __pulse_fetch_active(index: i32): bool {
  return __pulse_fastly_effect_kind(index) == 1 && __pulse_fastly_pending_mode[index] == PULSE_FASTLY_PENDING_ASYNC
}
function __pulse_fetch_has_deadlines(): bool {
  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) {
    /*ACCOUNTING_FORCE_POLL*/
    if (__pulse_fetch_active(i) && __pulse_fetch_timeout[i] > 0) return true
  }
  return false
}
function __pulse_fetch_complete(index: i32, outcome: i32, result: i32 = 0): void {
  __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_READY
  __pulse_fastly_pending[index] = 0; __pulse_fastly_ready[index] = result
  __pulse_fetch_completed[index] = true; __pulse_fetch_outcome[index] = outcome
}
function __pulse_fetch_retire(index: i32, outcome: i32): void {
  // The Fastly ABI has no pending-request cancellation hostcall. Retain explicit
  // ownership until invocation cleanup; never wait, retry, or claim rollback.
  /*ACCOUNTING_RETIRED*/ __pulse_fetch_retired_total++
  __pulse_fetch_complete(index, outcome)
}
function __pulse_fetch_retire_all(): void {
  for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) if (__pulse_fetch_active(i)) __pulse_fetch_retire(i, -2)
}
function __pulse_fetch_reap(): void {
  /*ACCOUNTING_REAP*/
  const detail = new StaticArray<i32>(__PULSE_SEND_ERROR_DETAIL_WORDS), done = new StaticArray<i32>(1)
  const response = new StaticArray<i32>(1), body = new StaticArray<i32>(1)
  for (let i = __pulse_fetch_retired.length - 1; i >= 0; i--) {
    done[0] = 0
    __pulse_send_error_detail_reset(changetype<usize>(detail))
    const status = /*ACCOUNTING_POLL*/(__pulse_fetch_retired[i], changetype<usize>(detail), changetype<usize>(done), changetype<usize>(response), changetype<usize>(body))
    if (status == 0 && done[0] == 0) continue
    if (status == 0 && done[0] == 1) { /*ACCOUNTING_LATE_CLOSE*/ }
    __pulse_fetch_retired[i] = __pulse_fetch_retired[__pulse_fetch_retired.length - 1]; __pulse_fetch_retired.pop()
  }
  // Unready handles remain platform-owned until host teardown. No guest task
  // survives _start and no response/body is exposed for an expired operation.
}
// Request-budget instrumentation replaces these hooks when maxDurationMs exists.
function __pulse_fetch_request_check(index: i32): bool { return true }
function __pulse_fetch_request_remaining(): i32 { return 2147483647 }
function __pulse_fetch_take(index: i32): i32 {
  const outcome = __pulse_fetch_outcome[index], result = __pulse_fastly_ready[index]
  __pulse_fetch_completed[index] = false; __pulse_fastly_pending_mode[index] = PULSE_FASTLY_PENDING_NONE
  __pulse_fastly_ready[index] = 0
  if (outcome == -1) __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 271, index)
  else if (outcome == -2) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 272, index)
  else if (outcome != 0) __pulse_fetch_fail(outcome, 81, index)
  return outcome == 0 ? result : 0
}
function __pulse_fetch_wait(index: i32): i32 {
  const handles = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT), selected = new StaticArray<i32>(1)
  const detail = new StaticArray<i32>(__PULSE_SEND_ERROR_DETAIL_WORDS), done = new StaticArray<i32>(1)
  const response = new StaticArray<i32>(1), body = new StaticArray<i32>(1)
  while (!__pulse_fetch_completed[index]) {
    if (!__pulse_fetch_request_check(index)) { __pulse_fetch_retire_all(); return 0 }
    let now = __pulse_fetch_clock(index)
    if (now < 0) { __pulse_fetch_retire_all(); return 0 }
    let count = 0, remaining = 2147483647.0
    // Observe all dispatched fetches, not just the first static slot. Otherwise
    // a slow earlier sibling could turn timely later headers into a false timeout.
    for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) {
      if (!__pulse_fetch_active(i)) continue
      if (__pulse_fetch_remaining(i, now) <= 0) { __pulse_fetch_retire(i, -1); continue }
      done[0] = 0
      __pulse_send_error_detail_reset(changetype<usize>(detail))
      const status = /*ACCOUNTING_POLL*/(__pulse_fastly_pending[i], changetype<usize>(detail), changetype<usize>(done), changetype<usize>(response), changetype<usize>(body))
      now = __pulse_fetch_clock(i)
      if (status != 0) {
        __pulse_transport_capture(i, status, 'poll', changetype<usize>(detail))
        __pulse_fetch_complete(i, now < 0 ? -2 : __pulse_fetch_remaining(i, now) <= 0 ? -1 : status)
        if (now < 0) { __pulse_fetch_retire_all(); return 0 }
        continue
      }
      if (done[0] != 0 && done[0] != 1) {
        __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 272, i); __pulse_fetch_retire_all(); return 0
      }
      if (now < 0 || __pulse_fetch_remaining(i, now) <= 0) {
        if (done[0] == 1) {
          /*ACCOUNTING_LATE_CLOSE*/; __pulse_fetch_complete(i, now < 0 ? -2 : -1)
        } else __pulse_fetch_retire(i, now < 0 ? -2 : -1)
        if (now < 0) { __pulse_fetch_retire_all(); return 0 }
        continue
      }
      if (done[0] == 1) {
        const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_FETCH
        value.responseHandle = response[0]; value.bodyHandle = body[0]
        __pulse_fetch_complete(i, 0, __pulse_fastly_put(value)); continue
      }
    }
    if (__pulse_fetch_completed[index]) break
    if (!__pulse_fetch_request_check(index)) { __pulse_fetch_retire_all(); return 0 }
    now = __pulse_fetch_clock(index)
    if (now < 0) { __pulse_fetch_retire_all(); return 0 }
    for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) {
      if (!__pulse_fetch_active(i)) continue
      const budget = __pulse_fetch_remaining(i, now)
      if (budget <= 0) { __pulse_fetch_retire(i, -1); continue }
      handles[count++] = __pulse_fastly_pending[i]; remaining = Math.min(remaining, budget)
    }
    if (__pulse_fetch_completed[index]) break
    remaining = Math.min(remaining, f64(__pulse_fetch_request_remaining()))
    if (count == 0 || remaining <= 0) {
      __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 272, index); __pulse_fetch_retire_all(); return 0
    }
    selected[0] = -2
    const status = __pulse_fetch_select(changetype<usize>(handles), count, i32(Math.ceil(remaining)), changetype<usize>(selected))
    const after = __pulse_fetch_clock(index)
    if (status != 0 || selected[0] < -1 || selected[0] >= count || after < 0 || (selected[0] == -1 && after <= now)) {
      __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 272, index); __pulse_fetch_retire_all(); return 0
    }
  }
  return __pulse_fetch_take(index)
}
