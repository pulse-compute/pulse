'use strict';

// Alias and retention decisions stay private. Control receives stable names;
// declaration rendering remains deferred until final source assembly.
function prepareNativeExpressions({
  expressions, expressionIndex, pureHelpers, localIndex, binaryIndex, unaryIndex,
  fail, localName, stringHandle
}) {
  const expressionAlias = new Map();
  const retainedExpressions = new Set();
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

  return {
    exprName,
    renderDeclarations() {
      return [
        ...expressions.filter((_, index) => !expressionAlias.has(index)).map(renderExpression),
        ...[...pureHelpers.values()].map(renderPureHelper)
      ];
    }
  };
}

module.exports = Object.freeze({ prepareNativeExpressions });
