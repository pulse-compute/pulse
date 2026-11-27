'use strict';
const fs = require('node:fs');
const path = require('node:path');
function macTextNativeSource(plan) {
  if (!plan.effects.some(effect => effect.kind === 'crypto.verifyMacText')) return '';
  const selected = plan.crypto?.algorithms.find(entry => entry.algorithm === 'HS256');
  if (!selected || selected.realization !== 'guest-source:pulse-hmac-as' || selected.implementation !== 'pulse-hmac-as.v1'
    || selected.kind !== 'guest-source' || selected.targetImplemented !== true || selected.automaticFallback !== false) throw new TypeError('MAC requires selected Crypto HS256 guest source.');
  const root = path.dirname(require.resolve('@pulse-compute/crypto/pulsewasm-native'));
  return fs.readFileSync(path.join(root, 'as/mac-text.as.ts'), 'utf8') + `
function __pulse_fastly_mac_result(index: i32, status: string): void {
  const result = host_value_object()
  host_value_object_set(result, __pulse_fastly_string_value('status'), __pulse_fastly_string_value(status))
  __pulse_fastly_ready_effect(index, result)
}
function __pulse_fastly_mac_begin(index: i32, outer: __PulseFastlyValue): void {
  const payload = __pulse_fastly_value(__pulse_fastly_payload_field(outer, 'invocation'))
  const message = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'message'))
  const tag = __pulse_fastly_value(__pulse_fastly_payload_field(payload, 'tag'))
  if (message.kind != PULSE_VALUE_STRING) { __pulse_fastly_mac_result(index, 'invalid-input'); return }
  const length = __pulse_crypto_mac_length(message.text, 65536)
  if (length < 0) { __pulse_fastly_mac_result(index, length == -2 ? 'too-large' : 'invalid-input'); return }
  if (tag.kind != PULSE_VALUE_STRING || !__pulse_crypto_mac_tag_valid(tag.text)) { __pulse_fastly_mac_result(index, 'invalid-input'); return }
  // Static authority was validated by the package lowerer and provider planner.
  // Resolve raw bytes without constructing a secret string or application value.
  const storeName = __pulse_fastly_utf8(__pulse_fastly_secret_store(index))
  const storeOut = __pulse_fastly_out_i32()
  let status = fastly_secret_store_open(changetype<usize>(storeName), storeName.byteLength, changetype<usize>(storeOut))
  if (status != FASTLY_STATUS_OK) { __pulse_fastly_mac_result(index, status == FASTLY_STATUS_NONE ? 'unavailable' : 'realization-failure'); return }
  const name = __pulse_fastly_utf8(__pulse_fastly_jwt_secret_binding(index))
  const secretOut = __pulse_fastly_out_i32()
  status = fastly_secret_store_get(__pulse_fastly_out_value(storeOut), changetype<usize>(name), name.byteLength, changetype<usize>(secretOut))
  if (status != FASTLY_STATUS_OK) { __pulse_fastly_mac_result(index, status == FASTLY_STATUS_NONE ? 'invalid-key' : 'realization-failure'); return }
  // The existing Crypto frame fits all v1 key/message/tag inputs. The provider
  // owns this synchronous borrow; returned hostcall failures also wipe it.
  const frame = pulse_crypto_bytes_frame_v1()
  const capacity: usize = 8192 + 65536 + 32
  memory.fill(frame, 0, capacity)
  const written = __pulse_fastly_out_i32()
  status = fastly_secret_store_plaintext(__pulse_fastly_out_value(secretOut), frame, 4096, changetype<usize>(written))
  const keyLength = __pulse_fastly_out_value(written)
  let outcome = 'realization-failure'
  if (status == FASTLY_STATUS_BUFLEN || status == FASTLY_STATUS_OK && (keyLength < 32 || keyLength > 4096)) outcome = 'invalid-key'
  else if (status == FASTLY_STATUS_OK) {
    const data = Uint8Array.wrap(String.UTF8.encode(message.text))
    memory.copy(frame + 8192, data.dataStart, data.length)
    data.fill(0)
    for (let i = 0; i < 32; i++) store<u8>(frame + 8192 + 65536 + i, <u8>((__pulse_crypto_mac_hex(tag.text.charCodeAt(i * 2)) << 4) | __pulse_crypto_mac_hex(tag.text.charCodeAt(i * 2 + 1))))
    const code = pulse_crypto_hs256_verify(frame, keyLength, frame + 8192, length, frame + 8192 + 65536, 32)
    outcome = code == 1 ? 'valid' : code == 0 ? 'invalid-authenticator' : 'realization-failure'
  }
  memory.fill(frame, 0, capacity)
  __pulse_fastly_mac_result(index, outcome)
}
`;
}
module.exports = { macTextNativeSource };
