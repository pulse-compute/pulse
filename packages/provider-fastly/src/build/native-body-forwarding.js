'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {normalizeBodyForwarding, forwardingError} = require('../toolchain/body-forwarding.js');
const IMPORTS = ['fastly_http_req:send_async_streaming', 'fastly_http_body:abandon',
  'fastly_async_io:is_ready', 'fastly_http_resp:header_names_get'];
const enabled = plan => (plan?.capabilities || []).includes('request.body.forward');
function field(value, name) { return value?.entries?.find(entry => entry.key?.value === name)?.value; }
function validate(plan, options) {
  const config = normalizeBodyForwarding(options.bodyForwarding, options.maxDurationMs);
  if (!enabled(plan)) return;
  if (!config) throw forwardingError('Fastly Native incoming forwarding requires fastly.bodyForwarding limits and maxDurationMs.');
  const effects = plan.effects || [], effect = effects[0];
  const init = effect?.inputs?.find(input => input.name === 'init')?.value;
  const body = field(init, 'body'), method = field(init, 'method'), headers = field(init, 'headers');
  if (effects.length !== 1 || effect.kind !== 'fetch' || effect.grouped
    || effect.result?.mode !== 'return' || effect.result?.valueKind !== 'opaque-response'
    || effect.resource?.kind !== 'literal' || options.bindings?.dynamicBackends
    || body?.name !== 'request.body.forward-marker' || method?.kind !== 'literal' || method.value !== 'POST'
    || init.entries.some(entry => !['method', 'body', 'headers', 'timeoutMs'].includes(entry.key?.value))
    || (headers && (headers.kind !== 'object' || headers.entries.some(entry => entry.key?.kind !== 'literal' || entry.value?.kind !== 'literal' || typeof entry.value.value !== 'string')))) {
    throw forwardingError('Fastly Native forwarding admits one terminal opaque POST fetch with inline req.body(), a static backend, and optional literal headers/timeoutMs; groups, decoding, reuse, and dynamic backends are unsupported.');
  }
  const entries = headers?.entries || [];
  const hop = /^(connection|keep-alive|proxy-connection|transfer-encoding|te|trailer|upgrade|content-length|host|proxy-authenticate|proxy-authorization)$/i;
  if (entries.length > 64 || entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.key.value) + Buffer.byteLength(entry.value.value) + 4, 0) > 16384
    || entries.some(entry => hop.test(entry.key.value) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(entry.key.value) || /[\x00-\x08\x0a-\x1f\x7f]/.test(entry.value.value))) {
    throw forwardingError('Forwarding request headers must fit 64 pairs/16 KiB and exclude hop-by-hop, framing and Host fields.');
  }
  // One marker evaluation owns the incoming body. Reject unused/duplicate markers
  // too: they must not be dispatched later through another continuation.
  let markers = 0;
  function walk(value) { if (!value || typeof value !== 'object') return; if (value.name === 'request.body.forward-marker') markers++; for (const item of Object.values(value)) walk(item); }
  walk(plan);
  if (markers !== 1) throw forwardingError('Fastly Native forwarding requires exactly one incoming body consumer.');
}
function instrument(input, plan, bindings) {
  if (!enabled(plan)) return input;
  let source = input;
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Fastly body-forwarding boundary drift: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  for (const [name, args, result, body] of [
    ['__pulse_fastly_fetch_begin', 'effectIndex: i32, payload: __PulseFastlyValue', 'void', '__fwd_begin(effectIndex, payload);'],
    ['__pulse_fastly_wait_fetch', 'effectIndex: i32', 'i32', 'return __fwd_wait();']
  ]) {
    const line = source.split('\n').find(line => line.startsWith(`function ${name}(`));
    if (!line || !line.endsWith('}')) throw new Error('Fastly forwarding function boundary drift: ' + name);
    replace(line, `function ${name}(${args}): ${result} { ${body} }`);
  }
  // Generic request-budget code must not wait for headers before driving upload.
  const begin = source.indexOf('function __pulse_fastly_resolve_effect(');
  const end = source.indexOf('\n}', begin);
  if (begin < 0 || end < 0) throw new Error('Fastly forwarding effect boundary drift');
  source = source.slice(0, begin) + 'function __pulse_fastly_resolve_effect(effectIndex: i32): i32 { return __fwd_wait(); }' + source.slice(end + 2);
  return source + '\n' + `const __FWD_REQUEST_MAX: i32 = ${bindings.bodyForwarding.requestMaxBytes}\nconst __FWD_RESPONSE_MAX: i32 = ${bindings.bodyForwarding.responseMaxBytes}\n`
    + fs.readFileSync(path.join(__dirname, 'native-body-forwarding.as.ts'), 'utf8');
}
function hooks(plan) {
  if (!enabled(plan)) return [];
  const owner = 'body-forwarding', order = 10;
  return [
    { point: 'request.acquired', owner, order, body: '  __fwd_source = __pulse_fastly_request_body_handle' },
    { point: 'response.error', owner, order, body: '  return __fwd_error_response()' },
    { point: 'result.claim', owner, order, body: `  if (result != __fwd_result || result == 0) return false
  if (__pulse_response_owned()) __fwd_send()
  return true` },
    { point: 'invocation.end', owner, order, body: '  __fwd_cleanup()' }
  ];
}
module.exports = {IMPORTS, enabled, validate, instrument, hooks};
