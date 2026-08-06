'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveAsc } = loadBuildSupportAssemblyScriptCompile();
const { getDefaultArtifactsDir } = loadBuildSupportArtifactsDir();
const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const {
  SCHEMA_JSON_GENERIC_PARSER_VERSION,
  SCHEMA_JSON_GENERIC_PARSER_PLAN_VERSION,
  SCHEMA_JSON_GENERIC_PARSER_ABI_VERSION,
  SCHEMA_JSON_GENERIC_PARSER_SMOKE_VERSION,
  SCHEMA_JSON_GENERIC_PARSER_PHASE,
  SCHEMA_JSON_GENERIC_PARSER_ARTIFACT,
  SCHEMA_JSON_GENERIC_PARSER_SMOKE_ARTIFACT,
  SCHEMA_JSON_GENERIC_PARSER_ID,
  SCHEMA_JSON_GENERIC_PARSER_NAME,
  SCHEMA_JSON_GENERIC_PARSER_MODE,
  SCHEMA_JSON_GENERIC_PARSER_FILE,
  SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE,
  SCHEMA_JSON_GENERIC_PARSER_WASM_FILE,
  SCHEMA_JSON_GENERIC_PARSER_WAT_FILE,
  SCHEMA_JSON_GENERIC_PARSER_DOC_FILE,
  SCHEMA_JSON_GENERIC_VALUE_KINDS,
  SCHEMA_JSON_GENERIC_PARSER_ACCESSORS,
  SCHEMA_JSON_GENERIC_RESERVED_SURFACE,
  SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS,
  normalizeJsonParserConfig,
  genericParserNeeded,
  defaultSchemaJsonGenericParserPolicy
} = loadContractsGenericParser();
const {
  SCHEMA_JSON_PLAN_VERSION,
  SCHEMA_JSON_REPORT_VERSION,
  SCHEMA_JSON_REGISTRY_VERSION,
  SCHEMA_JSON_ABI_VERSION,
  SCHEMA_JSON_BODY_POLICY_VERSION,
  DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY,
  DEFAULT_SCHEMA_JSON_MAX_BYTES,
  PHASE: SCHEMA_JSON_PHASE
} = loadContractsSchemaJsonV1();

function loadContractsDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadContractsGenericParser() {
  try { return require('@pulse-compute/wasm-contracts/schema-json/generic-parser'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/schema-json/generic-parser.js');
    throw error;
  }
}
function loadContractsSchemaJsonV1() {
  try { return require('@pulse-compute/wasm-contracts/schema-json/v1'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/schema-json/v1.js');
    throw error;
  }
}
function loadBuildSupportArtifactsDir() {
  try { return require('@pulse-compute/wasm-build-support/artifacts-dir'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-build-support')) return require('../../../build-support/src/artifacts-dir.js');
    throw error;
  }
}
function loadBuildSupportAssemblyScriptCompile() {
  try { return require('@pulse-compute/wasm-build-support/assemblyscript-compile'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-build-support')) return require('../../../build-support/src/assemblyscript-compile.js');
    throw error;
  }
}

function sha256Text(text) { return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex'); }
function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function makeFile(file, text) { return { file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text), text }; }
function stableSlash(value) { return String(value || '').replace(/\\/g, '/'); }
function stripAnsi(value) { return String(value || '').replace(/\u001b\[[0-9;]*m/g, ''); }
function truncate(value, max = 12000) { const text = String(value || ''); return text.length <= max ? text : `${text.slice(0, max)}\n... <truncated ${text.length - max} chars>`; }
function parseAscWarnings(stderr) {
  const text = stripAnsi(stderr);
  const warnings = [];
  const regex = /WARNING\s+(AS\d+):\s+([^\n]+)(?:.|\n)*?in ([^\n]+)\((\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(text))) warnings.push({ code: match[1], message: match[2].trim(), file: match[3], line: Number(match[4]), column: Number(match[5]) });
  if (warnings.length === 0 && /WARNING\s+AS\d+:/m.test(text)) warnings.push({ code: 'AS_WARNING', message: 'AssemblyScript emitted one or more warnings. Inspect stderr.' });
  return warnings;
}
function fileRecord(filePath, cwd, kind) {
  const buffer = fs.readFileSync(filePath);
  return { file: stableSlash(path.relative(cwd, filePath)), kind, bytes: buffer.length, sha256: sha256Buffer(buffer) };
}
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function configArtifact(options = {}) { return options.resolvedConfig?.artifact || options.resolvedConfig || {}; }
function normalizeBuilderOptions(args) {
  if (args.length <= 1) return args[0] || {};
  return args[2] || {};
}
function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({ severity: 'error', phase: 'schema-json-generic-parser', pass: 'schema-json-generic-parser', code, message, hint, details, loc: { file: '<config>' } });
}
function makeWarning(code, message, hint, details) {
  return normalizeDiagnostic({ severity: 'warning', phase: 'schema-json-generic-parser', pass: 'schema-json-generic-parser', code, message, hint, details, loc: { file: '<config>' } });
}
function jsonConfig(config) {
  const artifact = config && config.artifact ? config.artifact : config;
  const runtime = plainObject(artifact && artifact.runtime);
  const payload = plainObject(runtime.payload);
  return plainObject(payload.json || (artifact && artifact.json));
}
function validateSelection(selection, options) {
  const diagnostics = [];
  const warnings = [];
  const json = jsonConfig(configArtifact(options));
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  const parser = selection.parser;
  for (const code of selection.diagnostics || []) {
    if (code === SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.parserRequired) {
      diagnostics.push(makeDiagnostic(code, 'Schema JSON generic parser fallback requires runtime.payload.json.parser = "as-json" when no schemas are supplied.', 'Use runtime.payload.json = { target: "auto", parser: "as-json" } or provide json.schemas for schema sidecars.', { target: selection.target, schemaCount: selection.schemaCount }));
    } else if (code === SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.unsupportedParser) {
      diagnostics.push(makeDiagnostic(code, `Unsupported schema JSON fallback parser ${JSON.stringify(parser)}.`, 'The initial generic fallback supports parser = "as-json" only.', { target: selection.target, parser }));
    } else if (code === SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemaTargetRequiresSchemas) {
      diagnostics.push(makeDiagnostic(code, 'json.target = "schema" requires at least one schema declaration.', 'Provide runtime.payload.json.schemas or use target = "auto" with parser = "as-json" for schema-less generic parsing.', { target: selection.target }));
    } else {
      diagnostics.push(makeDiagnostic(code, 'Schema JSON generic parser configuration is invalid.', 'Check runtime.payload.json.target, parser, and schemas.', { target: selection.target, parser }));
    }
  }
  for (const code of selection.warnings || []) {
    if (code === SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemasTakePrecedence) {
      warnings.push(makeWarning(code, 'json.target = "auto" prefers explicit schema sidecars when schemas are supplied.', 'Remove json.schemas or set target = "parser" to force the generic parser fallback.', { schemas: schemas.length }));
    } else if (code === SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemasIgnored) {
      warnings.push(makeWarning(code, 'json.target = "parser" uses the generic parser and ignores json.schemas.', 'Use target = "schema" or target = "auto" when explicit schemas should own parsing.', { schemas: schemas.length }));
    } else {
      warnings.push(makeWarning(code, 'Schema JSON generic parser selected with a warning.', 'Review runtime.payload.json configuration.', { target: selection.target, parser }));
    }
  }
  if (!selection.genericParser && options.forceGenericParser && diagnostics.length === 0) {
    diagnostics.push(makeDiagnostic(SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.parserRequired, 'Forced schema JSON generic parser emission did not select the as-json parser.', 'Use runtime.payload.json = { target: "parser", parser: "as-json" } or { target: "auto", parser: "as-json" } with no schemas.', { target: selection.target, parser, schemaCount: selection.schemaCount }));
  }
  return { diagnostics, warnings };
}

function genericParserSource() {
  return String.raw`// Generated by PulseWasm Pass 34.
const JSON_NULL: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.null};
const JSON_BOOL: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.bool};
const JSON_NUMBER: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.number};
const JSON_STRING: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.string};
const JSON_ARRAY: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.array};
const JSON_OBJECT: i32 = ${SCHEMA_JSON_GENERIC_VALUE_KINDS.object};

export class PulseSchemaJsonError { code: string = ""; message: string = ""; statusCode: i32 = 400; }
export class JsonValue { kind: i32 = JSON_NULL; raw: string = "null"; }
export class JsonParseResult { ok: bool = false; valueRef: usize = 0; errorRef: usize = 0; }

function makeValue(kind: i32, raw: string): usize { const v = new JsonValue(); v.kind = kind; v.raw = raw; return changetype<usize>(v); }
function makeError(code: string, message: string, statusCode: i32 = 400): usize { const e = new PulseSchemaJsonError(); e.code = code; e.message = message; e.statusCode = statusCode; return changetype<usize>(e); }
function makeOk(valueRef: usize): usize { const r = new JsonParseResult(); r.ok = true; r.valueRef = valueRef; return changetype<usize>(r); }
function makeErr(errorRef: usize): usize { const r = new JsonParseResult(); r.ok = false; r.errorRef = errorRef; return changetype<usize>(r); }
function ws(ch: i32): bool { return ch == 32 || ch == 10 || ch == 13 || ch == 9; }
function skipWs(s: string, p: i32): i32 { let i = p; while (i < s.length && ws(s.charCodeAt(i))) i += 1; return i; }
function trimJson(s: string): string { const start = skipWs(s, 0); let end = s.length - 1; while (end >= start && ws(s.charCodeAt(end))) end -= 1; return start <= end ? s.substring(start, end + 1) : ""; }
function kindOfRaw(raw: string): i32 { if (raw == "null") return JSON_NULL; if (raw == "true" || raw == "false") return JSON_BOOL; if (raw.length > 0 && raw.charCodeAt(0) == 34) return JSON_STRING; if (raw.length > 0 && raw.charCodeAt(0) == 91) return JSON_ARRAY; if (raw.length > 0 && raw.charCodeAt(0) == 123) return JSON_OBJECT; return JSON_NUMBER; }
function findStringEnd(s: string, p: i32): i32 { let i = p + 1; while (i < s.length) { const ch = s.charCodeAt(i); if (ch == 92) { i += 2; continue; } if (ch == 34) return i + 1; i += 1; } return -1; }
function findNumberEnd(s: string, p: i32): i32 { let i = p; if (i < s.length && s.charCodeAt(i) == 45) i += 1; let seen = false; while (i < s.length) { const ch = s.charCodeAt(i); if (ch >= 48 && ch <= 57) { seen = true; i += 1; continue; } if (ch == 46) { i += 1; continue; } break; } return seen ? i : -1; }
function findValueEnd(s: string, p: i32): i32 { const start = skipWs(s, p); if (start >= s.length) return -1; const ch = s.charCodeAt(start); if (ch == 34) return findStringEnd(s, start); if (ch == 123 || ch == 91) { let depth = 0; let i = start; while (i < s.length) { const c = s.charCodeAt(i); if (c == 34) { const e = findStringEnd(s, i); if (e < 0) return -1; i = e; continue; } if (c == 123 || c == 91) depth += 1; if (c == 125 || c == 93) { depth -= 1; if (depth == 0) return i + 1; } i += 1; } return -1; } if (s.substr(start, 4) == "true") return start + 4; if (s.substr(start, 5) == "false") return start + 5; if (s.substr(start, 4) == "null") return start + 4; return findNumberEnd(s, start); }
function validRaw(raw: string): bool { if (raw.length == 0) return false; const end = findValueEnd(raw, 0); return end == raw.length; }
function unquote(raw: string): string { if (raw.length < 2 || raw.charCodeAt(0) != 34) return ""; return raw.substring(1, raw.length - 1); }
function rawOf(valueRef: usize): string { return valueRef == 0 ? "" : changetype<JsonValue>(valueRef).raw; }
function rawNum(valueRef: usize): string { return kind(valueRef) == JSON_NUMBER ? rawOf(valueRef) : "0"; }

export function parse(json: string): usize { const raw = trimJson(json); if (!validRaw(raw)) return makeErr(makeError("PULSEWASM_SCHEMA_JSON_PARSE_ERROR", "Invalid JSON input.", 400)); return makeOk(makeValue(kindOfRaw(raw), raw)); }
export function ok(resultRef: usize): bool { return resultRef != 0 && changetype<JsonParseResult>(resultRef).ok; }
export function value(resultRef: usize): usize { return resultRef == 0 ? 0 : changetype<JsonParseResult>(resultRef).valueRef; }
export function error(resultRef: usize): usize { return resultRef == 0 ? 0 : changetype<JsonParseResult>(resultRef).errorRef; }
export function errorCode(errorRef: usize): string { return errorRef == 0 ? "" : changetype<PulseSchemaJsonError>(errorRef).code; }
export function errorMessage(errorRef: usize): string { return errorRef == 0 ? "" : changetype<PulseSchemaJsonError>(errorRef).message; }
export function errorStatusCode(errorRef: usize): i32 { return errorRef == 0 ? 0 : changetype<PulseSchemaJsonError>(errorRef).statusCode; }
export function kind(valueRef: usize): i32 { return valueRef == 0 ? -1 : changetype<JsonValue>(valueRef).kind; }
export function isNull(valueRef: usize): bool { return kind(valueRef) == JSON_NULL; }
export function asBool(valueRef: usize): bool { return rawOf(valueRef) == "true"; }
export function asF64(valueRef: usize): f64 { return F64.parseFloat(rawNum(valueRef)); }
export function asString(valueRef: usize): string { return kind(valueRef) == JSON_STRING ? unquote(rawOf(valueRef)) : ""; }
export function arrayLen(valueRef: usize): i32 { if (kind(valueRef) != JSON_ARRAY) return 0; const raw = rawOf(valueRef); let i = skipWs(raw, 1); let count = 0; if (i < raw.length && raw.charCodeAt(i) == 93) return 0; while (i < raw.length - 1) { const end = findValueEnd(raw, i); if (end < 0) return count; count += 1; i = skipWs(raw, end); if (i < raw.length && raw.charCodeAt(i) == 44) i = skipWs(raw, i + 1); else break; } return count; }
export function arrayGet(valueRef: usize, index: i32): usize { if (kind(valueRef) != JSON_ARRAY || index < 0) return 0; const raw = rawOf(valueRef); let i = skipWs(raw, 1); let current = 0; while (i < raw.length - 1) { const end = findValueEnd(raw, i); if (end < 0) return 0; if (current == index) { const child = trimJson(raw.substring(i, end)); return makeValue(kindOfRaw(child), child); } current += 1; i = skipWs(raw, end); if (i < raw.length && raw.charCodeAt(i) == 44) i = skipWs(raw, i + 1); else break; } return 0; }
export function objectGet(valueRef: usize, key: string): usize { if (kind(valueRef) != JSON_OBJECT) return 0; const raw = rawOf(valueRef); let i = skipWs(raw, 1); while (i < raw.length - 1) { if (raw.charCodeAt(i) != 34) return 0; const keyEnd = findStringEnd(raw, i); if (keyEnd < 0) return 0; const foundKey = unquote(raw.substring(i, keyEnd)); i = skipWs(raw, keyEnd); if (i >= raw.length || raw.charCodeAt(i) != 58) return 0; i = skipWs(raw, i + 1); const valueEnd = findValueEnd(raw, i); if (valueEnd < 0) return 0; if (foundKey == key) { const child = trimJson(raw.substring(i, valueEnd)); return makeValue(kindOfRaw(child), child); } i = skipWs(raw, valueEnd); if (i < raw.length && raw.charCodeAt(i) == 44) i = skipWs(raw, i + 1); else break; } return 0; }
export function objectHas(valueRef: usize, key: string): bool { return objectGet(valueRef, key) != 0; }

// Stable Pass 34 accessor aliases.
export function has(valueRef: usize, key: string): bool { return objectHas(valueRef, key); }
export function get(valueRef: usize, key: string): usize { return objectGet(valueRef, key); }
export function getString(valueRef: usize, key: string): string { return asString(get(valueRef, key)); }
export function getI32(valueRef: usize, key: string): i32 { return I32.parseInt(rawNum(get(valueRef, key))); }
export function getU32(valueRef: usize, key: string): u32 { return U32.parseInt(rawNum(get(valueRef, key))); }
export function getF64(valueRef: usize, key: string): f64 { return asF64(get(valueRef, key)); }
export function getBool(valueRef: usize, key: string): bool { return asBool(get(valueRef, key)); }
export function length(valueRef: usize): i32 { return arrayLen(valueRef); }
export function at(valueRef: usize, index: i32): usize { return arrayGet(valueRef, index); }
export function text(valueRef: usize): string { return rawOf(valueRef); }
`;
}

function genericParserSmokeRunnerSource() {
  return String.raw`import { parse, ok, value, error, errorCode, kind, objectHas, objectGet, arrayLen, arrayGet, asString, asF64, asBool, isNull, getString, getI32, getBool, length, at, text } from "../as/schema-json/generic/as-json-parser.as";
function root(): usize { const r = parse('{"name":"Ada","age":37,"active":true,"tags":["wasm","json"],"profile":{"email":"ada@example.test"},"missing":null}'); return ok(r) ? value(r) : 0; }
export function smoke_generic_json_object(): i32 { const v = root(); return v != 0 && kind(v) == 5 && objectHas(v, "name") ? 1 : 0; }
export function smoke_generic_json_string(): i32 { return asString(objectGet(root(), "name")) == "Ada" && getString(root(), "name") == "Ada" ? 1 : 0; }
export function smoke_generic_json_number_bool_null(): i32 { const v = root(); return asF64(objectGet(v, "age")) == 37.0 && getI32(v, "age") == 37 && asBool(objectGet(v, "active")) && getBool(v, "active") && isNull(objectGet(v, "missing")) ? 1 : 0; }
export function smoke_generic_json_array_nested_object(): i32 { const v = root(); const tags = objectGet(v, "tags"); const p = objectGet(v, "profile"); return arrayLen(tags) == 2 && length(tags) == 2 && asString(arrayGet(tags, 1)) == "json" && asString(at(tags, 0)) == "wasm" && asString(objectGet(p, "email")) == "ada@example.test" ? 1 : 0; }
export function smoke_generic_json_text(): i32 { return text(objectGet(root(), "profile")).indexOf("email") >= 0 ? 1 : 0; }
export function smoke_generic_json_error(): i32 { const r = parse('{"bad":'); return !ok(r) && errorCode(error(r)) == "PULSEWASM_SCHEMA_JSON_PARSE_ERROR" ? 1 : 0; }
`;
}

function compileAndSmoke({ cwd, outDir, files, checkNames }) {
  const diagnostics = [];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-schema-json-generic-'));
  for (const file of files) {
    const target = path.join(temp, file.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text, 'utf8');
  }
  const runner = path.join(temp, SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE);
  const wasmFile = path.join(outDir, SCHEMA_JSON_GENERIC_PARSER_WASM_FILE);
  const watFile = path.join(outDir, SCHEMA_JSON_GENERIC_PARSER_WAT_FILE);
  fs.mkdirSync(path.dirname(wasmFile), { recursive: true });
  const asc = resolveAsc(cwd);
  const args = [runner, '--outFile', wasmFile, '--textFile', watFile, '--runtime', 'stub', '--optimize'];
  if (!asc) {
    diagnostics.push({ phase: 'schema-json-generic-parser', code: SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.ascMissing, severity: 'error', message: 'AssemblyScript compiler is not installed.', hint: 'Run npm install so the assemblyscript dev dependency is available.', loc: { file: '<schema-json-generic-parser>' } });
    return { diagnostics, warnings: [], smoke: undefined, outputs: [], command: undefined, result: undefined };
  }
  const proc = spawnSync(asc.executable || asc.command, asc.script ? [asc.script, ...args] : args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true });
  const warnings = parseAscWarnings(proc.stderr);
  if (proc.status !== 0) {
    diagnostics.push({ phase: 'schema-json-generic-parser', code: SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.compileFailed, severity: 'error', message: 'Schema JSON generic parser smoke compilation failed.', hint: 'Inspect schema-json-generic-parser-smoke.json stderr.', loc: { file: '<schema-json-generic-parser>' }, details: { stdout: truncate(proc.stdout), stderr: truncate(proc.stderr), exitCode: proc.status } });
  }
  const outputs = [];
  if (fs.existsSync(wasmFile)) outputs.push(fileRecord(wasmFile, cwd, 'schema-json-generic-parser-wasm'));
  if (fs.existsSync(watFile)) outputs.push(fileRecord(watFile, cwd, 'schema-json-generic-parser-wat'));
  let smoke;
  if (diagnostics.length === 0 && fs.existsSync(wasmFile)) {
    const wasm = fs.readFileSync(wasmFile);
    const module = new WebAssembly.Module(wasm);
    const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('AssemblyScript abort'); } } });
    const checks = checkNames.map((name) => {
      let actual;
      let status = 'ok';
      let message;
      try {
        const fn = instance.exports[name];
        if (typeof fn !== 'function') { status = 'error'; message = 'Missing smoke export.'; }
        else { actual = fn(); if (actual !== 1) { status = 'error'; message = `Expected 1, got ${actual}.`; } }
      } catch (error) { status = 'error'; message = error.message || String(error); }
      return { name, expected: 1, actual, status, message };
    });
    smoke = { imports: WebAssembly.Module.imports(module), exports: WebAssembly.Module.exports(module), checks, failedChecks: checks.filter((c) => c.status !== 'ok'), wasmBytes: wasm.length };
    if (smoke.failedChecks.length) {
      diagnostics.push({ phase: 'schema-json-generic-parser', code: SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.smokeFailed, severity: 'error', message: 'Schema JSON generic parser smoke checks failed.', hint: 'Inspect schema-json-generic-parser-smoke.json checks.', loc: { file: '<schema-json-generic-parser>' } });
    }
  }
  return {
    diagnostics,
    warnings,
    smoke,
    outputs,
    command: {
      executable: 'node node_modules/assemblyscript/bin/asc.js',
      args: [
        SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE,
        '--outFile',
        SCHEMA_JSON_GENERIC_PARSER_WASM_FILE,
        '--textFile',
        SCHEMA_JSON_GENERIC_PARSER_WAT_FILE,
        '--runtime',
        'stub',
        '--optimize'
      ]
    },
    result: { exitCode: proc.status, stdout: truncate(proc.stdout), stderr: truncate(proc.stderr) }
  };
}

function buildMarkdown(artifact) {
  const lines = [];
  lines.push('# PulseWasm Schema JSON Generic Parser');
  lines.push('');
  lines.push(`Generated by: \`${artifact.generatedBy}\``);
  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push('- provide an explicit AssemblyScript JSON value-tree fallback when schema declarations are absent');
  lines.push('- keep values behind opaque refs and typed accessors rather than JS object semantics');
  lines.push('- preserve schema sidecars as the preferred mode when schemas are supplied');
  lines.push('');
  lines.push('## Accessors');
  lines.push('');
  for (const accessor of SCHEMA_JSON_GENERIC_PARSER_ACCESSORS) lines.push(`- \`${accessor}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildSchemaJsonGenericParser(...args) {
  const options = normalizeBuilderOptions(args);
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const generatedBy = options.generatedBy || PACKAGE_VERSION;
  const config = configArtifact(options);
  const json = jsonConfig(config);
  let selection = normalizeJsonParserConfig(config);
  if (options.forceGenericParser && !selection.genericParser) {
    selection = {
      ...selection,
      target: selection.target === 'generic' || selection.target === 'none' ? 'parser' : selection.target,
      effectiveTarget: 'parser',
      parser: SCHEMA_JSON_GENERIC_PARSER_NAME,
      genericParser: true,
      schemaSidecar: false,
      mode: SCHEMA_JSON_GENERIC_PARSER_MODE,
      diagnostics: [],
      warnings: selection.schemaCount > 0 ? [SCHEMA_JSON_GENERIC_PARSER_DIAGNOSTICS.schemasIgnored] : []
    };
  }
  const validation = validateSelection(selection, options);
  const diagnostics = [...validation.diagnostics];
  const warnings = [...validation.warnings];
  const active = selection.genericParser && diagnostics.length === 0;
  const files = [];
  let compileResult = { diagnostics: [], warnings: [], smoke: undefined, outputs: [], command: undefined, result: undefined };
  const checkNames = ['smoke_generic_json_object', 'smoke_generic_json_string', 'smoke_generic_json_number_bool_null', 'smoke_generic_json_array_nested_object', 'smoke_generic_json_text', 'smoke_generic_json_error'];
  if (active) {
    files.push(makeFile(SCHEMA_JSON_GENERIC_PARSER_FILE, genericParserSource()));
    files.push(makeFile(SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE, genericParserSmokeRunnerSource()));
    compileResult = compileAndSmoke({ cwd, outDir, files, checkNames });
    diagnostics.push(...compileResult.diagnostics);
    warnings.push(...compileResult.warnings.map((warning) => normalizeDiagnostic({ ...warning, severity: 'warning', phase: 'schema-json-generic-parser', pass: 'schema-json-generic-parser' })));
  }
  const status = diagnostics.length ? 'error' : 'ok';
  const contentTypePolicy = typeof json.contentTypePolicy === 'string' && json.contentTypePolicy ? json.contentTypePolicy : DEFAULT_SCHEMA_JSON_CONTENT_TYPE_POLICY;
  const maxBytes = Number.isFinite(Number(json.maxBytes)) ? Number(json.maxBytes) : DEFAULT_SCHEMA_JSON_MAX_BYTES;
  const summary = {
    active,
    target: selection.target,
    effectiveTarget: selection.effectiveTarget,
    parser: selection.parser || null,
    schemas: selection.schemaCount,
    schemaSidecar: false,
    genericJsonTree: active,
    generatedFiles: files.length,
    compiled: Boolean(compileResult.smoke) && diagnostics.length === 0,
    smokeExecuted: Boolean(compileResult.smoke),
    smokeChecks: compileResult.smoke ? compileResult.smoke.checks.length : 0,
    failedSmokeChecks: compileResult.smoke ? compileResult.smoke.failedChecks.length : 0,
    seededBodyTextOnly: true,
    directJsObjects: false,
    diagnostics: diagnostics.length,
    warnings: warnings.length
  };
  const artifact = normalizeArtifact({
    version: SCHEMA_JSON_GENERIC_PARSER_VERSION,
    generatedBy,
    status,
    phase: SCHEMA_JSON_GENERIC_PARSER_PHASE,
    artifact: SCHEMA_JSON_GENERIC_PARSER_ARTIFACT,
    contractId: SCHEMA_JSON_GENERIC_PARSER_ID,
    parser: SCHEMA_JSON_GENERIC_PARSER_NAME,
    mode: SCHEMA_JSON_GENERIC_PARSER_MODE,
    active,
    policy: defaultSchemaJsonGenericParserPolicy(),
    selection,
    moduleFile: active ? SCHEMA_JSON_GENERIC_PARSER_FILE : null,
    smokeArtifact: SCHEMA_JSON_GENERIC_PARSER_SMOKE_ARTIFACT,
    wasmFile: active ? SCHEMA_JSON_GENERIC_PARSER_WASM_FILE : null,
    watFile: active ? SCHEMA_JSON_GENERIC_PARSER_WAT_FILE : null,
    valueKinds: SCHEMA_JSON_GENERIC_VALUE_KINDS,
    accessors: SCHEMA_JSON_GENERIC_PARSER_ACCESSORS,
    reservedSurface: SCHEMA_JSON_GENERIC_RESERVED_SURFACE,
    diagnostics,
    warnings,
    summary
  }, cwd);
  const plan = normalizeArtifact({
    version: SCHEMA_JSON_GENERIC_PARSER_PLAN_VERSION,
    generatedBy,
    status,
    target: selection.target,
    effectiveTarget: selection.effectiveTarget,
    parserModel: {
      kind: SCHEMA_JSON_GENERIC_PARSER_MODE,
      parser: SCHEMA_JSON_GENERIC_PARSER_NAME,
      genericJsonTree: active,
      dependencyFree: true,
      parseResultAbi: true,
      opaqueRefs: true,
      directJsObjectMaterialization: false,
      schemaSidecarsPreferredWhenSchemasSupplied: true
    },
    schemas: [],
    diagnostics,
    warnings,
    summary
  }, cwd);
  const registry = normalizeArtifact({
    version: SCHEMA_JSON_REGISTRY_VERSION,
    generatedBy,
    status,
    target: selection.target,
    defaultNamespace: 'app',
    schemas: [],
    genericParser: {
      version: SCHEMA_JSON_GENERIC_PARSER_VERSION,
      parser: SCHEMA_JSON_GENERIC_PARSER_NAME,
      mode: SCHEMA_JSON_GENERIC_PARSER_MODE,
      moduleFile: active ? SCHEMA_JSON_GENERIC_PARSER_FILE : null,
      accessors: SCHEMA_JSON_GENERIC_PARSER_ACCESSORS,
      valueKinds: SCHEMA_JSON_GENERIC_VALUE_KINDS
    },
    diagnostics,
    warnings,
    summary
  }, cwd);
  const sidecarAbi = normalizeArtifact({
    version: SCHEMA_JSON_GENERIC_PARSER_ABI_VERSION,
    generatedBy,
    status,
    phase: SCHEMA_JSON_PHASE,
    genericParser: true,
    parseAbi: {
      parse: '(json: string) => JsonParseResultRef',
      ok: '(resultRef: usize) => bool',
      value: '(resultRef: usize) => JsonValueRef',
      error: '(resultRef: usize) => PulseErrorRef'
    },
    valueAbi: {
      kind: '(valueRef: usize) => i32',
      has: '(valueRef: usize, key: string) => bool',
      get: '(valueRef: usize, key: string) => JsonValueRef',
      at: '(valueRef: usize, index: i32) => JsonValueRef',
      text: '(valueRef: usize) => string'
    },
    accessors: SCHEMA_JSON_GENERIC_PARSER_ACCESSORS,
    diagnostics,
    warnings,
    summary
  }, cwd);
  const bodyPolicy = normalizeArtifact({
    version: SCHEMA_JSON_BODY_POLICY_VERSION,
    generatedBy,
    status,
    phase: SCHEMA_JSON_PHASE,
    canonicalHandlerSurface: 'ctx.req.parse(schemaId) for schemas; generic parser refs for explicit parser fallback',
    requestBodyAccess: {
      lazyByArchitecture: true,
      phase34Mode: 'seeded-body-text-only',
      bodyReadEffect: 'reserved',
      automaticBodyRead: false,
      automaticParseDuringRouting: false
    },
    contentTypePolicy: {
      default: contentTypePolicy,
      maxBytes,
      implemented: ['accept-json-or-missing', 'require-json'],
      reserved: ['ignore-content-type']
    },
    diagnostics,
    warnings,
    summary
  }, cwd);
  const report = normalizeArtifact({
    version: SCHEMA_JSON_REPORT_VERSION,
    generatedBy,
    status,
    lowering: [{
      kind: SCHEMA_JSON_GENERIC_PARSER_MODE,
      parser: SCHEMA_JSON_GENERIC_PARSER_NAME,
      moduleFile: active ? SCHEMA_JSON_GENERIC_PARSER_FILE : null,
      smokeRunner: active ? SCHEMA_JSON_GENERIC_PARSER_SMOKE_RUNNER_FILE : null,
      accessors: SCHEMA_JSON_GENERIC_PARSER_ACCESSORS,
      valueKinds: SCHEMA_JSON_GENERIC_VALUE_KINDS,
      outputFiles: compileResult.outputs || []
    }],
    command: compileResult.command,
    result: compileResult.result,
    outputFiles: compileResult.outputs || [],
    diagnostics,
    warnings,
    summary
  }, cwd);
  const smoke = normalizeArtifact({
    version: SCHEMA_JSON_GENERIC_PARSER_SMOKE_VERSION,
    generatedBy,
    status,
    active,
    command: compileResult.command,
    result: compileResult.result,
    generated: { inputFiles: files.map(({ text, ...rest }) => rest), outputFiles: compileResult.outputs || [] },
    checks: compileResult.smoke ? compileResult.smoke.checks : [],
    diagnostics,
    warnings,
    summary: {
      compiled: Boolean(compileResult.outputs?.length) && diagnostics.length === 0,
      executed: Boolean(compileResult.smoke),
      checks: compileResult.smoke ? compileResult.smoke.checks.length : 0,
      failedChecks: compileResult.smoke ? compileResult.smoke.failedChecks.length : 0,
      diagnostics: diagnostics.length,
      warnings: warnings.length
    }
  }, cwd);
  return {
    artifact,
    plan,
    report,
    registry,
    sidecarAbi,
    abi: sidecarAbi,
    bodyPolicy,
    smoke,
    files: files.concat([makeFile(SCHEMA_JSON_GENERIC_PARSER_DOC_FILE, buildMarkdown(artifact))]),
    outputFiles: compileResult.outputs || [],
    diagnostics,
    warnings,
    selection
  };
}

module.exports = {
  buildSchemaJsonGenericParser,
  genericParserNeeded,
  genericParserSource,
  genericParserSmokeRunnerSource
};
