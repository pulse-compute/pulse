// Fixed scalar-only host provenance. Never retain pointers, URLs, headers or bodies.
class __PulseTransportDetail {
  phase: string = ''
  status: u32 = 0
  tag: i64 = -1
  mask: i64 = -1
  kind: string = 'unavailable'
  dnsRcode: i32 = -1
  dnsInfo: i32 = -1
  tlsAlert: i32 = -1
  h2Frame: i32 = -1
  h2Code: i64 = -1
}
@lazy const __pulse_transport_slots = new StaticArray<__PulseTransportDetail | null>(PULSE_FASTLY_EFFECT_COUNT)
let __pulse_transport_error: __PulseTransportDetail | null = null
function __pulse_transport_kind(tag: u32): string {
  switch (tag) {
    case 1: return 'ok'
    case 2: return 'dns_timeout'
    case 3: return 'dns_error'
    case 4: return 'destination_not_found'
    case 5: return 'destination_unavailable'
    case 6: return 'destination_ip_unroutable'
    case 7: return 'connection_refused'
    case 8: return 'connection_terminated'
    case 9: return 'connection_timeout'
    case 10: return 'connection_limit_reached'
    case 11: return 'tls_certificate_error'
    case 12: return 'tls_configuration_error'
    case 13: return 'http_incomplete_response'
    case 14: return 'http_response_header_section_too_large'
    case 15: return 'http_response_body_too_large'
    case 16: return 'http_response_timeout'
    case 17: return 'http_response_status_invalid'
    case 18: return 'http_upgrade_failed'
    case 19: return 'http_protocol_error'
    case 20: return 'http_request_cache_key_invalid'
    case 21: return 'http_request_uri_invalid'
    case 22: return 'internal_error'
    case 23: return 'tls_alert_received'
    case 24: return 'tls_protocol_error'
    case 25: return 'h2_error'
    default: return 'unknown'
  }
}
function __pulse_transport_integer(value: i64): string { return value < 0 ? 'null' : value.toString() }
function __pulse_transport_capture(index: i32, status: i32, phase: string, ptr: usize = 0): void {
  const d = new __PulseTransportDetail(); d.status = u32(status); d.phase = phase;
  // Uninitialized means no host detail, even if stale/unknown mask bits exist.
  if (ptr != 0 && load<u32>(ptr) != 0) {
    const tag = load<u32>(ptr), mask = load<u32>(ptr + 4);
    d.tag = i64(tag); d.mask = i64(mask); d.kind = __pulse_transport_kind(tag);
    if (tag == 3) {
      if ((mask & 2) != 0) d.dnsRcode = load<u16>(ptr + 8);
      if ((mask & 4) != 0) d.dnsInfo = load<u16>(ptr + 10);
    }
    if (tag == 23 && (mask & 8) != 0) d.tlsAlert = load<u8>(ptr + 12);
    if (tag == 25 && (mask & 16) != 0) { d.h2Frame = load<u8>(ptr + 13); d.h2Code = i64(load<u32>(ptr + 16)); }
  }
  if (index >= 0 && index < PULSE_FASTLY_EFFECT_COUNT) __pulse_transport_slots[index] = d;
  // One bounded best-effort diagnostic through the configured existing log sink.
  // Only fixed enum strings and unsigned integers enter this record (<512 bytes).
  const text = '[pulse:error] {"event":"pulse.transport","provider":"fastly","phase":"' + d.phase
    + '","status":' + d.status.toString() + ',"tag":' + __pulse_transport_integer(d.tag)
    + ',"mask":' + __pulse_transport_integer(d.mask) + ',"kind":"' + d.kind
    + '","dnsRcode":' + __pulse_transport_integer(d.dnsRcode) + ',"dnsInfo":' + __pulse_transport_integer(d.dnsInfo)
    + ',"tlsAlert":' + __pulse_transport_integer(d.tlsAlert) + ',"h2Frame":' + __pulse_transport_integer(d.h2Frame)
    + ',"h2Code":' + __pulse_transport_integer(d.h2Code) + '}\n';
  __pulse_fastly_write_stdout(String.UTF8.encode(text, false));
}
function __pulse_transport_field(result: i32, key: string, value: i64): void {
  host_value_object_set(result, __pulse_fastly_string_value(key), value < 0 ? host_value_null() : host_value_number(f64(value)));
}
function __pulse_transport_value(d: __PulseTransportDetail): i32 {
  const result = host_value_object();
  host_value_object_set(result, __pulse_fastly_string_value('provider'), __pulse_fastly_string_value('fastly'));
  host_value_object_set(result, __pulse_fastly_string_value('phase'), __pulse_fastly_string_value(d.phase));
  host_value_object_set(result, __pulse_fastly_string_value('kind'), __pulse_fastly_string_value(d.kind));
  __pulse_transport_field(result, 'status', i64(d.status)); __pulse_transport_field(result, 'tag', d.tag);
  __pulse_transport_field(result, 'mask', d.mask); __pulse_transport_field(result, 'dnsRcode', d.dnsRcode);
  __pulse_transport_field(result, 'dnsInfo', d.dnsInfo); __pulse_transport_field(result, 'tlsAlert', d.tlsAlert);
  __pulse_transport_field(result, 'h2Frame', d.h2Frame); __pulse_transport_field(result, 'h2Code', d.h2Code);
  return result;
}
