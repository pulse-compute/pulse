'use strict';

const crypto = require('node:crypto');
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

const { resolveAsc } = loadBuildSupport();

const FASTLY_NATIVE_HTTP_SHELL_VERSION = 'pulse.fastly-native-http-shell.v1';
const FASTLY_NATIVE_HTTP_SHELL_GENERATOR_VERSION = 'pulse.fastly-native-http-shell-generator.v1';
const FASTLY_NATIVE_HTTP_SHELL_COMPILER_VERSION = 'pulse.fastly-native-http-shell-compiler.v1';
const FASTLY_NATIVE_HTTP_SHELL_ABI_VERSION = 1;
const FASTLY_NATIVE_HTTP_BUFFER_BYTES = 65536;
const FASTLY_NATIVE_HTTP_MAX_WASM_BYTES = 512 * 1024;

const FASTLY_NATIVE_HTTP_IMPORTS = Object.freeze([
  Object.freeze(['fastly_abi', 'init']),
  Object.freeze(['fastly_http_req', 'body_downstream_get']),
  Object.freeze(['fastly_http_req', 'method_get']),
  Object.freeze(['fastly_http_req', 'uri_get']),
  Object.freeze(['fastly_http_req', 'header_value_get']),
  Object.freeze(['fastly_http_resp', 'new']),
  Object.freeze(['fastly_http_resp', 'header_append']),
  Object.freeze(['fastly_http_resp', 'status_set']),
  Object.freeze(['fastly_http_resp', 'send_downstream']),
  Object.freeze(['fastly_http_body', 'new']),
  Object.freeze(['fastly_http_body', 'write'])
]);

const FASTLY_NATIVE_HTTP_CORE_IMPORTS = Object.freeze(FASTLY_NATIVE_HTTP_IMPORTS.filter(([module, name]) => !(module === 'fastly_http_req' && name === 'header_value_get')));

const FASTLY_NATIVE_HTTP_ALLOWED_IMPORTS = new Set([
  ...FASTLY_NATIVE_HTTP_IMPORTS.map(([module, name]) => `${module}:${name}`)
]);

class FastlyNativeHttpShellError extends Error {
  constructor(message, code = 'PULSE_FASTLY_NATIVE_HTTP_SHELL_FAILED', detail = {}) {
    super(message);
    this.name = 'FastlyNativeHttpShellError';
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
  throw new FastlyNativeHttpShellError(message, code, detail);
}

function literalValue(expression, label) {
  if (!expression || expression.kind !== 'literal') {
    fail(`${label} must be a static literal in the Pass96 Fastly HTTP shell.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_VALUE_REQUIRED', { label, expression });
  }
  return expression.value;
}

function objectEntries(expression, label) {
  if (!expression || expression.kind !== 'object') {
    fail(`${label} must be a static object in the Pass96 Fastly HTTP shell.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_OBJECT_REQUIRED', { label, expression });
  }
  const entries = new Map();
  for (const entry of expression.entries || []) {
    if (entry.kind !== 'property' || !entry.key || entry.key.kind !== 'literal' || typeof entry.key.value !== 'string') {
      fail(`${label} only accepts literal property names.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_OBJECT_REQUIRED', { label, entry });
    }
    entries.set(entry.key.value, entry.value);
  }
  return entries;
}

function parseStaticHeaders(expression, label) {
  if (!expression) return [];
  const headers = [];
  if (expression.kind === 'array') {
    for (const [index, item] of (expression.items || []).entries()) {
      if (!item || item.kind !== 'array' || (item.items || []).length !== 2) {
        fail(`${label}[${index}] must be a literal [name, value] pair.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, index, item });
      }
      const name = literalValue(item.items[0], `${label}[${index}][0]`);
      const value = literalValue(item.items[1], `${label}[${index}][1]`);
      if (typeof name !== 'string' || typeof value !== 'string') {
        fail(`${label}[${index}] must contain two strings.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, index, name, value });
      }
      headers.push([name, value]);
    }
    return headers;
  }
  if (expression.kind === 'object') {
    for (const entry of expression.entries || []) {
      if (entry.kind !== 'property' || !entry.key || entry.key.kind !== 'literal' || typeof entry.key.value !== 'string') {
        fail(`${label} only accepts literal header names.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, entry });
      }
      const name = entry.key.value;
      if (entry.value && entry.value.kind === 'array') {
        for (const [index, item] of (entry.value.items || []).entries()) {
          const value = literalValue(item, `${label}.${name}[${index}]`);
          if (typeof value !== 'string') fail(`${label}.${name}[${index}] must be a string.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, name, index, value });
          headers.push([name, value]);
        }
      } else {
        const value = literalValue(entry.value, `${label}.${name}`);
        if (typeof value !== 'string') fail(`${label}.${name} must be a string.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, name, value });
        headers.push([name, value]);
      }
    }
    return headers;
  }
  fail(`${label} must be a static header object or array of pairs.`, 'PULSE_FASTLY_NATIVE_HTTP_STATIC_HEADERS_REQUIRED', { label, expression });
}

function responseOptions(expression, kind) {
  const defaultContentType = kind === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
  const defaults = { status: 200, headers: [['content-type', defaultContentType]] };
  if (!expression || expression.kind === 'undefined') return defaults;
  const entries = objectEntries(expression, `${kind} response options`);
  const allowed = new Set(['status', 'headers']);
  for (const key of entries.keys()) {
    if (!allowed.has(key)) {
      fail(`Pass96 ${kind} responses do not support option ${key}.`, 'PULSE_FASTLY_NATIVE_HTTP_RESPONSE_OPTION_UNSUPPORTED', { kind, option: key });
    }
  }
  let status = 200;
  if (entries.has('status')) {
    status = literalValue(entries.get('status'), `${kind} response status`);
    if (!Number.isInteger(status) || status < 100 || status > 999) {
      fail(`${kind} response status must be a static integer between 100 and 999.`, 'PULSE_FASTLY_NATIVE_HTTP_STATUS_INVALID', { kind, status });
    }
  }
  const headers = entries.has('headers') ? parseStaticHeaders(entries.get('headers'), `${kind} response headers`) : [];
  const contentType = headers.some(([name]) => name.toLowerCase() === 'content-type');
  if (!contentType) headers.push(['content-type', defaultContentType]);
  return { status, headers };
}

function validatePlanBoundary(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('Fastly native HTTP realization requires a canonical native plan.');
  if (plan.version !== CANONICAL_NATIVE_PLAN_VERSION) {
    fail(`Fastly native HTTP realization requires ${CANONICAL_NATIVE_PLAN_VERSION}.`, 'PULSE_FASTLY_NATIVE_HTTP_PLAN_VERSION_UNSUPPORTED', { version: plan.version });
  }
  if (!plan.ownership || plan.ownership.providerNeutral !== true || plan.ownership.javascriptRuntime !== false) {
    fail('Fastly native HTTP realization requires a provider-neutral plan with no JavaScript runtime ownership.', 'PULSE_FASTLY_NATIVE_HTTP_PLAN_OWNERSHIP_INVALID', { ownership: plan.ownership });
  }
  if ((plan.effects || []).length > 0 || (plan.continuations || []).length > 0 || ((plan.packages && plan.packages.effects) || []).length > 0) {
    fail('Pass96 realizes only effect-free HTTP handlers; effects and continuations are introduced in Pass97.', 'PULSE_FASTLY_NATIVE_HTTP_EFFECTS_DEFERRED', {
      effects: (plan.effects || []).map((entry) => entry.id),
      continuations: (plan.continuations || []).map((entry) => entry.id),
      packageEffects: ((plan.packages && plan.packages.effects) || []).map((entry) => entry.id)
    });
  }
  if ((plan.locals || []).length > 0) {
    fail('Pass96 realizes effect-free handlers without local bindings; local/effect execution is introduced in Pass97.', 'PULSE_FASTLY_NATIVE_HTTP_LOCALS_DEFERRED', { locals: (plan.locals || []).map((entry) => entry.id) });
  }
  if (!plan.entry || !Array.isArray(plan.entry.body)) {
    fail('Fastly native HTTP realization requires a canonical handler entry body.', 'PULSE_FASTLY_NATIVE_HTTP_ENTRY_INVALID');
  }
  return plan;
}

function createRenderer(plan) {
  const responseFactories = [];
  let factoryIndex = 0;

  function renderString(expression) {
    if (!expression || typeof expression !== 'object') fail('String expression is missing.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
    if (expression.kind === 'literal') {
      if (typeof expression.value !== 'string') fail('String expression requires a string literal.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
      return quote(expression.value);
    }
    if (expression.kind === 'context-read') {
      const key = (expression.path || []).join('.');
      const mapping = {
        'req.method': '__pulse_request_method',
        'req.url': '__pulse_request_url',
        'req.path': '__pulse_request_path'
      };
      if (!mapping[key]) fail(`Pass96 does not support context read ${key || '<root>'}.`, 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
      return mapping[key];
    }
    if (expression.kind === 'intrinsic' && expression.name === 'request.header') {
      const args = expression.arguments || [];
      if (args.length !== 1 || args[0].kind !== 'literal' || typeof args[0].value !== 'string') {
        fail('Pass96 request.header() requires one static string name.', 'PULSE_FASTLY_NATIVE_HTTP_HEADER_NAME_STATIC', { expression });
      }
      return `__pulse_request_header(${quote(args[0].value)})`;
    }
    if (expression.kind === 'template') {
      const parts = (expression.parts || []).map((part) => part.kind === 'text' ? quote(part.value || '') : renderString(part.value));
      return parts.length > 0 ? `(${parts.join(' + ')})` : '""';
    }
    if (expression.kind === 'binary' && expression.operator === '+') {
      return `(${renderString(expression.left)} + ${renderString(expression.right)})`;
    }
    if (expression.kind === 'conditional') {
      return `(${renderBoolean(expression.test)} ? ${renderString(expression.whenTrue)} : ${renderString(expression.whenFalse)})`;
    }
    fail(`Pass96 cannot lower string expression kind ${String(expression.kind)}.`, 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
  }

  function renderNumber(expression) {
    if (expression && expression.kind === 'literal' && typeof expression.value === 'number' && Number.isFinite(expression.value)) return String(expression.value);
    fail('Pass96 numeric expressions must be finite static literals.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
  }

  function renderScalar(expression) {
    const kind = expression && expression.valueKind;
    if (kind === 'boolean') return { type: 'boolean', source: renderBoolean(expression) };
    if (kind === 'number') return { type: 'number', source: renderNumber(expression) };
    return { type: 'string', source: renderString(expression) };
  }

  function renderBoolean(expression) {
    if (!expression || typeof expression !== 'object') fail('Boolean expression is missing.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
    if (expression.kind === 'literal' && typeof expression.value === 'boolean') return expression.value ? 'true' : 'false';
    if (expression.kind === 'unary' && expression.operator === '!') return `(!${renderBoolean(expression.value)})`;
    if (expression.kind === 'binary') {
      if (expression.operator === '&&' || expression.operator === '||') {
        return `(${renderBoolean(expression.left)} ${expression.operator} ${renderBoolean(expression.right)})`;
      }
      if (['===', '!==', '==', '!=', '<', '<=', '>', '>='].includes(expression.operator)) {
        const left = renderScalar(expression.left);
        const right = renderScalar(expression.right);
        if (left.type !== right.type) {
          fail('Pass96 comparison operands must have the same static scalar kind.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression, left: left.type, right: right.type });
        }
        const operator = expression.operator === '===' ? '==' : expression.operator === '!==' ? '!=' : expression.operator;
        return `(${left.source} ${operator} ${right.source})`;
      }
    }
    if (expression.kind === 'conditional') {
      return `(${renderBoolean(expression.test)} ? ${renderBoolean(expression.whenTrue)} : ${renderBoolean(expression.whenFalse)})`;
    }
    fail(`Pass96 cannot lower boolean expression kind ${String(expression.kind)}.`, 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
  }

  function renderJson(expression) {
    if (!expression || typeof expression !== 'object') fail('JSON expression is missing.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
    if (expression.kind === 'literal') {
      if (typeof expression.value === 'string') return `__pulse_json_string(${quote(expression.value)})`;
      if (expression.value === null || typeof expression.value === 'boolean' || typeof expression.value === 'number') return quote(JSON.stringify(expression.value));
      fail('Pass96 JSON literals must be JSON primitives.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
    }
    if (expression.kind === 'undefined') return '"null"';
    if (expression.kind === 'context-read' || (expression.kind === 'intrinsic' && expression.name === 'request.header') || expression.kind === 'template') {
      return `__pulse_json_string(${renderString(expression)})`;
    }
    if (expression.kind === 'object') {
      const parts = [];
      for (const entry of expression.entries || []) {
        if (entry.kind !== 'property' || !entry.key || entry.key.kind !== 'literal' || typeof entry.key.value !== 'string') {
          fail('Pass96 JSON objects require static property names and do not support spreads.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { entry });
        }
        parts.push(`${quote(JSON.stringify(entry.key.value))} + ":" + ${renderJson(entry.value)}`);
      }
      if (parts.length === 0) return '"{}"';
      return `("{" + ${parts.join(' + "," + ')} + "}")`;
    }
    if (expression.kind === 'array') {
      const items = (expression.items || []).map((item) => {
        if (item && item.kind === 'spread') fail('Pass96 JSON arrays do not support spreads.', 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { item });
        return renderJson(item);
      });
      if (items.length === 0) return '"[]"';
      return `("[" + ${items.join(' + "," + ')} + "]")`;
    }
    if (expression.kind === 'conditional') return `(${renderBoolean(expression.test)} ? ${renderJson(expression.whenTrue)} : ${renderJson(expression.whenFalse)})`;
    if (expression.kind === 'binary' && expression.valueKind === 'string') return `__pulse_json_string(${renderString(expression)})`;
    fail(`Pass96 cannot lower JSON expression kind ${String(expression.kind)}.`, 'PULSE_FASTLY_NATIVE_HTTP_EXPRESSION_UNSUPPORTED', { expression });
  }

  function registerResponse(expression) {
    if (!expression || expression.kind !== 'intrinsic') {
      fail('Pass96 handler returns must use ctx.json() or ctx.text().', 'PULSE_FASTLY_NATIVE_HTTP_RETURN_UNSUPPORTED', { expression });
    }
    const args = expression.arguments || [];
    let kind;
    let body;
    if (expression.name === 'response.json') {
      kind = 'json';
      if (args.length < 1 || args.length > 2) fail('ctx.json() must have one value and optional response options.', 'PULSE_FASTLY_NATIVE_HTTP_RETURN_UNSUPPORTED', { expression });
      body = renderJson(args[0]);
    } else if (expression.name === 'response.text') {
      kind = 'text';
      if (args.length < 1 || args.length > 2) fail('ctx.text() must have one value and optional response options.', 'PULSE_FASTLY_NATIVE_HTTP_RETURN_UNSUPPORTED', { expression });
      body = renderString(args[0]);
    } else {
      fail(`Pass96 does not realize response intrinsic ${String(expression.name)}.`, 'PULSE_FASTLY_NATIVE_HTTP_RETURN_UNSUPPORTED', { expression });
    }
    const options = responseOptions(args[1], kind);
    const index = factoryIndex++;
    const name = `__pulse_response_${index}`;
    const lines = [
      `function ${name}(): __PulseResponse {`,
      '  const headers = new Array<__PulseHeader>()',
      ...options.headers.map(([headerName, value]) => `  headers.push(new __PulseHeader(${quote(headerName)}, ${quote(value)}))`),
      `  return new __PulseResponse(${options.status}, ${body}, headers)`,
      '}'
    ];
    responseFactories.push(lines.join('\n'));
    return `${name}()`;
  }

  function renderSequence(statements, depth = 1) {
    const indent = '  '.repeat(depth);
    const lines = [];
    for (const statement of statements || []) {
      if (statement.kind === 'return') {
        lines.push(`${indent}return ${registerResponse(statement.value)}`);
      } else if (statement.kind === 'if') {
        lines.push(`${indent}if (${renderBoolean(statement.test)}) {`);
        lines.push(...renderSequence(statement.then || [], depth + 1));
        lines.push(`${indent}}`);
        if ((statement.else || []).length > 0) {
          lines.push(`${indent}else {`);
          lines.push(...renderSequence(statement.else || [], depth + 1));
          lines.push(`${indent}}`);
        }
      } else {
        fail(`Pass96 does not realize statement kind ${String(statement.kind)}.`, 'PULSE_FASTLY_NATIVE_HTTP_STATEMENT_UNSUPPORTED', { statement });
      }
    }
    return lines;
  }

  const handlerLines = [
    'function __pulse_handler(): __PulseResponse {',
    ...renderSequence(plan.entry.body || []),
    '  return __pulse_internal_error_response()',
    '}'
  ];

  return Object.freeze({ responseFactories: Object.freeze(responseFactories), handlerSource: handlerLines.join('\n') });
}

function generateFastlyNativeHttpAssemblyScript(plan, options = {}) {
  validatePlanBoundary(plan);
  const rendered = createRenderer(plan);
  const source = [
    '/* Generated by Pulse Pass96 Fastly native HTTP shell. */',
    'export function __pulse_fastly_abort(message: string | null, fileName: string | null, line: u32, column: u32): void { unreachable() }',
    '',
    '@external("fastly_abi", "init") declare function fastly_abi_init(version: i64): i32',
    '@external("fastly_http_req", "body_downstream_get") declare function fastly_http_req_body_downstream_get(requestOut: usize, bodyOut: usize): i32',
    '@external("fastly_http_req", "method_get") declare function fastly_http_req_method_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32',
    '@external("fastly_http_req", "uri_get") declare function fastly_http_req_uri_get(handle: i32, buffer: usize, bufferLength: i32, writtenOut: usize): i32',
    '@external("fastly_http_req", "header_value_get") declare function fastly_http_req_header_value_get(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32, writtenOut: usize): i32',
    '@external("fastly_http_resp", "new") declare function fastly_http_resp_new(handleOut: usize): i32',
    '@external("fastly_http_resp", "header_append") declare function fastly_http_resp_header_append(handle: i32, name: usize, nameLength: i32, value: usize, valueLength: i32): i32',
    '@external("fastly_http_resp", "status_set") declare function fastly_http_resp_status_set(handle: i32, status: i32): i32',
    '@external("fastly_http_resp", "send_downstream") declare function fastly_http_resp_send_downstream(handle: i32, body: i32, streaming: i32): i32',
    '@external("fastly_http_body", "new") declare function fastly_http_body_new(handleOut: usize): i32',
    '@external("fastly_http_body", "write") declare function fastly_http_body_write(handle: i32, buffer: usize, bufferLength: i32, end: i32, writtenOut: usize): i32',
    '',
    `const PULSE_FASTLY_ABI_VERSION: i64 = ${FASTLY_NATIVE_HTTP_SHELL_ABI_VERSION}`,
    `const PULSE_FASTLY_BUFFER_BYTES: i32 = ${FASTLY_NATIVE_HTTP_BUFFER_BYTES}`,
    'const FASTLY_STATUS_OK: i32 = 0',
    'const FASTLY_STATUS_NONE: i32 = 10',
    `const PULSE_PLAN_HASH: string = ${quote(plan.planHash)}`,
    'let __pulse_request_handle: i32 = 0',
    'let __pulse_request_body_handle: i32 = 0',
    'let __pulse_request_method: string = ""',
    'let __pulse_request_url: string = ""',
    'let __pulse_request_path: string = ""',
    'let __pulse_last_error: i32 = 0',
    '',
    'class __PulseHeader {',
    '  constructor(public name: string, public value: string) {}',
    '}',
    'class __PulseResponse {',
    '  constructor(public status: i32, public body: string, public headers: Array<__PulseHeader>) {}',
    '}',
    '',
    'function __pulse_out_i32(): StaticArray<i32> { return new StaticArray<i32>(1) }',
    'function __pulse_out_value(out: StaticArray<i32>): i32 { return load<i32>(changetype<usize>(out)) }',
    'function __pulse_utf8(value: string): ArrayBuffer { return String.UTF8.encode(value, false) }',
    'function __pulse_decode(buffer: Uint8Array, length: i32): string { return String.UTF8.decodeUnsafe(buffer.dataStart, length, false) }',
    '',
    'function __pulse_read_request_string(kind: i32): string {',
    '  const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES)',
    '  const written = __pulse_out_i32()',
    '  let status = kind == 0',
    '    ? fastly_http_req_method_get(__pulse_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written))',
    '    : fastly_http_req_uri_get(__pulse_request_handle, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written))',
    '  if (status != FASTLY_STATUS_OK) { __pulse_last_error = status; return "" }',
    '  return __pulse_decode(buffer, __pulse_out_value(written))',
    '}',
    '',
    'function __pulse_request_header(name: string): string {',
    '  const nameBytes = __pulse_utf8(name)',
    '  const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES)',
    '  const written = __pulse_out_i32()',
    '  const status = fastly_http_req_header_value_get(__pulse_request_handle, changetype<usize>(nameBytes), nameBytes.byteLength, buffer.dataStart, PULSE_FASTLY_BUFFER_BYTES, changetype<usize>(written))',
    '  if (status == FASTLY_STATUS_NONE) return ""',
    '  if (status != FASTLY_STATUS_OK) { __pulse_last_error = status; return "" }',
    '  return __pulse_decode(buffer, __pulse_out_value(written))',
    '}',
    '',
    'function __pulse_path_from_uri(uri: string): string {',
    '  let start = 0',
    '  const scheme = uri.indexOf("://")',
    '  if (scheme >= 0) {',
    '    const slash = uri.indexOf("/", scheme + 3)',
    '    start = slash >= 0 ? slash : uri.length',
    '  }',
    '  let end = uri.length',
    '  const query = uri.indexOf("?", start)',
    '  if (query >= 0 && query < end) end = query',
    '  const fragment = uri.indexOf("#", start)',
    '  if (fragment >= 0 && fragment < end) end = fragment',
    '  if (start >= end) return "/"',
    '  return uri.substring(start, end)',
    '}',
    '',
    'function __pulse_hex_digit(value: i32): string {',
    '  return String.fromCharCode(value < 10 ? 48 + value : 87 + value)',
    '}',
    'function __pulse_json_string(value: string): string {',
    '  let output = "\\\""',
    '  for (let index = 0; index < value.length; index += 1) {',
    '    const code = value.charCodeAt(index)',
    '    if (code == 34) output += "\\\\\\\""',
    '    else if (code == 92) output += "\\\\\\\\"',
    '    else if (code == 8) output += "\\\\b"',
    '    else if (code == 9) output += "\\\\t"',
    '    else if (code == 10) output += "\\\\n"',
    '    else if (code == 12) output += "\\\\f"',
    '    else if (code == 13) output += "\\\\r"',
    '    else if (code < 32) output += "\\\\u00" + __pulse_hex_digit((code >> 4) & 15) + __pulse_hex_digit(code & 15)',
    '    else output += String.fromCharCode(code)',
    '  }',
    '  return output + "\\\""',
    '}',
    '',
    'function __pulse_internal_error_response(): __PulseResponse {',
    '  const headers = new Array<__PulseHeader>()',
    '  headers.push(new __PulseHeader("content-type", "text/plain; charset=utf-8"))',
    '  return new __PulseResponse(500, "Pulse handler did not return a response", headers)',
    '}',
    ...rendered.responseFactories,
    rendered.handlerSource,
    '',
    'function __pulse_append_header(responseHandle: i32, header: __PulseHeader): i32 {',
    '  const name = __pulse_utf8(header.name)',
    '  const value = __pulse_utf8(header.value)',
    '  return fastly_http_resp_header_append(responseHandle, changetype<usize>(name), name.byteLength, changetype<usize>(value), value.byteLength)',
    '}',
    '',
    'function __pulse_write_body(bodyHandle: i32, value: string): i32 {',
    '  const bytes = __pulse_utf8(value)',
    '  let offset = 0',
    '  while (offset < bytes.byteLength) {',
    '    const written = __pulse_out_i32()',
    '    const status = fastly_http_body_write(bodyHandle, changetype<usize>(bytes) + offset, bytes.byteLength - offset, 0, changetype<usize>(written))',
    '    if (status != FASTLY_STATUS_OK) return status',
    '    const count = __pulse_out_value(written)',
    '    if (count <= 0) return 1',
    '    offset += count',
    '  }',
    '  return FASTLY_STATUS_OK',
    '}',
    '',
    'function __pulse_send(response: __PulseResponse): i32 {',
    '  const responseOut = __pulse_out_i32()',
    '  let status = fastly_http_resp_new(changetype<usize>(responseOut))',
    '  if (status != FASTLY_STATUS_OK) return status',
    '  const responseHandle = __pulse_out_value(responseOut)',
    '  const bodyOut = __pulse_out_i32()',
    '  status = fastly_http_body_new(changetype<usize>(bodyOut))',
    '  if (status != FASTLY_STATUS_OK) return status',
    '  const bodyHandle = __pulse_out_value(bodyOut)',
    '  status = fastly_http_resp_status_set(responseHandle, response.status)',
    '  if (status != FASTLY_STATUS_OK) return status',
    '  for (let index = 0; index < response.headers.length; index += 1) {',
    '    status = __pulse_append_header(responseHandle, unchecked(response.headers[index]))',
    '    if (status != FASTLY_STATUS_OK) return status',
    '  }',
    '  status = __pulse_write_body(bodyHandle, response.body)',
    '  if (status != FASTLY_STATUS_OK) return status',
    '  return fastly_http_resp_send_downstream(responseHandle, bodyHandle, 0)',
    '}',
    '',
    'export function pulse_fastly_plan_hash_ptr(): i32 { return changetype<i32>(PULSE_PLAN_HASH) }',
    'export function pulse_fastly_plan_hash_length(): i32 { return PULSE_PLAN_HASH.length }',
    'export function pulse_fastly_last_error(): i32 { return __pulse_last_error }',
    'export function _start(): void {',
    '  __pulse_last_error = fastly_abi_init(PULSE_FASTLY_ABI_VERSION)',
    '  if (__pulse_last_error != FASTLY_STATUS_OK) return',
    '  const handles = new StaticArray<i32>(2)',
    '  __pulse_last_error = fastly_http_req_body_downstream_get(changetype<usize>(handles), changetype<usize>(handles) + 4)',
    '  if (__pulse_last_error != FASTLY_STATUS_OK) return',
    '  __pulse_request_handle = load<i32>(changetype<usize>(handles))',
    '  __pulse_request_body_handle = load<i32>(changetype<usize>(handles) + 4)',
    '  __pulse_request_method = __pulse_read_request_string(0)',
    '  if (__pulse_last_error != FASTLY_STATUS_OK) return',
    '  __pulse_request_url = __pulse_read_request_string(1)',
    '  if (__pulse_last_error != FASTLY_STATUS_OK) return',
    '  __pulse_request_path = __pulse_path_from_uri(__pulse_request_url)',
    '  __pulse_last_error = __pulse_send(__pulse_handler())',
    '}',
    ''
  ].join('\n');

  return Object.freeze({
    version: FASTLY_NATIVE_HTTP_SHELL_GENERATOR_VERSION,
    source,
    sourceHash: sha256(source),
    manifest: Object.freeze({
      version: FASTLY_NATIVE_HTTP_SHELL_VERSION,
      generatorVersion: FASTLY_NATIVE_HTTP_SHELL_GENERATOR_VERSION,
      abiVersion: FASTLY_NATIVE_HTTP_SHELL_ABI_VERSION,
      planVersion: plan.version,
      planHash: plan.planHash,
      sourceHash: sha256(source),
      bufferBytes: FASTLY_NATIVE_HTTP_BUFFER_BYTES,
      effectFree: true,
      allowedImports: FASTLY_NATIVE_HTTP_IMPORTS,
      requiredExports: Object.freeze(['_start', 'pulse_fastly_plan_hash_ptr', 'pulse_fastly_plan_hash_length', 'pulse_fastly_last_error']),
      policy: Object.freeze({
        nativeFastly: true,
        provider: 'fastly',
        providerNeutralInput: true,
        javascriptRuntime: false,
        jsComputeRuntime: false,
        wasi: false,
        effects: false,
        continuations: false,
        requestBody: false,
        requestHeaders: 'named-read',
        repeatedResponseHeaders: true
      })
    })
  });
}

function inspectFastlyNativeHttpWasm(input) {
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(bytes)) fail('Generated Fastly native HTTP shell is not valid WebAssembly.', 'PULSE_FASTLY_NATIVE_HTTP_WASM_INVALID');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind }));
  const exports = WebAssembly.Module.exports(module).map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }));
  const unexpected = imports.filter((entry) => !FASTLY_NATIVE_HTTP_ALLOWED_IMPORTS.has(`${entry.module}:${entry.name}`));
  if (unexpected.length > 0) fail('Generated Fastly native HTTP shell imports functions outside the Pass96 ABI.', 'PULSE_FASTLY_NATIVE_HTTP_IMPORT_UNSUPPORTED', { unexpected, imports });
  const forbidden = imports.filter((entry) => /pulse_host|wasi|js[_-]?compute/i.test(`${entry.module}:${entry.name}`));
  if (forbidden.length > 0) fail('Generated Fastly native HTTP shell imports a forbidden runtime.', 'PULSE_FASTLY_NATIVE_HTTP_RUNTIME_FORBIDDEN', { forbidden });
  const imported = new Set(imports.map((entry) => `${entry.module}:${entry.name}`));
  const missingImports = FASTLY_NATIVE_HTTP_CORE_IMPORTS.map(([moduleName, name]) => `${moduleName}:${name}`).filter((key) => !imported.has(key));
  if (missingImports.length > 0) fail('Generated Fastly native HTTP shell is missing required host imports.', 'PULSE_FASTLY_NATIVE_HTTP_IMPORT_MISSING', { missingImports, imports });
  const exportNames = new Set(exports.map((entry) => entry.name));
  const requiredExports = ['_start', 'memory', 'pulse_fastly_plan_hash_ptr', 'pulse_fastly_plan_hash_length', 'pulse_fastly_last_error'];
  const missingExports = requiredExports.filter((name) => !exportNames.has(name));
  if (missingExports.length > 0) fail('Generated Fastly native HTTP shell is missing required exports.', 'PULSE_FASTLY_NATIVE_HTTP_EXPORT_MISSING', { missingExports, exports });
  if (bytes.length > FASTLY_NATIVE_HTTP_MAX_WASM_BYTES) fail('Generated Fastly native HTTP shell exceeds the Pass96 size ceiling.', 'PULSE_FASTLY_NATIVE_HTTP_WASM_TOO_LARGE', { bytes: bytes.length, maxBytes: FASTLY_NATIVE_HTTP_MAX_WASM_BYTES });
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

function compileFastlyNativeHttpPlan(plan, options = {}) {
  const generated = generateFastlyNativeHttpAssemblyScript(plan, options);
  const cwd = path.resolve(options.cwd || process.cwd());
  const compilerFallback = path.resolve(__dirname, '..', '..', '..', '..', 'wasm', 'packages', 'compiler');
  const asc = resolveAsc(cwd) || resolveAsc(compilerFallback);
  if (!asc) fail('AssemblyScript compiler dependency was not found for Fastly native HTTP realization.', 'PULSE_FASTLY_NATIVE_HTTP_ASC_MISSING', { cwd, compilerFallback });
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fastly-native-http-'));
  const requestedOutDir = options.outDir ? path.resolve(options.outDir) : undefined;
  const outputDir = requestedOutDir || stagingDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFile = path.join(stagingDir, 'fastly-native-http.as.ts');
  const wasmFile = path.join(outputDir, options.wasmFile || 'fastly-native-http.wasm');
  const watFile = path.join(outputDir, options.watFile || 'fastly-native-http.wat');
  try {
    fs.writeFileSync(sourceFile, generated.source, 'utf8');
    const args = [
      asc.script,
      path.basename(sourceFile),
      '--outFile', wasmFile,
      '--textFile', watFile,
      '--runtime', 'stub',
      '--noAssert',
      '--optimize',
      '--use', 'abort=fastly-native-http.as/__pulse_fastly_abort'
    ];
    const startedAt = Date.now();
    const result = spawnSync(asc.executable, args, {
      cwd: stagingDir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: Number(options.timeoutMs || 120000)
    });
    const durationMs = Date.now() - startedAt;
    if (result.error || result.status !== 0 || !fs.existsSync(wasmFile)) {
      fail('AssemblyScript failed to compile the Fastly native HTTP shell.', 'PULSE_FASTLY_NATIVE_HTTP_ASC_FAILED', {
        status: result.status,
        signal: result.signal,
        error: result.error && result.error.message,
        stdout: String(result.stdout || '').slice(-16000),
        stderr: String(result.stderr || '').slice(-16000),
        source: generated.source,
        durationMs
      });
    }
    const wasm = fs.readFileSync(wasmFile);
    const wat = fs.existsSync(watFile) ? fs.readFileSync(watFile, 'utf8') : '';
    const inspection = inspectFastlyNativeHttpWasm(wasm);
    const manifest = Object.freeze({
      ...generated.manifest,
      compilerVersion: FASTLY_NATIVE_HTTP_SHELL_COMPILER_VERSION,
      assemblyScript: Object.freeze({ package: 'assemblyscript', version: require(path.join(asc.packageRoot, 'package.json')).version }),
      wasm: Object.freeze({ bytes: inspection.bytes, sha256: inspection.sha256, magic: inspection.magic }),
      wat: Object.freeze({ bytes: Buffer.byteLength(wat), sha256: sha256(wat) }),
      importModules: inspection.importModules,
      imports: inspection.imports,
      exports: inspection.exports
    });
    return Object.freeze({
      version: FASTLY_NATIVE_HTTP_SHELL_VERSION,
      compilerVersion: FASTLY_NATIVE_HTTP_SHELL_COMPILER_VERSION,
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

function writeFastlyNativeHttpModule(compiled, outDir, options = {}) {
  if (!compiled || !Buffer.isBuffer(compiled.wasm) || !compiled.manifest || !compiled.plan) throw new TypeError('writeFastlyNativeHttpModule requires a compiled Pass96 module.');
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  const sourceFile = path.join(target, options.sourceFile || 'fastly-native-http.as.ts');
  const wasmFile = path.join(target, options.wasmFile || 'fastly-native-http.wasm');
  const watFile = path.join(target, options.watFile || 'fastly-native-http.wat');
  const planFile = path.join(target, options.planFile || 'canonical-native-plan.json');
  const manifestFile = path.join(target, options.manifestFile || 'fastly-native-http-manifest.json');
  fs.writeFileSync(sourceFile, compiled.source, 'utf8');
  fs.writeFileSync(wasmFile, compiled.wasm);
  fs.writeFileSync(watFile, compiled.wat, 'utf8');
  fs.writeFileSync(planFile, `${stableStringify(compiled.plan, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestFile, `${stableStringify(compiled.manifest, 2)}\n`, 'utf8');
  return Object.freeze({ target, sourceFile, wasmFile, watFile, planFile, manifestFile, manifest: compiled.manifest });
}

module.exports = Object.freeze({
  FASTLY_NATIVE_HTTP_SHELL_VERSION,
  FASTLY_NATIVE_HTTP_SHELL_GENERATOR_VERSION,
  FASTLY_NATIVE_HTTP_SHELL_COMPILER_VERSION,
  FASTLY_NATIVE_HTTP_SHELL_ABI_VERSION,
  FASTLY_NATIVE_HTTP_BUFFER_BYTES,
  FASTLY_NATIVE_HTTP_MAX_WASM_BYTES,
  FASTLY_NATIVE_HTTP_IMPORTS,
  FASTLY_NATIVE_HTTP_CORE_IMPORTS,
  FastlyNativeHttpShellError,
  generateFastlyNativeHttpAssemblyScript,
  compileFastlyNativeHttpPlan,
  inspectFastlyNativeHttpWasm,
  writeFastlyNativeHttpModule,
  stableStringify
});
