'use strict';

function runtimeSource() {
  return `
let __pulse_request_body_failure: i32 = 0
// Validate the bounded, assembled request bytes before any text projection.
function __pulse_request_utf8_valid(bytes: Uint8Array): bool {
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i++]; if (lead < 128) continue;
    let count = 0, minimum = 128, maximum = 191;
    if (lead >= 194 && lead <= 223) count = 1;
    else if (lead >= 224 && lead <= 239) { count = 2; if (lead == 224) minimum = 160; if (lead == 237) maximum = 159; }
    else if (lead >= 240 && lead <= 244) { count = 3; if (lead == 240) minimum = 144; if (lead == 244) maximum = 143; }
    else return false;
    if (i + count > bytes.length || i32(bytes[i]) < minimum || i32(bytes[i]) > maximum) return false;
    i++; for (let n = 1; n < count; n++, i++) if (bytes[i] < 128 || bytes[i] > 191) return false;
  }
  return true;
}
function __pulse_request_send_body_error(): bool {
  if (__pulse_fastly_last_error != PULSE_ERROR_REQUEST_BODY) return false;
  const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE;
  output.status = __pulse_fastly_error_stage == 21 ? 413 : 400;
  output.text = output.status == 413 ? "Payload Too Large" : "Bad Request";
  output.headers.push(new __PulseFastlyHeader("content-type", "text/plain; charset=utf-8"));
  __pulse_fastly_last_error = 0; __pulse_fastly_error_stage = 0; __pulse_fastly_error_effect = -1;
  const status = __pulse_fastly_send_result(__pulse_fastly_put(output));
  if (status != FASTLY_STATUS_OK) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 104, -1);
  return true;
}
`;
}

function instrument(source, applicationErrors) {
  if (!applicationErrors) source = source.replace(/function (host_\w+)\(([^)]*)\): (i32|void) \{/g,
    (declaration, _name, _args, result) => `${declaration} if (__pulse_fastly_last_error == PULSE_ERROR_REQUEST_BODY) return${result === 'void' ? '' : ' 0'};`);
  // The existing terminal failure path also covers applications without an
  // error handler. Request-budget instrumentation subsequently takes priority.
  const marker = 'function __pulse_fastly_jwt_send_error(): void {';
  if (!source.includes(marker)) throw new Error('Fastly request-body error boundary drift.');
  return source.replace(marker, marker + ' if (__pulse_request_send_body_error()) return;');
}

module.exports = { runtimeSource, instrument };
