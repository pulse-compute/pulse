'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Evidence-only compiler option. Not a ctx API, runtime header switch, or logger.
function instrument(input, enabled, plan, duration) {
  if (enabled === undefined || enabled === false) return input;
  if (enabled !== true || !Number.isInteger(duration) || duration < 1 || duration > 30000
      || plan.packages?.application || plan.effects.some(e => ['s3.getBody', 'request.body.forward', 'host.extension', 'fetch', 'grip.hold'].includes(e.kind))) {
    throw new TypeError('Request latency evidence requires a bounded canonical buffered Native application without fetch or terminal handoffs.');
  }
  let source = input;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Request latency boundary drift: ' + before);
    source = source.replace(before, after);
  };
  const wrap = (name, params, result, args, before, after) => {
    const anchor = `function ${name}(${params}): ${result} {`;
    replace(anchor, `function ${name}_latency_inner(${params}): ${result} {`);
    source += `\nfunction ${name}(${params}): ${result} {\n${before}\n${result === 'void' ? '' : 'const result = '}${name}_latency_inner(${args});\n${after}\n${result === 'void' ? '' : 'return result;'}\n}\n`;
  };
  replace('function __pulse_fastly_run_invocation(): void {', 'function __pulse_fastly_run_invocation(): void {\n  __lat_start = __lat_clock();');
  wrap('host_effect_begin', 'effectIndex: i32, payload: i32', 'void', 'effectIndex, payload',
    '__lat_begin(effectIndex); const previous = __lat_current; __lat_current = effectIndex;', '__lat_current = previous;');
  wrap('__pulse_fastly_resolve_effect', 'effectIndex: i32', 'i32', 'effectIndex',
    'const previous = __lat_current; __lat_current = effectIndex;', '__lat_finish(effectIndex); __lat_current = previous;');
  if (plan.effects.some(e => e.kind.startsWith('s3.'))) {
    wrap('__s3_wait_ready', 'index: i32, handle: i32', 'i32', 'index, handle',
      'const start = __lat_clock();', '__lat_add(index, 1, __lat_clock() - start);');
    wrap('__s3_secret', 'store: i32, name: string', 'string | null', 'store, name',
      'const start = __lat_clock();', '__lat_add(__lat_current, 2, __lat_clock() - start);');
    wrap('__pulse_s3_sign', "method: string, path: string, host: string, region: string, id: string, secret: string, token: string, seconds: i64, body: Uint8Array, contentType: string, range: string = '', ifNoneMatch: string = ''", '__PulseS3Signature',
      'method, path, host, region, id, secret, token, seconds, body, contentType, range, ifNoneMatch',
      'const start = __lat_clock();', '__lat_add(__lat_current, 3, __lat_clock() - start);');
    wrap('__s3_read_response', 'index: i32, response: i32, body: i32, status: i32', 'i32', 'index, response, body, status',
      'const start = __lat_clock(), wait = __lat_part(index, 1);',
      '__lat_add(index, 4, __lat_clock() - start - (__lat_part(index, 1) - wait));');
    // Include store opening; secret helper above owns get/plaintext/decoding.
    const declaration = /declare function fastly_secret_store_open\(([^\n]+)\): i32/;
    const match = source.match(declaration);
    if (!match) throw new Error('Request latency secret-store boundary drift');
    source = source.replace(declaration, 'declare function __lat_secret_open_raw($1): i32');
    const names = match[1].split(',').map(x => x.trim().split(':')[0]).join(', ');
    source += `\nfunction fastly_secret_store_open(${match[1]}): i32 { const start = __lat_clock(); const result = __lat_secret_open_raw(${names}); __lat_add(__lat_current, 2, __lat_clock() - start); return result; }\n`;
  }
  if (source.includes('function __kv_ready(')) wrap('__kv_ready', 'index: i32, handle: i32', 'i32', 'index, handle',
    'const start = __lat_clock();', '__lat_add(index, 1, __lat_clock() - start);');
  wrap('__request_wait', 'handle: i32, index: i32', 'bool', 'handle, index',
    'const start = __lat_clock();', '__lat_add(index, 1, __lat_clock() - start);');
  const send = /(@external\("fastly_http_resp", "send_downstream"\) declare function )(\w+)(\(handle: i32, body: i32, streaming: i32\): i32)/;
  const match = source.match(send);
  if (!match) throw new Error('Request latency response boundary drift');
  source = source.replace(send, '$1__lat_send_raw$3');
  source += `\nfunction ${match[2]}(handle: i32, body: i32, streaming: i32): i32 { __lat_emit(handle); return __lat_send_raw(handle, body, streaming); }\n`;
  return source + '\n' + fs.readFileSync(path.join(__dirname, 'request-latency.as.ts'), 'utf8');
}
module.exports = { instrument };
