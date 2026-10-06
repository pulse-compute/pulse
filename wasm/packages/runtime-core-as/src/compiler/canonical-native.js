'use strict';

const {
  runtimeContract, eventContract, CanonicalNativeAssemblyScriptError,
  stableHash, quote, prepareNativePlan, prepareNativeEmissionInputs, prepareNativeFlow
} = require('./canonical-native-context.js');
const { nativeSchemaCodecSource } = require('./canonical-native-schema.js');
const { buildNativeCryptoGuestSources } = require('./crypto-guest-source.js');
const {
  prepareNativeRuntimeSupport, renderNativeValueSupport,
  renderNativeResumeSupport, renderNativeExports
} = require('./canonical-native-support.js');

const CANONICAL_NATIVE_AS_GENERATOR_VERSION = runtimeContract.CANONICAL_NATIVE_AS_GENERATOR_VERSION;

function generateCanonicalNativeAssemblyScript(plan, options = {}) {
  const {
    pureHelpers, stages, stageBindings, stageSites, maxStageSites,
    localIndex, effectIndex, continuationIndex, expressions, expressionIndex,
    stateEnabled, binaryIndex, unaryIndex, fail, localName, stringHandle
  } = prepareNativePlan(plan);
  const stageEntries = new Map();
  const expressionAlias = new Map();
  const retainedExpressions = new Set();
  const nativeSchemaCodecs = nativeSchemaCodecSource(plan);
  const nativeCrypto = buildNativeCryptoGuestSources(plan);
  const { eventEntries, eventReachable } = prepareNativeEmissionInputs(plan);

  function exprName(expression) {
    const index = expressionIndex.get(expression);
    if (!Number.isInteger(index)) fail('Expression was not registered for native AssemblyScript generation.', { expression });
    const representative = expressionAlias.get(index) ?? index;
    // Encode the existing decision without changing identifier length or
    // lexical order: chunk budgets count source characters and Binaryen uses
    // names to break function-ordering ties. '$' sorts before the next digit.
    return `__pulse_ex_${representative}$${retainedExpressions.has(representative) ? 'k' : 'i'}`;
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
          'request.body.forward-marker': () => 'host_request_body()',
          'request.json': () => `host_request_json(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'})`,
          'response.json': () => `host_response_json(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'schema.encode.text': () => `host_schema_encode(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'schema.decode.text': () => `host_schema_decode(${args[0] ? `${exprName(args[0])}()` : 'host_value_undefined()'}, ${args[1] ? `${exprName(args[1])}()` : 'host_value_undefined()'})`,
          'response.output.close': () => 'host_output_close()',
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
        else if (s.kind === 'return') lines.push(`${indent}{`, `${indent}  const result = ${exprName(s.value)}()`, ...helper.localIds.map(id => `${indent}  ${localName(id)} = 0`), `${indent}  return result`, `${indent}}`);
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
  const { applicationErrors, helpers, handlers, routerLocal, routerCursor } = prepareNativeFlow(plan, pureHelpers);
  const helperEntries = new Map();
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

  const support = prepareNativeRuntimeSupport({
    plan, stages, stageSites, maxStageSites, helpers, applicationErrors,
    stateEnabled, eventEntries, eventReachable, blocks, resumeRequirements
  });

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
    ...support.imports,
    '',
    `const PULSE_ABI_VERSION: i32 = ${runtimeContract.CANONICAL_NATIVE_ABI_VERSION}`,
    `const PULSE_PLAN_HASH: string = ${quote(plan.planHash)}`,
    `const PULSE_ENTRY_PC: i32 = ${entryBlock}`,
    ...support.executionGlobals,
    ...support.globals,
    ...renderNativeValueSupport({ stages, stageSites, stateEnabled, binaryIndex }),
    ...nativeSchemaCodecs.declarations,
    ...(nativeCrypto.active ? [nativeCrypto.source] : []),
    ...expressions.filter((_, index) => !expressionAlias.has(index)).map(renderExpression),
    ...[...pureHelpers.values()].map(renderPureHelper),
    ...renderNativeResumeSupport(support),
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
    ...renderNativeExports({ eventReachable, stateEnabled, eventExports: support.eventExports, setterCases: support.setterCases }),
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
      ...(plan.capabilities.includes('request.body.transform') ? { bodyTransform: { version: 'pulse.bounded-text-transform.v1', inputBytes: 65536, outputBytes: 262144, maxExpansionRatio: 4, encoding: 'utf-8-fatal', memory: runtimeContract.CANONICAL_NATIVE_READ_LOOP_MEMORY } } : {}),
      ...(plan.capabilities.includes('response.output') ? { generatedOutput: { version: 'pulse.generated-output.v1', memory: runtimeContract.CANONICAL_NATIVE_READ_LOOP_MEMORY, completion: 'provider-local-finish', independentInstalledQualification: false } } : {}),
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
