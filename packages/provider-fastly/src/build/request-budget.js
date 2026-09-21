'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {normalizeRequestDuration} = require('@pulse-compute/runtime/host');

function instrumentRequestBudget(input, duration, plan) {
  const ms = normalizeRequestDuration(duration);
  if (ms === undefined) return input;
  let source = input;
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Fastly request budget boundary drift: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  replace('  __pulse_fastly_last_error = fastly_abi_init', `  __request_expired = false; __request_error_response = false; __request_last_clock = -1;
  __request_deadline = __request_clock() + i64(${ms}) * 1000000;
  __pulse_fastly_last_error = fastly_abi_init`);
  replace('  const handles = new StaticArray<i32>(2)\n  const downstreamStatus', `  if (!__request_check()) { __request_send_timeout(); return; }
  const handles = new StaticArray<i32>(2)
  const downstreamStatus`);
  replace('function host_effect_begin(effectIndex: i32, payload: i32): void {', 'function host_effect_begin(effectIndex: i32, payload: i32): void {\n  if (!__request_check(effectIndex)) return;');
  replace('function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {', 'function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {\n  if (!__request_check(index)) return 0;');
  replace('  let runStatus = pulse_start()', '  if (!__request_check()) { __request_send_timeout(); return; }\n  let runStatus = pulse_start()');
  replace('function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {', `function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {
  if (!__request_check(effectIndex)) return 0;
  const kind = __pulse_fastly_effect_kind(effectIndex);
  if (unchecked(__pulse_fastly_pending_mode[effectIndex]) == PULSE_FASTLY_PENDING_ASYNC && kind != 12 && kind != 13 && kind != 14 && ${plan.effects.filter(e=>e.kind.startsWith('kv.')&&['kv.getVersioned','kv.insertIfAbsent','kv.compareAndSwap'].includes(e.kind)).map(e=>'effectIndex != '+plan.effects.indexOf(e)).join(' && ')||'true'}) {
    if (!__request_wait(unchecked(__pulse_fastly_pending[effectIndex]), effectIndex)) return 0;
  }`);
  replace('    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();', '    if (!__request_wait(handle, effectIndex)) return "";\n    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();');
  replace('while (offset < bytes.byteLength) { const written', 'while (offset < bytes.byteLength) { if (!__request_check()) return 1; const written');
  replace('function __pulse_fastly_send_result(handle: i32): i32 {', 'function __pulse_fastly_send_result(handle: i32): i32 { if (!__request_check()) return 1;');
  replace('return fastly_http_resp_send_downstream(responseHandle, bodyHandle, 0)', 'if (!__request_check()) return 1; return fastly_http_resp_send_downstream(responseHandle, bodyHandle, 0)');
  replace('if (sendStatus != FASTLY_STATUS_OK) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 104, -1)', 'if (sendStatus != FASTLY_STATUS_OK) { if (__request_expired) { __request_send_timeout(); return; } __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 104, -1); }');
  replace('status = fastly_http_req_send_async(requestHandle', 'if (!__request_check(effectIndex)) return; status = fastly_http_req_send_async(requestHandle');
  replace('function __pulse_fastly_ready_effect(effectIndex: i32, handle: i32): void {', 'function __pulse_fastly_ready_effect(effectIndex: i32, handle: i32): void { if (!__request_check(effectIndex)) return;');
  source = source.replace('if (fatal) return', 'if (fatal) { if (__request_expired || !__request_check()) __request_send_timeout(); return; }');
  replace('function __pulse_fastly_jwt_send_error(): void {', 'function __pulse_fastly_jwt_send_error(): void { if (__request_expired || !__request_check()) { __request_send_timeout(); return; }');
  source = source.replaceAll('runStatus = pulse_resume()', 'if (!__request_check()) { __request_send_timeout(); return; }\n    runStatus = pulse_resume()');
  replace('  const result = pulse_result_handle()', '  if (!__request_check()) { __request_send_timeout(); return; }\n  const result = pulse_result_handle()');
  if (source.includes('__kv_deadline[index] = start +')) replace('__kv_deadline[index] = start + i64(__KV_timeoutMs) * 1000000;', '__kv_deadline[index] = min<i64>(__request_deadline, start + i64(__KV_timeoutMs) * 1000000);');
  if (source.includes('__s3_deadlines[index] = start +')) replace('__s3_deadlines[index] = start + i64(binding.timeout) * 1000000;', '__s3_deadlines[index] = min<i64>(__request_deadline, start + i64(binding.timeout) * 1000000);');
  return source + '\n' + fs.readFileSync(path.join(__dirname,'request-budget.as.ts'),'utf8');
}
module.exports = {instrumentRequestBudget};
