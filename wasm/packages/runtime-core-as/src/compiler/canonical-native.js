'use strict';

const crypto = require('node:crypto');
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

  schemas.forEach((schema, schemaIndex) => {
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
    const root = symbols.get('');
    // json-as 1.5.0's slow struct scanner treats a closing quote after a
    // doubled backslash as escaped. A JSON-equivalent Unicode spelling avoids
    // that scanner defect without changing schema values or admitting fallback.
    const decode = `__pulse_schema_decode_${schemaIndex}`;
    const encode = `__pulse_schema_encode_${schemaIndex}`;
    declarations.push(`function ${decode}(input: string): string {`);
    declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
    declarations.push(`  return JSON.stringify<${root}>(value)`);
    declarations.push('}');
    declarations.push(`function ${encode}(input: string): string {`);
    declarations.push(`  const value = JSON.parse<${root}>(input.replaceAll(${quote('\\\\')}, ${quote('\\u005c')}))`);
    declarations.push(`  return JSON.stringify<${root}>(value)`);
    declarations.push('}');
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
      if (statement.kind === 'local') add(statement.value);
      else if (statement.kind === 'expression') add(statement.expression);
      else if (statement.kind === 'return') add(statement.value);
      else if (statement.kind === 'if') {
        add(statement.test);
        walkStatements(statement.then);
        walkStatements(statement.else);
      } else if (statement.kind === 'pure-loop') {
        add(statement.test);
        walkStatements(statement.body);
      }
    }
  }

  walkStatements(plan.entry && plan.entry.body);
  for (const effect of plan.effects || []) {
    for (const input of effect.inputs || []) add(input.value);
    const decoder = effect.result && effect.result.decoder;
    for (const argument of (decoder && decoder.arguments) || []) add(argument);
  }
  return expressions;
}

function generateCanonicalNativeAssemblyScript(plan, options = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('generateCanonicalNativeAssemblyScript requires a canonical native plan.');
  const localIndex = new Map((plan.locals || []).map((local, index) => [String(local.id), index]));
  const effectIndex = new Map((plan.effects || []).map((effect, index) => [String(effect.id), index]));
  const continuationIndex = new Map((plan.continuations || []).map((continuation) => [String(continuation.id), Number(continuation.stateIndex)]));
  const expressions = collectExpressions(plan);
  const expressionIndex = new Map(expressions.map((expression, index) => [expression, index]));
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
    return `__pulse_expr_${index}`;
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
    return `function ${exprName(expression)}(): i32 {\n${lines.join('\n')}\n}`;
  }

  const blocks = [];
  function block(kind, data = {}) {
    const id = blocks.length;
    blocks.push({ id, kind, ...data });
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
      if (result.mode === 'bind' || record.localId) lines.push(`${localName(result.localId || record.localId)} = __pulse_effect_result_${index}`);
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
    for (const { index, effect } of effects) {
      lines.push(`__pulse_effect_pending_${index} = 1`);
      lines.push(`__pulse_effect_ready_${index} = 0`);
      lines.push(`__pulse_effect_result_${index} = 0`);
      lines.push(`const payload_${index} = host_value_object()`);
      for (const input of effect.inputs || []) lines.push(`host_value_object_set(payload_${index}, ${stringHandle(input.name)}, ${exprName(input.value)}())`);
      lines.push(`host_effect_begin(${index}, payload_${index})`);
    }
    return block('suspend', {
      lines,
      continuationState: continuationState(continuationId),
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

  function compileSequence(statements, nextBlock) {
    let next = nextBlock;
    for (let index = (statements || []).length - 1; index >= 0; index -= 1) {
      const statement = statements[index];
      if (statement.kind === 'local') {
        next = block('action', { lines: [`${localName(statement.localId)} = ${exprName(statement.value)}()`], next });
      } else if (statement.kind === 'expression') {
        next = block('action', { lines: [`__pulse_drop(${exprName(statement.expression)}())`], next });
      } else if (statement.kind === 'return') {
        next = block('return', { expression: exprName(statement.value) });
      } else if (statement.kind === 'if') {
        const thenBlock = compileSequence(statement.then || [], next);
        const elseBlock = compileSequence(statement.else || [], next);
        next = block('branch', { test: exprName(statement.test), thenBlock, elseBlock });
      } else if (statement.kind === 'effect') {
        const resume = resumeAction([statement.effectId], [{ effectId: statement.effectId, ...(statement.result || {}) }], next);
        next = suspendBlock([statement.effectId], statement.continuationId, resume);
      } else if (statement.kind === 'pure-loop') {
        next = block('action', { lines: pureLines([statement]), next });
      } else if (statement.kind === 'effect-group') {
        const resume = resumeAction(statement.effectIds || [], statement.results || [], next);
        next = suspendBlock(statement.effectIds || [], statement.continuationId, resume);
      } else fail(`Unsupported native statement kind ${String(statement.kind)}.`, { kind: statement.kind, statementPath: statement.statementPath });
    }
    return next;
  }

  const entryBlock = compileSequence(plan.entry.body || [], fallthroughBlock);
  const resumeRequirements = new Map();
  for (const item of blocks) if (item.kind === 'resume' || item.kind === 'resume-return') resumeRequirements.set(item.id, item.required);

  function renderBlock(item) {
    const lines = [`    case ${item.id}: {`];
    const emit = (line) => lines.push(`      ${line}`);
    if (item.kind === 'action') {
      for (const line of item.lines) emit(line);
      emit(`__pulse_pc = ${item.next}`);
      emit('continue');
    } else if (item.kind === 'branch') {
      emit(`__pulse_pc = host_value_truthy(${item.test}()) != 0 ? ${item.thenBlock} : ${item.elseBlock}`);
      emit('continue');
    } else if (item.kind === 'return') {
      emit(`__pulse_result = ${item.expression}()`);
      emit('__pulse_pending = 0');
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE}`);
    } else if (item.kind === 'suspend') {
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
        emit('continue');
      }
    } else if (item.kind === 'fail') {
      emit(`__pulse_error = ${item.errorCode}`);
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`);
    } else fail(`Unknown native block kind ${item.kind}.`, { block: item });
    lines.push('    }');
    return lines.join('\n');
  }

  const imports = runtimeContract.CANONICAL_NATIVE_IMPORTS.map(([name, parameters, results]) => {
    const args = parameters.map((type, index) => `arg${index}: ${type}`).join(', ');
    const result = results.length > 0 ? results[0] : 'void';
    return `@external("${runtimeContract.CANONICAL_NATIVE_IMPORT_MODULE}", "${name}") declare function host_${name}(${args}): ${result}`;
  });

  const globals = [];
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
    const condition = required.length > 0 ? required.map((index) => `__pulse_effect_ready_${index} != 0`).join(' && ') : 'true';
    return `    case ${pc}: return ${condition}`;
  }).join('\n');
  const clearCases = [...resumeRequirements.entries()].map(([pc, required]) => {
    const lines = required.flatMap((index) => [`__pulse_effect_ready_${index} = 0`, `__pulse_effect_pending_${index} = 0`]).join('; ');
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
    ...expressions.map(renderExpression),
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
    'function __pulse_run(): i32 {',
    `  let guard: i32 = ${Math.max(64, blocks.length * 8)}`,
    '  while (guard > 0) {',
    '    guard -= 1',
    '    switch (__pulse_pc) {',
    ...blocks.map(renderBlock),
    `      default: __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_PROGRAM_COUNTER}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`,
    '    }',
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
    policy: runtimeContract.CANONICAL_NATIVE_POLICY
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
