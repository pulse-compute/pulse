function __pulse_embedded_request_header(name: string): string | null {
  const values = __pulse_request_header_list(name, false);
  return values.length ? values.join(', ') : null;
}
function __pulse_embedded_field(payload: __PulseFastlyValue, name: string): string { return __pulse_fastly_string(__pulse_fastly_payload_field(payload, name)); }
function __pulse_fastly_embedded_asset(payload: __PulseFastlyValue): i32 {
  // Avoid exposing provider buffers as canonical application values.
  const length = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'embeddedFound')).boolean != 0 ? i32(__pulse_fastly_number(__pulse_fastly_payload_field(payload, 'embeddedLength'))) : -1;
  const etag = __pulse_embedded_field(payload, 'embeddedEtag'), method = __pulse_embedded_field(payload, 'method');
  const selected = __pulse_embedded_selection(length, method, etag,
    __pulse_embedded_request_header('if-none-match'), __pulse_embedded_request_header('range'), __pulse_embedded_request_header('if-range'));
  if (__pulse_request_headers_failed) return 0;
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = selected.status;
  if (selected.status != 400 && selected.status != 404) {
    output.headers.push(new __PulseFastlyHeader('content-type', __pulse_embedded_field(payload, 'embeddedType')));
    output.headers.push(new __PulseFastlyHeader('etag', etag)); output.headers.push(new __PulseFastlyHeader('accept-ranges', 'bytes'));
    if (selected.contentRange.length) output.headers.push(new __PulseFastlyHeader('content-range', selected.contentRange));
    if (selected.status == 200 || selected.status == 206) {
      output.headers.push(new __PulseFastlyHeader('content-length', max<i32>(0, selected.end - selected.start + 1).toString()));
      if (method != 'HEAD') output.binaryBody = __pulse_embedded_bytes(__pulse_embedded_field(payload, 'embeddedData'), selected.start, selected.end);
    }
  }
  return __pulse_fastly_put(output);
}
function __pulse_fastly_write_binary(handle: i32, data: Uint8Array): i32 {
  const written = new StaticArray<i32>(1); let offset = 0;
  while (offset < data.length) {
    if (fastly_http_body_write(handle, data.dataStart + offset, data.length - offset, 0, changetype<usize>(written)) != 0 || written[0] <= 0 || written[0] > data.length - offset) return 1;
    offset += written[0];
  }
  return 0;
}
