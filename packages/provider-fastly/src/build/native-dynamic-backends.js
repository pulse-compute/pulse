'use strict';

const fs = require('node:fs');
const path = require('node:path');
const policy = Object.freeze({
  optIn: 'bindings.dynamicBackends', maxRegistrationAttempts: 32,
  identity: 'canonical origin with derived Host/TLS policy; request-local',
  precedence: 'effect backend, configured canonical origin, dynamic registration',
  urls: 'absolute ASCII HTTP/HTTPS DNS; canonical IPv4 over HTTP; ports 1–65535; no credentials, IDNA or IPv6',
  tls: 'platform trust; URL DNS hostname for certificate verification and SNI',
  hostPrerequisite: 'Fastly Dynamic Backends service capability',
  stages: Object.freeze({ invalidUrl: 273, unavailable: 274, registrationFailed: 275, attemptsExhausted: 276 })
});
function active(bindings) { return (Array.isArray(bindings) ? bindings : bindings.backends || []).some(b => b.dynamic === true); }
function originMappings(origins) {
  return Object.fromEntries(Object.entries(origins || {}).filter(([, name]) => typeof name === 'string' && name.trim()).map(([origin, name]) => [origin, name.trim()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
function describe(origins) { return Object.freeze({ ...policy, staticOrigins: Object.freeze(originMappings(origins)) }); }
function runtimeSource(backends, platform, origins) {
  if (!active(backends)) return '';
  const mappings = Object.entries(originMappings(origins));
  return fs.readFileSync(path.join(__dirname, 'native-dynamic-backends.as.ts'), 'utf8') + '\n'
    + `function __pulse_dynamic_static(origin: string): string {\n${mappings.map(([origin, name]) => `  if (origin == ${JSON.stringify(origin)}) return ${JSON.stringify(name.trim())}`).join('\n')}\n  return ""\n}\n`
    + `function __pulse_dynamic_check(index: i32): bool { return ${platform ? '__pulse_fetch_request_check(index) && __pulse_fetch_before_send(index)' : 'true'} }\n`;
}
function instrument(source, bindings, platform, origins) {
  if (!active(bindings)) return source;
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Fastly dynamic backend boundary drift: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  if (platform) {
    replace('__pulse_fastly_start_request(effectIndex, url, method, headers, body, __pulse_fastly_backend(effectIndex))',
      'const backend = __pulse_dynamic_select(effectIndex, url); if (__pulse_fastly_last_error != 0) return; __pulse_fastly_start_request(effectIndex, __pulse_dynamic_url, method, headers, body, backend)');
  } else {
    replace('function host_effect_begin(effectIndex: i32, payload: i32): void {',
      'function host_effect_begin(effectIndex: i32, payload: i32): void { if (__pulse_fastly_last_error != 0) return;');
    replace('  const requestOut = __pulse_fastly_out_i32(); let status = fastly_http_req_new',
      '  const backend = __pulse_dynamic_select(effectIndex, url); if (__pulse_fastly_last_error != 0) return;\n  const requestOut = __pulse_fastly_out_i32(); let status = fastly_http_req_new');
    replace('const urlBytes = __pulse_fastly_utf8(url); status = fastly_http_req_uri_set',
      'const urlBytes = __pulse_fastly_utf8(__pulse_dynamic_url); status = fastly_http_req_uri_set');
    replace('const backend = __pulse_fastly_backend(effectIndex); if (backend.length == 0)', 'if (backend.length == 0)');
  }
  const entry = source.includes('export function pulse_fastly_handle(): void {') ? 'pulse_fastly_handle' : '_start';
  replace(`export function ${entry}(): void {`, 'function __pulse_dynamic_start(): void {');
  return source + '\n' + runtimeSource(bindings, platform, origins) + `\nexport function ${entry}(): void {
  __pulse_dynamic_clear(); __pulse_dynamic_attempts = 0; __pulse_dynamic_status = 0
  __pulse_dynamic_start()
  __pulse_dynamic_clear()
}\n`;
}
module.exports = { active, policy, describe, instrument };
