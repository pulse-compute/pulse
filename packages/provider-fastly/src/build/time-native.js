'use strict';

// Provider-owned realtime sampling. The portable guest still suspends through
// effect_begin; no clock import is exposed to application-authored code.
function timeNativeSource(plan) {
  if (!(plan.effects || []).some(effect => effect.kind === 'time.now')) return '';
  return `
function __pulse_time_pad(value: i32, width: i32): string {
  let text = value.toString()
  while (text.length < width) text = "0" + text
  return text
}
function __pulse_time_iso(ms: u64): string {
  // Gregorian civil date from whole days since the Unix epoch.
  const z = <i32>(ms / 86400000) + 719468
  const era = z / 146097
  const doe = z - era * 146097
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let year = yoe + era * 400
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  const mp = (5 * doy + 2) / 153
  const day = doy - (153 * mp + 2) / 5 + 1
  const month = mp + (mp < 10 ? 3 : -9)
  if (month <= 2) year += 1
  const rest = <i32>(ms % 86400000)
  return __pulse_time_pad(year, 4) + "-" + __pulse_time_pad(month, 2) + "-" + __pulse_time_pad(day, 2)
    + "T" + __pulse_time_pad(rest / 3600000, 2) + ":" + __pulse_time_pad((rest / 60000) % 60, 2)
    + ":" + __pulse_time_pad((rest / 1000) % 60, 2) + "." + __pulse_time_pad(rest % 1000, 3) + "Z"
}
function __pulse_fastly_time_begin(effectIndex: i32, payload: __PulseFastlyValue): void {
  const out = new StaticArray<u64>(1)
  const status = wasi_snapshot_preview1_clock_time_get(0, 1000000, changetype<usize>(out))
  const result = host_value_object()
  if (status != 0) {
    host_value_object_set(result, __pulse_fastly_string_value("status"), __pulse_fastly_string_value("failed"))
    host_value_object_set(result, __pulse_fastly_string_value("reason"), __pulse_fastly_string_value("unavailable"))
  } else {
    // Divide integer nanoseconds before conversion to f64 to retain millisecond precision.
    const ms = unchecked(out[0]) / 1000000
    host_value_object_set(result, __pulse_fastly_string_value("status"), __pulse_fastly_string_value("ok"))
    host_value_object_set(result, __pulse_fastly_string_value("unixEpochMs"), host_value_number(<f64>ms))
    host_value_object_set(result, __pulse_fastly_string_value("iso8601"), __pulse_fastly_string_value(__pulse_time_iso(ms)))
  }
  __pulse_fastly_ready_effect(effectIndex, result)
}
`;
}

module.exports = Object.freeze({ timeNativeSource });
