'use strict';
const fs = require('node:fs');
const path = require('node:path');
function enabled(plan) { return (plan.effects || []).some(effect => effect.kind === 'fetch'); }
function runtimeSource(plan) {
  if (!enabled(plan)) return `function __pulse_fetch_has_deadlines(): bool { return false }
function __pulse_fetch_request_check(index: i32): bool { return true }
function __pulse_fetch_request_remaining(): i32 { return 2147483647 }`;
  return fs.readFileSync(path.join(__dirname,'native-fetch-deadlines.as.ts'),'utf8');
}
function instrument(input, plan) {
  if (!enabled(plan)) return input;
  let source = input;
  const replace = (before,after) => {
    if (!source.includes(before)) throw new Error('Fastly fetch deadline boundary drift: ' + before.slice(0,80));
    source = source.replace(before,after);
  };
  replace('const init = initIndex >= 0 ? __pulse_fastly_value(unchecked(payload.values[initIndex])) : new __PulseFastlyValue(); let method',
    'const init = initIndex >= 0 ? __pulse_fastly_value(unchecked(payload.values[initIndex])) : new __PulseFastlyValue(); __pulse_fetch_begin_deadline(effectIndex, init); if (__pulse_fastly_last_error != 0) return; let method');
  replace('const backendBytes = __pulse_fastly_utf8(backend); const pendingOut',
    'if (!__pulse_fetch_before_send(effectIndex)) { __pulse_fetch_close_request(requestHandle); __pulse_fetch_close_body(bodyHandle); return; } const backendBytes = __pulse_fastly_utf8(backend); const pendingOut');
  replace('function __pulse_fastly_wait_fetch(effectIndex: i32): i32 {',
    'function __pulse_fastly_wait_fetch(effectIndex: i32): i32 { if (__pulse_fastly_effect_kind(effectIndex) == 1 && (__pulse_fetch_completed[effectIndex] || __pulse_fetch_has_deadlines())) return __pulse_fetch_wait(effectIndex);');
  replace('function __pulse_invocation_close(): void {', 'function __pulse_invocation_close(): void { __pulse_fetch_reap();');
  return source;
}
module.exports = {runtimeSource,instrument};
