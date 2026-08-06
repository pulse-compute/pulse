
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createKvProvider, createKvError } = require('./kv-provider.js');
const RESULT_NONE = 0; const RESULT_TEXT = 1; const RESULT_JSON = 2; const RESULT_BINARY = 3; const RESULT_EMPTY = 4; const RESULT_STREAM = 5;
function createSetupError(code, message, details) { const err = new Error(message); err.code = code; err.details = details || null; return err; }
function normalizeHeaders(headers) { if (!headers) return []; if (Array.isArray(headers)) return headers.map((pair) => [String(pair[0]), String(pair[1])]); if (typeof headers[Symbol.iterator] === 'function') return Array.from(headers, ([name, value]) => [String(name), String(value)]); return Object.entries(headers).map(([name, value]) => [String(name), String(value)]); }
function methodNameToCode(exports, method) { const upper = String(method || '').toUpperCase(); if (upper === 'GET') return exports.pulse_bridge_method_get(); if (upper === 'POST') return exports.pulse_bridge_method_post(); return 0; }
function createPulseWasmCompiledHostRuntimeWithKv(options = {}) {
  const wasmBytes = options.wasmBytes || (options.wasmPath ? fs.readFileSync(path.resolve(options.wasmPath)) : undefined);
  if (!wasmBytes) throw createSetupError('PULSEWASM_COMPILED_RUNTIME_WASM_REQUIRED', 'createPulseWasmCompiledHostRuntimeWithKv requires wasmBytes or wasmPath.');
  const deploymentPosture = options.deploymentPosture || { engine: 'wasm' };
  if ((deploymentPosture.engine || 'wasm') === 'js' && !options.allowJsEngine) throw createSetupError('PULSEWASM_COMPILED_RUNTIME_ENGINE_MISMATCH', 'compiled-wasm host runtime refuses JS engine posture.', { engine: deploymentPosture.engine });
  const encoder = new TextEncoder(); const decoder = new TextDecoder();
  const module = new WebAssembly.Module(wasmBytes);
  const imports = { env: { abort() { throw new Error('AssemblyScript abort'); } } };
  const instance = new WebAssembly.Instance(module, imports); const exports = instance.exports;
  const hostResponses = new Map();
  for (const [key, value] of Object.entries(options.hostResponses || {})) hostResponses.set(Number(key), value);
  if (!hostResponses.has(77)) hostResponses.set(77, { status: 206, headers: [['Content-Type', 'application/octet-stream'], ['Grip-Channel', 'backend:stream']], bodyStream: { chunks: ['asset:42'] } });
  const kvProvider = options.kvProvider || createKvProvider({ provider: options.runtimeProvider || { kind: 'local', kv: {} } });
  function memory() { return exports.memory; }
  function allocText(text) { const bytes = encoder.encode(String(text ?? '')); const ptr = exports.pulse_alloc(bytes.length || 1); new Uint8Array(memory().buffer, ptr, bytes.length).set(bytes); return { ptr, len: bytes.length }; }
  function readBytes(ptr, len) { if (!ptr || !len) return ''; return decoder.decode(new Uint8Array(memory().buffer, ptr, len)); }
  function readResultHeaders() { const headers = []; const count = exports.pulse_result_header_count ? exports.pulse_result_header_count() : 0; for (let i = 0; i < count; i += 1) headers.push([readBytes(exports.pulse_result_header_name_ptr(i), exports.pulse_result_header_name_len(i)), readBytes(exports.pulse_result_header_value_ptr(i), exports.pulse_result_header_value_len(i)), exports.pulse_result_header_mode ? exports.pulse_result_header_mode(i) : 2]); return headers; }
  function mergeHeaders(base, resultHeaders) { const merged = normalizeHeaders(base); for (const item of resultHeaders || []) { const name = item[0]; const value = item[1]; const mode = Number(item[2] || 2); const lower = String(name).toLowerCase(); if (mode === 1) { for (let i = merged.length - 1; i >= 0; i -= 1) if (String(merged[i][0]).toLowerCase() === lower) merged.splice(i, 1); } merged.push([String(name), String(value)]); } return merged; }
  function decodeResult(status) { const kindCode = exports.pulse_result_kind ? exports.pulse_result_kind() : RESULT_NONE; const resultStatus = exports.pulse_result_status ? exports.pulse_result_status() : status; const resultHeaders = readResultHeaders(); if (kindCode === RESULT_STREAM) { const responseRef = exports.pulse_result_response_ref ? exports.pulse_result_response_ref() : 0; const streamRef = exports.pulse_result_stream_ref ? exports.pulse_result_stream_ref() : 0; const response = hostResponses.get(responseRef) || (streamRef ? { status: resultStatus || status, headers: [], bodyStream: hostResponses.get(streamRef) } : undefined); return { status: resultStatus || (response && response.status) || status, kind: 'stream', kindCode, headers: mergeHeaders(response && response.headers, resultHeaders), bodyStream: response && response.bodyStream, responseRef, streamRef, response, diagnostics: [] }; } const body = exports.pulse_result_body_ptr ? readBytes(exports.pulse_result_body_ptr(), exports.pulse_result_body_len()) : ''; const kind = kindCode === RESULT_JSON ? 'json' : kindCode === RESULT_TEXT ? 'text' : kindCode === RESULT_EMPTY ? 'empty' : 'none'; return { status: resultStatus || status, kind, kindCode, headers: resultHeaders.map(([name, value]) => [name, value]), body: body || undefined, diagnostics: [] }; }
  function executeRequest(input = {}) { const body = allocText(input.bodyText || ''); if (exports.pulse_bridge_set_body_text) exports.pulse_bridge_set_body_text(body.ptr, body.len); const path = allocText(input.path || '/'); const status = exports.pulse_execute_request(methodNameToCode(exports, input.method), path.ptr, path.len); return decodeResult(status); }
  return { version: 'pulsewasm.compiled-wasm-host-runtime-kv.v1', handlerExecutionMode: 'compiled-wasm', provider: kvProvider, kv(name){ return kvProvider.kv(name); }, executeRequest, executeConnect(){ return { event: 'connect', invoked: 0, status: 200 }; }, executeDisconnect(){ return { event: 'disconnect', invoked: 0, status: 200 }; }, close(){}, exports, imports: WebAssembly.Module.imports(module), hostResponses };
}
module.exports = { createPulseWasmCompiledHostRuntimeWithKv, RESULT_NONE, RESULT_TEXT, RESULT_JSON, RESULT_BINARY, RESULT_EMPTY, RESULT_STREAM, createKvError };
