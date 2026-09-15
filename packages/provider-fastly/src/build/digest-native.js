'use strict';
const fs = require('node:fs');
const path = require('node:path');
function digestNativeSource(plan) {
  if (!plan.effects.some(effect => effect.kind === 'crypto.digestText')) return '';
  const selected = plan.crypto?.algorithms.find(entry => entry.algorithm === 'SHA-256');
  if (!selected || selected.realization !== 'guest-source:pulse-hmac-as' || selected.automaticFallback !== false) throw new TypeError('Digest requires the selected Crypto SHA-256 guest source.');
  const root = path.dirname(require.resolve('@pulse-compute/crypto/pulsewasm-native'));
  return fs.readFileSync(path.join(root, 'as/digest-text.as.ts'), 'utf8') + `
function __pulse_fastly_digest_begin(index: i32, outer: __PulseFastlyValue): void {
  const payload = __pulse_fastly_value(__pulse_fastly_payload_field(outer, 'invocation'))
  const text = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'text'))
  const digest = __pulse_crypto_digest_text(text.kind == PULSE_VALUE_STRING ? text.text : null)
  if (text.kind == PULSE_VALUE_STRING) __pulse_fastly_remember_secret(text.text)
  const result = host_value_object()
  host_value_object_set(result, __pulse_fastly_string_value('status'), __pulse_fastly_string_value(digest.status))
  if (digest.status == 'ok') {
    host_value_object_set(result, __pulse_fastly_string_value('sha256'), __pulse_fastly_string_value(digest.sha256))
    host_value_object_set(result, __pulse_fastly_string_value('byteLength'), host_value_number(f64(digest.byteLength)))
  } else host_value_object_set(result, __pulse_fastly_string_value('reason'), __pulse_fastly_string_value(digest.reason))
  __pulse_fastly_ready_effect(index, result)
}
`;
}
module.exports = { digestNativeSource };
