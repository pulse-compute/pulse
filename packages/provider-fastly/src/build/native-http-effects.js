'use strict';

const crypto = require('node:crypto');
const { nativeStringTrim, needsNativeValueFailureGuard } = require('./native-string-values.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CANONICAL_NATIVE_PLAN_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');

function loadBuildSupport() {
  try { return require('@pulse-compute/wasm-build-support/assemblyscript-compile'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/build-support/src/assemblyscript-compile.js');
    }
    throw error;
  }
}

function loadNativeGenerator() {
  try { return require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../../wasm/packages/runtime-core-as/src/compiler/canonical-native.js');
    }
    throw error;
  }
}

const { resolveAsc } = loadBuildSupport();
const { generateCanonicalNativeAssemblyScript } = loadNativeGenerator();

const FASTLY_NATIVE_HTTP_EFFECTS_VERSION = 'pulse.fastly-native-http-effects.v1';
const FASTLY_NATIVE_HTTP_EFFECTS_GENERATOR_VERSION = 'pulse.fastly-native-http-effects-generator.v1';
const FASTLY_NATIVE_HTTP_EFFECTS_COMPILER_VERSION = 'pulse.fastly-native-http-effects-compiler.v1';
const FASTLY_NATIVE_HTTP_EFFECTS_ABI_VERSION = 1;
const FASTLY_NATIVE_HTTP_EFFECTS_MAX_WASM_BYTES = 1024 * 1024;
const FASTLY_NATIVE_HTTP_EFFECTS_BUFFER_BYTES = 65536;

const FASTLY_NATIVE_HTTP_EFFECTS_IMPORTS = Object.freeze([
  Object.freeze(['fastly_abi', 'init']),
  Object.freeze(['fastly_http_req', 'body_downstream_get']),
  Object.freeze(['fastly_http_req', 'method_get']),
  Object.freeze(['fastly_http_req', 'uri_get']),
  Object.freeze(['fastly_http_req', 'header_value_get']),
  Object.freeze(['fastly_http_req', 'new']),
  Object.freeze(['fastly_http_req', 'method_set']),
  Object.freeze(['fastly_http_req', 'uri_set']),
  Object.freeze(['fastly_http_req', 'header_insert']),
  Object.freeze(['fastly_http_req', 'send_async']),
  Object.freeze(['fastly_http_req', 'pending_req_wait']),
  Object.freeze(['fastly_http_resp', 'new']),
  Object.freeze(['fastly_http_resp', 'header_append']),
  Object.freeze(['fastly_http_resp', 'header_value_get']),
  Object.freeze(['fastly_http_resp', 'status_get']),
  Object.freeze(['fastly_http_resp', 'status_set']),
  Object.freeze(['fastly_http_resp', 'send_downstream']),
  Object.freeze(['fastly_http_body', 'new']),
  Object.freeze(['fastly_http_body', 'read']),
  Object.freeze(['fastly_http_body', 'write'])
]);

const FASTLY_NATIVE_HTTP_EFFECTS_REQUIRED_IMPORTS = Object.freeze([
  Object.freeze(['fastly_abi', 'init']),
  Object.freeze(['fastly_http_req', 'body_downstream_get']),
  Object.freeze(['fastly_http_req', 'new']),
  Object.freeze(['fastly_http_req', 'send_async']),
  Object.freeze(['fastly_http_req', 'pending_req_wait']),
  Object.freeze(['fastly_http_resp', 'send_downstream']),
  Object.freeze(['fastly_http_body', 'new']),
  Object.freeze(['fastly_http_body', 'write'])
]);

const FASTLY_NATIVE_HTTP_EFFECTS_ALLOWED_IMPORTS = new Set([
  ...FASTLY_NATIVE_HTTP_EFFECTS_IMPORTS.map(([moduleName, name]) => `${moduleName}:${name}`)
]);

class FastlyNativeHttpEffectsError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativeHttpEffectsError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) if (value[key] !== undefined) output[key] = stableObject(value[key]);
  return output;
}

function stableStringify(value, space = 0) {
  return JSON.stringify(stableObject(value), null, space);
}

function quote(value) {
  return JSON.stringify(String(value));
}

function fail(message, code, detail = {}) {
  throw new FastlyNativeHttpEffectsError(message, code, detail);
}

function validatePlanBoundary(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('Fastly native HTTP effects realization requires a canonical native plan.');
  if (plan.version !== CANONICAL_NATIVE_PLAN_VERSION) {
    fail(`Fastly native HTTP effects realization requires ${CANONICAL_NATIVE_PLAN_VERSION}.`, 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_PLAN_VERSION_UNSUPPORTED', { version: plan.version });
  }
  if (!plan.ownership || plan.ownership.providerNeutral !== true || plan.ownership.javascriptRuntime !== false) {
    fail('Fastly native HTTP effects realization requires a provider-neutral plan without JavaScript runtime ownership.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_PLAN_OWNERSHIP_INVALID', { ownership: plan.ownership });
  }
  const packageEffects = ((plan.packages && plan.packages.effects) || []);
  if (packageEffects.length > 0) {
    fail('Pass97 does not realize package-owned Fastly effects; config, secret, KV, and GRIP are introduced in Pass98.', 'PULSE_FASTLY_NATIVE_HTTP_PLATFORM_EFFECTS_DEFERRED', { effects: packageEffects.map((entry) => entry.id) });
  }
  const unsupported = (plan.effects || []).filter((effect) => effect.kind !== 'fetch');
  if (unsupported.length > 0) {
    fail('Pass97 realizes only outbound HTTP fetch effects.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECT_KIND_UNSUPPORTED', { effects: unsupported.map((entry) => ({ id: entry.id, kind: entry.kind })) });
  }
  if ((plan.effects || []).length === 0) {
    fail('Pass97 requires at least one outbound HTTP effect.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECT_REQUIRED');
  }
  if (!plan.entry || !Array.isArray(plan.entry.body)) {
    fail('Fastly native HTTP effects realization requires a canonical handler entry body.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_ENTRY_INVALID');
  }
  return plan;
}

function literalOriginFromExpression(expression) {
  if (!expression || typeof expression !== 'object') return undefined;
  if (expression.kind === 'literal' && typeof expression.value === 'string') {
    try { return new URL(expression.value).origin; }
    catch (_) { return undefined; }
  }
  if (expression.kind === 'template') {
    const first = (expression.parts || [])[0];
    if (first && first.kind === 'text') {
      try { return new URL(first.value).origin; }
      catch (_) { return undefined; }
    }
  }
  return undefined;
}

function resolveBackendBindings(plan, options = {}) {
  const byEffect = options.effectBackends || {};
  const byOrigin = options.backends || {};
  const bindings = [];
  for (const [index, effect] of (plan.effects || []).entries()) {
    const urlInput = (effect.inputs || []).find((entry) => entry.name === 'url');
    const origin = effect.resource && effect.resource.origin
      ? String(effect.resource.origin)
      : literalOriginFromExpression(urlInput && urlInput.value);
    const backend = byEffect[effect.id]
      || (origin && byOrigin[origin])
      || (effect.resource && effect.resource.value && byOrigin[effect.resource.value]);
    if (typeof backend !== 'string' || backend.trim() === '') {
      fail(`Fastly native effect ${effect.id} has no static backend binding.`, 'PULSE_FASTLY_NATIVE_HTTP_BACKEND_MISSING', {
        effectId: effect.id,
        effectIndex: index,
        origin,
        hint: `Provide options.effectBackends[${JSON.stringify(effect.id)}] or options.backends[${JSON.stringify(origin || '<origin>')}].`
      });
    }
    bindings.push(Object.freeze({ index, effectId: effect.id, origin: origin || null, backend: backend.trim() }));
  }
  return Object.freeze(bindings);
}

function stripPulseHostImports(source) {
  return String(source)
    .split('\n')
    .filter((line) => !line.startsWith('@external("pulse_host",'))
    .join('\n');
}

function generateSchemaRuntime(plan) {
  const registry = plan.schemas && plan.schemas.registry ? plan.schemas.registry : { schemas: [], maxBytes: FASTLY_NATIVE_HTTP_EFFECTS_BUFFER_BYTES, contentTypePolicy: 'accept-json-or-missing' };
  const schemas = registry.schemas || [];
  const nodeLines = [];
  let nodeIndex = 0;

  function emitNode(schemaIndex, node) {
    const currentIndex = nodeIndex++;
    const functionName = `__pulse_fastly_schema_${schemaIndex}_${currentIndex}`;
    const child = node.kind === 'nullable'
      ? emitNode(schemaIndex, node.value)
      : node.kind === 'array'
        ? emitNode(schemaIndex, node.element)
        : undefined;
    const fields = node.kind === 'object'
      ? node.fields.map((field) => Object.freeze({ field, apply: emitNode(schemaIndex, field.value) }))
      : [];
    const body = [`function ${functionName}(valueHandle: i32): i32 {`, '  const input = __pulse_fastly_value(valueHandle)'];
    if (node.kind === 'nullable') {
      body.push('  if (input.kind == PULSE_VALUE_NULL) return valueHandle');
      body.push(`  return ${child}(valueHandle)`);
    } else if (node.kind === 'array') {
      body.push('  if (input.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  const output = host_value_array()');
      body.push('  for (let index = 0; index < input.values.length; index += 1) {');
      body.push(`    const item = ${child}(unchecked(input.values[index]))`);
      body.push('    if (item <= 0) return 0');
      body.push('    host_value_array_push(output, item)');
      body.push('  }');
      body.push('  return output');
    } else if (node.kind === 'object') {
      body.push('  if (input.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 50, -1); return 0 }');
      body.push('  const output = host_value_object()');
      fields.forEach(({ field, apply }, fieldIndex) => {
        body.push(`  const key_${currentIndex}_${fieldIndex} = __pulse_fastly_string_value(${quote(field.name)})`);
        body.push(`  const field_${currentIndex}_${fieldIndex} = host_value_property(valueHandle, key_${currentIndex}_${fieldIndex})`);
        body.push(`  if (__pulse_fastly_value(field_${currentIndex}_${fieldIndex}).kind == PULSE_VALUE_UNDEFINED) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 51, -1); return 0 }`);
        body.push(`  const projected_${currentIndex}_${fieldIndex} = ${apply}(field_${currentIndex}_${fieldIndex})`);
        body.push(`  if (projected_${currentIndex}_${fieldIndex} <= 0) return 0`);
        body.push(`  host_value_object_set(output, key_${currentIndex}_${fieldIndex}, projected_${currentIndex}_${fieldIndex})`);
      });
      body.push('  return output');
    } else if (node.kind === 'string') {
      body.push('  if (input.kind != PULSE_VALUE_STRING) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'boolean') {
      body.push('  if (input.kind != PULSE_VALUE_BOOLEAN) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'i32') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number) || input.number < -2147483648.0 || input.number > 2147483647.0 || Math.floor(input.number) != input.number) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'u32') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number) || input.number < 0.0 || input.number > 4294967295.0 || Math.floor(input.number) != input.number) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'f64') {
      body.push('  if (input.kind != PULSE_VALUE_NUMBER || !isFinite(input.number)) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 53, -1); return 0 }');
      body.push('  return valueHandle');
    } else if (node.kind === 'string-enum') {
      const allowed = node.values.map((value) => `input.text == ${quote(value)}`).join(' || ') || 'false';
      body.push(`  if (input.kind != PULSE_VALUE_STRING || !(${allowed})) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 54, -1); return 0 }`);
      body.push('  return valueHandle');
    } else {
      throw new TypeError(`Unsupported Fastly native schema node ${String(node.kind)}.`);
    }
    body.push('}', '');
    nodeLines.push(...body);
    return functionName;
  }

  const roots = schemas.map((schema, schemaIndex) => emitNode(schemaIndex, schema.root));
  const lines = [
    `const __PULSE_SCHEMA_MAX_BYTES: i32 = ${Number(registry.maxBytes || FASTLY_NATIVE_HTTP_EFFECTS_BUFFER_BYTES)}`,
    `const __PULSE_SCHEMA_REQUIRE_JSON: bool = ${registry.contentTypePolicy === 'require-json' ? 'true' : 'false'}`,
    '',
    ...nodeLines,
    'function __pulse_fastly_schema_apply(schemaId: string, valueHandle: i32, encode: bool): i32 {',
    '  if (schemaId.length == 0) return valueHandle'
  ];
  for (const [schemaIndex, schema] of schemas.entries()) {
    lines.push(`${schemaIndex === 0 ? '  if' : '  else if'} (schemaId == ${quote(schema.id)}) {`);
    lines.push(`    const projected = ${roots[schemaIndex]}(valueHandle)`);
    lines.push('    if (projected <= 0) return 0');
    lines.push('    const input = __pulse_fastly_json(projected, 0)');
    lines.push(`    const normalized = encode ? __pulse_schema_encode_${schemaIndex}(input) : __pulse_schema_decode_${schemaIndex}(input)`);
    lines.push('    return __pulse_fastly_parse_json(normalized)');
    lines.push('  }');
  }
  lines.push('  __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1)');
  lines.push('  return 0');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function effectResultSource(plan, bindings) {
  const lines = ['function __pulse_fastly_backend(effectIndex: i32): string {', '  switch (effectIndex) {'];
  for (const binding of bindings) lines.push(`    case ${binding.index}: return ${quote(binding.backend)}`);
  lines.push('    default: return ""', '  }', '}', '');
  lines.push('function __pulse_fastly_resolve_effect(effectIndex: i32): i32 {');
  lines.push('  const response = __pulse_fastly_wait_fetch(effectIndex)');
  lines.push('  if (response <= 0) return 0');
  lines.push('  switch (effectIndex) {');
  for (const [index, effect] of (plan.effects || []).entries()) {
    const result = effect.result || {};
    const decoder = result.decoder;
    lines.push(`    case ${index}: {`);
    if (result.valueKind === 'json' || (decoder && decoder.kind === 'json' && result.valueKind !== 'fetch-response')) {
      const args = (decoder && decoder.arguments) || [];
      const schemaId = args.length === 1 && args[0].kind === 'literal' && typeof args[0].value === 'string' ? args[0].value : '';
      lines.push(`      return host_fetch_json(response, ${schemaId ? `__pulse_fastly_string_value(${quote(schemaId)})` : 'host_value_undefined()'})`);
    } else if (result.valueKind === 'text' || (decoder && decoder.kind === 'text')) {
      lines.push('      return host_fetch_text(response)');
    } else {
      lines.push('      return response');
    }
    lines.push('    }');
  }
  lines.push('    default: __pulse_fastly_fail(PULSE_ERROR_STATE, 61, effectIndex); return 0');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function fastlyRuntimeSource(plan, bindings) {
  const effectCount = (plan.effects || []).length;
  return String.raw`
@external("fastly_abi", "init") declare function fastly_abi_init(version: i64): i32
@external("fastly_http_req", "body_downstream_get") declare function fastly_http_req_body_downstream_get(requestOut: usize, bodyOut: usize): i32
@external("fastly_http_req", "method_get") declare function fastly_http_req_method_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "uri_get") declare function fastly_http_req_uri_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "header_value_get") declare function fastly_http_req_header_value_get(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_http_req", "new") declare function fastly_http_req_new(handleOut: usize): i32
@external("fastly_http_req", "method_set") declare function fastly_http_req_method_set(handle: i32, method: usize, methodLength: i32): i32
@external("fastly_http_req", "uri_set") declare function fastly_http_req_uri_set(handle: i32, uri: usize, uriLength: i32): i32
@external("fastly_http_req", "header_insert") declare function fastly_http_req_header_insert(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32
@external("fastly_http_req", "send_async") declare function fastly_http_req_send_async(handle: i32, body: i32, backend: usize, backendLength: i32, pendingOut: usize): i32
@external("fastly_http_req", "pending_req_wait") declare function fastly_http_req_pending_req_wait(handle: i32, responseOut: usize, bodyOut: usize): i32
@external("fastly_http_resp", "new") declare function fastly_http_resp_new(handleOut: usize): i32
@external("fastly_http_resp", "header_append") declare function fastly_http_resp_header_append(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32
@external("fastly_http_resp", "header_value_get") declare function fastly_http_resp_header_value_get(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32
@external("fastly_http_resp", "status_get") declare function fastly_http_resp_status_get(handle: i32, statusOut: usize): i32
@external("fastly_http_resp", "status_set") declare function fastly_http_resp_status_set(handle: i32, status: i32): i32
@external("fastly_http_resp", "send_downstream") declare function fastly_http_resp_send_downstream(handle: i32, body: i32, streaming: i32): i32
@external("fastly_http_body", "new") declare function fastly_http_body_new(handleOut: usize): i32
@external("fastly_http_body", "read") declare function fastly_http_body_read(handle: i32, buffer: usize, bufferLength: i32, readOut: usize): i32
@external("fastly_http_body", "write") declare function fastly_http_body_write(handle: i32, buffer: usize, bufferLength: i32, end: i32, writtenOut: usize): i32

const PULSE_FASTLY_EFFECTS_ABI_VERSION: i64 = ${FASTLY_NATIVE_HTTP_EFFECTS_ABI_VERSION}
const PULSE_FASTLY_BUFFER_BYTES: i32 = ${FASTLY_NATIVE_HTTP_EFFECTS_BUFFER_BYTES}
const PULSE_FASTLY_EFFECT_COUNT: i32 = ${effectCount}
const FASTLY_STATUS_OK: i32 = 0
const FASTLY_STATUS_BUFLEN: i32 = 4
const FASTLY_STATUS_NONE: i32 = 10
const PULSE_VALUE_UNDEFINED: i32 = 0
const PULSE_VALUE_NULL: i32 = 1
const PULSE_VALUE_BOOLEAN: i32 = 2
const PULSE_VALUE_NUMBER: i32 = 3
const PULSE_VALUE_STRING: i32 = 4
const PULSE_VALUE_ARRAY: i32 = 5
const PULSE_VALUE_OBJECT: i32 = 6
const PULSE_VALUE_FETCH: i32 = 7
const PULSE_VALUE_RESPONSE: i32 = 8
const PULSE_ERROR_NONE: i32 = 0
const PULSE_ERROR_VALUE: i32 = 1001
const PULSE_ERROR_UNSUPPORTED: i32 = 1002
const PULSE_ERROR_HOSTCALL: i32 = 1003
const PULSE_ERROR_JSON: i32 = 1004
const PULSE_ERROR_SCHEMA: i32 = 1005
const PULSE_ERROR_TRANSPORT: i32 = 1006
const PULSE_ERROR_STATE: i32 = 1007

class __PulseFastlyValue {
  immutable: bool = false
  kind: i32 = PULSE_VALUE_UNDEFINED
  boolean: i32 = 0
  number: f64 = 0.0
  text: string = ""
  keys: Array<string> = new Array<string>()
  values: Array<i32> = new Array<i32>()
  responseHandle: i32 = 0
  bodyHandle: i32 = 0
  bodyLoaded: i32 = 0
  status: i32 = 200
  headers: Array<__PulseFastlyHeader> = new Array<__PulseFastlyHeader>()
}
class __PulseFastlyHeader {
  constructor(public name: string, public value: string) {}
}
class __PulseJsonParser {
  source: string
  index: i32 = 0
  failed: bool = false
  constructor(source: string) { this.source = source }
  skip(): void { while (this.index < this.source.length) { const c = this.source.charCodeAt(this.index); if (c != 32 && c != 9 && c != 10 && c != 13) return; this.index += 1 } }
  parse(): i32 { this.skip(); const value = this.value(0); this.skip(); if (this.index != this.source.length) this.failed = true; return this.failed ? 0 : value }
  value(depth: i32): i32 {
    this.skip(); if (this.index >= this.source.length || depth > 64) { this.failed = true; return 0 }
    const c = this.source.charCodeAt(this.index)
    if (c == 34) return __pulse_fastly_string_value(this.string())
    if (c == 123) return this.object(depth + 1)
    if (c == 91) return this.array(depth + 1)
    if (this.source.substr(this.index, 4) == "true") { this.index += 4; return host_value_boolean(1) }
    if (this.source.substr(this.index, 5) == "false") { this.index += 5; return host_value_boolean(0) }
    if (this.source.substr(this.index, 4) == "null") { this.index += 4; return host_value_null() }
    if (c == 45 || (c >= 48 && c <= 57)) return this.numberValue()
    this.failed = true; return 0
  }
  string(): string {
    let output = ""; this.index += 1
    while (this.index < this.source.length) {
      let c = this.source.charCodeAt(this.index); this.index += 1
      if (c == 34) return output
      if (c == 92) {
        if (this.index >= this.source.length) { this.failed = true; return "" }
        c = this.source.charCodeAt(this.index); this.index += 1
        if (c == 34 || c == 92 || c == 47) output += String.fromCharCode(c)
        else if (c == 98) output += String.fromCharCode(8)
        else if (c == 102) output += String.fromCharCode(12)
        else if (c == 110) output += "\n"
        else if (c == 114) output += "\r"
        else if (c == 116) output += "\t"
        else if (c == 117) {
          if (this.index + 4 > this.source.length) { this.failed = true; return "" }
          let code = 0
          for (let digitIndex = 0; digitIndex < 4; digitIndex += 1) {
            const digitCode = this.source.charCodeAt(this.index + digitIndex)
            let digit = -1
            if (digitCode >= 48 && digitCode <= 57) digit = digitCode - 48
            else if (digitCode >= 65 && digitCode <= 70) digit = digitCode - 55
            else if (digitCode >= 97 && digitCode <= 102) digit = digitCode - 87
            if (digit < 0) { this.failed = true; return "" }
            code = (code << 4) | digit
          }
          this.index += 4; output += String.fromCharCode(code)
        } else { this.failed = true; return "" }
      } else if (c < 32) { this.failed = true; return "" }
      else output += String.fromCharCode(c)
    }
    this.failed = true; return ""
  }
  numberValue(): i32 {
    const start = this.index
    if (this.source.charCodeAt(this.index) == 45) { this.index += 1; if (this.index >= this.source.length) { this.failed = true; return 0 } }
    let c = this.source.charCodeAt(this.index)
    if (c == 48) {
      this.index += 1
      if (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c >= 48 && c <= 57) { this.failed = true; return 0 } }
    } else if (c >= 49 && c <= 57) {
      this.index += 1
      while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
    } else { this.failed = true; return 0 }
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 46) {
      this.index += 1
      if (this.index >= this.source.length) { this.failed = true; return 0 }
      c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) { this.failed = true; return 0 }
      while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
    }
    if (this.index < this.source.length) {
      c = this.source.charCodeAt(this.index)
      if (c == 69 || c == 101) {
        this.index += 1
        if (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c == 43 || c == 45) this.index += 1 }
        if (this.index >= this.source.length) { this.failed = true; return 0 }
        c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) { this.failed = true; return 0 }
        while (this.index < this.source.length) { c = this.source.charCodeAt(this.index); if (c < 48 || c > 57) break; this.index += 1 }
      }
    }
    return host_value_number(F64.parseFloat(this.source.substring(start, this.index)))
  }
  array(depth: i32): i32 {
    const output = host_value_array(); this.index += 1; this.skip()
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 93) { this.index += 1; return output }
    while (!this.failed) {
      host_value_array_push(output, this.value(depth)); this.skip()
      if (this.index >= this.source.length) { this.failed = true; break }
      const c = this.source.charCodeAt(this.index); this.index += 1
      if (c == 93) break
      if (c != 44) { this.failed = true; break }
    }
    return output
  }
  object(depth: i32): i32 {
    const output = host_value_object(); this.index += 1; this.skip()
    if (this.index < this.source.length && this.source.charCodeAt(this.index) == 125) { this.index += 1; return output }
    while (!this.failed) {
      this.skip(); if (this.index >= this.source.length || this.source.charCodeAt(this.index) != 34) { this.failed = true; break }
      const key = this.string(); this.skip()
      if (this.index >= this.source.length || this.source.charCodeAt(this.index) != 58) { this.failed = true; break }
      this.index += 1; host_value_object_set(output, __pulse_fastly_string_value(key), this.value(depth)); this.skip()
      if (this.index >= this.source.length) { this.failed = true; break }
      const c = this.source.charCodeAt(this.index); this.index += 1
      if (c == 125) break
      if (c != 44) { this.failed = true; break }
    }
    return output
  }
}

const __pulse_fastly_values = new Array<__PulseFastlyValue>()
const __pulse_fastly_pending = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_fastly_pending_active = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_fastly_payloads = new StaticArray<i32>(PULSE_FASTLY_EFFECT_COUNT)
let __pulse_fastly_request_handle: i32 = 0
let __pulse_fastly_request_body_handle: i32 = 0
let __pulse_fastly_request_method: string = ""
let __pulse_fastly_request_url: string = ""
let __pulse_fastly_request_path: string = ""
let __pulse_fastly_request_body: string = ""
let __pulse_fastly_request_body_loaded: i32 = 0
let __pulse_fastly_last_error: i32 = 0
let __pulse_fastly_error_stage: i32 = 0
let __pulse_fastly_error_effect: i32 = -1

function __pulse_fastly_fail(code: i32, stage: i32, effectIndex: i32): void { if (__pulse_fastly_last_error == 0) { __pulse_fastly_last_error = code; __pulse_fastly_error_stage = stage; __pulse_fastly_error_effect = effectIndex } }
function __pulse_fastly_out_i32(): StaticArray<i32> { return new StaticArray<i32>(1) }
function __pulse_fastly_out_value(out: StaticArray<i32>): i32 { return load<i32>(changetype<usize>(out)) }
function __pulse_fastly_utf8(value: string): ArrayBuffer { return String.UTF8.encode(value, false) }
function __pulse_fastly_decode(buffer: Uint8Array, length: i32): string { return String.UTF8.decodeUnsafe(buffer.dataStart, length, false) }
function __pulse_fastly_put(value: __PulseFastlyValue): i32 { __pulse_fastly_values.push(value); return __pulse_fastly_values.length }
function __pulse_fastly_value(handle: i32): __PulseFastlyValue { if (handle <= 0 || handle > __pulse_fastly_values.length) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 1, -1); return new __PulseFastlyValue() } return unchecked(__pulse_fastly_values[handle - 1]) }
function __pulse_fastly_string_value(value: string): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_STRING; item.text = value; return __pulse_fastly_put(item) }
function __pulse_fastly_find(object: __PulseFastlyValue, key: string): i32 { for (let i = 0; i < object.keys.length; i += 1) if (unchecked(object.keys[i]) == key) return i; return -1 }
function __pulse_fastly_number_string(value: f64): string { if (value >= -9007199254740991.0 && value <= 9007199254740991.0 && Math.floor(value) == value) return i64(value).toString(); return value.toString() }
function __pulse_fastly_string(handle: i32): string { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_STRING) return value.text; if (value.kind == PULSE_VALUE_NUMBER) return __pulse_fastly_number_string(value.number); if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean != 0 ? "true" : "false"; if (value.kind == PULSE_VALUE_NULL) return "null"; if (value.kind == PULSE_VALUE_UNDEFINED) return "undefined"; return __pulse_fastly_json(handle, 0) }
function __pulse_fastly_number(handle: i32): f64 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_NUMBER) return value.number; if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean != 0 ? 1.0 : 0.0; if (value.kind == PULSE_VALUE_STRING) return F64.parseFloat(value.text); return 0.0 }
function __pulse_fastly_hex(value: i32): string { return String.fromCharCode(value < 10 ? 48 + value : 87 + value) }
function __pulse_fastly_is_unpaired(value: string, i: i32): bool {
  const c = value.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) return i + 1 >= value.length || value.charCodeAt(i + 1) < 0xdc00 || value.charCodeAt(i + 1) > 0xdfff;
  if (c >= 0xdc00 && c <= 0xdfff) return i == 0 || value.charCodeAt(i - 1) < 0xd800 || value.charCodeAt(i - 1) > 0xdbff;
  return false;
}
function __pulse_fastly_quote(value: string): string {
  // Count once and write UTF-16 units once. Repeated concatenation can allocate
  // gigabytes for a valid bounded string when every byte needs JSON escaping.
  let size = 2;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    size += c == 34 || c == 92 || c == 8 || c == 9 || c == 10 || c == 12 || c == 13 ? 2 : (c < 32 || __pulse_fastly_is_unpaired(value, i)) ? 6 : 1;
  }
  const out = new Uint16Array(size); let cursor = 0; out[cursor++] = 34;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c == 34 || c == 92) { out[cursor++] = 92; out[cursor++] = u16(c); }
    else if (c == 8 || c == 9 || c == 10 || c == 12 || c == 13) {
      out[cursor++] = 92; out[cursor++] = c == 8 ? 98 : c == 9 ? 116 : c == 10 ? 110 : c == 12 ? 102 : 114;
    } else if (c < 32 || __pulse_fastly_is_unpaired(value, i)) {
      out[cursor++] = 92; out[cursor++] = 117;
      out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 12) & 15)); out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 8) & 15));
      out[cursor++] = u16('0123456789abcdef'.charCodeAt((c >> 4) & 15)); out[cursor++] = u16('0123456789abcdef'.charCodeAt(c & 15));
    } else out[cursor++] = u16(c);
  }
  out[cursor] = 34;
  return String.UTF16.decodeUnsafe(out.dataStart, out.byteLength);
}
function __pulse_fastly_json(handle: i32, depth: i32): string {
  if (depth > 64) { __pulse_fastly_fail(PULSE_ERROR_JSON, 2, -1); return "null" }
  const value = __pulse_fastly_value(handle)
  if (value.kind == PULSE_VALUE_UNDEFINED || value.kind == PULSE_VALUE_NULL) return "null"
  if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean != 0 ? "true" : "false"
  if (value.kind == PULSE_VALUE_NUMBER) return __pulse_fastly_number_string(value.number)
  if (value.kind == PULSE_VALUE_STRING) return __pulse_fastly_quote(value.text)
  if (value.kind == PULSE_VALUE_ARRAY) { let out = "["; for (let i = 0; i < value.values.length; i += 1) { if (i > 0) out += ","; out += __pulse_fastly_json(unchecked(value.values[i]), depth + 1) } return out + "]" }
  if (value.kind == PULSE_VALUE_OBJECT) { let out = "{"; for (let i = 0; i < value.keys.length; i += 1) { if (i > 0) out += ","; out += __pulse_fastly_quote(unchecked(value.keys[i])) + ":" + __pulse_fastly_json(unchecked(value.values[i]), depth + 1) } return out + "}" }
  return "null"
}
${nativeStringTrim}
function __pulse_fastly_deep_freeze(handle: i32): void { const value = __pulse_fastly_value(handle); if (value.immutable) return; value.immutable = true; if (value.kind == PULSE_VALUE_ARRAY || value.kind == PULSE_VALUE_OBJECT) for (let index = 0; index < value.values.length; index += 1) __pulse_fastly_deep_freeze(unchecked(value.values[index])) }
function __pulse_fastly_parse_json(text: string): i32 { const parser = new __PulseJsonParser(text); const value = parser.parse(); if (parser.failed || value <= 0) { __pulse_fastly_fail(PULSE_ERROR_JSON, 3, -1); return 0 } return value }
function __pulse_fastly_path(uri: string): string { let start = 0; const scheme = uri.indexOf("://"); if (scheme >= 0) { const slash = uri.indexOf("/", scheme + 3); start = slash >= 0 ? slash : uri.length } let end = uri.length; const query = uri.indexOf("?", start); if (query >= 0 && query < end) end = query; const fragment = uri.indexOf("#", start); if (fragment >= 0 && fragment < end) end = fragment; return start >= end ? "/" : uri.substring(start, end) }
function __pulse_fastly_read_req_string(kind: i32): string { const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = kind == 0 ? fastly_http_req_method_get(__pulse_fastly_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)) : fastly_http_req_uri_get(__pulse_fastly_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 10 + kind, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_read_body(handle: i32, effectIndex: i32): string { let out = ""; let total = 0; while (true) { const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const read = __pulse_fastly_out_i32(); const status = fastly_http_body_read(handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(read)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 20, effectIndex); return "" } const count = __pulse_fastly_out_value(read); if (count <= 0) return out; total += count; if (total > __PULSE_SCHEMA_MAX_BYTES && __PULSE_SCHEMA_MAX_BYTES > 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 21, effectIndex); return "" } out += __pulse_fastly_decode(buffer, count) } }
function __pulse_fastly_request_header_text(name: string): string { const nameBytes = __pulse_fastly_utf8(name); const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = fastly_http_req_header_value_get(__pulse_fastly_request_handle, changetype<usize>(nameBytes), nameBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status == FASTLY_STATUS_NONE) return ""; if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 22, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_fetch_header_text(responseHandle: i32, name: string): string { const nameBytes = __pulse_fastly_utf8(name); const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES); const written = __pulse_fastly_out_i32(); const status = fastly_http_resp_header_value_get(responseHandle, changetype<usize>(nameBytes), nameBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written)); if (status == FASTLY_STATUS_NONE) return ""; if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 23, -1); return "" } return __pulse_fastly_decode(buffer, __pulse_fastly_out_value(written)) }
function __pulse_fastly_fetch_body(value: __PulseFastlyValue): string { if (value.bodyLoaded == 0) { value.text = __pulse_fastly_read_body(value.bodyHandle, -1); value.bodyLoaded = 1 } return value.text }

function host_value_undefined(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_UNDEFINED; return __pulse_fastly_put(item) }
function host_value_null(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_NULL; return __pulse_fastly_put(item) }
function host_value_boolean(value: i32): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_BOOLEAN; item.boolean = value != 0 ? 1 : 0; return __pulse_fastly_put(item) }
function host_value_number(value: f64): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_NUMBER; item.number = value; return __pulse_fastly_put(item) }
function host_value_string(pointer: i32, length: i32): i32 { return __pulse_fastly_string_value(changetype<string>(pointer)) }
function host_value_array(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_ARRAY; return __pulse_fastly_put(item) }
function host_value_array_push(target: i32, value: i32): void { const item = __pulse_fastly_value(target); if (item.kind != PULSE_VALUE_ARRAY || item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 30, -1); return } item.values.push(value) }
function host_value_array_spread(target: i32, source: i32): void { const from = __pulse_fastly_value(source); if (from.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 31, -1); return } for (let i = 0; i < from.values.length; i += 1) host_value_array_push(target, unchecked(from.values[i])) }
function host_value_object(): i32 { const item = new __PulseFastlyValue(); item.kind = PULSE_VALUE_OBJECT; return __pulse_fastly_put(item) }
function host_value_object_set(target: i32, keyHandle: i32, value: i32): void { const item = __pulse_fastly_value(target); if (item.kind != PULSE_VALUE_OBJECT || item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 32, -1); return } const key = __pulse_fastly_string(keyHandle); const index = __pulse_fastly_find(item, key); if (index >= 0) unchecked(item.values[index] = value); else { item.keys.push(key); item.values.push(value) } }
function host_value_object_spread(target: i32, source: i32): void { const from = __pulse_fastly_value(source); if (from.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 33, -1); return } for (let i = 0; i < from.keys.length; i += 1) host_value_object_set(target, __pulse_fastly_string_value(unchecked(from.keys[i])), unchecked(from.values[i])) }
function host_value_property(target: i32, keyHandle: i32): i32 { const item = __pulse_fastly_value(target); const key = __pulse_fastly_string(keyHandle); if (item.kind == PULSE_VALUE_OBJECT) { const index = __pulse_fastly_find(item, key); return index >= 0 ? unchecked(item.values[index]) : host_value_undefined() } if (item.kind == PULSE_VALUE_FETCH && key == "status") { const out = __pulse_fastly_out_i32(); const status = fastly_http_resp_status_get(item.responseHandle, changetype<usize>(out)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 34, -1); return 0 } return host_value_number(__pulse_fastly_out_value(out)) } if ((item.kind == PULSE_VALUE_STRING || item.kind == PULSE_VALUE_ARRAY) && key == "length") return host_value_number(item.kind == PULSE_VALUE_STRING ? item.text.length : item.values.length); return host_value_undefined() }
function host_value_property_set(target: i32, key: i32, value: i32): i32 { host_value_object_set(target, key, value); return value }
function host_value_element(target: i32, keyHandle: i32): i32 { const item = __pulse_fastly_value(target); if (item.kind == PULSE_VALUE_ARRAY) { const index = i32(__pulse_fastly_number(keyHandle)); return index >= 0 && index < item.values.length ? unchecked(item.values[index]) : host_value_undefined() } return host_value_property(target, keyHandle) }
function host_value_element_set(target: i32, keyHandle: i32, value: i32): i32 { const item = __pulse_fastly_value(target); if (item.immutable) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 35, -1); return 0 } if (item.kind == PULSE_VALUE_ARRAY) { const index = i32(__pulse_fastly_number(keyHandle)); if (index < 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 35, -1); return 0 } while (item.values.length <= index) item.values.push(host_value_undefined()); unchecked(item.values[index] = value); return value } return host_value_property_set(target, keyHandle, value) }
function host_value_truthy(handle: i32): i32 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_UNDEFINED || value.kind == PULSE_VALUE_NULL) return 0; if (value.kind == PULSE_VALUE_BOOLEAN) return value.boolean; if (value.kind == PULSE_VALUE_NUMBER) return value.number != 0.0 && !isNaN(value.number) ? 1 : 0; if (value.kind == PULSE_VALUE_STRING) return value.text.length > 0 ? 1 : 0; return 1 }
function host_value_nullish(handle: i32): i32 { const kind = __pulse_fastly_value(handle).kind; return kind == PULSE_VALUE_UNDEFINED || kind == PULSE_VALUE_NULL ? 1 : 0 }
function host_value_binary(operator: i32, leftHandle: i32, rightHandle: i32): i32 { const left = __pulse_fastly_value(leftHandle); const right = __pulse_fastly_value(rightHandle); if (operator == 0 || operator == 2) { let equal = false; if (left.kind == right.kind) { if (left.kind == PULSE_VALUE_UNDEFINED || left.kind == PULSE_VALUE_NULL) equal = true; else if (left.kind == PULSE_VALUE_BOOLEAN) equal = left.boolean == right.boolean; else if (left.kind == PULSE_VALUE_NUMBER) equal = left.number == right.number; else if (left.kind == PULSE_VALUE_STRING) equal = left.text == right.text; else equal = leftHandle == rightHandle } return host_value_boolean(equal ? 1 : 0) } if (operator == 1 || operator == 3) { const result = host_value_binary(operator == 1 ? 0 : 2, leftHandle, rightHandle); return host_value_boolean(host_value_truthy(result) == 0 ? 1 : 0) } if (operator == 8) { if (left.kind == PULSE_VALUE_STRING || right.kind == PULSE_VALUE_STRING) return __pulse_fastly_string_value(__pulse_fastly_string(leftHandle) + __pulse_fastly_string(rightHandle)); return host_value_number(__pulse_fastly_number(leftHandle) + __pulse_fastly_number(rightHandle)) } if (operator == 4) return host_value_boolean(__pulse_fastly_number(leftHandle) < __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 5) return host_value_boolean(__pulse_fastly_number(leftHandle) <= __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 6) return host_value_boolean(__pulse_fastly_number(leftHandle) > __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 7) return host_value_boolean(__pulse_fastly_number(leftHandle) >= __pulse_fastly_number(rightHandle) ? 1 : 0); if (operator == 9) return host_value_number(__pulse_fastly_number(leftHandle) - __pulse_fastly_number(rightHandle)); if (operator == 10) return host_value_number(__pulse_fastly_number(leftHandle) * __pulse_fastly_number(rightHandle)); if (operator == 11) return host_value_number(__pulse_fastly_number(leftHandle) / __pulse_fastly_number(rightHandle)); if (operator == 14) return host_value_truthy(leftHandle) != 0 ? rightHandle : leftHandle; if (operator == 15) return host_value_truthy(leftHandle) != 0 ? leftHandle : rightHandle; if (operator == 16) return host_value_nullish(leftHandle) == 0 ? leftHandle : rightHandle; __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 36, -1); return 0 }
function host_value_unary(operator: i32, handle: i32): i32 { if (operator == 0) return host_value_boolean(host_value_truthy(handle) == 0 ? 1 : 0); if (operator == 1) return host_value_number(__pulse_fastly_number(handle)); if (operator == 2) return host_value_number(-__pulse_fastly_number(handle)); if (operator == 5) return host_value_undefined(); __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 37, -1); return 0 }

function host_request_method(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_method) }
function host_request_url(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_url) }
function __pulse_router_segments(value: string): Array<string> { let start = 0; let end = value.length; while (start < end && value.charCodeAt(start) == 47) start += 1; while (end > start && value.charCodeAt(end - 1) == 47) end -= 1; if (start >= end) return new Array<string>(); return value.substring(start, end).split("/") }
function __pulse_router_match_text(path: string, pattern: string): bool { const actual = __pulse_router_segments(path); const expected = __pulse_router_segments(pattern); const wildcard = expected.length > 0 && unchecked(expected[expected.length - 1]) == "*"; if ((!wildcard && actual.length != expected.length) || (wildcard && actual.length < expected.length - 1)) return false; const limit = wildcard ? expected.length - 1 : expected.length; for (let i = 0; i < limit; i += 1) { const part = unchecked(expected[i]); if (part.length > 0 && part.charCodeAt(0) == 58) { if (unchecked(actual[i]).length == 0) return false } else if (unchecked(actual[i]) != part) return false } return true }
function __pulse_router_param_text(path: string, pattern: string, name: string): string | null { const actual = __pulse_router_segments(path); const expected = __pulse_router_segments(pattern); const target = ":" + name; for (let i = 0; i < expected.length; i += 1) if (unchecked(expected[i]) == target) return unchecked(actual[i]); return null }
function host_router_match(path: i32, pattern: i32): i32 { return host_value_boolean(__pulse_router_match_text(__pulse_fastly_string(path), __pulse_fastly_string(pattern)) ? 1 : 0) }
function host_router_param(path: i32, pattern: i32, name: i32): i32 { const value = __pulse_router_param_text(__pulse_fastly_string(path), __pulse_fastly_string(pattern), __pulse_fastly_string(name)); return value === null ? host_value_undefined() : __pulse_fastly_string_value(value) }
function host_request_path(): i32 { return __pulse_fastly_string_value(__pulse_fastly_request_path) }
function host_request_headers(): i32 { return host_value_object() }
function host_request_header(name: i32): i32 { const value = __pulse_fastly_request_header_text(__pulse_fastly_string(name)); return value.length == 0 ? host_value_undefined() : __pulse_fastly_string_value(value) }
function host_request_text(): i32 { if (__pulse_fastly_request_body_loaded == 0) { __pulse_fastly_request_body = __pulse_fastly_read_body(__pulse_fastly_request_body_handle, -1); __pulse_fastly_request_body_loaded = 1 } return __pulse_fastly_string_value(__pulse_fastly_request_body) }
function host_request_json(schema: i32): i32 { const parsed = __pulse_fastly_parse_json(__pulse_fastly_string(host_request_text())); if (parsed <= 0) return 0; const schemaValue = __pulse_fastly_value(schema); return schemaValue.kind == PULSE_VALUE_STRING ? __pulse_fastly_schema_apply(schemaValue.text, parsed, false) : parsed }
function __pulse_fastly_headers_from_options(options: __PulseFastlyValue, output: __PulseFastlyValue): void { const index = __pulse_fastly_find(options, "headers"); if (index < 0) return; const headers = __pulse_fastly_value(unchecked(options.values[index])); if (headers.kind == PULSE_VALUE_OBJECT) { for (let i = 0; i < headers.keys.length; i += 1) { const name = unchecked(headers.keys[i]); const value = __pulse_fastly_value(unchecked(headers.values[i])); if (value.kind == PULSE_VALUE_ARRAY) { for (let j = 0; j < value.values.length; j += 1) output.headers.push(new __PulseFastlyHeader(name, __pulse_fastly_string(unchecked(value.values[j])))) } else output.headers.push(new __PulseFastlyHeader(name, __pulse_fastly_string(unchecked(headers.values[i])))) } return } if (headers.kind == PULSE_VALUE_ARRAY) { for (let i = 0; i < headers.values.length; i += 1) { const pair = __pulse_fastly_value(unchecked(headers.values[i])); if (pair.kind != PULSE_VALUE_ARRAY || pair.values.length < 2) continue; output.headers.push(new __PulseFastlyHeader(__pulse_fastly_string(unchecked(pair.values[0])), __pulse_fastly_string(unchecked(pair.values[1])))) } } }
function __pulse_fastly_response(value: i32, optionsHandle: i32, json: bool): i32 { const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const options = __pulse_fastly_value(optionsHandle); let bodyValue = value; if (options.kind == PULSE_VALUE_OBJECT) { const statusIndex = __pulse_fastly_find(options, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(options.values[statusIndex]))); const schemaIndex = __pulse_fastly_find(options, "schema"); if (json && schemaIndex >= 0) { bodyValue = __pulse_fastly_schema_apply(__pulse_fastly_string(unchecked(options.values[schemaIndex])), value, true); if (bodyValue <= 0) return 0 } __pulse_fastly_headers_from_options(options, output) } output.text = json ? __pulse_fastly_json(bodyValue, 0) : __pulse_fastly_string(value); let hasContentType = false; for (let i = 0; i < output.headers.length; i += 1) if (unchecked(output.headers[i]).name.toLowerCase() == "content-type") hasContentType = true; if (!hasContentType) output.headers.push(new __PulseFastlyHeader("content-type", json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")); return __pulse_fastly_put(output) }
function host_response_json(value: i32, options: i32): i32 { return __pulse_fastly_response(value, options, true) }
function host_schema_decode(text: i32, schema: i32): i32 {
  const id = __pulse_fastly_value(schema)
  if (id.kind != PULSE_VALUE_STRING || id.text.length == 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1); return 0 }
  const input = __pulse_fastly_value(text)
  if (input.kind != PULSE_VALUE_STRING) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 52, -1); return 0 }
  if (String.UTF8.byteLength(input.text) > __PULSE_SCHEMA_MAX_BYTES) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 21, -1); return 0 }
  const parsed = __pulse_fastly_parse_json(input.text)
  if (parsed <= 0) return 0
  const decoded = __pulse_fastly_schema_apply(id.text, parsed, false)
  if (decoded <= 0) return 0
  __pulse_fastly_deep_freeze(decoded)
  return decoded
}
function host_schema_encode(value: i32, schema: i32): i32 {
  const id = __pulse_fastly_value(schema)
  if (id.kind != PULSE_VALUE_STRING || id.text.length == 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 55, -1); return 0 }
  const projected = __pulse_fastly_schema_apply(id.text, value, true)
  if (projected <= 0) return 0
  const text = __pulse_fastly_json(projected, 0)
  if (String.UTF8.byteLength(text) > __PULSE_SCHEMA_MAX_BYTES) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 21, -1); return 0 }
  return __pulse_fastly_string_value(text)
}
function host_response_text(value: i32, options: i32): i32 { return __pulse_fastly_response(value, options, false) }
function host_response_custom(specHandle: i32): i32 { const spec = __pulse_fastly_value(specHandle); if (spec.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 40, -1); return 0 } const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const statusIndex = __pulse_fastly_find(spec, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(spec.values[statusIndex]))); const bodyIndex = __pulse_fastly_find(spec, "body"); if (bodyIndex >= 0) output.text = __pulse_fastly_string(unchecked(spec.values[bodyIndex])); __pulse_fastly_headers_from_options(spec, output); return __pulse_fastly_put(output) }
function __pulse_fastly_grip_frame_channels(options: __PulseFastlyValue, output: __PulseFastlyValue): bool { const channelsIndex = __pulse_fastly_find(options, "channels"); const channelIndex = __pulse_fastly_find(options, "channel"); let count = 0; if (channelsIndex >= 0) { const channels = __pulse_fastly_value(unchecked(options.values[channelsIndex])); if (channels.kind != PULSE_VALUE_ARRAY) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 133, -1); return false } for (let i = 0; i < channels.values.length; i += 1) { const channel = __pulse_fastly_string(unchecked(channels.values[i])).trim(); if (channel.length == 0 || channel.indexOf(",") >= 0 || channel.indexOf("\r") >= 0 || channel.indexOf("\n") >= 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 134, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Channel", channel)); count += 1 } } else if (channelIndex >= 0) { const channel = __pulse_fastly_string(unchecked(options.values[channelIndex])).trim(); if (channel.length == 0 || channel.indexOf(",") >= 0 || channel.indexOf("\r") >= 0 || channel.indexOf("\n") >= 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 134, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Channel", channel)); count = 1 } if (count == 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 135, -1); return false } return true }
function __pulse_fastly_grip_frame(options: __PulseFastlyValue, output: __PulseFastlyValue): bool { for (let i = output.headers.length - 1; i >= 0; i -= 1) { const name = unchecked(output.headers[i]).name.toLowerCase(); if (name == "grip-hold" || name == "grip-channel" || name == "grip-timeout") output.headers.splice(i, 1) } const modeIndex = __pulse_fastly_find(options, "mode"); const mode = modeIndex < 0 ? "stream" : __pulse_fastly_string(unchecked(options.values[modeIndex])); if (mode != "stream" && mode != "response") { __pulse_fastly_fail(PULSE_ERROR_VALUE, 136, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Hold", mode)); if (!__pulse_fastly_grip_frame_channels(options, output)) return false; const timeoutIndex = __pulse_fastly_find(options, "timeoutMs"); if (timeoutIndex >= 0) { const timeout = __pulse_fastly_number(unchecked(options.values[timeoutIndex])); if (timeout < 0.0 || Math.floor(timeout) != timeout) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 137, -1); return false } output.headers.push(new __PulseFastlyHeader("Grip-Timeout", i64(timeout).toString())) } return true }
function host_grip_is_websocket(): i32 { const contentType = __pulse_fastly_request_header_text("content-type").toLowerCase(); const accept = __pulse_fastly_request_header_text("accept").toLowerCase(); const upgrade = __pulse_fastly_request_header_text("upgrade").toLowerCase(); const connection = __pulse_fastly_request_header_text("connection").toLowerCase(); let connectionUpgrade = false; const tokens = connection.split(","); for (let i = 0; i < tokens.length; i += 1) if (unchecked(tokens[i]).trim() == "upgrade") connectionUpgrade = true; return host_value_boolean(contentType.indexOf("application/websocket-events") >= 0 || accept.indexOf("application/websocket-events") >= 0 || (upgrade == "websocket" && connectionUpgrade) ? 1 : 0) }
function host_grip_subscribe(responseHandle: i32, optionsHandle: i32): i32 { const output = __pulse_fastly_value(responseHandle); const options = __pulse_fastly_value(optionsHandle); if (output.kind != PULSE_VALUE_RESPONSE || options.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 138, -1); return 0 } return __pulse_fastly_grip_frame(options, output) ? responseHandle : 0 }
function host_grip_handoff(optionsHandle: i32): i32 { const options = __pulse_fastly_value(optionsHandle); if (options.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 139, -1); return 0 } const output = new __PulseFastlyValue(); output.kind = PULSE_VALUE_RESPONSE; output.status = 200; const statusIndex = __pulse_fastly_find(options, "status"); if (statusIndex >= 0) output.status = i32(__pulse_fastly_number(unchecked(options.values[statusIndex]))); const bodyIndex = __pulse_fastly_find(options, "body"); if (bodyIndex >= 0) output.text = __pulse_fastly_string(unchecked(options.values[bodyIndex])); __pulse_fastly_headers_from_options(options, output); let hasContentType = false; for (let i = 0; i < output.headers.length; i += 1) if (unchecked(output.headers[i]).name.toLowerCase() == "content-type") hasContentType = true; if (!hasContentType) output.headers.push(new __PulseFastlyHeader("Content-Type", "application/websocket-events")); return __pulse_fastly_grip_frame(options, output) ? __pulse_fastly_put(output) : 0 }
function host_kv_namespace(name: i32): i32 { __pulse_fastly_fail(PULSE_ERROR_UNSUPPORTED, 41, -1); return 0 }
function host_fetch_text(responseHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 42, -1); return 0 } return __pulse_fastly_string_value(__pulse_fastly_fetch_body(response)) }
function host_fetch_json(responseHandle: i32, schemaHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 43, -1); return 0 } if (__PULSE_SCHEMA_REQUIRE_JSON) { const contentType = __pulse_fastly_fetch_header_text(response.responseHandle, "content-type"); if (contentType.length == 0 || contentType.toLowerCase().indexOf("json") < 0) { __pulse_fastly_fail(PULSE_ERROR_SCHEMA, 44, -1); return 0 } } const parsed = __pulse_fastly_parse_json(__pulse_fastly_fetch_body(response)); if (parsed <= 0) return 0; const schema = __pulse_fastly_value(schemaHandle); return schema.kind == PULSE_VALUE_STRING ? __pulse_fastly_schema_apply(schema.text, parsed, false) : parsed }
function host_fetch_header(responseHandle: i32, nameHandle: i32): i32 { const response = __pulse_fastly_value(responseHandle); if (response.kind != PULSE_VALUE_FETCH) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 45, -1); return 0 } const value = __pulse_fastly_fetch_header_text(response.responseHandle, __pulse_fastly_string(nameHandle)); return value.length == 0 ? host_value_undefined() : __pulse_fastly_string_value(value) }
function host_effect_begin(effectIndex: i32, payload: i32): void { ${needsNativeValueFailureGuard(plan) ? 'if (__pulse_fastly_last_error != PULSE_ERROR_NONE) return; ' : ''}if (effectIndex < 0 || effectIndex >= PULSE_FASTLY_EFFECT_COUNT || unchecked(__pulse_fastly_pending_active[effectIndex]) != 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 46, effectIndex); return } const payloadValue = __pulse_fastly_value(payload); if (payloadValue.kind != PULSE_VALUE_OBJECT) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 47, effectIndex); return } const urlIndex = __pulse_fastly_find(payloadValue, "url"); if (urlIndex < 0) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 48, effectIndex); return } const url = __pulse_fastly_string(unchecked(payloadValue.values[urlIndex])); const initIndex = __pulse_fastly_find(payloadValue, "init"); const init = initIndex >= 0 ? __pulse_fastly_value(unchecked(payloadValue.values[initIndex])) : new __PulseFastlyValue(); let method = "GET"; let body = ""; let headers = new __PulseFastlyValue(); headers.kind = PULSE_VALUE_OBJECT; if (init.kind == PULSE_VALUE_OBJECT) { const methodIndex = __pulse_fastly_find(init, "method"); if (methodIndex >= 0) method = __pulse_fastly_string(unchecked(init.values[methodIndex])).toUpperCase(); const headersIndex = __pulse_fastly_find(init, "headers"); if (headersIndex >= 0) headers = __pulse_fastly_value(unchecked(init.values[headersIndex])); const bodyIndex = __pulse_fastly_find(init, "body"); if (bodyIndex >= 0) { const bodyValue = unchecked(init.values[bodyIndex]); const bodyObject = __pulse_fastly_value(bodyValue); body = bodyObject.kind == PULSE_VALUE_STRING ? bodyObject.text : __pulse_fastly_json(bodyValue, 0) } }
  const requestOut = __pulse_fastly_out_i32(); let status = fastly_http_req_new(changetype<usize>(requestOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 70, effectIndex); return } const requestHandle = __pulse_fastly_out_value(requestOut)
  const bodyOut = __pulse_fastly_out_i32(); status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71, effectIndex); return } const bodyHandle = __pulse_fastly_out_value(bodyOut)
  const methodBytes = __pulse_fastly_utf8(method); status = fastly_http_req_method_set(requestHandle, changetype<usize>(methodBytes), methodBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 72, effectIndex); return }
  const urlBytes = __pulse_fastly_utf8(url); status = fastly_http_req_uri_set(requestHandle, changetype<usize>(urlBytes), urlBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 73, effectIndex); return }
  if (headers.kind == PULSE_VALUE_OBJECT) { for (let i = 0; i < headers.keys.length; i += 1) { const nameBytes = __pulse_fastly_utf8(unchecked(headers.keys[i])); const valueBytes = __pulse_fastly_utf8(__pulse_fastly_string(unchecked(headers.values[i]))); status = fastly_http_req_header_insert(requestHandle, changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(valueBytes), valueBytes.byteLength); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 74, effectIndex); return } } }
  if (body.length > 0) { status = __pulse_fastly_write_body(bodyHandle, body); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 75, effectIndex); return } }
  const backend = __pulse_fastly_backend(effectIndex); if (backend.length == 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 76, effectIndex); return } const backendBytes = __pulse_fastly_utf8(backend); const pendingOut = __pulse_fastly_out_i32(); status = fastly_http_req_send_async(requestHandle, bodyHandle, changetype<usize>(backendBytes), backendBytes.byteLength, changetype<usize>(pendingOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 77, effectIndex); return } unchecked(__pulse_fastly_pending[effectIndex] = __pulse_fastly_out_value(pendingOut)); unchecked(__pulse_fastly_pending_active[effectIndex] = 1); unchecked(__pulse_fastly_payloads[effectIndex] = payload)
}
function __pulse_fastly_wait_fetch(effectIndex: i32): i32 { if (unchecked(__pulse_fastly_pending_active[effectIndex]) == 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 80, effectIndex); return 0 } const pending = unchecked(__pulse_fastly_pending[effectIndex]); const responseOut = __pulse_fastly_out_i32(); const bodyOut = __pulse_fastly_out_i32(); const status = fastly_http_req_pending_req_wait(pending, changetype<usize>(responseOut), changetype<usize>(bodyOut)); unchecked(__pulse_fastly_pending_active[effectIndex] = 0); unchecked(__pulse_fastly_pending[effectIndex] = 0); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_TRANSPORT, 81, effectIndex); return 0 } const value = new __PulseFastlyValue(); value.kind = PULSE_VALUE_FETCH; value.responseHandle = __pulse_fastly_out_value(responseOut); value.bodyHandle = __pulse_fastly_out_value(bodyOut); return __pulse_fastly_put(value) }
function __pulse_fastly_write_body(bodyHandle: i32, value: string): i32 { const bytes = __pulse_fastly_utf8(value); let offset = 0; while (offset < bytes.byteLength) { const written = __pulse_fastly_out_i32(); const status = fastly_http_body_write(bodyHandle, changetype<usize>(bytes) + offset, bytes.byteLength - offset, 0, changetype<usize>(written)); if (status != FASTLY_STATUS_OK) return status; const count = __pulse_fastly_out_value(written); if (count <= 0) return 1; offset += count } return FASTLY_STATUS_OK }
function __pulse_fastly_send_result(handle: i32): i32 { const value = __pulse_fastly_value(handle); if (value.kind == PULSE_VALUE_FETCH) return fastly_http_resp_send_downstream(value.responseHandle, value.bodyHandle, 0); if (value.kind != PULSE_VALUE_RESPONSE) { __pulse_fastly_fail(PULSE_ERROR_VALUE, 90, -1); return PULSE_ERROR_VALUE } const responseOut = __pulse_fastly_out_i32(); let status = fastly_http_resp_new(changetype<usize>(responseOut)); if (status != FASTLY_STATUS_OK) return status; const responseHandle = __pulse_fastly_out_value(responseOut); const bodyOut = __pulse_fastly_out_i32(); status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) return status; const bodyHandle = __pulse_fastly_out_value(bodyOut); status = fastly_http_resp_status_set(responseHandle, value.status); if (status != FASTLY_STATUS_OK) return status; for (let i = 0; i < value.headers.length; i += 1) { const header = unchecked(value.headers[i]); const nameBytes = __pulse_fastly_utf8(header.name); const valueBytes = __pulse_fastly_utf8(header.value); status = fastly_http_resp_header_append(responseHandle, changetype<usize>(nameBytes), nameBytes.byteLength, changetype<usize>(valueBytes), valueBytes.byteLength); if (status != FASTLY_STATUS_OK) return status } status = __pulse_fastly_write_body(bodyHandle, value.text); if (status != FASTLY_STATUS_OK) return status; return fastly_http_resp_send_downstream(responseHandle, bodyHandle, 0) }

${generateSchemaRuntime(plan)}
${effectResultSource(plan, bindings)}
`;
}

function driverSource(plan) {
  return String.raw`
export function pulse_fastly_last_error(): i32 { return __pulse_fastly_last_error }
export function pulse_fastly_error_stage(): i32 { return __pulse_fastly_error_stage }
export function pulse_fastly_error_effect(): i32 { return __pulse_fastly_error_effect }
export function _start(): void {
  __pulse_fastly_last_error = fastly_abi_init(PULSE_FASTLY_EFFECTS_ABI_VERSION)
  if (__pulse_fastly_last_error != FASTLY_STATUS_OK) return
  const handles = new StaticArray<i32>(2)
  const downstreamStatus = fastly_http_req_body_downstream_get(changetype<usize>(handles), changetype<usize>(handles) + 4)
  if (downstreamStatus != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 100, -1); return }
  __pulse_fastly_request_handle = load<i32>(changetype<usize>(handles))
  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)
  __pulse_fastly_request_method = __pulse_fastly_read_req_string(0)
  if (__pulse_fastly_last_error != 0) return
  __pulse_fastly_request_url = __pulse_fastly_read_req_string(1)
  if (__pulse_fastly_last_error != 0) return
  __pulse_fastly_request_path = __pulse_fastly_path(__pulse_fastly_request_url)
  let runStatus = pulse_start()
  while (runStatus == 1 && __pulse_fastly_last_error == 0) {
    for (let effectIndex = 0; effectIndex < PULSE_FASTLY_EFFECT_COUNT; effectIndex += 1) {
      if (unchecked(__pulse_fastly_pending_active[effectIndex]) == 0) continue
      const result = __pulse_fastly_resolve_effect(effectIndex)
      if (result <= 0 || __pulse_fastly_last_error != 0) return
      if (pulse_set_effect_result(effectIndex, result) != 1) { __pulse_fastly_fail(PULSE_ERROR_STATE, 101, effectIndex); return }
    }
    runStatus = pulse_resume()
  }
  if (runStatus != 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 102, -1); return }
  const result = pulse_result_handle()
  if (result <= 0) { __pulse_fastly_fail(PULSE_ERROR_STATE, 103, -1); return }
  const sendStatus = __pulse_fastly_send_result(result)
  if (sendStatus != FASTLY_STATUS_OK) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 104, -1)
}
`;
}

function generateFastlyNativeHttpEffectsAssemblyScript(plan, options = {}) {
  validatePlanBoundary(plan);
  const bindings = resolveBackendBindings(plan, options);
  const portable = generateCanonicalNativeAssemblyScript(plan, options);
  const portableSource = stripPulseHostImports(portable.source);
  const source = [
    '/* Generated by Pulse Pass97 Fastly native HTTP effects compiler. */',
    'export function __pulse_fastly_abort(message: string | null, fileName: string | null = null, line: u32 = 0, column: u32 = 0): void { unreachable() }',
    '',
    fastlyRuntimeSource(plan, bindings),
    portableSource,
    driverSource(plan),
    ''
  ].join('\n');
  const manifest = Object.freeze({
    version: FASTLY_NATIVE_HTTP_EFFECTS_VERSION,
    generatorVersion: FASTLY_NATIVE_HTTP_EFFECTS_GENERATOR_VERSION,
    abiVersion: FASTLY_NATIVE_HTTP_EFFECTS_ABI_VERSION,
    planVersion: plan.version,
    planHash: plan.planHash,
    sourceHash: sha256(source),
    portableGeneratorVersion: portable.version,
    portableSourceHash: portable.sourceHash,
    schemaCodecs: portable.manifest.schemaCodecs,
    effectCount: (plan.effects || []).length,
    continuationCount: (plan.continuations || []).length,
    groupedContinuationCount: (plan.continuations || []).filter((entry) => (entry.effectIds || []).length > 1).length,
    backends: bindings,
    allowedImports: FASTLY_NATIVE_HTTP_EFFECTS_IMPORTS,
    requiredExports: Object.freeze([
      '_start',
      'pulse_fastly_last_error',
      'pulse_fastly_error_stage',
      'pulse_fastly_error_effect',
      'pulse_plan_hash_ptr',
      'pulse_plan_hash_length'
    ]),
    policy: Object.freeze({
      nativeFastly: true,
      provider: 'fastly',
      providerNeutralInput: true,
      javascriptRuntime: false,
      jsComputeRuntime: false,
      wasi: false,
      effects: 'fetch-only',
      continuations: true,
      groupedEffects: 'all send_async calls begin before pending_req_wait',
      schemas: 'fetch JSON decode and structured response encode',
      opaqueResponse: 'origin response/body handles pass through without guest body materialization',
      transportErrors: 'nonzero Fastly pending_req_wait status fails execution; HTTP status remains response data',
      platformCapabilities: false
    })
  });
  return Object.freeze({
    version: FASTLY_NATIVE_HTTP_EFFECTS_GENERATOR_VERSION,
    source,
    sourceHash: manifest.sourceHash,
    manifest,
    bindings,
    portable
  });
}

function inspectFastlyNativeHttpEffectsWasm(input) {
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(bytes)) fail('Generated Fastly native HTTP effects module is not valid WebAssembly.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_WASM_INVALID');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind }));
  const exports = WebAssembly.Module.exports(module).map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }));
  const unexpected = imports.filter((entry) => !FASTLY_NATIVE_HTTP_EFFECTS_ALLOWED_IMPORTS.has(`${entry.module}:${entry.name}`));
  if (unexpected.length > 0) fail('Generated Fastly native HTTP effects module imports functions outside the Pass97 ABI.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_IMPORT_UNSUPPORTED', { unexpected, imports });
  const forbidden = imports.filter((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`));
  if (forbidden.length > 0) fail('Generated Fastly native HTTP effects module imports a forbidden runtime.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_RUNTIME_FORBIDDEN', { forbidden });
  const imported = new Set(imports.map((entry) => `${entry.module}:${entry.name}`));
  const missingImports = FASTLY_NATIVE_HTTP_EFFECTS_REQUIRED_IMPORTS.map(([moduleName, name]) => `${moduleName}:${name}`).filter((key) => !imported.has(key));
  if (missingImports.length > 0) fail('Generated Fastly native HTTP effects module is missing required host imports.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_IMPORT_MISSING', { missingImports, imports });
  const exportNames = new Set(exports.map((entry) => entry.name));
  const requiredExports = ['_start', 'memory', 'pulse_fastly_last_error', 'pulse_fastly_error_stage', 'pulse_fastly_error_effect', 'pulse_start', 'pulse_resume', 'pulse_set_effect_result', 'pulse_result_handle'];
  const missingExports = requiredExports.filter((name) => !exportNames.has(name));
  if (missingExports.length > 0) fail('Generated Fastly native HTTP effects module is missing required exports.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_EXPORT_MISSING', { missingExports, exports });
  if (bytes.length > FASTLY_NATIVE_HTTP_EFFECTS_MAX_WASM_BYTES) fail('Generated Fastly native HTTP effects module exceeds the Pass97 size ceiling.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_WASM_TOO_LARGE', { bytes: bytes.length, maxBytes: FASTLY_NATIVE_HTTP_EFFECTS_MAX_WASM_BYTES });
  return Object.freeze({
    valid: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
    magic: bytes.subarray(0, 8).toString('hex'),
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    importModules: Object.freeze([...new Set(imports.map((entry) => entry.module))].sort())
  });
}

function compileFastlyNativeHttpEffectsPlan(plan, options = {}) {
  const generated = generateFastlyNativeHttpEffectsAssemblyScript(plan, options);
  const cwd = path.resolve(options.cwd || process.cwd());
  const compilerFallback = path.resolve(__dirname, '..', '..', '..', '..', 'wasm', 'packages', 'compiler');
  const asc = resolveAsc(cwd) || resolveAsc(compilerFallback);
  if (!asc) fail('AssemblyScript compiler dependency was not found for Fastly native HTTP effects realization.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_ASC_MISSING', { cwd, compilerFallback });
  const schemaCodecsActive = generated.manifest.schemaCodecs && generated.manifest.schemaCodecs.active === true;
  let jsonAs;
  if (schemaCodecsActive) {
    let transform;
    try {
      transform = require.resolve('json-as', { paths: [compilerFallback, cwd] });
    } catch (error) {
      fail(
        'The lockfile-pinned json-as transform was not found for Fastly Native HTTP effects schema codec compilation.',
        'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_JSON_AS_MISSING',
        { cwd, package: 'json-as', version: '1.5.0', cause: error && error.message }
      );
    }
    const packageRoot = path.resolve(transform, '..', '..', '..');
    const dependencyRoot = path.dirname(packageRoot);
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== '1.5.0') {
      fail(
        'Fastly Native HTTP effects schema codec compilation requires json-as 1.5.0 exactly.',
        'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_JSON_AS_VERSION_INVALID',
        { expected: '1.5.0', actual: packageJson.version, packageRoot }
      );
    }
    jsonAs = Object.freeze({ transform, dependencyRoot, version: packageJson.version });
  }
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-native-effects-'));
  const requestedOutDir = options.outDir ? path.resolve(options.outDir) : undefined;
  const outputDir = requestedOutDir || stagingDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFile = path.join(stagingDir, 'fastly-native-http-effects.as.ts');
  const wasmFile = path.join(outputDir, options.wasmFile || 'fastly-native-http-effects.wasm');
  const watFile = path.join(outputDir, options.watFile || 'fastly-native-http-effects.wat');
  try {
    fs.writeFileSync(sourceFile, generated.source, 'utf8');
    const args = [
      asc.script,
      path.basename(sourceFile),
      '--outFile', wasmFile,
      '--textFile', watFile,
      '--runtime', schemaCodecsActive ? 'incremental' : 'stub',
      '--noAssert',
      '--optimize',
      '--use', 'abort=fastly-native-http-effects.as/__pulse_fastly_abort'
    ];
    if (schemaCodecsActive) {
      args.push(
        '--exportRuntime',
        '--transform', jsonAs.transform,
        '--path', path.join(compilerFallback, 'node_modules'),
        '--path', jsonAs.dependencyRoot
      );
    }
    const startedAt = Date.now();
    const result = spawnSync(asc.executable, args, {
      cwd: stagingDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: Number(options.timeoutMs || 180000),
      env: schemaCodecsActive
        ? { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' }
        : process.env
    });
    const durationMs = Date.now() - startedAt;
    if (result.error || result.status !== 0 || !fs.existsSync(wasmFile)) {
      fail('AssemblyScript failed to compile the Fastly native HTTP effects module.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_ASC_FAILED', {
        status: result.status,
        signal: result.signal,
        error: result.error && result.error.message,
        stdout: String(result.stdout || '').slice(-24000),
        stderr: String(result.stderr || '').slice(-24000),
        source: generated.source,
        durationMs
      });
    }
    const wasm = fs.readFileSync(wasmFile);
    const wat = fs.existsSync(watFile) ? fs.readFileSync(watFile, 'utf8') : '';
    const inspection = inspectFastlyNativeHttpEffectsWasm(wasm);
    const manifest = Object.freeze({
      ...generated.manifest,
      compilerVersion: FASTLY_NATIVE_HTTP_EFFECTS_COMPILER_VERSION,
      assemblyScript: Object.freeze({ package: 'assemblyscript', version: require(path.join(asc.packageRoot, 'package.json')).version }),
      jsonAs: jsonAs
        ? Object.freeze({ package: 'json-as', version: jsonAs.version, transform: true, strict: true, mode: 'NAIVE', fastPath: false })
        : undefined,
      wasm: Object.freeze({ bytes: inspection.bytes, sha256: inspection.sha256, magic: inspection.magic }),
      wat: Object.freeze({ bytes: Buffer.byteLength(wat), sha256: sha256(wat) }),
      importModules: inspection.importModules,
      imports: inspection.imports,
      exports: inspection.exports
    });
    return Object.freeze({
      version: FASTLY_NATIVE_HTTP_EFFECTS_VERSION,
      compilerVersion: FASTLY_NATIVE_HTTP_EFFECTS_COMPILER_VERSION,
      plan,
      generated,
      source: generated.source,
      sourceHash: generated.sourceHash,
      wasm,
      wat,
      inspection,
      manifest,
      durationMs,
      output: requestedOutDir ? Object.freeze({ outDir: outputDir, wasmFile, watFile }) : undefined
    });
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function writeFastlyNativeHttpEffectsModule(compiled, outDir, options = {}) {
  if (!compiled || !Buffer.isBuffer(compiled.wasm) || !compiled.manifest || !compiled.plan) throw new TypeError('writeFastlyNativeHttpEffectsModule requires a compiled Pass97 module.');
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  const sourceFile = path.join(target, options.sourceFile || 'fastly-native-http-effects.as.ts');
  const wasmFile = path.join(target, options.wasmFile || 'fastly-native-http-effects.wasm');
  const watFile = path.join(target, options.watFile || 'fastly-native-http-effects.wat');
  const planFile = path.join(target, options.planFile || 'canonical-native-plan.json');
  const manifestFile = path.join(target, options.manifestFile || 'fastly-native-http-effects-manifest.json');
  fs.writeFileSync(sourceFile, compiled.source, 'utf8');
  fs.writeFileSync(wasmFile, compiled.wasm);
  fs.writeFileSync(watFile, compiled.wat, 'utf8');
  fs.writeFileSync(planFile, `${stableStringify(compiled.plan, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestFile, `${stableStringify(compiled.manifest, 2)}\n`, 'utf8');
  return Object.freeze({ target, sourceFile, wasmFile, watFile, planFile, manifestFile, manifest: compiled.manifest });
}

module.exports = Object.freeze({
  FASTLY_NATIVE_HTTP_EFFECTS_VERSION,
  FASTLY_NATIVE_HTTP_EFFECTS_GENERATOR_VERSION,
  FASTLY_NATIVE_HTTP_EFFECTS_COMPILER_VERSION,
  FASTLY_NATIVE_HTTP_EFFECTS_ABI_VERSION,
  FASTLY_NATIVE_HTTP_EFFECTS_BUFFER_BYTES,
  FASTLY_NATIVE_HTTP_EFFECTS_MAX_WASM_BYTES,
  FASTLY_NATIVE_HTTP_EFFECTS_IMPORTS,
  FASTLY_NATIVE_HTTP_EFFECTS_REQUIRED_IMPORTS,
  FastlyNativeHttpEffectsError,
  resolveBackendBindings,
  generateFastlyNativeHttpEffectsAssemblyScript,
  compileFastlyNativeHttpEffectsPlan,
  inspectFastlyNativeHttpEffectsWasm,
  writeFastlyNativeHttpEffectsModule,
  stableStringify
});
