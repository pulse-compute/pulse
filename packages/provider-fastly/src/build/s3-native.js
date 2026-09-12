'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pulseS3AssemblyScriptSource } = require('@pulse-compute/s3/pulsewasm-native');
const S3_IMPORTS = Object.freeze([
  'fastly_async_io:select', 'fastly_http_req:pending_req_poll_v2', 'fastly_http_req:cache_override_set',
  'fastly_http_req:auto_decompress_response_set', 'fastly_http_req:close', 'fastly_http_resp:close', 'fastly_http_body:close',
  'fastly_http_resp:header_names_get', 'fastly_http_resp:header_values_get', 'fastly_http_resp:status_get',
  'fastly_http_req:new', 'fastly_http_req:method_set', 'fastly_http_req:uri_set', 'fastly_http_req:header_insert', 'fastly_http_req:send_async',
  'fastly_http_body:new', 'fastly_http_body:read', 'fastly_secret_store:open', 'fastly_secret_store:get', 'fastly_secret_store:plaintext',
  'wasi_snapshot_preview1:clock_time_get'
]);
function s3NativeSource(plan, bindings) {
  if (!bindings.s3.length) return '';
  const contribution = pulseS3AssemblyScriptSource();
  for (const name of contribution.cryptoRequirements) {
    const selected = plan.crypto && plan.crypto.algorithms.find((entry) => entry.algorithm === name);
    if (!selected || selected.realization !== 'guest-source:pulse-hmac-as' || selected.implementation !== 'pulse-hmac-as.v1'
      || selected.kind !== 'guest-source' || selected.targetImplemented !== true || selected.automaticFallback !== false) throw new TypeError('Fastly S3 requires its exact selected Native Crypto algorithms.');
  }
  const lines = ['function __pulse_fastly_s3_binding(index: i32): __PulseS3Binding {', 'const value = new __PulseS3Binding();', 'switch (index) {'];
  for (const binding of bindings.s3) {
    lines.push(`case ${binding.index}:`);
    for (const [field, input] of Object.entries({ endpoint: 'endpoint', bucket: 'bucket', region: 'region', backend: 'backend', id: 'accessKeyIdSecret', secret: 'secretAccessKeySecret', token: 'sessionTokenSecret' })) lines.push(`value.${field} = ${JSON.stringify(binding[input] || '')};`);
    lines.push(`value.max = ${binding.maxTextBytes}; value.timeout = ${binding.timeoutMs}; break;`);
  }
  lines.push('default: unreachable();', '}', 'return value;', '}');
  return [contribution.source, fs.readFileSync(path.join(__dirname, 's3-native.as.ts'), 'utf8'), lines.join('\n')].join('\n');
}
module.exports = { S3_IMPORTS, s3NativeSource };
