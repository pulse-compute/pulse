'use strict';

const crypto = require('node:crypto');
const { schemaNeedsValueProjection, schemaHasScalarRecord, schemaHasNestedJson } = require('@pulse-compute/wasm-contracts/schema-json/registry');
const { scalarRecordRuntimeSource, generateScalarRecordTextValidation } = require('./schema-scalar-record.js');
const { generateSchemaPresenceCodec } = require('./schema-presence-codec.js');
const { jsonAdmissionRuntimeSource, generateSchemaJsonPolicy } = require('./schema-admission.js');
const { nestedJsonProjectionSource } = require('./schema-nested-json.js');
const {
  buildNativeCryptoGuestSources
} = require('./crypto-guest-source.js');

function loadRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/handler/canonical-native-runtime.js');
    }
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

const runtimeContract = loadRuntimeContract();
const runtimePlanContract = require('@pulse-compute/wasm-contracts/handler/canonical-native-plan');
const eventContract = loadEventContract();
const CANONICAL_NATIVE_AS_GENERATOR_VERSION = runtimeContract.CANONICAL_NATIVE_AS_GENERATOR_VERSION;

class CanonicalNativeAssemblyScriptError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'CanonicalNativeAssemblyScriptError';
    this.code = 'PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED';
    this.detail = Object.freeze({ ...detail });
  }
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function quote(value) {
  return JSON.stringify(String(value));
}

function schemaIdentifier(value) {
  const normalized = String(value || 'schema').normalize('NFKC').replace(/[^A-Za-z0-9_$]+/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function nativeSchemaCodecSource(plan) {
  const registry = plan.schemas && plan.schemas.registry;
  const schemas = registry && Array.isArray(registry.schemas) ? registry.schemas : [];
  if (schemas.length === 0) {
    return Object.freeze({
      active: false,
      imports: Object.freeze([]),
      declarations: Object.freeze([]),
      exports: Object.freeze([]),
      codecs: Object.freeze([]),
      sourceHash: null
    });
  }

  const declarations = [];
  const codecEntries = [];

  function typeFor(node, symbols, path) {
    switch (node.kind) {
      case 'string': return 'string';
      case 'boolean': return 'bool';
      case 'i32': return 'i32';
      case 'u32': return 'u32';
      case 'f64': return 'f64';
      case 'string-enum': return 'string';
      case 'array': return `Array<${typeFor(node.element, symbols, [...path, 'item'])}>`;
      case 'object': return symbols.get(path.join('.'));
      case 'nullable': {
        const inner = typeFor(node.value, symbols, [...path, 'value']);
        return ['boolean', 'i32', 'u32', 'f64'].includes(node.value.kind)
          ? `JSON.Box<${inner}> | null`
          : `${inner} | null`;
      }
      default: throw new CanonicalNativeAssemblyScriptError(`Unsupported Native schema node ${String(node.kind)}.`, { node, path });
    }
  }

  function defaultFor(node, symbols, path) {
    if (node.kind === 'nullable') return 'null';
    if (node.kind === 'string' || node.kind === 'string-enum') return "''";
    if (node.kind === 'boolean') return 'false';
    if (node.kind === 'i32' || node.kind === 'u32') return '0';
    if (node.kind === 'f64') return '0.0';
    if (node.kind === 'array') return `new Array<${typeFor(node.element, symbols, [...path, 'item'])}>()`;
    if (node.kind === 'object') return `new ${symbols.get(path.join('.'))}()`;
    throw new CanonicalNativeAssemblyScriptError(`Unsupported Native schema default for ${String(node.kind)}.`, { node, path });
  }

  function collectObjects(schema, schemaIndex, node, symbols, records, path = []) {
    if (node.kind === 'nullable') {
      collectObjects(schema, schemaIndex, node.value, symbols, records, [...path, 'value']);
      return;
    }
    if (node.kind === 'array') {
      collectObjects(schema, schemaIndex, node.element, symbols, records, [...path, 'item']);
      return;
    }
    if (node.kind !== 'object') return;
    const key = path.join('.');
    const suffix = path.length === 0
      ? ''
      : `_${path.map(schemaIdentifier).join('_')}_${stableHash(JSON.stringify(path)).slice(0, 8)}`;
    const baseSymbol = registry.codecs
      && registry.codecs[schemaIndex]
      && registry.codecs[schemaIndex].native
      && registry.codecs[schemaIndex].native.symbol
      || `__Pulse_${schemaIdentifier(schema.id)}_${schemaIndex}`;
    const symbol = `${baseSymbol}${suffix}`;
    symbols.set(key, symbol);
    for (const field of node.fields) collectObjects(schema, schemaIndex, field.value, symbols, records, [...path, field.name]);
    records.push(Object.freeze({ symbol, node, path: Object.freeze([...path]) }));
  }

  if (schemas.some(schema => schemaHasScalarRecord(schema.root) || schemaHasNestedJson(schema.root))) declarations.push(scalarRecordRuntimeSource());
  if (schemas.some(schema => schema.jsonLimits)) declarations.push(jsonAdmissionRuntimeSource());
  if (schemas.some(schema => schemaHasNestedJson(schema.root))) declarations.push(nestedJsonProjectionSource());
  schemas.forEach((schema, schemaIndex) => {
    const decode = `__pulse_schema_decode_${schemaIndex}`;
    const encode = `__pulse_schema_encode_${schemaIndex}`;
    let root;
    if (schema.jsonLimits) declarations.push(generateSchemaJsonPolicy(schema, schemaIndex, registry.maxBytes));
    if (schemaNeedsValueProjection(schema.root) || schema.jsonLimits) {
      root = 'JSON.Value';
      const presence = generateSchemaPresenceCodec(schema.root, schemaIndex);
      declarations.push(...presence.declarations);
      const nested = schemaHasNestedJson(schema.root);
      const recordText = schemaHasScalarRecord(schema.root) || nested ? generateScalarRecordTextValidation(schema.root, schemaIndex) : null;
      if (recordText) declarations.push(...recordText.declarations);
      for (const fn of [decode, encode]) {
        declarations.push(`function ${fn}(input: string): string {`);
        if (schema.jsonLimits) {
          declarations.push(`  const admission = __pulse_schema_json_scan_${schemaIndex}(input)`);
          declarations.push('  if (admission.failure != 0) abort("JSON admission failed", "pulse-schema-codecs", 0, 0)');
          if (recordText) declarations.push(`  ${recordText.apply}(new __PulseSchemaTextCursor(input), 0${nested ? ', admission.duplicateObjects' : ''})`);
        }
        declarations.push(`  const value = JSON.parse<JSON.Value>(input)`);
        if (recordText && !schema.jsonLimits) declarations.push(`  ${recordText.apply}(new __PulseSchemaTextCursor(input), 0)`);
        declarations.push(`  const text = JSON.stringify<JSON.Value>(${presence.apply}(value))`);
        if (schema.jsonLimits) declarations.push(`  if (__pulse_schema_json_scan_${schemaIndex}(text, 0).failure != 0) abort("JSON output admission failed", "pulse-schema-codecs", 0, 0)`);
        declarations.push('  return text');
        declarations.push('}');
      }
    } else {
      const symbols = new Map();
      const records = [];
      collectObjects(schema, schemaIndex, schema.root, symbols, records);
      for (const record of records) {
        declarations.push('@json');
        declarations.push(`class ${record.symbol} {`);
        record.node.fields.forEach((field, fieldIndex) => {
          const member = `field_${fieldIndex}`;
          declarations.push(`  @alias(${quote(field.name)})`);
          declarations.push(`  ${member}: ${typeFor(field.value, symbols, [...record.path, field.name])} = ${defaultFor(field.value, symbols, [...record.path, field.name])}`);
        });
        declarations.push('}');
        declarations.push('');
      }
      root = symbols.get('');
      // json-as 1.5.0's slow struct scanner treats a closing quote after a
      // doubled backslash as escaped. A JSON-equivalent Unicode spelling avoids
      // that scanner defect without changing schema values or admitting fallback.
      declarations.push(`function ${decode}(input: string): string {`);
      declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
      declarations.push(`  return JSON.stringify<${root}>(value)`);
      declarations.push('}');
      declarations.push(`function ${encode}(input: string): string {`);
      declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
      declarations.push(`  return JSON.stringify<${root}>(value)`);
      declarations.push('}');
    }
    declarations.push('');
    codecEntries.push(Object.freeze({
      id: String(schema.id),
      index: schemaIndex,
      rootClass: root,
      decode,
      encode,
      semanticHash: registry.codecs && registry.codecs[schemaIndex] && registry.codecs[schemaIndex].semanticHash,
      nativeHash: registry.codecs && registry.codecs[schemaIndex] && registry.codecs[schemaIndex].native && registry.codecs[schemaIndex].native.hash
    }));
  });

  const exports = [
    "let __pulse_schema_result: string = ''",
    'export function pulse_schema_string_id(): i32 { return idof<string>() }',
    'export function pulse_schema_decode(schemaIndex: i32, inputPointer: i32): i32 {',
    '  const input = changetype<string>(inputPointer)',
    '  switch (schemaIndex) {',
    ...codecEntries.map((entry) => `    case ${entry.index}: __pulse_schema_result = ${entry.decode}(input); break`),
    "    default: abort('Unknown Pulse schema codec index', 'pulse-schema-codecs', 0, 0)",
    '  }',
    '  return changetype<i32>(__pulse_schema_result)',
    '}',
    'export function pulse_schema_encode(schemaIndex: i32, inputPointer: i32): i32 {',
    '  const input = changetype<string>(inputPointer)',
    '  switch (schemaIndex) {',
    ...codecEntries.map((entry) => `    case ${entry.index}: __pulse_schema_result = ${entry.encode}(input); break`),
    "    default: abort('Unknown Pulse schema codec index', 'pulse-schema-codecs', 0, 0)",
    '  }',
    '  return changetype<i32>(__pulse_schema_result)',
    '}',
    ''
  ];
  const source = [
    "import { JSON } from 'json-as'",
    '',
    ...declarations,
    ...exports
  ].join('\n');
  return Object.freeze({
    active: true,
    imports: Object.freeze(["import { JSON } from 'json-as'"]),
    declarations: Object.freeze(declarations),
    exports: Object.freeze(exports),
    codecs: Object.freeze(codecEntries),
    sourceHash: stableHash(source)
  });
}

function collectExpressions(plan) {
  const expressions = [];
  const seen = new WeakSet();

  function add(expression) {
    if (!expression || typeof expression !== 'object' || seen.has(expression)) return;
    seen.add(expression);
    expressions.push(expression);
    switch (expression.kind) {
      case 'array':
        for (const item of expression.items || []) add(item.kind === 'spread' ? item.value : item);
        break;
      case 'object':
        for (const entry of expression.entries || []) {
          if (entry.kind === 'spread') add(entry.value);
          else {
            if (entry.key && entry.key.kind === 'computed') add(entry.key.value);
            else add(entry.key);
            add(entry.value);
          }
        }
        break;
      case 'template':
        for (const part of expression.parts || []) if (part.kind === 'value') add(part.value);
        break;
      case 'binary':
        add(expression.left);
        add(expression.right);
        break;
      case 'unary':
        add(expression.value);
        break;
      case 'conditional':
        add(expression.test);
        add(expression.whenTrue);
        add(expression.whenFalse);
        break;
      case 'property':
        add(expression.object);
        break;
      case 'element':
        add(expression.object);
        add(expression.index);
        break;
      case 'pure-helper-call':
      case 'intrinsic':
        for (const argument of expression.arguments || []) add(argument);
        break;
      case 'method-call':
        add(expression.receiver);
        for (const argument of expression.arguments || []) add(argument);
        break;
      case 'assignment':
        add(expression.target);
        add(expression.value);
        break;
      case 'update':
        add(expression.target);
        break;
      case 'spread':
        add(expression.value);
        break;
      default:
        break;
    }
  }

  function walkStatements(statements) {
    for (const statement of statements || []) {
      if (statement.kind === 'helper-call') for (const arg of statement.arguments) add(arg);
      else if (statement.kind === 'local') add(statement.value);
      else if (statement.kind === 'expression') add(statement.expression);
      else if (statement.kind === 'return') add(statement.value);
      else if (statement.kind === 'if') {
        add(statement.test);
        walkStatements(statement.then);
        walkStatements(statement.else);
      } else if (statement.kind === 'pure-loop' || statement.kind === 'read-loop') {
        if (statement.kind === 'read-loop') { add(statement.initial); add(statement.increment); }
        add(statement.test);
        walkStatements(statement.body);
      }
    }
  }

  walkStatements(plan.entry && plan.entry.body);
  for (const handler of [...(plan.handlers || []), ...(plan.stages || []), ...(plan.helpers || [])]) walkStatements(handler.body);
  for (const effect of plan.effects || []) {
    for (const input of effect.inputs || []) add(input.value);
    const decoder = effect.result && effect.result.decoder;
    for (const argument of (decoder && decoder.arguments) || []) add(argument);
  }
  return expressions;
}

function generateCanonicalNativeAssemblyScript(plan, options = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('generateCanonicalNativeAssemblyScript requires a canonical native plan.');
  const pureHelpers = new Map((plan.helpers || []).filter(h => h.version === runtimePlanContract.CANONICAL_NATIVE_PURE_HELPER_VERSION).map((h, i) => [h.id, { ...h, nativeName: `__pulse_pure_helper_${i}` }]));
  const stages = new Map((plan.stages || []).map(stage => [stage.id, stage]));
  const stageBindings = new Map((plan.stages || []).flatMap(stage => stage.registrations.map(row => [row.entryId, row])));
  const stageEntries = new Map();
  const stageSites = new Map((plan.effects || []).flatMap((effect, index) => effect.stageId === undefined ? [] : [[index, { site: effect.stageSite }]]));
  const maxStageSites = Math.max(0, ...(plan.stages || []).map(stage => stage.effectIds.length));
  const localIndex = new Map((plan.locals || []).map((local, index) => [String(local.id), index]));
  const effectIndex = new Map((plan.effects || []).map((effect, index) => [String(effect.id), index]));
  const continuationIndex = new Map((plan.continuations || []).map((continuation) => [String(continuation.id), Number(continuation.stateIndex)]));
  const expressions = collectExpressions(plan);
  const expressionIndex = new Map(expressions.map((expression, index) => [expression, index]));
  const expressionAlias = new Map();
  const retainedExpressions = new Set();
  const stateEnabled = expressions.some((expression) => expression && expression.kind === 'intrinsic' && ['state.get', 'state.set'].includes(expression.name));
  const binaryIndex = new Map(runtimeContract.CANONICAL_NATIVE_BINARY_OPERATORS.map((operator, index) => [operator, index]));
  const unaryIndex = new Map(runtimeContract.CANONICAL_NATIVE_UNARY_OPERATORS.map((operator, index) => [operator, index]));
  const nativeSchemaCodecs = nativeSchemaCodecSource(plan);
  const nativeCrypto = buildNativeCryptoGuestSources(plan);
  const eventEntries = plan.events && plan.events.catalog && Array.isArray(plan.events.catalog.events)
    ? plan.events.catalog.events
    : [];
  const eventReachable = eventEntries.length > 0;
  if (eventReachable && (!plan.events.abi || plan.events.abi.version !== eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION)) {
    throw new CanonicalNativeAssemblyScriptError('Event-reachable Native plans require the frozen event ABI extension.', {
      planHash: plan.planHash,
      expected: eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION,
      actual: plan.events.abi && plan.events.abi.version
    });
  }

  for (const effect of plan.effects || []) {
    const decoder = effect.result && effect.result.decoder;
    const decoderArguments = (decoder && decoder.arguments) || [];
    if (!decoder || decoderArguments.length === 0) continue;
    const supportedSchemaDecoder = decoder.kind === 'json'
      && decoderArguments.length === 1
      && decoderArguments[0].kind === 'literal'
      && typeof decoderArguments[0].value === 'string';
    if (!supportedSchemaDecoder) {
      throw new CanonicalNativeAssemblyScriptError('Native effect-result decoder arguments must be one static JSON schema ID.', {
        planHash: plan.planHash,
        effectId: effect.id,
        decoder: decoder.kind,
        arguments: decoderArguments
      });
    }
  }

  function fail(message, detail = {}) {
    throw new CanonicalNativeAssemblyScriptError(message, { planHash: plan.planHash, ...detail });
  }

  function exprName(expression) {
    const index = expressionIndex.get(expression);
    if (!Number.isInteger(index)) fail('Expression was not registered for native AssemblyScript generation.', { expression });
    const representative = expressionAlias.get(index) ?? index;
    // Encode the existing decision without changing identifier length or
    // lexical order: chunk budgets count source characters and Binaryen uses
    // names to break function-ordering ties. '$' sorts before the next digit.
    return `__pulse_ex_${representative}$${retainedExpressions.has(representative) ? 'k' : 'i'}`;
  }

  function localName(localId) {
    const index = localIndex.get(String(localId));
    if (!Number.isInteger(index)) fail(`Native plan references unknown local ${String(localId)}.`, { localId });
    return `__pulse_local_${index}`;
  }

  function stringHandle(value) {
    return `__pulse_string(${quote(value)})`;
  }

  function targetParts(target, emit) {
    if (!target || typeof target !== 'object') fail('Native assignment target is missing.', { target });
    if (target.kind === 'local') {
      const name = localName(target.id);
      return {
        read: name,
        write(valueExpression) { emit(`${name} = ${valueExpression}`); return name; }
      };
    }
    if (target.kind === 'property') {
      const object = '__pulse_target_object';
      const key = '__pulse_target_key';
      emit(`const ${object} = ${exprName(target.object)}()`);
      emit(`const ${key} = ${stringHandle(target.property)}`);
      return {
        read: `host_value_property(${object}, ${key})`,
        write(valueExpression) { return `host_value_property_set(${object}, ${key}, ${valueExpression})`; }
      };
    }
    if (target.kind === 'element') {
      const object = '__pulse_target_object';
      const key = '__pulse_target_key';
      emit(`const ${object} = ${exprName(target.object)}()`);
      emit(`const ${key} = ${exprName(target.index)}()`);
      return {
        read: `host_value_element(${object}, ${key})`,
        write(valueExpression) { return `host_value_element_set(${object}, ${key}, ${valueExpression})`; }
      };
    }
    fail('Native assignment target must be a local, property, or element.', { targetKind: target.kind });
  }

  function renderExpression(expression) {
    const lines = [];
    const emit = (line) => lines.push(`  ${line}`);
    switch (expression.kind) {
      case 'literal':
        if (expression.value === null) emit('return host_value_null()');
        else if (typeof expression.value === 'boolean') emit(`return host_value_boolean(${expression.value ? 1 : 0})`);
        else if (typeof expression.value === 'number') emit(`return host_value_number(${Number(expression.value)})`);
        else if (typeof expression.value === 'string') emit(`return ${stringHandle(expression.value)}`);
        else fail('Native Wasm compiler only accepts JSON primitive literal expressions.', { kind: expression.kind, value: expression.value });
        break;
      case 'undefined':
        emit('return host_value_undefined()');
        break;
      case 'local':
        emit(`return ${localName(expression.id)}`);
        break;
      case 'context-read': {
        const key = (expression.path || []).join('.');
        const calls = {
          'req.method': 'host_request_method()',
          'req.url': 'host_request_url()',
          'req.path': 'host_request_path()',
          'req.headers': 'host_request_headers()',
          'event.payload': '__pulse_event_payload_handle == 0 ? host_value_null() : __pulse_event_payload_handle'
        };
        if (!calls[key]) fail(`Unsupported native context read ${key || '<root>'}.`, { key });
        emit(`return ${calls[key]}`);
        break;
      }
      case 'array':
        emit('const value = host_value_array()');
        for (const item of expression.items || []) {
          if (item.kind === 'spread') emit(`host_value_array_spread(value, ${exprName(item.value)}())`);
          else emit(`host_value_array_push(value, ${exprName(item)}())`);
        }
        emit('return value');
        break;
      case 'object':
        emit('const value = host_value_object()');
        for (const entry of expression.entries || []) {
          if (entry.kind === 'spread') emit(`host_value_object_spread(value, ${exprName(entry.value)}())`);
          else {
            const keyExpression = entry.key && entry.key.kind === 'computed' ? entry.key.value : entry.key;
            if (!keyExpression) fail('Native object property is missing a key expression.', { expression });
            emit(`host_value_object_set(value, ${exprName(keyExpression)}(), ${exprName(entry.value)}())`);
          }
        }
        emit('return value');
        break;
      case 'template':
        emit(`let value = ${stringHandle('')}`);
        for (const part of expression.parts || []) {
          const handle = part.kind === 'text' ? stringHandle(part.value || '') : `${exprName(part.value)}()`;
          emit(`value = host_value_binary(${binaryIndex.get('+')}, value, ${handle})`);
        }
        emit('return value');
        break;
      case 'binary': {
        const operator = binaryIndex.get(expression.operator);
        if (!Number.isInteger(operator)) fail(`Unsupported native binary operator ${String(expression.operator)}.`, { operator: expression.operator });
        if (expression.operator === '&&' || expression.operator === '||' || expression.operator === '??') {
          emit(`const left = ${exprName(expression.left)}()`);
          if (expression.operator === '&&') emit('if (host_value_truthy(left) == 0) return left');
          else if (expression.operator === '||') emit('if (host_value_truthy(left) != 0) return left');
          else emit('if (host_value_nullish(left) == 0) return left');
          emit(`return ${exprName(expression.right)}()`);
        } else {
          emit(`return host_value_binary(${operator}, ${exprName(expression.left)}(), ${exprName(expression.right)}())`);
        }
        break;
      }
      case 'unary': {
        const operator = unaryIndex.get(expression.operator);
        if (!Number.isInteger(operator)) fail(`Unsupported native unary operator ${String(expression.operator)}.`, { operator: expression.operator });
        emit(`return host_value_unary(${operator}, ${exprName(expression.value)}())`);
        break;
      }
      case 'conditional':
        emit(`if (host_value_truthy(${exprName(expression.test)}()) != 0) return ${exprName(expression.whenTrue)}()`);
        emit(`return ${exprName(expression.whenFalse)}()`);
        break;
      case 'property':
        emit(`return host_value_property(${exprName(expression.object)}(), ${stringHandle(expression.property)})`);
        break;
      case 'element':
        emit(`return host_value_element(${exprName(expression.object)}(), ${exprName(expression.index)}())`);
        break;
      case 'pure-helper-call': {
        const helper = pureHelpers.get(expression.helperId);
        if (!helper) fail('Unknown pure helper.', { helperId: expression.helperId });
        for (const [i, arg] of expression.arguments.entries()) emit(`const arg_${i} = ${exprName(arg)}()`);
        emit(`return ${helper.nativeName}(${expression.arguments.map((_, i) => `arg_${i}`).join(', ')})`);
        break;
      }
      case 'intrinsic': {
        const args = expression.arguments || [];
        if (expression.name === 'logging.emit') {
          const level = args[0] && args[0].kind === 'literal' ? Number(args[0].value) : 0;
          emit(`host_log(${level}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`);
          emit('return host_value_undefined()');
          break;
        }
        const call = {
          'event.runtime-id': () => 'host_value_number(<f64>__pulse_event_runtime_id)',
          'request.header': () => `host_request_header(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'request.text': () => 'host_request_text()',
          'request.json': () => `host_request_json(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'response.json': () => `host_response_json(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'schema.encode.text': () => `host_schema_encode(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'schema.decode.text': () => `host_schema_decode(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'response.text': () => `host_response_text(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'response.custom': () => `host_response_custom(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'grip.is-websocket': () => 'host_grip_is_websocket()',
          'grip.subscribe': () => `host_grip_subscribe(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'grip.handoff': () => `host_grip_handoff(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'kv.namespace': () => `host_kv_namespace(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'state.get': () => {
            if (!args[0]) fail('Native state.get requires one key expression.', { expression });
            return `__pulse_state_get(${exprName(args[0])}())`;
          },
          'state.set': () => {
            if (!args[0] || !args[1]) fail('Native state.set requires one key and one value expression.', { expression });
            return `__pulse_state_set(${exprName(args[0])}(), ${exprName(args[1])}())`;
          },
          'router.match': () => `host_router_match(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'router.param': () => `host_router_param(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'}, ${args[2] ? `${exprName(args[2])}()` : 'host_value_undefined()'})`
        }[expression.name];
        if (!call) fail(`Unsupported native intrinsic ${String(expression.name)}.`, { intrinsic: expression.name });
        emit(`return ${call()}`);
        break;
      }
      case 'method-call': {
        const receiver = `${exprName(expression.receiver)}()`;
        const args = expression.arguments || [];
        if (expression.method === 'string.trim') {
          if (args.length) fail('String trim does not accept arguments.');
          emit(`return host_value_string_trim(${receiver})`);
        } else if (expression.method === 'json') {
          if (args.length > 1) fail('Native fetch-response json() accepts at most one schema argument.', { method: expression.method, argumentCount: args.length });
          emit(`return host_fetch_json(${receiver}, ${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`);
        } else if (expression.method === 'text') {
          if (args.length > 0) fail('Native fetch-response text() does not accept arguments.', { method: expression.method, argumentCount: args.length });
          emit(`return host_fetch_text(${receiver})`);
        } else if (expression.method === 'header') {
          if (args.length !== 1) fail('Native fetch-response header() requires one argument.', { method: expression.method, argumentCount: args.length });
          emit(`return host_fetch_header(${receiver}, ${exprName(args[0])}())`);
        } else fail(`Unsupported native method call ${String(expression.method)}.`, { method: expression.method });
        break;
      }
      case 'assignment': {
        const target = targetParts(expression.target, emit);
        if (expression.operator === '=') {
          const written = target.write(`${exprName(expression.value)}()`);
          if (written) emit(`return ${written}`);
          else emit(`return ${target.read}`);
          break;
        }
        if (['&&=', '||=', '??='].includes(expression.operator)) {
          emit(`const previous = ${target.read}`);
          if (expression.operator === '&&=') emit('if (host_value_truthy(previous) == 0) return previous');
          else if (expression.operator === '||=') emit('if (host_value_truthy(previous) != 0) return previous');
          else emit('if (host_value_nullish(previous) == 0) return previous');
          const written = target.write(`${exprName(expression.value)}()`);
          if (written) emit(`return ${written}`);
          else emit(`return ${target.read}`);
          break;
        }
        const operator = binaryIndex.get(String(expression.operator || '').replace(/=$/, ''));
        if (!Number.isInteger(operator)) fail(`Unsupported native assignment operator ${String(expression.operator)}.`, { operator: expression.operator });
        emit(`const previous = ${target.read}`);
        const written = target.write(`host_value_binary(${operator}, previous, ${exprName(expression.value)}())`);
        if (written) emit(`return ${written}`);
        else emit(`return ${target.read}`);
        break;
      }
      case 'update': {
        const target = targetParts(expression.target, emit);
        const operator = expression.operator === '++' ? binaryIndex.get('+') : binaryIndex.get('-');
        emit(`const previous = ${target.read}`);
        const written = target.write(`host_value_binary(${operator}, previous, host_value_number(1.0))`);
        if (written) emit(`const current = ${written}`);
        else emit(`const current = ${target.read}`);
        emit(`return ${expression.prefix ? 'current' : 'previous'}`);
        break;
      }
      case 'spread':
        emit(`return ${exprName(expression.value)}()`);
        break;
      default:
        fail(`Unsupported native expression kind ${String(expression.kind)}.`, { kind: expression.kind });
    }
    const retained = retainedExpressions.has(expressionIndex.get(expression)) ? '@noinline\n' : '';
    return `${retained}function ${exprName(expression)}(): i32 {\n${lines.join('\n')}\n}`;
  }

  // Synchronous bodies share the existing value representation and local
  // ownership. Nesting is forbidden, so reset-on-call slots cannot overlap.
  function renderPureHelper(helper) {
    function body(statements, indent = '  ') {
      const lines = [];
      for (const s of statements) {
        if (s.kind === 'local') lines.push(`${indent}${localName(s.localId)} = ${exprName(s.value)}()`);
        else if (s.kind === 'expression') lines.push(`${indent}${exprName(s.expression)}()`);
        else if (s.kind === 'return') lines.push(`${indent}return ${exprName(s.value)}()`);
        else if (s.kind === 'if') lines.push(`${indent}if (host_value_truthy(${exprName(s.test)}()) != 0) {`, ...body(s.then, indent + '  '), `${indent}} else {`, ...body(s.else, indent + '  '), `${indent}}`);
        else if (s.kind === 'pure-loop') {
          const index = `i_${localIndex.get(s.localId)}`;
          lines.push(`${indent}for (let ${index}: i32 = 0; ${index} < ${s.maxIterations}; ${index}++) {`,
            `${indent}  ${localName(s.localId)} = host_value_number(<f64>${index})`,
            `${indent}  if (host_value_truthy(${exprName(s.test)}()) == 0) break`,
            ...body(s.body, indent + '  '), `${indent}}`);
        } else if (s.kind === 'break' || s.kind === 'continue') lines.push(`${indent}${s.kind}`);
        else fail('Non-pure statement in synchronous helper.', { kind: s.kind });
      }
      return lines;
    }
    return ['@noinline', `function ${helper.nativeName}(${helper.parameters.map((_, i) => `arg_${i}: i32`).join(', ')}): i32 {`,
      ...helper.localIds.map(id => `  ${localName(id)} = 0`),
      ...helper.parameters.map((p, i) => `  ${localName(p.localId)} = arg_${i}`),
      ...body(helper.body), '  return 0', '}'].join('\n');
  }

  // Canonicalize identical emitted bodies after their child references. Resolved
  // local slots and host operations remain in the key; sharing a declaration
  // preserves each call, allocation, mutation, and evaluation order.
  const expressionBodies = new Map();
  const sharedBodies = new Map();
  for (let index = expressions.length - 1; index >= 0; index--) {
    const declaration = renderExpression(expressions[index]);
    const body = declaration.slice(declaration.indexOf('{\n') + 2);
    const representative = expressionBodies.get(body);
    if (representative === undefined) expressionBodies.set(body, index);
    else {
      expressionAlias.set(index, representative);
      sharedBodies.set(representative, body);
    }
  }
  for (const [index, body] of sharedBodies) {
    // Keep repeated multi-statement bodies as actual shared Wasm functions.
    // Small leaves remain eligible for inlining. Pulse's asc transform gives
    // this annotation meaning before Binaryen's optimizer runs.
    if (body.split('\n').length > 2) retainedExpressions.add(index);
  }

  const blocks = [];
  const applicationErrors = (plan.routing?.entries || []).some(entry => entry.kind === 'error');
  const helpers = new Map((plan.helpers || []).filter(helper => !pureHelpers.has(helper.id)).map(helper => [helper.id, helper]));
  const helperEntries = new Map();
  const handlers = new Map((plan.handlers || []).map(handler => [handler.id, handler]));
  const routerLocal = name => (plan.locals || []).find(local => local.name === `__pulse_router_${name}`)?.id;
  const routerCursor = routerLocal('cursor');
  const protectedEntries = new Set();
  let activeBoundary;
  let activeHandler;
  let activeVisitWeight = 1;
  function block(kind, data = {}) {
    const id = blocks.length;
    blocks.push({ id, kind, boundary: activeBoundary, handlerId: activeHandler, visitWeight: activeVisitWeight, ...data });
    return id;
  }

  const fallthroughBlock = block('fail', { errorCode: runtimeContract.CANONICAL_NATIVE_ERROR_CODES.FALLTHROUGH_WITHOUT_RESULT });

  function effectRecord(effectId) {
    const index = effectIndex.get(String(effectId));
    const effect = Number.isInteger(index) ? plan.effects[index] : undefined;
    if (!effect) fail(`Native statement references unknown effect ${String(effectId)}.`, { effectId });
    return { index, effect };
  }

  function continuationState(continuationId) {
    const index = continuationIndex.get(String(continuationId));
    if (!Number.isInteger(index)) fail(`Native statement references unknown continuation ${String(continuationId)}.`, { continuationId });
    return index;
  }

  function resumeAction(effectIds, resultRecords, nextBlock) {
    const required = effectIds.map((id) => effectRecord(id).index);
    const lines = [];
    for (const record of resultRecords) {
      const { index, effect } = effectRecord(record.effectId || record.id);
      const result = effect.result || record;
      const selected = stages.has(activeHandler) && stageSites.get(index);
      if (result.mode === 'bind' || record.localId) lines.push(`${localName(result.localId || record.localId)} = ${selected ? `__pulse_stage_result(__pulse_stage_effect_${selected.site})` : `__pulse_effect_result_${index}`}`);
      else if (result.mode === 'return') lines.push(`__pulse_result = __pulse_effect_result_${index}`);
      else lines.push(`__pulse_drop(__pulse_effect_result_${index})`);
    }
    const returns = resultRecords.some((record) => {
      const { effect } = effectRecord(record.effectId || record.id);
      return (effect.result || record).mode === 'return';
    });
    return block(returns ? 'resume-return' : 'resume', { required, lines, next: nextBlock });
  }

  function suspendBlock(effectIds, continuationId, resumeBlock) {
    const effects = effectIds.map((id) => effectRecord(id));
    const lines = [];
    const payloadLines = [];
    for (const { index, effect } of effects) {
      const selected = stages.has(activeHandler) && stageSites.get(index);
      if (selected) lines.push(`__pulse_stage_prepare(__pulse_stage_effect_${selected.site})`);
      else {
        lines.push(`__pulse_effect_pending_${index} = 1`);
        lines.push(`__pulse_effect_ready_${index} = 0`);
        lines.push(`__pulse_effect_result_${index} = 0`);
      }
      const prepare = applicationErrors ? payloadLines : lines;
      prepare.push(`const payload_${index} = host_value_object()`);
      for (const input of effect.inputs || []) prepare.push(`host_value_object_set(payload_${index}, ${stringHandle(input.name)}, ${exprName(input.value)}())`);
      lines.push(`host_effect_begin(${selected ? `__pulse_stage_effect_${selected.site}` : index}, payload_${index})`);
    }
    return block('suspend', {
      lines,
      payloadLines,
      continuationState: stages.has(activeHandler)
        ? `__pulse_stage_continuation_${stageSites.get(effects[0].index).site}` : continuationState(continuationId),
      resumeBlock,
      pendingCount: effects.length
    });
  }

  let pureLoopIndex = 0;
  function pureLines(statements) {
    const lines = [];
    for (const statement of statements || []) {
      if (statement.kind === 'local') lines.push(`${localName(statement.localId)} = ${exprName(statement.value)}()`);
      else if (statement.kind === 'expression') lines.push(`__pulse_drop(${exprName(statement.expression)}())`);
      else if (statement.kind === 'break' || statement.kind === 'continue') lines.push(statement.kind);
      else if (statement.kind === 'if') {
        lines.push(`if (host_value_truthy(${exprName(statement.test)}()) != 0) {`, ...pureLines(statement.then).map(line => `  ${line}`), '} else {', ...pureLines(statement.else).map(line => `  ${line}`), '}');
      } else if (statement.kind === 'pure-loop') {
        const counter = `__pulse_iteration_${pureLoopIndex++}`;
        lines.push(`for (let ${counter}: i32 = 0; ${counter} < ${statement.maxIterations}; ${counter} += 1) {`,
          `  ${localName(statement.localId)} = host_value_number(<f64>${counter})`,
          `  if (host_value_truthy(${exprName(statement.test)}()) == 0) break`,
          ...pureLines(statement.body).map(line => `  ${line}`), '}');
      } else fail('Pure loop contains an unsupported statement.', { kind: statement.kind });
    }
    return lines;
  }

  function compileSequence(statements, nextBlock, boundary, loopTargets) {
    const previousBoundary = activeBoundary;
    activeBoundary = boundary;
    let next = nextBlock;
    for (let index = (statements || []).length - 1; index >= 0; index -= 1) {
      const statement = statements[index];
      if (statement.kind === 'helper-call') {
        const helper = helpers.get(statement.helperId);
        const resume = block('action', { lines: [`${localName(statement.localId)} = __pulse_helper_result`, '__pulse_helper_result = 0'], next });
        const lines = [`__pulse_helper_return = ${resume}`, '__pulse_helper_result = 0',
          ...statement.arguments.map((arg, i) => `const helper_arg_${i} = ${exprName(arg)}()`),
          ...helper.localIds.map(id => `${localName(id)} = 0`),
          ...helper.parameters.map((parameter, i) => `${localName(parameter.localId)} = helper_arg_${i}`),
          ...(applicationErrors ? [`__pulse_helper_error_next = ${boundary.nextIndex}`, `__pulse_helper_error_return = ${boundary.nextBlock}`] : [])];
        next = block('action', { lines, next: helperEntries.get(helper.id) });
      } else if (statement.kind === 'stage-call') {
        const stage = stages.get(statement.stageId), row = stageBindings.get(statement.registrationId);
        if (!stage || !row || activeHandler) fail('Stage call requires a validated dispatcher binding.');
        const lines = [
          `__pulse_stage_next = ${row.nextIndex}`,
          `__pulse_stage_return = ${next}`,
          `${localName(stage.inputs.nextCursorLocalId)} = host_value_number(${row.nextIndex})`,
          ...stage.localIds.map(id => `${localName(id)} = 0`),
          ...row.effectIds.flatMap((effectId, site) => [
            `__pulse_stage_effect_${site} = ${effectIndex.get(effectId)}`,
            `__pulse_stage_continuation_${site} = ${continuationState(row.continuationIds[site])}`
          ])
        ];
        next = block('action', { lines, next: stageEntries.get(stage.id) });
      } else if (statement.kind === 'handler-call') {
        const handler = handlers.get(statement.handlerId);
        if (!handler || activeHandler) fail('Private Router call must select one terminal body.', { handlerId: statement.handlerId });
        activeHandler = handler.id;
        next = compileSequence(handler.body, next, boundary, loopTargets);
        activeHandler = undefined;
      } else if (statement.kind === 'local') {
        next = block('action', { lines: [`${localName(statement.localId)} = ${exprName(statement.value)}()`], next });
      } else if (statement.kind === 'expression') {
        next = block('action', { lines: [`__pulse_drop(${exprName(statement.expression)}())`], next });
      } else if (statement.kind === 'return') {
        next = block(helpers.has(activeHandler) ? 'helper-return' : 'return', { expression: exprName(statement.value) });
      } else if (statement.kind === 'if') {
        const test = statement.test;
        const entry = applicationErrors && !boundary && test.kind === 'binary' && test.operator === '==='
          && test.left.kind === 'local' && test.left.id === routerCursor && test.right.kind === 'literal'
          && plan.routing.entries.find(entry => entry.index === test.right.value);
        if (entry) protectedEntries.add(entry.index);
        const thenBlock = compileSequence(statement.then || [], next, entry ? { nextBlock: next, nextIndex: entry.nextIndex } : boundary, loopTargets);
        const elseBlock = compileSequence(statement.else || [], next, boundary, loopTargets);
        next = block('branch', { test: exprName(statement.test), thenBlock, elseBlock });
      } else if (statement.kind === 'effect') {
        const resume = resumeAction([statement.effectId], [{ effectId: statement.effectId, ...(statement.result || {}) }], next);
        next = suspendBlock([statement.effectId], statement.continuationId, resume);
      } else if (statement.kind === 'pure-loop') {
        next = block('action', { lines: pureLines([statement]), next });
      } else if (statement.kind === 'read-loop') {
        // A helper can return before suspending on every visit. Account for the
        // complete literal-capped caller path, not just its static call site.
        const hasHelper = value => value && typeof value === 'object' &&
          (value.kind === 'helper-call' || Object.values(value).some(hasHelper));
        const previousWeight = activeVisitWeight;
        if (hasHelper(statement.body)) activeVisitWeight *= Math.max(1, statement.maxIterations + 1);
        const guard = block('branch', { test: exprName(statement.test), thenBlock: undefined, elseBlock: next });
        const increment = block('action', { lines: [`__pulse_drop(${exprName(statement.increment)}())`], next: guard });
        const body = compileSequence(statement.body, increment, boundary, { break: next, continue: increment });
        blocks[guard].thenBlock = body;
        activeVisitWeight = previousWeight;
        next = block('action', { lines: [`${localName(statement.localId)} = ${exprName(statement.initial)}()`], next: guard });
      } else if (statement.kind === 'break' || statement.kind === 'continue') {
        if (!loopTargets) fail('Loop transfer requires an enclosing read loop.', { kind: statement.kind });
        next = loopTargets[statement.kind];
      } else if (statement.kind === 'effect-group') {
        const resume = resumeAction(statement.effectIds || [], statement.results || [], next);
        next = suspendBlock(statement.effectIds || [], statement.continuationId, resume);
      } else fail(`Unsupported native statement kind ${String(statement.kind)}.`, { kind: statement.kind, statementPath: statement.statementPath });
    }
    activeBoundary = previousBoundary;
    return next;
  }

  for (const helper of helpers.values()) {
    activeHandler = helper.id;
    helperEntries.set(helper.id, compileSequence(helper.body, fallthroughBlock, applicationErrors ? {
      nextBlock: '__pulse_helper_error_return', nextIndex: '__pulse_helper_error_next'
    } : undefined));
    activeHandler = undefined;
  }
  for (const stage of stages.values()) {
    activeHandler = stage.id;
    const exit = block('stage-exit');
    stageEntries.set(stage.id, compileSequence(stage.body, exit, applicationErrors ? {
      nextBlock: '__pulse_stage_return', nextIndex: '__pulse_stage_next'
    } : undefined));
    activeHandler = undefined;
  }
  const entryBlock = compileSequence(plan.entry.body || [], fallthroughBlock);
  if (applicationErrors && (!routerCursor || !routerLocal('mode') || !routerLocal('error')
    || plan.routing.entries.some(entry => !protectedEntries.has(entry.index)))) {
    fail('Router application errors require explicit compiler-owned entry boundaries.');
  }
  const resumeRequirements = new Map();
  for (const item of blocks) if (item.kind === 'resume' || item.kind === 'resume-return') resumeRequirements.set(item.id, item.required);

  // Resolve Router locals through this plan, never fixed slots. The private
  // result is 0 = no error, 2 = routed, -1 = terminal host failure.
  const routeErrorLines = (nextIndex) => [
    `${localName(routerLocal('error'))} = failure`,
    `${localName(routerLocal('mode'))} = host_value_number(1.0)`,
    `${localName(routerCursor)} = host_value_number(${nextIndex})`,
    '__pulse_pending = 0; __pulse_state = 0; __pulse_result = 0'
  ];
  const errorGuard = applicationErrors ? [
    '@noinline',
    'function __pulse_route_error(nextIndex: f64, nextBlock: i32): i32 {',
    '  const failure = host_router_error_take()',
    `  if (failure < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}; return -1 }`,
    '  if (failure > 0) {',
    ...routeErrorLines('nextIndex').map(line => `    ${line}`),
    '    __pulse_pc = nextBlock; return 2',
    '  }',
    '  return 0',
    '}'
  ] : [];

  // Charge the pre-sharing guard footprint to the partition budget. Shrinking
  // guards must not pack more states into each optimizer unit as a side effect.
  // These lines are measured only; the shared helper is the emitted code.
  function errorGuardPartitionSize(boundary, advance) {
    return [
      '{ const failure = host_router_error_take()',
      `  if (failure < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}; return -1 }`,
      '  if (failure > 0) {',
      ...routeErrorLines(`${boundary.nextIndex}.0`).map(line => `    ${line}`),
      `    __pulse_pc = ${boundary.nextBlock}; ${advance}`,
      '  } }'
    ].map(line => `      ${line}`).join('\n').length;
  }

  function renderBlock(item, partitioned = false) {
    const advance = partitioned ? 'return 2' : 'continue';
    const lines = [`    case ${item.id}: {`];
    let partitionAdjustment = 0;
    const emit = (line) => lines.push(`      ${line}`);
    const checkError = () => {
      if (!item.boundary) return;
      // Chunks propagate the existing routed status directly; decoding and
      // re-encoding it here repeats branches at every guard site.
      const guard = [
        `{ const routed = __pulse_route_error(${typeof item.boundary.nextIndex === 'number' ? item.boundary.nextIndex + '.0' : '<f64>' + item.boundary.nextIndex}, ${item.boundary.nextBlock})`,
        ...(partitioned ? [
          '  if (routed != 0) return routed',
          '}'
        ] : [
          '  if (routed < 0) return routed',
          '  if (routed > 0) continue',
          '}'
        ])
      ];
      partitionAdjustment += errorGuardPartitionSize(item.boundary, advance)
        - guard.map(line => `      ${line}`).join('\n').length;
      guard.forEach(emit);
    };
    checkError();
    if (item.kind === 'stage-exit') {
      emit('__pulse_pc = __pulse_stage_return');
      emit(advance);
    } else if (item.kind === 'action') {
      for (const line of item.lines) emit(line);
      checkError();
      emit(`__pulse_pc = ${item.next}`);
      emit(advance);
    } else if (item.kind === 'branch') {
      emit(`const matched = host_value_truthy(${item.test}())`);
      checkError();
      emit(`__pulse_pc = matched != 0 ? ${item.thenBlock} : ${item.elseBlock}`);
      emit(advance);
    } else if (item.kind === 'helper-return') {
      emit(`__pulse_helper_result = ${item.expression}()`);
      checkError();
      emit('__pulse_pc = __pulse_helper_return');
      emit(advance);
    } else if (item.kind === 'return') {
      emit(`__pulse_result = ${item.expression}()`);
      checkError();
      emit('__pulse_pending = 0');
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE}`);
    } else if (item.kind === 'suspend') {
      for (const line of item.payloadLines) emit(line);
      checkError();
      for (const line of item.lines) emit(line);
      emit(`__pulse_state = ${item.continuationState}`);
      emit(`__pulse_pc = ${item.resumeBlock}`);
      emit(`__pulse_pending = ${item.pendingCount}`);
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.SUSPENDED}`);
    } else if (item.kind === 'resume' || item.kind === 'resume-return') {
      for (const line of item.lines) emit(line);
      emit('__pulse_pending = 0');
      emit('__pulse_state = 0');
      if (item.kind === 'resume-return') emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE}`);
      else {
        emit(`__pulse_pc = ${item.next}`);
        emit(advance);
      }
    } else if (item.kind === 'fail') {
      emit(`__pulse_error = ${item.errorCode}`);
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`);
    } else fail(`Unknown native block kind ${item.kind}.`, { block: item });
    lines.push('    }');
    const source = lines.join('\n');
    return { source, partitionCharacters: source.length + partitionAdjustment };
  }

  // Bound optimizer work per dispatcher function without changing plan state IDs.
  // A pure-loop state stays indivisible: these are partition targets, not an
  // absolute source/Wasm size limit on arbitrary authored expressions or loops.
  const maxChunkStates = 64;
  const maxChunkCharacters = 24000;
  const renderedBlocks = blocks.map(item => ({ item, ...renderBlock(item) }));
  const partitioned = handlers.size > 0 || stages.size > 0 || helpers.size > 0 || blocks.length > maxChunkStates
    || renderedBlocks.reduce((size, block) => size + block.partitionCharacters, 0) > maxChunkCharacters;
  const chunks = [];
  if (partitioned) {
    let chunk = [], characters = 0;
    for (const { item } of renderedBlocks) {
      const rendered = renderBlock(item, true);
      if (chunk.length && (chunk[0].handlerId !== item.handlerId || chunk.length >= maxChunkStates || characters + rendered.partitionCharacters > maxChunkCharacters)) {
        chunks.push(chunk);
        chunk = [];
        characters = 0;
      }
      chunk.push({ id: item.id, ...rendered, handlerId: item.handlerId });
      characters += rendered.partitionCharacters;
    }
    if (chunk.length) chunks.push(chunk);
  }
  const invalidProgramCounter = `__pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_PROGRAM_COUNTER}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`;
  // Pulse's @noinline transform prevents rebuilding the monolithic function.
  const stageChunks = chunks.flatMap((chunk, index) => stages.has(chunk[0].handlerId) ? [index] : []);
  const helperChunks = chunks.flatMap((chunk, index) => helpers.has(chunk[0].handlerId) ? [index] : []);
  const chunkName = index => helperChunks.includes(index) ? `__pulse_shared_helper_${helperChunks.indexOf(index)}` : stageChunks.includes(index) ? `__pulse_shared_stage_${stageChunks.indexOf(index)}` : `__pulse_chunk_${index}`;
  const dispatcherFunctions = chunks.flatMap((chunk, index) => [
    '@noinline',
    `function ${chunkName(index)}(): i32 {`,
    '  switch (__pulse_pc) {',
    ...chunk.map(block => block.source),
    `    default: ${invalidProgramCounter}`,
    '  }',
    '}'
  ]);
  // Balanced selection keeps dispatch depth logarithmic as the program grows.
  function selectChunk(first, last, indent) {
    if (first === last) return [`${indent}return ${chunkName(first)}()`];
    const middle = Math.floor((first + last) / 2);
    const upper = chunks[middle][chunks[middle].length - 1].id;
    return [
      `${indent}if (__pulse_pc <= ${upper}) {`,
      ...selectChunk(first, middle, indent + '  '),
      `${indent}} else {`,
      ...selectChunk(middle + 1, last, indent + '  '),
      `${indent}}`
    ];
  }
  if (partitioned) dispatcherFunctions.push(
    '@noinline',
    'function __pulse_step(): i32 {',
    ...selectChunk(0, chunks.length - 1, '  '),
    '}'
  );

  const imports = runtimeContract.CANONICAL_NATIVE_IMPORTS.filter(([name]) => name !== 'router_error_take' || applicationErrors).map(([name, parameters, results]) => {
    const args = parameters.map((type, index) => `arg${index}: ${type}`).join(', ');
    const result = results.length > 0 ? results[0] : 'void';
    return `@external("${runtimeContract.CANONICAL_NATIVE_IMPORT_MODULE}", "${name}") declare function host_${name}(${args}): ${result}`;
  });

  const globals = stages.size ? [
    'let __pulse_stage_next: i32 = 0', 'let __pulse_stage_return: i32 = 0',
    ...Array.from({ length: maxStageSites }, (_, site) => site).flatMap(site => [`let __pulse_stage_effect_${site}: i32 = -1`, `let __pulse_stage_continuation_${site}: i32 = 0`])
  ] : [];
  if (helpers.size) globals.push('let __pulse_helper_result: i32 = 0', 'let __pulse_helper_return: i32 = 0', 'let __pulse_helper_error_next: i32 = 0', 'let __pulse_helper_error_return: i32 = 0');
  if (eventReachable) {
    globals.push('let __pulse_event_runtime_id: i32 = -1');
    globals.push('let __pulse_event_payload_handle: i32 = 0');
  }
  if (stateEnabled) {
    globals.push('let __pulse_state_keys = new Array<i32>()');
    globals.push('let __pulse_state_values = new Array<i32>()');
  }
  for (let index = 0; index < (plan.locals || []).length; index += 1) globals.push(`let __pulse_local_${index}: i32 = 0`);
  for (let index = 0; index < (plan.effects || []).length; index += 1) {
    globals.push(`let __pulse_effect_result_${index}: i32 = 0`);
    globals.push(`let __pulse_effect_ready_${index}: i32 = 0`);
    globals.push(`let __pulse_effect_pending_${index}: i32 = 0`);
  }

  const setterCases = (plan.effects || []).map((_, index) => [
    `    case ${index}:`,
    `      if (handle <= 0 || __pulse_effect_pending_${index} == 0 || __pulse_effect_ready_${index} != 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_EFFECT_RESULT}; return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED} }`,
    `      __pulse_effect_result_${index} = handle`,
    `      __pulse_effect_ready_${index} = 1`,
    `      __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.NONE}`,
    `      return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.ACCEPTED}`
  ].join('\n')).join('\n');
  const readyCases = [...resumeRequirements.entries()].map(([pc, required]) => {
    const condition = required.length > 0 ? required.map((index) => stages.has(blocks[pc].handlerId)
      ? `__pulse_stage_ready(__pulse_stage_effect_${stageSites.get(index).site}) != 0` : `__pulse_effect_ready_${index} != 0`).join(' && ') : 'true';
    return `    case ${pc}: return ${condition}`;
  }).join('\n');
  const clearCases = [...resumeRequirements.entries()].map(([pc, required]) => {
    const lines = required.flatMap((index) => stages.has(blocks[pc].handlerId)
      ? [`__pulse_stage_clear(__pulse_stage_effect_${stageSites.get(index).site})`] : [`__pulse_effect_ready_${index} = 0`, `__pulse_effect_pending_${index} = 0`]).join('; ');
    return `    case ${pc}: ${lines}${lines ? '; ' : ''}return`;
  }).join('\n');
  const eventPayloadCases = eventEntries.map((event) => {
    const condition = event.schemaId === null ? 'payloadHandle == 0' : 'payloadHandle > 0';
    return `    case ${event.runtimeId}: validPayload = ${condition}; break`;
  }).join('\n');
  const eventExports = eventReachable ? [
    `export function pulse_event_abi_version(): i32 { return ${eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion} }`,
    'export function pulse_event_start(runtimeId: i32, payloadHandle: i32): i32 {',
    `  if (__pulse_started != 0 || runtimeId < 0 || payloadHandle < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  let validPayload = false',
    '  switch (runtimeId) {',
    eventPayloadCases,
    '    default: validPayload = false',
    '  }',
    `  if (!validPayload) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  __pulse_started = 1',
    '  __pulse_event_runtime_id = runtimeId',
    '  __pulse_event_payload_handle = payloadHandle',
    '  __pulse_pc = PULSE_ENTRY_PC',
    '  __pulse_state = 0',
    '  __pulse_result = 0',
    '  __pulse_error = 0',
    '  __pulse_pending = 0',
    ...(stateEnabled ? ['  __pulse_state_keys = new Array<i32>()', '  __pulse_state_values = new Array<i32>()'] : []),
    '  return __pulse_run()',
    '}'
  ] : [];

  let helperCallCount = 0;
  const countHelperCalls = (value, visits = 1) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'helper-call') helperCallCount += visits;
    for (const [key, child] of Object.entries(value)) countHelperCalls(child,
      value.kind === 'read-loop' && key === 'body' ? visits * Math.max(1, value.maxIterations) : visits);
  };
  countHelperCalls(plan.entry.body);
  for (const handler of handlers.values()) countHelperCalls(handler.body);
  // Sharing cannot reduce the bounded dispatcher allowance for paths that
  // visit several registrations without suspending between them.
  const guardStateCount = blocks.reduce((sum, b) => sum + b.visitWeight, 0) + blocks.filter(b => helpers.has(b.handlerId)).length * Math.max(0, helperCallCount - 1) + [...stages.values()].reduce((total, stage) =>
    total + blocks.filter(block => block.handlerId === stage.id).length * (stage.registrations.length - 1), 0);
  if (!Number.isSafeInteger(guardStateCount) || guardStateCount > Math.floor(0x7fffffff / 8)) fail('Bounded dispatcher allowance exceeds the Native counter range.');
  const source = [
    '/* Generated by Pulse canonical native AssemblyScript compiler. */',
    ...nativeSchemaCodecs.imports,
    ...(nativeSchemaCodecs.imports.length > 0 ? [''] : []),
    ...imports,
    '',
    `const PULSE_ABI_VERSION: i32 = ${runtimeContract.CANONICAL_NATIVE_ABI_VERSION}`,
    `const PULSE_PLAN_HASH: string = ${quote(plan.planHash)}`,
    `const PULSE_ENTRY_PC: i32 = ${entryBlock}`,
    'let __pulse_started: i32 = 0',
    'let __pulse_pc: i32 = 0',
    'let __pulse_state: i32 = 0',
    'let __pulse_result: i32 = 0',
    'let __pulse_error: i32 = 0',
    'let __pulse_pending: i32 = 0',
    ...globals,
    ...(stages.size ? require('./shared-stage-accessors').effectAccessors(stageSites) : []),
    '',
    'function __pulse_string(value: string): i32 { return host_value_string(changetype<i32>(value), value.length) }',
    'function __pulse_drop(value: i32): void {}',
    ...(stateEnabled ? [
      `function __pulse_state_find(key: i32): i32 { for (let index: i32 = 0; index < __pulse_state_keys.length; index += 1) { const equal = host_value_binary(${binaryIndex.get('===')}, __pulse_state_keys[index], key); if (host_value_truthy(equal) != 0) return index; } return -1 }`,
      'function __pulse_state_get(key: i32): i32 { const index = __pulse_state_find(key); return index < 0 ? host_value_undefined() : __pulse_state_values[index] }',
      'function __pulse_state_set(key: i32, value: i32): i32 { const index = __pulse_state_find(key); if (index < 0) { __pulse_state_keys.push(key); __pulse_state_values.push(value); } else { __pulse_state_values[index] = value; } return host_value_undefined() }'
    ] : []),
    ...nativeSchemaCodecs.declarations,
    ...(nativeCrypto.active ? [nativeCrypto.source] : []),
    ...expressions.filter((_, index) => !expressionAlias.has(index)).map(renderExpression),
    ...[...pureHelpers.values()].map(renderPureHelper),
    '',
    'function __pulse_ready_for_resume(): bool {',
    '  switch (__pulse_pc) {',
    ...(readyCases ? [readyCases] : []),
    '    default: return false',
    '  }',
    '}',
    'function __pulse_clear_resume_flags(): void {',
    '  switch (__pulse_pc) {',
    ...(clearCases ? [clearCases] : []),
    '    default: return',
    '  }',
    '}',
    ...errorGuard,
    ...dispatcherFunctions,
    'function __pulse_run(): i32 {',
    `  let guard: i32 = ${Math.max(64, guardStateCount * 8)}`,
    '  while (guard > 0) {',
    '    guard -= 1',
    ...(partitioned ? [
      '    const status = __pulse_step()',
      // Private status 2 advances exactly one state under the original guard.
      '    if (status != 2) return status'
    ] : [
      '    switch (__pulse_pc) {',
      ...renderedBlocks.map(block => block.source),
      `      default: ${invalidProgramCounter}`,
      '    }'
    ]),
    '  }',
    `  __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}`,
    `  return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`,
    '}',
    '',
    'export function pulse_abi_version(): i32 { return PULSE_ABI_VERSION }',
    'export function pulse_plan_hash_ptr(): i32 { return changetype<i32>(PULSE_PLAN_HASH) }',
    'export function pulse_plan_hash_length(): i32 { return PULSE_PLAN_HASH.length }',
    'export function pulse_start(): i32 {',
    `  if (__pulse_started != 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_START}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED} }`,
    '  __pulse_started = 1',
    '  __pulse_pc = PULSE_ENTRY_PC',
    '  __pulse_state = 0',
    '  __pulse_result = 0',
    '  __pulse_error = 0',
    '  __pulse_pending = 0',
    ...(eventReachable ? ['  __pulse_event_runtime_id = -1', '  __pulse_event_payload_handle = 0'] : []),
    ...(stateEnabled ? ['  __pulse_state_keys = new Array<i32>()', '  __pulse_state_values = new Array<i32>()'] : []),
    '  return __pulse_run()',
    '}',
    ...eventExports,
    'export function pulse_resume(): i32 {',
    `  if (__pulse_started == 0 || __pulse_pending == 0 || !__pulse_ready_for_resume()) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INCOMPLETE_RESUME}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.INVALID_RESUME} }`,
    `  __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.NONE}`,
    '  __pulse_clear_resume_flags()',
    '  return __pulse_run()',
    '}',
    'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {',
    '  switch (effectIndex) {',
    ...(setterCases ? [setterCases] : []),
    `    default: __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_EFFECT_RESULT}; return ${runtimeContract.CANONICAL_NATIVE_RESULT_STATUS.REJECTED}`,
    '  }',
    '}',
    'export function pulse_result_handle(): i32 { return __pulse_result }',
    'export function pulse_program_counter(): i32 { return __pulse_pc }',
    'export function pulse_continuation_state(): i32 { return __pulse_state }',
    'export function pulse_last_error_code(): i32 { return __pulse_error }',
    'export function pulse_pending_count(): i32 { return __pulse_pending }',
    ...nativeSchemaCodecs.exports,
    ''
  ].join('\n');

  const manifest = Object.freeze({
    version: runtimeContract.CANONICAL_NATIVE_WASM_VERSION,
    generatorVersion: CANONICAL_NATIVE_AS_GENERATOR_VERSION,
    abiVersion: runtimeContract.CANONICAL_NATIVE_ABI_VERSION,
    planVersion: plan.version,
    planHash: plan.planHash,
    sourceHash: stableHash(source),
    entryBlock,
    blockCount: blocks.length,
    guardStateCount,
    dispatcher: Object.freeze({
      strategy: partitioned ? 'bounded-state-chunks' : 'single-function',
      chunkCount: chunks.length,
      maxChunkStates,
      maxChunkCharacters,
      oversizedStateCount: (partitioned ? chunks.flat() : renderedBlocks).filter(block => block.source.length > maxChunkCharacters).length,
      guard: 'shared-once-per-state',
      chunkInlining: partitioned ? 'disabled' : 'not-applicable'
    }),
    stages: Object.freeze([...stages.values()].map(stage => Object.freeze({
      id: stage.id, handlerId: stage.handlerId, registrations: stage.registrations.length,
      entryBlock: stageEntries.get(stage.id), bodyStates: blocks.filter(block => block.handlerId === stage.id).length,
      chunks: Object.freeze(chunks.flatMap((chunk, index) => chunk[0].handlerId === stage.id ? [index] : []))
    }))),
    pureHelperBodies: Object.freeze([...pureHelpers.values()].map(helper => Object.freeze({ id: helper.id, name: helper.nativeName }))),
    helperBodies: Object.freeze([...helpers.values()].map(helper => Object.freeze({
      id: helper.id, entryBlock: helperEntries.get(helper.id), bodyStates: blocks.filter(b => b.handlerId === helper.id).length,
      chunks: Object.freeze(chunks.flatMap((chunk, i) => chunk[0].handlerId === helper.id ? [i] : []))
    }))),
    handlerBodies: Object.freeze([...handlers.values()].map(handler => Object.freeze({
      id: handler.id,
      handlerId: handler.handlerId,
      chunks: Object.freeze(chunks.flatMap((chunk, index) => chunk[0].handlerId === handler.id ? [index] : [])),
      stateCount: blocks.filter(block => block.handlerId === handler.id).length
    }))),
    expressionCount: expressions.length,
    localCount: (plan.locals || []).length,
    schemaCodecs: Object.freeze({
      active: nativeSchemaCodecs.active,
      backend: nativeSchemaCodecs.active ? 'json-as' : 'none',
      package: nativeSchemaCodecs.active ? 'json-as' : null,
      packageVersion: nativeSchemaCodecs.active ? '1.5.0' : null,
      registryHash: plan.schemas && plan.schemas.registryHash || null,
      codecTableHash: plan.schemas && plan.schemas.codecTableHash || null,
      sourceHash: nativeSchemaCodecs.sourceHash,
      codecs: nativeSchemaCodecs.codecs
    }),
    crypto: Object.freeze({
      version: nativeCrypto.version,
      active: nativeCrypto.active,
      realizationPlanVersion: nativeCrypto.realizationPlanVersion,
      realizationPlanHash: nativeCrypto.realizationPlanHash,
      algorithms: nativeCrypto.algorithms,
      sourceHash: nativeCrypto.sourceHash,
      automaticFallback: false
    }),
    requestState: Object.freeze({
      enabled: stateEnabled,
      representation: stateEnabled ? 'guest-string-map' : 'absent',
      reset: stateEnabled ? (eventReachable ? 'invocation-start' : 'pulse-start') : 'not-required'
    }),
    ...(eventReachable ? {
      events: Object.freeze({
        version: eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION,
        abiVersion: eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion,
        catalogHash: plan.events.catalog.catalogHash,
        count: eventEntries.length,
        exports: eventContract.EVENT_NATIVE_ABI_EXTENSION.exports,
        imports: eventContract.EVENT_NATIVE_ABI_EXTENSION.imports,
        selection: 'artifact-local-runtime-id',
        payload: 'host-owned-schema-validated-value-handle',
        completion: eventContract.EVENT_COMPLETION_SEMANTICS
      })
    } : {}),
    ...(plan.application ? { application: plan.application } : {}),
    ...(plan.json ? { json: plan.json } : {}),
    effectCount: (plan.effects || []).length,
    continuationCount: (plan.continuations || []).length,
    allowedImports: runtimeContract.CANONICAL_NATIVE_IMPORTS,
    requiredExports: eventReachable
      ? Object.freeze([...runtimeContract.CANONICAL_NATIVE_EXPORTS, ...eventContract.EVENT_NATIVE_ABI_EXTENSION.exports])
      : runtimeContract.CANONICAL_NATIVE_EXPORTS,
    policy: Object.freeze({ ...runtimeContract.CANONICAL_NATIVE_POLICY,
      ...(runtimeContract.hasBoundedReadLoop(plan) ? { readLoopMemory: runtimeContract.CANONICAL_NATIVE_READ_LOOP_MEMORY } : {}) })
  });

  return Object.freeze({
    version: CANONICAL_NATIVE_AS_GENERATOR_VERSION,
    source,
    sourceHash: manifest.sourceHash,
    manifest,
    blocks: Object.freeze(blocks.map((item) => Object.freeze({ ...item })))
  });
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_AS_GENERATOR_VERSION,
  CanonicalNativeAssemblyScriptError,
  generateCanonicalNativeAssemblyScript
});
