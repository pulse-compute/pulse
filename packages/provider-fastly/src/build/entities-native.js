'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function loadBuildSupport() {
  try { return require('@pulse-compute/wasm-build-support/assemblyscript-compile'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/build-support/src/assemblyscript-compile.js');
    }
    throw error;
  }
}

const { resolveAsc } = loadBuildSupport();

const FASTLY_ENTITIES_NATIVE_REALIZATION_VERSION = 'pulse.fastly-entities-native-realization.i9.v1';
const FASTLY_ENTITIES_NATIVE_SOURCE_VERSION = 'pulse.fastly-entities-native-source.i9.v1';
const ENTITIES_NATIVE_SOURCE_VERSION = 'pulse.entities-native-source.v1';
const MAX_WASM_BYTES = 1024 * 1024;
const BUFFER_BYTES = 65_536;

const ALLOWED_IMPORTS = new Set([
  'fastly_abi:init',
  'fastly_config_store:get',
  'fastly_config_store:open',
  'fastly_http_body:new',
  'fastly_http_body:read',
  'fastly_http_body:write',
  'fastly_http_req:body_downstream_get',
  'fastly_http_req:method_set',
  'fastly_http_req:new',
  'fastly_http_req:pending_req_wait',
  'fastly_http_req:send_async',
  'fastly_http_req:uri_set',
  'fastly_http_resp:header_append',
  'fastly_http_resp:new',
  'fastly_http_resp:send_downstream',
  'fastly_http_resp:status_set',
  'fastly_log:endpoint_get',
  'fastly_log:write',
  'fastly_secret_store:get',
  'fastly_secret_store:open',
  'fastly_secret_store:plaintext'
]);

class FastlyEntitiesNativeError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'FastlyEntitiesNativeError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, message, detail) {
  throw new FastlyEntitiesNativeError(code, message, detail);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function normalizedBindings(artifact, options) {
  const input = Array.isArray(options.effectBindings) ? options.effectBindings : [];
  if (input.length !== artifact.summary.effects) {
    fail(
      'PULSE_FASTLY_ENTITIES_EFFECT_BINDINGS_INVALID',
      'Fastly Entities Native realization requires one exact binding record per generated effect.',
      { expected: artifact.summary.effects, actual: input.length }
    );
  }
  const seen = new Set();
  const bindings = input.map((entry) => {
    if (!entry || !Number.isInteger(entry.index) || entry.index < 0 || entry.index >= input.length || seen.has(entry.index)) {
      fail('PULSE_FASTLY_ENTITIES_EFFECT_BINDINGS_INVALID', 'Fastly Entities effect indexes must be unique and contiguous.', { entry });
    }
    seen.add(entry.index);
    const kind = String(entry.kind || '');
    if (!['config.get', 'fetch', 'secret.get'].includes(kind)) {
      fail('PULSE_FASTLY_ENTITIES_EFFECT_UNSUPPORTED', `Fastly Entities Native does not realize effect ${JSON.stringify(kind)}.`, {
        index: entry.index,
        kind,
        automaticFallback: false
      });
    }
    const backend = entry.backend == null ? '' : String(entry.backend).trim();
    const origin = entry.origin == null ? '' : String(entry.origin).trim();
    if (kind === 'fetch' && (!backend || !origin)) {
      fail('PULSE_FASTLY_ENTITIES_BACKEND_BINDING_REQUIRED', 'Fastly Entities fetch effects require one static backend and origin.', { index: entry.index });
    }
    return Object.freeze({ index: entry.index, kind, backend, origin });
  }).sort((left, right) => left.index - right.index);
  return Object.freeze(bindings);
}

function validateArtifact(artifact) {
  if (!artifact || artifact.version !== ENTITIES_NATIVE_SOURCE_VERSION || artifact.kind !== 'package-generated-source') {
    fail('PULSE_FASTLY_ENTITIES_SOURCE_INVALID', `Fastly Entities Native requires ${ENTITIES_NATIVE_SOURCE_VERSION}.`);
  }
  if (
    !artifact.policy
    || artifact.policy.javascriptRuntime !== false
    || artifact.policy.javascriptHandlerImports !== false
    || artifact.policy.automaticFallback !== false
    || artifact.policy.requestBodyReads !== 1
  ) {
    fail('PULSE_FASTLY_ENTITIES_SOURCE_POLICY_INVALID', 'Fastly Entities Native requires package-owned source with no JavaScript runtime or fallback.', {
      policy: artifact.policy
    });
  }
  if (!Array.isArray(artifact.imports) || artifact.imports.some((entry) => entry.module !== 'pulse_entities_host')) {
    fail('PULSE_FASTLY_ENTITIES_SOURCE_IMPORT_INVALID', 'Entities package source declares an unexpected provider import.', { imports: artifact.imports });
  }
  if (typeof artifact.source !== 'string' || sha256(artifact.source) !== artifact.sourceSha256) {
    fail('PULSE_FASTLY_ENTITIES_SOURCE_HASH_MISMATCH', 'Entities package source hash does not match its bytes.');
  }
  return artifact;
}

function stripPackageHostImports(source) {
  return String(source)
    .split('\n')
    .filter((line) => !line.startsWith('@external("pulse_entities_host",'))
    .join('\n');
}

function effectSwitch(bindings, field, fallback = '""') {
  const lines = ['  switch (effectIndex) {'];
  for (const binding of bindings) lines.push(`    case ${binding.index}: return ${quote(binding[field])}`);
  lines.push(`    default: return ${fallback}`, '  }');
  return lines.join('\n');
}

function effectKindSwitch(bindings) {
  const kindIds = Object.freeze({ fetch: 1, 'config.get': 2, 'secret.get': 3 });
  const lines = ['  switch (effectIndex) {'];
  for (const binding of bindings) lines.push(`    case ${binding.index}: return ${kindIds[binding.kind]}`);
  lines.push('    default: return 0', '  }');
  return lines.join('\n');
}

function providerRuntimeSource(bindings, options) {
  const configStore = String(options.configStore || '').trim();
  const secretStore = String(options.secretStore || '').trim();
  if (bindings.some((entry) => entry.kind === 'config.get') && !configStore) {
    fail('PULSE_FASTLY_ENTITIES_CONFIG_STORE_REQUIRED', 'Fastly Entities config effects require configStore.');
  }
  if (bindings.some((entry) => entry.kind === 'secret.get') && !secretStore) {
    fail('PULSE_FASTLY_ENTITIES_SECRET_STORE_REQUIRED', 'Fastly Entities secret effects require secretStore.');
  }

  return String.raw`
@external("fastly_abi", "init") declare function fastly_abi_init(version: i64): i32
@external("fastly_http_req", "body_downstream_get") declare function fastly_http_req_body_downstream_get(requestOut: usize, bodyOut: usize): i32
@external("fastly_http_req", "new") declare function fastly_http_req_new(handleOut: usize): i32
@external("fastly_http_req", "method_set") declare function fastly_http_req_method_set(handle: i32, method: usize, methodLength: i32): i32
@external("fastly_http_req", "uri_set") declare function fastly_http_req_uri_set(handle: i32, uri: usize, uriLength: i32): i32
@external("fastly_http_req", "send_async") declare function fastly_http_req_send_async(handle: i32, body: i32, backend: usize, backendLength: i32, pendingOut: usize): i32
@external("fastly_http_req", "pending_req_wait") declare function fastly_http_req_pending_req_wait(handle: i32, responseOut: usize, bodyOut: usize): i32
@external("fastly_http_resp", "new") declare function fastly_http_resp_new(handleOut: usize): i32
@external("fastly_http_resp", "header_append") declare function fastly_http_resp_header_append(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32
@external("fastly_http_resp", "status_set") declare function fastly_http_resp_status_set(handle: i32, status: i32): i32
@external("fastly_http_resp", "send_downstream") declare function fastly_http_resp_send_downstream(handle: i32, body: i32, streaming: i32): i32
@external("fastly_http_body", "new") declare function fastly_http_body_new(handleOut: usize): i32
@external("fastly_http_body", "read") declare function fastly_http_body_read(handle: i32, buffer: usize, bufferLength: i32, readOut: usize): i32
@external("fastly_http_body", "write") declare function fastly_http_body_write(handle: i32, buffer: usize, bufferLength: i32, end: i32, writtenOut: usize): i32
@external("fastly_config_store", "open") declare function fastly_config_store_open(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_config_store", "get") declare function fastly_config_store_get(handle: i32, key: usize, keyLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_secret_store", "open") declare function fastly_secret_store_open(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_secret_store", "get") declare function fastly_secret_store_get(handle: i32, key: usize, keyLength: i32, secretOut: usize): i32
@external("fastly_secret_store", "plaintext") declare function fastly_secret_store_plaintext(secret: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_log", "endpoint_get") declare function fastly_log_endpoint_get(name: usize, nameLength: i32, handleOut: usize): i32
@external("fastly_log", "write") declare function fastly_log_write(handle: i32, message: usize, messageLength: i32, writtenOut: usize): i32

const __PULSE_FASTLY_ENTITIES_ABI: i64 = 1
const __PULSE_FASTLY_ENTITIES_BUFFER: i32 = ${BUFFER_BYTES}
const __PULSE_FASTLY_ENTITIES_EFFECTS: i32 = ${bindings.length}
const __PULSE_FASTLY_OK: i32 = 0
const __PULSE_FASTLY_NONE: i32 = 10
let __pulse_fastly_entities_error: i32 = 0
let __pulse_fastly_entities_results = new Array<string>()
let __pulse_fastly_entities_ready = new Array<i32>()
let __pulse_fastly_entities_ok = new Array<i32>()
let __pulse_fastly_entities_redactions = new Array<string>()
let __pulse_fastly_entities_log_handle: i32 = -1

function __pulse_fastly_entities_out(): StaticArray<i32> { return new StaticArray<i32>(1) }
function __pulse_fastly_entities_out_value(value: StaticArray<i32>): i32 { return load<i32>(changetype<usize>(value)) }
function __pulse_fastly_entities_utf8(value: string): ArrayBuffer { return String.UTF8.encode(value, false) }
function __pulse_fastly_entities_decode(buffer: Uint8Array, length: i32): string { return String.UTF8.decodeUnsafe(buffer.dataStart, length, false) }
function __pulse_fastly_entities_fail(stage: i32): void { if (__pulse_fastly_entities_error == 0) __pulse_fastly_entities_error = stage }
function __pulse_fastly_entities_kind(effectIndex: i32): i32 {
${effectKindSwitch(bindings)}
}
function __pulse_fastly_entities_backend(effectIndex: i32): string {
${effectSwitch(bindings, 'backend')}
}
function __pulse_fastly_entities_origin(effectIndex: i32): string {
${effectSwitch(bindings, 'origin')}
}
function __pulse_fastly_entities_input(payload: string, name: string): string {
  const outerValue = JSON.parse<JSON.Value>(payload)
  if (outerValue.type != JSON.Types.Object) { __pulse_fastly_entities_fail(20); return "" }
  const outer = outerValue.get<JSON.Obj>()
  const inputsValue = outer.get("inputs")
  if (inputsValue === null || inputsValue!.type != JSON.Types.Object) { __pulse_fastly_entities_fail(21); return "" }
  const value = inputsValue!.get<JSON.Obj>().get(name)
  if (value === null || value!.type != JSON.Types.String) { __pulse_fastly_entities_fail(22); return "" }
  return value!.get<string>()
}
function __pulse_fastly_entities_open_config(): i32 {
  const name = __pulse_fastly_entities_utf8(${quote(configStore)})
  const out = __pulse_fastly_entities_out()
  if (fastly_config_store_open(changetype<usize>(name), name.byteLength, changetype<usize>(out)) != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(30); return 0 }
  return __pulse_fastly_entities_out_value(out)
}
function __pulse_fastly_entities_open_secret(): i32 {
  const name = __pulse_fastly_entities_utf8(${quote(secretStore)})
  const out = __pulse_fastly_entities_out()
  if (fastly_secret_store_open(changetype<usize>(name), name.byteLength, changetype<usize>(out)) != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(31); return 0 }
  return __pulse_fastly_entities_out_value(out)
}
function __pulse_fastly_entities_config(key: string): string {
  const store = __pulse_fastly_entities_open_config()
  if (__pulse_fastly_entities_error != 0) return "null"
  const keyBytes = __pulse_fastly_entities_utf8(key)
  const buffer = new Uint8Array(__PULSE_FASTLY_ENTITIES_BUFFER)
  const written = __pulse_fastly_entities_out()
  const status = fastly_config_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, buffer.dataStart, __PULSE_FASTLY_ENTITIES_BUFFER, changetype<usize>(written))
  if (status == __PULSE_FASTLY_NONE) return "null"
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(32); return "null" }
  return JSON.stringify<string>(__pulse_fastly_entities_decode(buffer, __pulse_fastly_entities_out_value(written)))
}
function __pulse_fastly_entities_secret(key: string): string {
  const store = __pulse_fastly_entities_open_secret()
  if (__pulse_fastly_entities_error != 0) return "null"
  const keyBytes = __pulse_fastly_entities_utf8(key)
  const secretOut = __pulse_fastly_entities_out()
  let status = fastly_secret_store_get(store, changetype<usize>(keyBytes), keyBytes.byteLength, changetype<usize>(secretOut))
  if (status == __PULSE_FASTLY_NONE) return "null"
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(33); return "null" }
  const buffer = new Uint8Array(__PULSE_FASTLY_ENTITIES_BUFFER)
  const written = __pulse_fastly_entities_out()
  status = fastly_secret_store_plaintext(__pulse_fastly_entities_out_value(secretOut), buffer.dataStart, __PULSE_FASTLY_ENTITIES_BUFFER, changetype<usize>(written))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(34); return "null" }
  const value = __pulse_fastly_entities_decode(buffer, __pulse_fastly_entities_out_value(written))
  if (value.length > 0) __pulse_fastly_entities_redactions.push(value)
  return JSON.stringify<string>(value)
}
function __pulse_fastly_entities_read_body(handle: i32): string {
  let output = ""
  let total = 0
  while (true) {
    const buffer = new Uint8Array(__PULSE_FASTLY_ENTITIES_BUFFER)
    const read = __pulse_fastly_entities_out()
    if (fastly_http_body_read(handle, buffer.dataStart, __PULSE_FASTLY_ENTITIES_BUFFER, changetype<usize>(read)) != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(40); return "" }
    const count = __pulse_fastly_entities_out_value(read)
    if (count <= 0) return output
    total += count
    if (total > __PULSE_FASTLY_ENTITIES_BUFFER) { __pulse_fastly_entities_fail(41); return "" }
    output += __pulse_fastly_entities_decode(buffer, count)
  }
}
function __pulse_fastly_entities_fetch(effectIndex: i32, url: string): string {
  const origin = __pulse_fastly_entities_origin(effectIndex)
  if (origin.length == 0 || !url.startsWith(origin + "/")) { __pulse_fastly_entities_fail(50); return "null" }
  const requestOut = __pulse_fastly_entities_out()
  let status = fastly_http_req_new(changetype<usize>(requestOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(51); return "null" }
  const request = __pulse_fastly_entities_out_value(requestOut)
  const bodyOut = __pulse_fastly_entities_out()
  status = fastly_http_body_new(changetype<usize>(bodyOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(52); return "null" }
  const method = __pulse_fastly_entities_utf8("GET")
  status = fastly_http_req_method_set(request, changetype<usize>(method), method.byteLength)
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(53); return "null" }
  const uri = __pulse_fastly_entities_utf8(url)
  status = fastly_http_req_uri_set(request, changetype<usize>(uri), uri.byteLength)
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(54); return "null" }
  const backend = __pulse_fastly_entities_utf8(__pulse_fastly_entities_backend(effectIndex))
  const pendingOut = __pulse_fastly_entities_out()
  status = fastly_http_req_send_async(request, __pulse_fastly_entities_out_value(bodyOut), changetype<usize>(backend), backend.byteLength, changetype<usize>(pendingOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(55); return "null" }
  const responseOut = __pulse_fastly_entities_out()
  const responseBodyOut = __pulse_fastly_entities_out()
  status = fastly_http_req_pending_req_wait(__pulse_fastly_entities_out_value(pendingOut), changetype<usize>(responseOut), changetype<usize>(responseBodyOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(56); return "null" }
  return JSON.stringify<string>(__pulse_fastly_entities_read_body(__pulse_fastly_entities_out_value(responseBodyOut)))
}
function __pulse_fastly_entities_replace(input: string, secret: string): string {
  if (secret.length == 0) return input
  let source = input
  let output = ""
  while (true) {
    const index = source.indexOf(secret)
    if (index < 0) return output + source
    output += source.substring(0, index) + "<redacted>"
    source = source.substring(index + secret.length)
  }
}
function __pulse_fastly_entities_redact(input: string): string {
  let output = input
  for (let index = 0; index < __pulse_fastly_entities_redactions.length; index += 1) output = __pulse_fastly_entities_replace(output, unchecked(__pulse_fastly_entities_redactions[index]))
  return output
}
function pulse_entities_host_effect_begin(effectIndex: i32, payloadPointer: i32, payloadLength: i32): void {
  if (effectIndex < 0 || effectIndex >= __PULSE_FASTLY_ENTITIES_EFFECTS || payloadPointer <= 0 || payloadLength < 0) { __pulse_fastly_entities_fail(60); return }
  const payload = changetype<string>(payloadPointer)
  const kind = __pulse_fastly_entities_kind(effectIndex)
  let result = "null"
  if (kind == 1) result = __pulse_fastly_entities_fetch(effectIndex, __pulse_fastly_entities_input(payload, "url"))
  else if (kind == 2) result = __pulse_fastly_entities_config(__pulse_fastly_entities_input(payload, "name"))
  else if (kind == 3) result = __pulse_fastly_entities_secret(__pulse_fastly_entities_input(payload, "name"))
  else __pulse_fastly_entities_fail(61)
  unchecked(__pulse_fastly_entities_results[effectIndex] = result)
  unchecked(__pulse_fastly_entities_ok[effectIndex] = __pulse_fastly_entities_error == 0 ? 1 : 0)
  unchecked(__pulse_fastly_entities_ready[effectIndex] = 1)
}
function pulse_entities_host_log(level: i32, payloadPointer: i32, payloadLength: i32): void {
  if (payloadPointer <= 0 || payloadLength < 0) return
  if (__pulse_fastly_entities_log_handle < 0) {
    const endpoint = __pulse_fastly_entities_utf8("stdout")
    const handleOut = __pulse_fastly_entities_out()
    if (fastly_log_endpoint_get(changetype<usize>(endpoint), endpoint.byteLength, changetype<usize>(handleOut)) != __PULSE_FASTLY_OK) return
    __pulse_fastly_entities_log_handle = __pulse_fastly_entities_out_value(handleOut)
  }
  const message = __pulse_fastly_entities_utf8("[pulse:entities:" + level.toString() + "] " + __pulse_fastly_entities_redact(changetype<string>(payloadPointer)) + "\n")
  const written = __pulse_fastly_entities_out()
  fastly_log_write(__pulse_fastly_entities_log_handle, changetype<usize>(message), message.byteLength, changetype<usize>(written))
}
function __pulse_fastly_entities_write_body(handle: i32, value: string): i32 {
  const bytes = __pulse_fastly_entities_utf8(value)
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = __pulse_fastly_entities_out()
    const status = fastly_http_body_write(handle, changetype<usize>(bytes) + offset, bytes.byteLength - offset, 0, changetype<usize>(written))
    if (status != __PULSE_FASTLY_OK) return status
    const count = __pulse_fastly_entities_out_value(written)
    if (count <= 0) return 1
    offset += count
  }
  return __PULSE_FASTLY_OK
}
function __pulse_fastly_entities_send(statusCode: i32, text: string): void {
  const responseOut = __pulse_fastly_entities_out()
  let status = fastly_http_resp_new(changetype<usize>(responseOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(70); return }
  const response = __pulse_fastly_entities_out_value(responseOut)
  const bodyOut = __pulse_fastly_entities_out()
  status = fastly_http_body_new(changetype<usize>(bodyOut))
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(71); return }
  const body = __pulse_fastly_entities_out_value(bodyOut)
  status = fastly_http_resp_status_set(response, statusCode)
  if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(72); return }
  if (text.length > 0) {
    const name = __pulse_fastly_entities_utf8("content-type")
    const value = __pulse_fastly_entities_utf8("application/json; charset=utf-8")
    status = fastly_http_resp_header_append(response, changetype<usize>(name), name.byteLength, changetype<usize>(value), value.byteLength)
    if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(73); return }
    status = __pulse_fastly_entities_write_body(body, text)
    if (status != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(74); return }
  }
  if (fastly_http_resp_send_downstream(response, body, 0) != __PULSE_FASTLY_OK) __pulse_fastly_entities_fail(75)
}
function __pulse_fastly_entities_provider_failure(): void {
  __pulse_fastly_entities_send(500, "{\"error\":\"Internal Server Error\"}")
}
export function __pulse_fastly_abort(message: string | null, fileName: string | null = null, line: u32 = 0, column: u32 = 0): void { unreachable() }
export function __pulse_fastly_seed(): f64 { return 0.5 }
export function pulse_fastly_entities_last_error(): i32 { return __pulse_fastly_entities_error }
export function _start(): void {
  __pulse_fastly_entities_error = fastly_abi_init(__PULSE_FASTLY_ENTITIES_ABI)
  if (__pulse_fastly_entities_error != __PULSE_FASTLY_OK) { __pulse_fastly_entities_provider_failure(); return }
  __pulse_fastly_entities_results = new Array<string>()
  __pulse_fastly_entities_ready = new Array<i32>()
  __pulse_fastly_entities_ok = new Array<i32>()
  for (let index = 0; index < __PULSE_FASTLY_ENTITIES_EFFECTS; index += 1) {
    __pulse_fastly_entities_results.push("null")
    __pulse_fastly_entities_ready.push(0)
    __pulse_fastly_entities_ok.push(0)
  }
  const handles = new StaticArray<i32>(2)
  if (fastly_http_req_body_downstream_get(changetype<usize>(handles), changetype<usize>(handles) + 4) != __PULSE_FASTLY_OK) { __pulse_fastly_entities_fail(80); __pulse_fastly_entities_provider_failure(); return }
  const requestBody = __pulse_fastly_entities_read_body(load<i32>(changetype<usize>(handles) + 4))
  if (__pulse_fastly_entities_error != 0) { __pulse_fastly_entities_provider_failure(); return }
  if (pulse_entities_set_request(changetype<i32>(requestBody)) != 1) { __pulse_fastly_entities_fail(81); __pulse_fastly_entities_provider_failure(); return }
  let runStatus = pulse_entities_start()
  while (runStatus == pulse_entities_run_suspended() && __pulse_fastly_entities_error == 0) {
    for (let effectIndex = 0; effectIndex < __PULSE_FASTLY_ENTITIES_EFFECTS; effectIndex += 1) {
      if (unchecked(__pulse_fastly_entities_ready[effectIndex]) == 0) continue
      const result = unchecked(__pulse_fastly_entities_results[effectIndex])
      if (pulse_entities_set_effect_result(effectIndex, unchecked(__pulse_fastly_entities_ok[effectIndex]), changetype<i32>(result)) != 1) { __pulse_fastly_entities_fail(82); break }
      unchecked(__pulse_fastly_entities_ready[effectIndex] = 0)
    }
    if (__pulse_fastly_entities_error == 0) runStatus = pulse_entities_resume()
  }
  if (__pulse_fastly_entities_error != 0 || runStatus != pulse_entities_run_complete()) { __pulse_fastly_entities_provider_failure(); return }
  const response = changetype<string>(pulse_entities_response_ptr())
  __pulse_fastly_entities_send(pulse_entities_response_status(), response)
}
`;
}

function generateFastlyEntitiesNativeSource(sourceArtifact, options = {}) {
  const artifact = validateArtifact(sourceArtifact);
  const bindings = normalizedBindings(artifact, options);
  const packageSource = stripPackageHostImports(artifact.source);
  const runtime = providerRuntimeSource(bindings, options);
  const source = [
    '/* Generated Fastly provider adapter for package-owned Entities Native source. */',
    packageSource,
    runtime,
    ''
  ].join('\n');
  return Object.freeze({
    version: FASTLY_ENTITIES_NATIVE_SOURCE_VERSION,
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    packageSourceSha256: artifact.sourceSha256,
    planHash: artifact.planHash,
    effectBindings: bindings,
    policy: Object.freeze({
      semanticOwner: '@pulse-compute/entities',
      providerAuthorities: Object.freeze(['request', 'response-transport', 'effect-execution', 'logging']),
      javascriptRuntime: false,
      automaticFallback: false
    })
  });
}

function inspectWasm(bytes) {
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => Object.freeze({
    module: entry.module,
    name: entry.name,
    kind: entry.kind
  }));
  const unexpected = imports.filter((entry) => !ALLOWED_IMPORTS.has(`${entry.module}:${entry.name}`));
  if (unexpected.length > 0) {
    fail('PULSE_FASTLY_ENTITIES_IMPORT_POLICY_FAILED', 'Fastly Entities Native emitted an unauthorized import.', { imports, unexpected });
  }
  const exports = WebAssembly.Module.exports(module).map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }));
  const required = ['_start', 'memory', 'pulse_entities_start', 'pulse_entities_resume', 'pulse_entities_set_effect_result', 'pulse_fastly_entities_last_error'];
  const missing = required.filter((name) => !exports.some((entry) => entry.name === name));
  if (missing.length > 0) fail('PULSE_FASTLY_ENTITIES_EXPORT_POLICY_FAILED', 'Fastly Entities Native is missing a required export.', { missing, exports });
  return Object.freeze({ imports: Object.freeze(imports), exports: Object.freeze(exports) });
}

function compileFastlyEntitiesNative(sourceArtifact, options = {}) {
  const generated = generateFastlyEntitiesNativeSource(sourceArtifact, options);
  const cwd = path.resolve(options.cwd || process.cwd());
  const compilerFallback = path.resolve(__dirname, '..', '..', '..', '..', 'wasm', 'packages', 'compiler');
  const asc = resolveAsc(cwd) || resolveAsc(compilerFallback);
  if (!asc) fail('PULSE_FASTLY_ENTITIES_ASC_MISSING', 'AssemblyScript compiler dependency was not found.', { cwd, compilerFallback });
  let transform;
  try { transform = require.resolve('json-as', { paths: [compilerFallback, cwd] }); }
  catch (error) {
    fail('PULSE_FASTLY_ENTITIES_JSON_AS_MISSING', 'Fastly Entities Native requires lockfile-pinned json-as 1.5.0.', { cause: error && error.message });
  }
  const jsonAsRoot = path.resolve(transform, '..', '..', '..');
  const jsonAsManifest = JSON.parse(fs.readFileSync(path.join(jsonAsRoot, 'package.json'), 'utf8'));
  if (jsonAsManifest.version !== '1.5.0') {
    fail('PULSE_FASTLY_ENTITIES_JSON_AS_VERSION_INVALID', 'Fastly Entities Native requires json-as 1.5.0 exactly.', {
      expected: '1.5.0',
      actual: jsonAsManifest.version
    });
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-entities-native-'));
  const sourceFile = path.join(staging, 'entities-native-fastly.as.ts');
  const wasmFile = path.join(staging, 'entities-native-fastly.wasm');
  const watFile = path.join(staging, 'entities-native-fastly.wat');
  try {
    fs.writeFileSync(sourceFile, generated.source, 'utf8');
    const args = [
      asc.script,
      path.basename(sourceFile),
      '--outFile', wasmFile,
      '--textFile', watFile,
      '--runtime', 'incremental',
      '--exportRuntime',
      '--noAssert',
      '--optimize',
      '--use', 'abort=entities-native-fastly.as/__pulse_fastly_abort',
      '--use', 'seed=entities-native-fastly.as/__pulse_fastly_seed',
      '--transform', transform,
      '--path', path.join(compilerFallback, 'node_modules'),
      '--path', path.dirname(jsonAsRoot)
    ];
    const startedAt = Date.now();
    const result = spawnSync(asc.executable, args, {
      cwd: staging,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number(options.timeoutMs || 180_000),
      env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0' }
    });
    if (result.error || result.status !== 0 || !fs.existsSync(wasmFile)) {
      fail('PULSE_FASTLY_ENTITIES_ASC_FAILED', 'AssemblyScript failed to compile the Fastly Entities Native realization.', {
        status: result.status,
        signal: result.signal,
        error: result.error && result.error.message,
        stdout: String(result.stdout || '').slice(-24_000),
        stderr: String(result.stderr || '').slice(-24_000)
      });
    }
    const wasm = fs.readFileSync(wasmFile);
    const maxBytes = Number(options.maxWasmBytes || MAX_WASM_BYTES);
    if (wasm.byteLength > maxBytes) {
      fail('PULSE_FASTLY_ENTITIES_WASM_TOO_LARGE', 'Fastly Entities Native exceeds its explicit Wasm ceiling.', {
        bytes: wasm.byteLength,
        maxBytes
      });
    }
    const inspection = inspectWasm(wasm);
    return Object.freeze({
      version: FASTLY_ENTITIES_NATIVE_REALIZATION_VERSION,
      status: 'realized',
      provider: 'fastly',
      target: 'native',
      targetId: 'fastly-compute-native',
      wasm,
      wat: fs.readFileSync(watFile, 'utf8'),
      source: generated.source,
      artifact: Object.freeze({
        bytes: wasm.byteLength,
        sha256: sha256(wasm),
        sourceBytes: generated.sourceBytes,
        sourceSha256: generated.sourceSha256,
        packageSourceSha256: generated.packageSourceSha256,
        planHash: generated.planHash
      }),
      imports: inspection.imports,
      exports: inspection.exports,
      effectBindings: generated.effectBindings,
      compiler: Object.freeze({
        package: 'assemblyscript',
        version: JSON.parse(fs.readFileSync(path.join(asc.packageRoot, 'package.json'), 'utf8')).version,
        jsonAs: jsonAsManifest.version,
        durationMs: Date.now() - startedAt
      }),
      policy: generated.policy
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({
  FASTLY_ENTITIES_NATIVE_REALIZATION_VERSION,
  FASTLY_ENTITIES_NATIVE_SOURCE_VERSION,
  FastlyEntitiesNativeError,
  generateFastlyEntitiesNativeSource,
  compileFastlyEntitiesNative
});
