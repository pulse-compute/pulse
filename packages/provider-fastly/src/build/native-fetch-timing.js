'use strict';
const fs = require('node:fs');
const path = require('node:path');
function instrument(input, plan) {
  const timed = plan.effects.flatMap((e,i)=>e.kind==='fetch' && e.fetchTiming ? [i] : []);
  const projected = timed.filter(i=>plan.effects[i].decoder);
  let source = input;
  const replace = (a,b) => { if(source.split(a).length!==2)throw Error('Fetch timing boundary drift: '+a);source=source.replace(a,b); };
  const selected = index => timed.map(i=>`${index} == ${i}`).join(' || ') || 'false';
  // Dynamic init must not introduce optional instrumentation after compilation.
  const anchor = 'headers.kind = PULSE_VALUE_OBJECT; if (init.kind == PULSE_VALUE_OBJECT) {';
  replace(anchor, anchor+`
    const timingIndex = __pulse_fastly_find(init, 'timing');
    const timing = timingIndex >= 0 ? __pulse_fastly_value(init.values[timingIndex]) : new __PulseFastlyValue();
    if ((timingIndex >= 0 && timing.kind != PULSE_VALUE_UNDEFINED && timing.kind != PULSE_VALUE_BOOLEAN)
      || (timing.kind == PULSE_VALUE_BOOLEAN && timing.boolean) != (${selected('effectIndex')})) {
      __pulse_fastly_fail(PULSE_ERROR_VALUE, 48, effectIndex); return;
    }
  `);
  if(!timed.length)return source;
  replace('function __pulse_fetch_begin_deadline(index: i32, init: __PulseFastlyValue): void {',
    'function __pulse_fetch_begin_deadline(index: i32, init: __PulseFastlyValue): void { __pulse_timing_reset(index);');
  replace('status = fastly_http_req_send_async(requestHandle, bodyHandle,',
    '__pulse_timing_begin(effectIndex); status = fastly_http_req_send_async(requestHandle, bodyHandle,');
  replace('function __pulse_fetch_has_deadlines(): bool {',
    'function __pulse_fetch_has_deadlines(): bool { if (__pulse_timing_active()) return true;');
  replace('function __pulse_fetch_complete(index: i32, outcome: i32, result: i32 = 0): void {',
    'function __pulse_fetch_complete(index: i32, outcome: i32, result: i32 = 0): void { __pulse_timing_end(index);');
  replace('__pulse_fetch_complete(i, 0, __pulse_fastly_put(value)); continue',
    '__pulse_timing_headers(i, __pulse_fastly_put(value)); continue');
  replace('while (!__pulse_fetch_completed[index]) {',
    'while (!__pulse_fetch_completed[index] || __pulse_timing_active()) {');
  // Both early-return fences must wait for transport observations, never decoding.
  source=source.replaceAll('if (__pulse_fetch_completed[index]) break',
    'if (__pulse_fetch_completed[index] && !__pulse_timing_active()) break');
  replace('    if (__pulse_fetch_completed[index] && !__pulse_timing_active()) break\n    if (!__pulse_fetch_request_check(index))',
    '    __pulse_timing_read_round(); if (__pulse_fastly_last_error != 0) return 0;\n    if (__pulse_fetch_completed[index] && !__pulse_timing_active()) break\n    if (!__pulse_fetch_request_check(index))');
  // Add active bodies to the same wait set. One pending request OR body per site.
  replace('    remaining = Math.min(remaining, f64(__pulse_fetch_request_remaining()))',
    '    for (let i = 0; i < PULSE_FASTLY_EFFECT_COUNT; i++) { const row = __pulse_timing_bodies[i]; if (row !== null && !row.done) handles[count++] = __pulse_fastly_value(row.value).bodyHandle; }\n    remaining = Math.min(remaining, f64(__pulse_fetch_request_remaining()))');
  replace('function __pulse_fastly_fetch_body(value: __PulseFastlyValue): string {',
    'function __pulse_fastly_fetch_body(value: __PulseFastlyValue): string { if (__pulse_timing_decode(value)) return value.text;');
  replace('const failure = __pulse_fetch_collect_failure(effectIndex)',
    '__pulse_timing_end(effectIndex); const failure = __pulse_fetch_collect_failure(effectIndex)');
  source += fs.readFileSync(path.join(__dirname,'native-fetch-timing.as.ts'),'utf8')
    .replace('/*TIMED*/',selected('index'))
    .replace('/*PROJECTED*/',projected.map(i=>`index == ${i}`).join(' || ') || 'false');
  return source;
}
module.exports = { instrument };
