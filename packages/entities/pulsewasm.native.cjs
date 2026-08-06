'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const packageManifest = require('./package.json');

function loadContract(subpath, fallback) {
  try { return require(`@pulse-compute/wasm-contracts/${subpath}`); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require(fallback);
    throw error;
  }
}

const entitiesContracts = loadContract('entities/contracts', '../../wasm/packages/contracts/src/entities/contracts.js');

const ENTITIES_NATIVE_SOURCE_VERSION = 'pulse.entities-native-source.v1';
const MANAGED_NATIVE_BUNDLE_VERSION = 'pulse.managed-handler-native-bundle.v1';
const sourceRelativeFile = 'as/index.as.ts';
const sourceFile = path.join(__dirname, sourceRelativeFile);

class EntitiesNativeSourceError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'EntitiesNativeSourceError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, message, detail) {
  throw new EntitiesNativeSourceError(code, message, detail);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function quote(value) {
  return JSON.stringify(String(value));
}

function identifier(value) {
  const normalized = String(value || 'value').normalize('NFKC').replace(/[^A-Za-z0-9_$]+/g, '_');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function knownInputKeys(input) {
  const allowed = new Set(['plan', 'managedHandlerNativeBundle', 'schemaBundle']);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) fail('PULSE_ENTITIES_NATIVE_INPUT_UNSUPPORTED', `Entities Native source input contains unsupported fields: ${unknown.join(', ')}.`, { unknown });
}

function schemaRecords(schemaBundle) {
  const registry = schemaBundle && schemaBundle.registry;
  const schemas = registry && Array.isArray(registry.schemas) ? registry.schemas : undefined;
  if (!schemas) fail('PULSE_ENTITIES_NATIVE_SCHEMA_BUNDLE_INVALID', 'Entities Native source requires one canonical schema bundle.');
  return schemas;
}

function runtimeInputFor(handler, effectId) {
  return handler.effects.runtimeInputs.find((entry) => entry.effectId === effectId)
    || Object.freeze({ effectId, inputs: Object.freeze([]) });
}

function collectRuntimeSchemaIds(handler, output) {
  for (const effect of handler.effects.sites) {
    if (effect.decoder !== 'json') continue;
    const decoder = runtimeInputFor(handler, effect.id).inputs.find((entry) => entry.name === 'decoderArgument0');
    if (decoder && decoder.value && decoder.value.kind === 'literal' && typeof decoder.value.value === 'string') output.add(decoder.value.value);
  }
}

function normalizeInputs(input) {
  if (!isPlainObject(input)) fail('PULSE_ENTITIES_NATIVE_INPUT_INVALID', 'buildEntitiesNativeSource requires one input object.');
  knownInputKeys(input);
  const suppliedPlan = input.plan;
  const plan = entitiesContracts.normalizeEntityPlan(suppliedPlan && suppliedPlan.planHash
    ? { version: suppliedPlan.version, contractId: suppliedPlan.contractId, routers: suppliedPlan.routers }
    : suppliedPlan);
  if (suppliedPlan && suppliedPlan.planHash && suppliedPlan.planHash !== plan.planHash) {
    fail('PULSE_ENTITIES_NATIVE_PLAN_HASH_MISMATCH', 'Entities Native source plan hash does not match its normalized plan.');
  }
  if (plan.routers.length !== 1) fail('PULSE_ENTITIES_NATIVE_ROUTER_COUNT', 'The first Entities Native dispatcher requires exactly one terminal router.', { routers: plan.routers.length });
  const nativeBundle = input.managedHandlerNativeBundle;
  if (!nativeBundle || nativeBundle.version !== MANAGED_NATIVE_BUNDLE_VERSION || !Array.isArray(nativeBundle.handlers)) {
    fail('PULSE_ENTITIES_NATIVE_HANDLER_BUNDLE_INVALID', `Entities Native source requires ${MANAGED_NATIVE_BUNDLE_VERSION}.`);
  }
  if (!nativeBundle.policy || nativeBundle.policy.automaticFallback !== false || nativeBundle.policy.genericDataOnly !== true) {
    fail('PULSE_ENTITIES_NATIVE_HANDLER_BUNDLE_POLICY', 'Managed Native facts must be generic, data-only, and fail closed without fallback.');
  }
  const router = plan.routers[0];
  const handlers = new Map(nativeBundle.handlers.map((handler) => [handler.id, handler]));
  const routes = router.entities.map((entity, index) => {
    const handlerId = `${router.id}:${entity.discriminator}`;
    const handler = handlers.get(handlerId);
    if (!handler) fail('PULSE_ENTITIES_NATIVE_HANDLER_MISSING', `Entity ${entity.discriminator} has no managed Native handler.`, { handlerId });
    if (handler.parameters.input.schemaId !== entity.inputSchema || handler.result.schemaId !== entity.outputSchema) {
      fail('PULSE_ENTITIES_NATIVE_HANDLER_SCHEMA_MISMATCH', `Managed handler ${handlerId} does not match its entity schema declaration.`, { handlerId });
    }
    return Object.freeze({ index, handlerId, entity, handler });
  });
  const selectedHandlerIds = new Set(routes.map((route) => route.handlerId));
  const extras = nativeBundle.handlers.map((handler) => handler.id).filter((id) => !selectedHandlerIds.has(id)).sort();
  if (extras.length > 0) fail('PULSE_ENTITIES_NATIVE_UNREACHABLE_HANDLER', 'Managed Native bundle contains handlers outside the selected discriminator table.', { extras });

  const requiredSchemaIds = new Set();
  for (const route of routes) {
    if (route.entity.inputSchema) requiredSchemaIds.add(route.entity.inputSchema);
    if (route.entity.outputSchema) requiredSchemaIds.add(route.entity.outputSchema);
    collectRuntimeSchemaIds(route.handler, requiredSchemaIds);
  }
  const available = new Map(schemaRecords(input.schemaBundle).map((schema) => [String(schema.id), schema]));
  const schemas = [...requiredSchemaIds].sort().map((id) => {
    const schema = available.get(id);
    if (!schema) fail('PULSE_ENTITIES_NATIVE_SCHEMA_MISSING', `Reachable Native schema ${id} is missing.`, { schemaId: id });
    return schema;
  });
  return Object.freeze({ plan, nativeBundle, schemaBundle: input.schemaBundle, router, routes: Object.freeze(routes), schemas: Object.freeze(schemas) });
}

function renderSchemas(schemas) {
  const lines = ['let __pulse_entities_schema_valid: bool = true', ''];
  const roots = new Map();
  const rendered = new Map();

  function nodeName(schemaIndex, pathParts) {
    const suffix = pathParts.length === 0 ? 'root' : pathParts.map(identifier).join('_');
    return `__pulse_entities_schema_${schemaIndex}_${suffix}_${sha256(JSON.stringify(pathParts)).slice(0, 8)}`;
  }

  function renderNode(schemaIndex, node, pathParts = []) {
    const key = `${schemaIndex}:${JSON.stringify(pathParts)}`;
    if (rendered.has(key)) return rendered.get(key);
    const name = nodeName(schemaIndex, pathParts);
    rendered.set(key, name);
    const body = [];
    const invalid = () => body.push('  __pulse_entities_schema_valid = false', '  return __pulse_entities_null()');
    if (!node || typeof node.kind !== 'string') fail('PULSE_ENTITIES_NATIVE_SCHEMA_NODE_INVALID', 'Reachable schema contains an invalid node.', { schemaIndex, pathParts });
    if (node.kind === 'string') {
      body.push('  if (input.type != JSON.Types.String) {');
      invalid();
      body.push('  }', '  return input');
    } else if (node.kind === 'boolean') {
      body.push('  if (input.type != JSON.Types.Bool) {');
      invalid();
      body.push('  }', '  return input');
    } else if (node.kind === 'i32' || node.kind === 'u32' || node.kind === 'f64') {
      body.push('  if (!__pulse_entities_is_number(input)) {');
      invalid();
      body.push('  }', '  const number = __pulse_entities_number(input)', '  if (isNaN(number) || number == Infinity || number == -Infinity) {');
      invalid();
      body.push('  }');
      if (node.kind === 'i32') {
        body.push('  if (number != Math.floor(number) || number < -2147483648.0 || number > 2147483647.0) {');
        invalid();
        body.push('  }');
      } else if (node.kind === 'u32') {
        body.push('  if (number != Math.floor(number) || number < 0.0 || number > 4294967295.0) {');
        invalid();
        body.push('  }');
      }
      body.push('  return JSON.Value.from<f64>(number)');
    } else if (node.kind === 'string-enum') {
      body.push('  if (input.type != JSON.Types.String) {');
      invalid();
      body.push('  }', '  const text = input.get<string>()');
      const condition = (node.values || []).map((value) => `text == ${quote(value)}`).join(' || ') || 'false';
      body.push(`  if (!(${condition})) {`);
      invalid();
      body.push('  }', '  return input');
    } else if (node.kind === 'nullable') {
      const child = renderNode(schemaIndex, node.value, [...pathParts, 'value']);
      body.push('  if (input.type == JSON.Types.Null) return input', `  return ${child}(input)`);
    } else if (node.kind === 'array') {
      const child = renderNode(schemaIndex, node.element, [...pathParts, 'item']);
      body.push('  if (input.type != JSON.Types.Array) {');
      invalid();
      body.push('  }', '  const source = input.get<JSON.Arr>()', '  const output = new JSON.Arr()', '  for (let index: i32 = 0; index < source.length; index += 1) {', `    const item = ${child}(source.at(index))`, '    if (!__pulse_entities_schema_valid) return __pulse_entities_null()', '    output.push<JSON.Value>(item)', '  }', '  return JSON.Value.from<JSON.Arr>(output)');
    } else if (node.kind === 'object') {
      body.push('  if (input.type != JSON.Types.Object) {');
      invalid();
      body.push('  }', '  const source = input.get<JSON.Obj>()', '  const output = new JSON.Obj()');
      for (const [fieldIndex, field] of (node.fields || []).entries()) {
        const child = renderNode(schemaIndex, field.value, [...pathParts, field.name]);
        body.push(`  const raw_${fieldIndex} = source.get(${quote(field.name)})`, `  if (raw_${fieldIndex} === null) {`, '    __pulse_entities_schema_valid = false', '    return __pulse_entities_null()', '  }', `  const field_${fieldIndex} = ${child}(raw_${fieldIndex}!)`, '  if (!__pulse_entities_schema_valid) return __pulse_entities_null()', `  output.set<JSON.Value>(${quote(field.name)}, field_${fieldIndex})`);
      }
      body.push('  return JSON.Value.from<JSON.Obj>(output)');
    } else {
      fail('PULSE_ENTITIES_NATIVE_SCHEMA_NODE_UNSUPPORTED', `Native Entities schema node ${node.kind} is unsupported.`, { schemaIndex, pathParts, kind: node.kind });
    }
    lines.push(`function ${name}(input: JSON.Value): JSON.Value {`, ...body, '}', '');
    return name;
  }

  schemas.forEach((schema, index) => {
    const root = renderNode(index, schema.root, []);
    roots.set(schema.id, root);
  });
  return Object.freeze({ source: lines.join('\n'), roots });
}

function collectExpression(expression, list, indexes) {
  if (!expression || typeof expression !== 'object') return;
  if (indexes.has(expression)) return;
  indexes.set(expression, list.length);
  list.push(expression);
  const add = (value) => collectExpression(value, list, indexes);
  if (expression.kind === 'array') for (const item of expression.items || []) add(item.kind === 'spread' ? item.value : item);
  else if (expression.kind === 'object') for (const entry of expression.entries || []) {
    if (entry.kind === 'spread') add(entry.value);
    else {
      if (entry.key && typeof entry.key === 'object' && entry.key.kind === 'computed') add(entry.key.value);
      add(entry.value);
    }
  }
  else if (expression.kind === 'template') for (const part of expression.parts || []) if (part.kind === 'value') add(part.value);
  else if (expression.kind === 'binary') { add(expression.left); add(expression.right); }
  else if (expression.kind === 'unary') add(expression.value);
  else if (expression.kind === 'conditional') { add(expression.test); add(expression.whenTrue); add(expression.whenFalse); }
  else if (expression.kind === 'property') add(expression.object);
  else if (expression.kind === 'element') { add(expression.object); add(expression.index); }
  else if (expression.kind === 'provider-namespace') add(expression.resource);
}

function createHandlerCompiler(route, context) {
  const { handler } = route;
  const expressions = [];
  const expressionIndexes = new WeakMap();
  const prefix = `__pulse_entities_h${route.index}`;
  const localIndexes = context.localIndexes;
  const effectIndexes = context.effectIndexes;

  function expressionName(expression) {
    collectExpression(expression, expressions, expressionIndexes);
    const index = expressionIndexes.get(expression);
    return `${prefix}_expr_${index}`;
  }

  function localIndex(id) {
    const value = localIndexes.get(`${handler.id}:${id}`);
    if (!Number.isInteger(value)) fail('PULSE_ENTITIES_NATIVE_LOCAL_UNKNOWN', `Native handler ${handler.id} references unknown local ${id}.`);
    return value;
  }

  function effectIndex(id) {
    const value = effectIndexes.get(`${handler.id}:${id}`);
    if (!Number.isInteger(value)) fail('PULSE_ENTITIES_NATIVE_EFFECT_UNKNOWN', `Native handler ${handler.id} references unknown effect ${id}.`);
    return value;
  }

  function renderExpression(expression) {
    const name = expressionName(expression);
    const lines = [];
    const emit = (line) => lines.push(`  ${line}`);
    if (expression.kind === 'literal') {
      if (expression.value === null) emit('return __pulse_entities_null()');
      else if (typeof expression.value === 'string') emit(`return JSON.Value.from<string>(${quote(expression.value)})`);
      else if (typeof expression.value === 'boolean') emit(`return JSON.Value.from<bool>(${expression.value ? 'true' : 'false'})`);
      else if (typeof expression.value === 'number' && Number.isFinite(expression.value)) emit(`return JSON.Value.from<f64>(${Number(expression.value)})`);
      else fail('PULSE_ENTITIES_NATIVE_LITERAL_UNSUPPORTED', 'Native managed literals must be finite JSON primitives.', { expression });
    } else if (expression.kind === 'undefined') emit('return __pulse_entities_null()');
    else if (expression.kind === 'input') emit('return __pulse_entities_input');
    else if (expression.kind === 'local') emit(`return unchecked(__pulse_entities_locals[${localIndex(expression.id)}])`);
    else if (expression.kind === 'effect-result') emit(`return unchecked(__pulse_entities_effect_results[${effectIndex(expression.effectId)}])`);
    else if (expression.kind === 'provider-namespace') emit(`return ${expressionName(expression.resource)}()`);
    else if (expression.kind === 'property') emit(`return __pulse_entities_property(${expressionName(expression.object)}(), ${quote(expression.property)})`);
    else if (expression.kind === 'element') emit(`return __pulse_entities_element(${expressionName(expression.object)}(), ${expressionName(expression.index)}())`);
    else if (expression.kind === 'array') {
      emit('const output = new JSON.Arr()');
      for (const item of expression.items || []) {
        if (item.kind === 'spread') {
          const value = expressionName(item.value);
          emit(`const spread_${lines.length} = ${value}()`);
          emit(`if (spread_${lines.length - 1}.type == JSON.Types.Array) { const source = spread_${lines.length - 1}.get<JSON.Arr>(); for (let index: i32 = 0; index < source.length; index += 1) output.push<JSON.Value>(source.at(index)) }`);
        } else emit(`output.push<JSON.Value>(${expressionName(item)}())`);
      }
      emit('return JSON.Value.from<JSON.Arr>(output)');
    } else if (expression.kind === 'object') {
      emit('const output = new JSON.Obj()');
      let spreadIndex = 0;
      for (const entry of expression.entries || []) {
        if (entry.kind === 'spread') {
          const variable = `spread_${spreadIndex++}`;
          emit(`const ${variable} = ${expressionName(entry.value)}()`);
          emit(`if (${variable}.type == JSON.Types.Object) { const source = ${variable}.get<JSON.Obj>(); const keys = source.keys(); for (let index: i32 = 0; index < keys.length; index += 1) { const found = source.get(unchecked(keys[index])); if (found !== null) output.set<JSON.Value>(unchecked(keys[index]), found!) } }`);
        } else {
          const key = entry.key && typeof entry.key === 'object' && entry.key.kind === 'computed'
            ? `__pulse_entities_text(${expressionName(entry.key.value)}())`
            : quote(entry.key);
          emit(`output.set<JSON.Value>(${key}, ${expressionName(entry.value)}())`);
        }
      }
      emit('return JSON.Value.from<JSON.Obj>(output)');
    } else if (expression.kind === 'template') {
      emit("let output = ''");
      for (const part of expression.parts || []) {
        if (part.kind === 'text') emit(`output += ${quote(part.value || '')}`);
        else emit(`output += __pulse_entities_text(${expressionName(part.value)}())`);
      }
      emit('return JSON.Value.from<string>(output)');
    } else if (expression.kind === 'binary') {
      if (expression.operator === '&&' || expression.operator === '||' || expression.operator === '??') {
        emit(`const left = ${expressionName(expression.left)}()`);
        if (expression.operator === '&&') emit('if (!__pulse_entities_truthy(left)) return left');
        else if (expression.operator === '||') emit('if (__pulse_entities_truthy(left)) return left');
        else emit('if (left.type != JSON.Types.Null) return left');
        emit(`return ${expressionName(expression.right)}()`);
      } else {
        const operators = new Map([['+', 0], ['-', 1], ['*', 2], ['/', 3], ['%', 4], ['===', 5], ['==', 5], ['!==', 6], ['!=', 6], ['<', 7], ['<=', 8], ['>', 9], ['>=', 10]]);
        const operator = operators.get(expression.operator);
        if (!Number.isInteger(operator)) fail('PULSE_ENTITIES_NATIVE_OPERATOR_UNSUPPORTED', `Native managed operator ${expression.operator} is unsupported.`, { handlerId: handler.id });
        emit(`return __pulse_entities_binary(${operator}, ${expressionName(expression.left)}(), ${expressionName(expression.right)}())`);
      }
    } else if (expression.kind === 'unary') {
      if (expression.operator === '!') emit(`return JSON.Value.from<bool>(!__pulse_entities_truthy(${expressionName(expression.value)}()))`);
      else if (expression.operator === '+') emit(`return JSON.Value.from<f64>(__pulse_entities_number(${expressionName(expression.value)}()))`);
      else if (expression.operator === '-') emit(`return JSON.Value.from<f64>(-__pulse_entities_number(${expressionName(expression.value)}()))`);
      else if (expression.operator === 'void') emit('return __pulse_entities_null()');
      else fail('PULSE_ENTITIES_NATIVE_OPERATOR_UNSUPPORTED', `Native managed unary operator ${expression.operator} is unsupported.`, { handlerId: handler.id });
    } else if (expression.kind === 'conditional') {
      emit(`if (__pulse_entities_truthy(${expressionName(expression.test)}())) return ${expressionName(expression.whenTrue)}()`);
      emit(`return ${expressionName(expression.whenFalse)}()`);
    } else {
      fail('PULSE_ENTITIES_NATIVE_EXPRESSION_UNSUPPORTED', `Managed expression ${String(expression.kind)} cannot be lowered to Native Entities.`, { handlerId: handler.id, kind: expression.kind });
    }
    return `function ${name}(): JSON.Value {\n${lines.join('\n')}\n}`;
  }

  function payloadFunction(site) {
    const globalIndex = effectIndex(site.id);
    const runtime = runtimeInputFor(handler, site.id);
    const lines = [
      `function ${prefix}_effect_payload_${globalIndex}(): string {`,
      '  const outer = new JSON.Obj()',
      `  outer.set<string>('effectId', ${quote(site.id)})`,
      `  outer.set<string>('kind', ${quote(site.kind)})`,
      `  outer.set<string>('providerKind', ${quote(site.providerKind)})`,
      `  outer.set<string>('operation', ${quote(site.operation)})`,
      `  outer.set<string>('capability', ${quote(site.capability)})`,
      '  const inputs = new JSON.Obj()'
    ];
    for (const input of runtime.inputs) lines.push(`  inputs.set<JSON.Value>(${quote(input.name)}, ${expressionName(input.value)}())`);
    lines.push("  outer.set<JSON.Obj>('inputs', inputs)");
    if (site.payload && Object.keys(site.payload).length > 0) {
      lines.push(`  outer.set<JSON.Value>('payload', JSON.parse<JSON.Value>(${quote(JSON.stringify(site.payload))}))`);
    }
    lines.push('  return JSON.stringify<JSON.Obj>(outer)', '}', '');
    return lines.join('\n');
  }

  return Object.freeze({
    prefix,
    expressionName,
    effectIndex,
    localIndex,
    payloadFunction,
    renderExpressions() {
      const rendered = [];
      for (let index = 0; index < expressions.length; index += 1) rendered.push(renderExpression(expressions[index]));
      return rendered.join('\n\n');
    },
    expressions
  });
}

function renderNativeProgram(model, schemaOutput) {
  const localIndexes = new Map();
  const effectIndexes = new Map();
  let localCount = 0;
  let effectCount = 0;
  let loggingCount = 0;
  for (const route of model.routes) {
    for (const local of route.handler.locals) localIndexes.set(`${route.handler.id}:${local.id}`, localCount++);
    for (const effect of route.handler.effects.sites) effectIndexes.set(`${route.handler.id}:${effect.id}`, effectCount++);
    loggingCount += route.handler.effects.logging.length;
  }
  const context = Object.freeze({ localIndexes, effectIndexes });
  const compilers = model.routes.map((route) => createHandlerCompiler(route, context));
  const blocks = [];
  const routeEntryBlocks = new Map();
  const block = (kind, data = {}) => {
    const id = blocks.length;
    blocks.push(Object.freeze({ id, kind, ...data }));
    return id;
  };
  const fallthrough = block('failure', { code: -32603 });

  function outputBlock(route, compiler, expression, completion = false) {
    return block('output', { route, compiler, expression, completion });
  }

  function decoderLines(route, site, globalIndex, variable) {
    const lines = [`const ${variable}_raw = unchecked(__pulse_entities_effect_results[${globalIndex}])`];
    if (site.decoder === 'json') {
      const decoder = runtimeInputFor(route.handler, site.id).inputs.find((entry) => entry.name === 'decoderArgument0');
      if (decoder && decoder.value.kind === 'literal' && typeof decoder.value.value === 'string') {
        const schema = schemaOutput.roots.get(decoder.value.value);
        if (!schema) fail('PULSE_ENTITIES_NATIVE_EFFECT_SCHEMA_MISSING', `Effect ${site.id} references unreachable schema ${decoder.value.value}.`);
        lines.push('__pulse_entities_schema_valid = true', `const ${variable} = ${schema}(${variable}_raw)`, `if (!__pulse_entities_schema_valid) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)`);
        return lines;
      }
    }
    if (site.decoder === 'text') lines.push(`if (${variable}_raw.type != JSON.Types.String) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)`);
    lines.push(`const ${variable} = ${variable}_raw`);
    return lines;
  }

  function resumeBlockForEffect(route, compiler, operation, next) {
    const site = operation.effect;
    const globalIndex = compiler.effectIndex(site.id);
    const lines = [`if (unchecked(__pulse_entities_effect_ok[${globalIndex}]) == 0) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)`, ...decoderLines(route, site, globalIndex, `effect_${globalIndex}`)];
    if (operation.binding) lines.push(`unchecked(__pulse_entities_locals[${compiler.localIndex(operation.binding.id)}] = effect_${globalIndex})`);
    lines.push(`unchecked(__pulse_entities_effect_pending[${globalIndex}] = 0)`, `unchecked(__pulse_entities_effect_ready[${globalIndex}] = 0)`);
    if (operation.result) return block('resume-output', { route, lines, value: `effect_${globalIndex}` });
    return block('action', { lines, next });
  }

  function suspendBlock(route, compiler, effects, resume) {
    const lines = [];
    for (const site of effects) {
      const globalIndex = compiler.effectIndex(site.id);
      lines.push(`unchecked(__pulse_entities_effect_pending[${globalIndex}] = 1)`);
      lines.push(`unchecked(__pulse_entities_effect_ready[${globalIndex}] = 0)`);
      lines.push(`unchecked(__pulse_entities_effect_ok[${globalIndex}] = 0)`);
      lines.push(`const payload_${globalIndex} = ${compiler.prefix}_effect_payload_${globalIndex}()`);
      lines.push(`pulse_entities_host_effect_begin(${globalIndex}, changetype<i32>(payload_${globalIndex}), payload_${globalIndex}.length)`);
    }
    return block('suspend', { lines, pending: effects.length, resume });
  }

  function compileParallel(route, compiler, operation, next) {
    const effects = operation.effects;
    const lines = [];
    for (const site of effects) {
      const globalIndex = compiler.effectIndex(site.id);
      lines.push(`if (unchecked(__pulse_entities_effect_ok[${globalIndex}]) == 0) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)`);
      lines.push(...decoderLines(route, site, globalIndex, `effect_${globalIndex}`));
    }
    if (operation.strategy === 'implicit-independent-fetch-group') {
      for (let index = 0; index < operation.bindings.length; index += 1) {
        const binding = operation.bindings[index];
        const globalIndex = compiler.effectIndex(effects[index].id);
        lines.push(`unchecked(__pulse_entities_locals[${compiler.localIndex(binding.id)}] = effect_${globalIndex})`);
      }
    } else if (operation.bindings.length === 1 && operation.bindings[0].key === null) {
      const binding = operation.bindings[0];
      lines.push('const parallel_result = new JSON.Obj()');
      for (const site of effects) lines.push(`parallel_result.set<JSON.Value>(${quote(site.groupKey)}, effect_${compiler.effectIndex(site.id)})`);
      lines.push(`unchecked(__pulse_entities_locals[${compiler.localIndex(binding.id)}] = JSON.Value.from<JSON.Obj>(parallel_result))`);
    } else {
      for (const binding of operation.bindings) {
        const site = effects.find((entry) => entry.groupKey === binding.key);
        if (!site) fail('PULSE_ENTITIES_NATIVE_PARALLEL_BINDING_INVALID', `Parallel binding ${binding.key} has no effect.`, { handlerId: route.handler.id });
        lines.push(`unchecked(__pulse_entities_locals[${compiler.localIndex(binding.id)}] = effect_${compiler.effectIndex(site.id)})`);
      }
    }
    for (const site of effects) {
      const globalIndex = compiler.effectIndex(site.id);
      lines.push(`unchecked(__pulse_entities_effect_pending[${globalIndex}] = 0)`, `unchecked(__pulse_entities_effect_ready[${globalIndex}] = 0)`);
    }
    const resume = block('action', { lines, next });
    return suspendBlock(route, compiler, effects, resume);
  }

  function compileOperation(route, compiler, operation, next) {
    if (!operation) return next;
    if (operation.kind === 'block') return compileSequence(route, compiler, operation.statements || [], next);
    if (operation.kind === 'local') return block('action', { lines: [`unchecked(__pulse_entities_locals[${compiler.localIndex(operation.id)}] = ${compiler.expressionName(operation.initializer)}())`], next });
    if (operation.kind === 'if') {
      const thenBlock = compileOperation(route, compiler, operation.thenOperation, next);
      const elseBlock = compileOperation(route, compiler, operation.elseOperation, next);
      return block('branch', { test: compiler.expressionName(operation.test), thenBlock, elseBlock });
    }
    if (operation.kind === 'effect') {
      const resume = resumeBlockForEffect(route, compiler, operation, next);
      return suspendBlock(route, compiler, [operation.effect], resume);
    }
    if (operation.kind === 'parallel') return compileParallel(route, compiler, operation, next);
    if (operation.kind === 'logging') {
      const args = operation.arguments || [];
      const level = new Map([['debug', 0], ['info', 1], ['warn', 2], ['error', 3]]).get(operation.site.level) ?? 1;
      const lines = ['const log_values = new JSON.Arr()'];
      for (const argument of args) lines.push(`log_values.push<JSON.Value>(${compiler.expressionName(argument)}())`);
      lines.push('const log_payload = JSON.stringify<JSON.Arr>(log_values)', `pulse_entities_host_log(${level}, changetype<i32>(log_payload), log_payload.length)`);
      return block('action', { lines, next });
    }
    if (operation.kind === 'schema-result') return outputBlock(route, compiler, compiler.expressionName(operation.expression));
    if (operation.kind === 'completion') return outputBlock(route, compiler, null, true);
    fail('PULSE_ENTITIES_NATIVE_OPERATION_UNSUPPORTED', `Managed operation ${String(operation.kind)} cannot be lowered to Native Entities.`, { handlerId: route.handler.id, kind: operation.kind });
  }

  function compileSequence(route, compiler, operations, next) {
    let current = next;
    for (let index = operations.length - 1; index >= 0; index -= 1) current = compileOperation(route, compiler, operations[index], current);
    return current;
  }

  for (let index = 0; index < model.routes.length; index += 1) {
    const route = model.routes[index];
    const entry = compileOperation(route, compilers[index], route.handler.body, fallthrough);
    routeEntryBlocks.set(route.index, entry);
  }

  function renderOutput(route, expression, completion, valueName) {
    if (completion || route.entity.outputSchema === null) return ['return __pulse_entities_complete_success(\'null\')'];
    const schema = schemaOutput.roots.get(route.entity.outputSchema);
    const raw = valueName || `${expression}()`;
    return [
      `const output_raw = ${raw}`,
      '__pulse_entities_schema_valid = true',
      `const output = ${schema}(output_raw)`,
      'if (!__pulse_entities_schema_valid) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)',
      'return __pulse_entities_complete_success(JSON.stringify<JSON.Value>(output))'
    ];
  }

  function renderBlock(entry) {
    const lines = [`    case ${entry.id}: {`];
    const emit = (line) => lines.push(`      ${line}`);
    if (entry.kind === 'action') {
      for (const line of entry.lines) emit(line);
      emit(`__pulse_entities_pc = ${entry.next}`);
      emit('continue');
    } else if (entry.kind === 'branch') {
      emit(`__pulse_entities_pc = __pulse_entities_truthy(${entry.test}()) ? ${entry.thenBlock} : ${entry.elseBlock}`);
      emit('continue');
    } else if (entry.kind === 'suspend') {
      for (const line of entry.lines) emit(line);
      emit(`__pulse_entities_pc = ${entry.resume}`);
      emit(`__pulse_entities_pending_count = ${entry.pending}`);
      emit('__pulse_entities_suspended = 1');
      emit('return __PULSE_ENTITIES_RUN_SUSPENDED');
    } else if (entry.kind === 'output') {
      for (const line of renderOutput(entry.route, entry.expression, entry.completion)) emit(line);
    } else if (entry.kind === 'resume-output') {
      for (const line of entry.lines) emit(line);
      for (const line of renderOutput(entry.route, null, false, entry.value)) emit(line);
    } else if (entry.kind === 'failure') emit('return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)');
    lines.push('    }');
    return lines.join('\n');
  }

  const imports = [];
  if (effectCount > 0) imports.push('@external("pulse_entities_host", "effect_begin") declare function pulse_entities_host_effect_begin(effectIndex: i32, payloadPointer: i32, payloadLength: i32): void');
  if (loggingCount > 0) imports.push('@external("pulse_entities_host", "log") declare function pulse_entities_host_log(level: i32, payloadPointer: i32, payloadLength: i32): void');

  const routeSelection = model.routes.map((route) => `  if (__pulse_entities_method == ${quote(route.entity.discriminator)}) return ${route.index}`).join('\n');
  const routePreparation = model.routes.map((route) => {
    const lines = [`    case ${route.index}: {`];
    if (route.entity.inputSchema === null) {
      lines.push(`      if (__pulse_entities_params_present && !(${model.router.adapter.options.acceptEmptyObjectForNoInput ? 'true' : 'false'} && __pulse_entities_empty_object(__pulse_entities_request.substring(__pulse_entities_params_start, __pulse_entities_params_end)))) return false`);
      lines.push('      __pulse_entities_input = __pulse_entities_null()');
    } else {
      const schema = schemaOutput.roots.get(route.entity.inputSchema);
      lines.push('      if (!__pulse_entities_params_present || __pulse_entities_request.charCodeAt(__pulse_entities_params_start) != 0x7b) return false');
      lines.push('      const raw = JSON.parse<JSON.Value>(__pulse_entities_request.substring(__pulse_entities_params_start, __pulse_entities_params_end))');
      lines.push('      __pulse_entities_schema_valid = true');
      lines.push(`      __pulse_entities_input = ${schema}(raw)`);
      lines.push('      if (!__pulse_entities_schema_valid) return false');
    }
    lines.push('      return true', '    }');
    return lines.join('\n');
  }).join('\n');
  const routeEntry = model.routes.map((route) => `    case ${route.index}: return ${routeEntryBlocks.get(route.index)}`).join('\n');
  const payloadFunctions = model.routes.flatMap((route, routeIndex) => route.handler.effects.sites.map((site) => compilers[routeIndex].payloadFunction(site))).join('\n');
  const expressionFunctions = compilers.map((compiler) => compiler.renderExpressions()).join('\n\n');

  const source = [
    '',
    '/* Generated reachable Entities Native program. */',
    ...imports,
    '',
    `const __PULSE_ENTITIES_ROUTE_COUNT: i32 = ${model.routes.length}`,
    `const __PULSE_ENTITIES_EFFECT_COUNT: i32 = ${effectCount}`,
    `const __PULSE_ENTITIES_LOCAL_COUNT: i32 = ${localCount}`,
    'let __pulse_entities_started: i32 = 0',
    'let __pulse_entities_selected: i32 = -1',
    'let __pulse_entities_pc: i32 = -1',
    'let __pulse_entities_suspended: i32 = 0',
    'let __pulse_entities_pending_count: i32 = 0',
    'let __pulse_entities_input: JSON.Value = __pulse_entities_null()',
    'let __pulse_entities_locals = new Array<JSON.Value>()',
    'let __pulse_entities_effect_results = new Array<JSON.Value>()',
    'let __pulse_entities_effect_pending = new Array<i32>()',
    'let __pulse_entities_effect_ready = new Array<i32>()',
    'let __pulse_entities_effect_ok = new Array<i32>()',
    'let __pulse_entities_invocations = new Array<i32>()',
    '',
    schemaOutput.source,
    expressionFunctions,
    payloadFunctions,
    'function __pulse_entities_select(): i32 {',
    routeSelection,
    '  return -1',
    '}',
    'function __pulse_entities_prepare(routeIndex: i32): bool {',
    '  switch (routeIndex) {',
    routePreparation,
    '    default: return false',
    '  }',
    '}',
    'function __pulse_entities_entry(routeIndex: i32): i32 {',
    '  switch (routeIndex) {',
    routeEntry,
    '    default: return -1',
    '  }',
    '}',
    'function __pulse_entities_reset_values(): void {',
    '  __pulse_entities_locals = new Array<JSON.Value>()',
    '  for (let index: i32 = 0; index < __PULSE_ENTITIES_LOCAL_COUNT; index += 1) __pulse_entities_locals.push(__pulse_entities_null())',
    '  __pulse_entities_effect_results = new Array<JSON.Value>()',
    '  __pulse_entities_effect_pending = new Array<i32>()',
    '  __pulse_entities_effect_ready = new Array<i32>()',
    '  __pulse_entities_effect_ok = new Array<i32>()',
    '  for (let index: i32 = 0; index < __PULSE_ENTITIES_EFFECT_COUNT; index += 1) { __pulse_entities_effect_results.push(__pulse_entities_null()); __pulse_entities_effect_pending.push(0); __pulse_entities_effect_ready.push(0); __pulse_entities_effect_ok.push(0) }',
    '  __pulse_entities_invocations = new Array<i32>()',
    '  for (let index: i32 = 0; index < __PULSE_ENTITIES_ROUTE_COUNT; index += 1) __pulse_entities_invocations.push(0)',
    '}',
    'function __pulse_entities_run(): i32 {',
    `  let guard: i32 = ${Math.max(64, blocks.length * 8)}`,
    '  while (guard > 0) {',
    '    guard -= 1',
    '    switch (__pulse_entities_pc) {',
    ...blocks.map(renderBlock),
    '      default: return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)',
    '    }',
    '  }',
    '  return __pulse_entities_complete_failure(__PULSE_ENTITIES_INTERNAL_ERROR, true)',
    '}',
    'export function pulse_entities_start(): i32 {',
    '  if (__pulse_entities_started != 0 || __pulse_entities_request_set == 0) return __PULSE_ENTITIES_RUN_FAILED',
    '  __pulse_entities_started = 1',
    '  __pulse_entities_reset_values()',
    '  if (!__pulse_entities_scan_envelope(__pulse_entities_request)) return __pulse_entities_complete_failure(__pulse_entities_scan_error, false)',
    '  __pulse_entities_selected = __pulse_entities_select()',
    '  if (__pulse_entities_selected < 0) return __pulse_entities_complete_failure(__PULSE_ENTITIES_METHOD_NOT_FOUND, true)',
    '  if (!__pulse_entities_prepare(__pulse_entities_selected)) return __pulse_entities_complete_failure(__PULSE_ENTITIES_INVALID_PARAMS, true)',
    '  unchecked(__pulse_entities_invocations[__pulse_entities_selected] += 1)',
    '  __pulse_entities_pc = __pulse_entities_entry(__pulse_entities_selected)',
    '  return __pulse_entities_run()',
    '}',
    'export function pulse_entities_set_effect_result(effectIndex: i32, ok: i32, pointer: i32): i32 {',
    '  if (effectIndex < 0 || effectIndex >= __PULSE_ENTITIES_EFFECT_COUNT || pointer <= 0 || unchecked(__pulse_entities_effect_pending[effectIndex]) == 0 || unchecked(__pulse_entities_effect_ready[effectIndex]) != 0) return __PULSE_ENTITIES_RESULT_REJECTED',
    '  const text = changetype<string>(pointer)',
    '  let value = __pulse_entities_null()',
    '  let accepted = ok != 0',
    '  if (accepted) { const end = __pulse_entities_scan_value(text, 0, 1); if (end < 0 || __pulse_entities_ws(text, end) != text.length) accepted = false; else value = JSON.parse<JSON.Value>(text) }',
    '  unchecked(__pulse_entities_effect_results[effectIndex] = value)',
    '  unchecked(__pulse_entities_effect_ok[effectIndex] = accepted ? 1 : 0)',
    '  unchecked(__pulse_entities_effect_ready[effectIndex] = 1)',
    '  __pulse_entities_pending_count -= 1',
    '  return __PULSE_ENTITIES_RESULT_ACCEPTED',
    '}',
    'export function pulse_entities_resume(): i32 {',
    '  if (__pulse_entities_suspended == 0 || __pulse_entities_pending_count != 0) return __PULSE_ENTITIES_RUN_FAILED',
    '  __pulse_entities_suspended = 0',
    '  return __pulse_entities_run()',
    '}',
    'export function pulse_entities_pending_count(): i32 { return __pulse_entities_pending_count }',
    'export function pulse_entities_selected_index(): i32 { return __pulse_entities_selected }',
    'export function pulse_entities_invocation_count(routeIndex: i32): i32 { return routeIndex >= 0 && routeIndex < __pulse_entities_invocations.length ? unchecked(__pulse_entities_invocations[routeIndex]) : 0 }',
    'export function pulse_entities_effect_count(): i32 { return __PULSE_ENTITIES_EFFECT_COUNT }',
    ''
  ].join('\n');
  return Object.freeze({ source, effectCount, localCount, loggingCount, blocks: Object.freeze(blocks) });
}

function applyLimits(base, router) {
  const limits = router.adapter.limits;
  const replacements = new Map([
    ['__PULSE_ENTITIES_MAX_ENVELOPE_BYTES', limits.maxEnvelopeBytes],
    ['__PULSE_ENTITIES_MAX_PAYLOAD_BYTES', limits.maxPayloadBytes],
    ['__PULSE_ENTITIES_MAX_METHOD_BYTES', limits.maxMethodBytes],
    ['__PULSE_ENTITIES_MAX_DEPTH', limits.maxJsonDepth],
    ['__PULSE_ENTITIES_MAX_OUTPUT_BYTES', limits.maxOutputBytes]
  ]);
  let source = base;
  for (const [name, value] of replacements) {
    const pattern = new RegExp(`const ${name}: i32 = [0-9_]+`);
    if (!pattern.test(source)) fail('PULSE_ENTITIES_NATIVE_BASE_INVALID', `Package Native base is missing limit ${name}.`);
    source = source.replace(pattern, `const ${name}: i32 = ${Number(value)}`);
  }
  return source;
}

function buildEntitiesNativeSource(input) {
  const model = normalizeInputs(input);
  const schemaOutput = renderSchemas(model.schemas);
  const program = renderNativeProgram(model, schemaOutput);
  const base = applyLimits(fs.readFileSync(sourceFile, 'utf8'), model.router);
  const source = `${base.trimEnd()}\n${program.source}`;
  const imports = Object.freeze([
    ...(program.effectCount > 0 ? [Object.freeze({ module: 'pulse_entities_host', name: 'effect_begin' })] : []),
    ...(program.loggingCount > 0 ? [Object.freeze({ module: 'pulse_entities_host', name: 'log' })] : [])
  ]);
  const exports = Object.freeze([
    'pulse_entities_string_id',
    'pulse_entities_set_request',
    'pulse_entities_start',
    'pulse_entities_resume',
    'pulse_entities_set_effect_result',
    'pulse_entities_pending_count',
    'pulse_entities_selected_index',
    'pulse_entities_invocation_count',
    'pulse_entities_effect_count',
    'pulse_entities_response_ptr',
    'pulse_entities_response_length',
    'pulse_entities_response_status',
    'pulse_entities_body_read_count'
  ]);
  const discriminatorTable = Object.freeze(model.routes.map((route) => Object.freeze({
    index: route.index,
    discriminator: route.entity.discriminator,
    handlerId: route.handlerId,
    inputSchema: route.entity.inputSchema,
    outputSchema: route.entity.outputSchema,
    effects: Object.freeze(route.handler.effects.sites.map((site) => site.id))
  })));
  return deepFreeze({
    version: ENTITIES_NATIVE_SOURCE_VERSION,
    id: 'pulse-entities-native-as',
    owner: entitiesContracts.ENTITIES_PACKAGE_NAME,
    packageVersion: packageManifest.version,
    kind: 'package-generated-source',
    language: 'assemblyscript',
    license: 'Apache-2.0',
    origin: 'package-source+reachable-lowering',
    sourceIncluded: true,
    sourceFile: sourceRelativeFile,
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: sha256(source),
    planHash: model.plan.planHash,
    managedHandlerNativeBundleHash: model.nativeBundle.bundleHash,
    discriminatorTable,
    schemas: Object.freeze(model.schemas.map((schema) => schema.id)),
    handlers: Object.freeze(model.routes.map((route) => route.handlerId)),
    imports,
    exports,
    summary: Object.freeze({
      routes: model.routes.length,
      schemas: model.schemas.length,
      handlers: model.routes.length,
      effects: program.effectCount,
      locals: program.localCount,
      blocks: program.blocks.length
    }),
    semanticOwnership: Object.freeze([
      'bounded-json-rpc-envelope-scan',
      'static-discriminator-selection',
      'selected-schema-decode',
      'managed-handler-dispatch',
      'selected-schema-encode',
      'json-rpc-completion-framing'
    ]),
    providerAuthorities: Object.freeze(['effect-execution', 'logging']),
    policy: Object.freeze({
      requestBodyReads: 1,
      selectBeforeDecode: true,
      exactlyOneSelectedHandler: true,
      selectedOutputOnly: true,
      catalogMetadataIncluded: false,
      sourceAstIncluded: false,
      javascriptHandlerImports: false,
      javascriptRuntime: false,
      asyncify: false,
      packageTargetPromoted: true,
      automaticFallback: false
    })
  });
}

module.exports = Object.freeze({
  ENTITIES_NATIVE_SOURCE_VERSION,
  MANAGED_NATIVE_BUNDLE_VERSION,
  EntitiesNativeSourceError,
  buildEntitiesNativeSource
});
