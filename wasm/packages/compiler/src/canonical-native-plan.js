'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { executeCanonicalNativePlanSpine } = require('./spine/canonical-native-plan.js');

function loadNativePlanContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-plan'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/handler/canonical-native-plan.js');
    }
    throw error;
  }
}

function loadLoggingContract() {
  try { return require('@pulse-compute/wasm-contracts/logging'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/logging.js');
    }
    throw error;
  }
}

function loadCryptoContract() {
  try { return require('@pulse-compute/wasm-contracts/crypto/contracts'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/crypto/contracts.js');
    }
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

const contract = loadNativePlanContract();
const loggingContract = loadLoggingContract();
const cryptoContract = loadCryptoContract();
const eventContract = loadEventContract();
const CANONICAL_NATIVE_PLAN_COMPILER_VERSION = 'pulse.canonical-native-plan-compiler.v2';
const GENERATED_HANDLER_NAME = '__pulse_handler';
const PULSE_RUNTIME_PARAMETER = '__pulse';

const ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '&=', '|=', '^=', '<<=', '>>=', '>>>='
]);
const PURE_BINARY_OPERATORS = new Set([
  '===', '!==', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '**',
  '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>', 'in'
]);
const PREFIX_OPERATORS = new Set(['!', '+', '-', '~', 'typeof', 'void']);
const UPDATE_OPERATORS = new Set(['++', '--']);
const FETCH_RESPONSE_METHODS = new Set(['json', 'text', 'header']);
const COMPILER_OWNED_INTRINSICS = Object.freeze({
  __pulse_event_runtime_id: Object.freeze(['event.runtime-id', 'number']),
  __pulse_router_match: Object.freeze(['router.match', 'boolean']),
  __pulse_router_param: Object.freeze(['router.param', 'string-or-undefined'])
});
const EFFECT_STATIC_FIELDS = new Set([
  'id', 'kind', 'source', 'package', 'contractId', 'providerKind', 'operation', 'capability', 'result'
]);

class CanonicalNativePlanError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'CanonicalNativePlanError';
    this.code = 'PULSE_CANONICAL_NATIVE_PLAN_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

function stableHash(value) {
  return crypto.createHash(contract.CANONICAL_NATIVE_PLAN_HASH_ALGORITHM).update(String(value)).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = stableObject(value[key]);
  }
  return out;
}

function stableStringify(value, space = 0) {
  return JSON.stringify(stableObject(value), null, space);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function sourcePosition(sourceFile, node) {
  const offset = node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0;
  const position = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ line: position.line + 1, column: position.character + 1, offset });
}

function diagnostic(sourceFile, node, code, message, detail = {}) {
  return Object.freeze({
    code,
    kind: 'CanonicalNativePlanDiagnostic',
    severity: 'error',
    message,
    file: sourceFile ? sourceFile.fileName : undefined,
    position: sourceFile ? sourcePosition(sourceFile, node || sourceFile) : undefined,
    detail: Object.freeze({ ...detail })
  });
}

function unwrap(node) {
  let current = node;
  while (current && (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isPartiallyEmittedExpression(current)
  )) current = current.expression;
  return current;
}

function literalString(node) {
  const current = unwrap(node);
  return current && (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) ? current.text : undefined;
}

function propertyName(sourceFile, name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return String(name.text);
  if (ts.isComputedPropertyName(name)) return undefined;
  return name ? name.getText(sourceFile) : undefined;
}

function declarationKind(statement) {
  const flags = statement.declarationList.flags;
  if ((flags & ts.NodeFlags.Const) !== 0) return 'const';
  if ((flags & ts.NodeFlags.Let) !== 0) return 'let';
  return 'var';
}

function formatStatementPath(parts) {
  let out = String(parts[0] || 'entry');
  for (const part of parts.slice(1)) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += `.${part}`;
  }
  return out;
}

function generatedHandler(sourceFile) {
  return sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement)
    && statement.name
    && statement.name.text === GENERATED_HANDLER_NAME
  ));
}

function contextPath(node, ctxName) {
  const parts = [];
  let current = unwrap(node);
  while (current && ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = unwrap(current.expression);
  }
  if (current && ts.isIdentifier(current) && current.text === ctxName) return parts;
  return undefined;
}

function contextValueKind(parts) {
  const key = parts.join('.');
  if (['req.method', 'req.url', 'req.path'].includes(key)) return 'string';
  if (key === 'req.headers') return 'headers';
  if (key === 'event.payload') return 'json';
  return 'unknown';
}

function intrinsicForContextCall(parts) {
  const key = parts.join('.');
  const entries = {
    'req.header': ['request.header', 'string-or-undefined'],
    'req.text': ['request.text', 'string'],
    'req.json': ['request.json', 'json'],
    json: ['response.json', 'pulse-result'],
    encodeJson: ['schema.encode.text', 'string'],
    text: ['response.text', 'pulse-result'],
    response: ['response.custom', 'pulse-result'],
    kv: ['kv.namespace', 'kv-namespace'],
    'state.get': ['state.get', 'string-or-undefined'],
    'state.set': ['state.set', 'undefined']
  };
  return entries[key];
}

function resultKindForEffect(site, decoder, continuation, resultMode) {
  if (decoder && decoder.kind === 'json') return 'json';
  if (decoder && decoder.kind === 'text') return 'string';
  if (resultMode === 'return' && continuation && continuation.kind === 'opaque-fetch-return') return 'opaque-response';
  if (site.result === 'opaque-response') return 'opaque-response';
  if (site.result === 'structured-response') return 'structured-response';
  if (site.result === 'ack') return 'ack';
  if (site.kind === 'fetch') return 'fetch-response';
  if (site.kind === 'config.get' || site.kind === 'secret.get') return 'string-or-undefined';
  if (site.kind === 'kv.get') return 'json-or-undefined';
  if (site.kind === 'kv.put') return 'ack';
  if (['kv.getVersioned', 'kv.insertIfAbsent', 'kv.compareAndSwap'].includes(site.kind)) return 'json';
  if (site.kind === 'event.emit') return 'ack';
  return 'unknown';
}

function inferBinaryValueKind(operator, left, right) {
  if (['===', '!==', '==', '!=', '<', '<=', '>', '>=', 'in'].includes(operator)) return 'boolean';
  if (['&&', '||', '??'].includes(operator)) {
    if (left.valueKind === right.valueKind) return left.valueKind;
    if (['||', '??'].includes(operator)) {
      const kinds = new Set([left.valueKind, right.valueKind]);
      if (kinds.has('string') && kinds.has('string-or-undefined')) return 'string';
    }
    return 'unknown';
  }
  if (operator === '+' && (left.valueKind === 'string' || right.valueKind === 'string')) return 'string';
  if (['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>'].includes(operator)) return 'number';
  return 'unknown';
}

class NativePlanBuilder {
  constructor(compiled, options = {}) {
    this.compiled = compiled;
    this.options = options;
    this.diagnostics = [];
    this.effects = [];
    this.locals = [];
    this.effectOccurrences = new Map();
    this.continuationOccurrences = new Map();
    this.localIndex = 0;
    this.effectOrder = 0;
    this.reporting = loggingContract.reportingDescriptor(options.reporting);
    this.enabledLogCount = 0;
    this.prunedLogCount = 0;
    this.summary = {
      statementCount: 0,
      expressionCount: 0,
      localCount: 0,
      branchCount: 0,
      returnCount: 0,
      effectCount: 0,
      effectGroupCount: 0,
      continuationCount: 0,
      maxStatementDepth: 0
    };

    if (!compiled || compiled.ok !== true || !compiled.metadata || typeof compiled.generatedSource !== 'string') {
      const code = contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.COMPILED_PROGRAM_REQUIRED;
      throw new CanonicalNativePlanError('A successful canonical compilation is required to build a native plan.', [
        diagnostic(undefined, undefined, code, 'Expected compileCanonicalSource/compileCanonicalProject output with metadata and generatedSource.')
      ]);
    }

    if (compiled.nativeEligibility && compiled.nativeEligibility.eligible !== true) {
      const diagnostics = (compiled.nativeEligibility.blockers || []).map((blocker) => Object.freeze({
        code: blocker.code,
        kind: 'CanonicalNativePlanDiagnostic',
        severity: 'error',
        message: blocker.message,
        file: blocker.source && blocker.source.file,
        position: blocker.source ? Object.freeze({ line: blocker.source.line, column: blocker.source.column }) : undefined,
        detail: Object.freeze({
          blockerId: blocker.id,
          blockerKind: blocker.kind,
          moduleId: blocker.moduleId,
          handlerIds: blocker.handlerIds,
          packageName: blocker.packageName,
          packageSubpath: blocker.packageSubpath,
          contractId: blocker.contractId,
          specifier: blocker.specifier,
          automaticFallback: false
        })
      }));
      throw new CanonicalNativePlanError(
        `The canonical project is not eligible for native-plan lowering (${diagnostics.length} blocker${diagnostics.length === 1 ? '' : 's'}).`,
        diagnostics
      );
    }

    const eventCatalog = compiled.eventCatalog || compiled.metadata && compiled.metadata.events && compiled.metadata.events.catalog;
    const nativeIneligibleEvents = eventCatalog && Array.isArray(eventCatalog.events)
      ? eventCatalog.events.filter((entry) => entry && entry.eligibility && entry.eligibility.native !== true)
      : [];
    if (nativeIneligibleEvents.length > 0) {
      throw new CanonicalNativePlanError(
        `The canonical event catalog contains ${nativeIneligibleEvents.length} event handler${nativeIneligibleEvents.length === 1 ? '' : 's'} not eligible for Native lowering.`,
        nativeIneligibleEvents.map((entry) => diagnostic(
          undefined,
          undefined,
          contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EVENT_HANDLER_INELIGIBLE,
          `Event ${JSON.stringify(entry.type)} is not eligible for Native lowering in this implementation pass.`,
          {
            eventStableId: entry.stableId,
            eventRuntimeId: entry.runtimeId,
            handlerStableId: entry.handlerStableId,
            capabilities: entry.capabilities,
            automaticFallback: false
          }
        ))
      );
    }

    this.metadata = compiled.metadata;
    this.generatedFile = `${this.metadata.file || 'app.ts'}.canonical.generated.js`;
    this.sourceFile = ts.createSourceFile(
      this.generatedFile,
      compiled.generatedSource,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS
    );
    const handlers = generatedHandler(this.sourceFile);
    if (handlers.length === 0) {
      this.fail(this.sourceFile, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.GENERATED_HANDLER_MISSING, `Generated canonical program does not contain ${GENERATED_HANDLER_NAME}.`);
      this.handler = undefined;
    } else {
      if (handlers.length > 1) this.fail(handlers[1], contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.GENERATED_HANDLER_DUPLICATE, `Generated canonical program contains more than one ${GENERATED_HANDLER_NAME}.`);
      this.handler = handlers[0];
    }
    this.ctxName = this.handler && this.handler.parameters[0] && ts.isIdentifier(this.handler.parameters[0].name)
      ? this.handler.parameters[0].name.text
      : String(this.metadata.ctxParameter || 'ctx');
    this.effectSites = new Map((this.metadata.effectSites || []).map((site) => [String(site.id), site]));
    this.continuationSites = new Map((this.metadata.continuationSites || []).map((site) => [String(site.id), site]));
    this.compilerOwnedCalls = new Set((this.metadata.compilerOwnedCalls || []).map(String));
    this.compilerOwnedIntrinsics = new Map(Object.entries(COMPILER_OWNED_INTRINSICS));
    for (const entry of this.metadata.compilerOwnedIntrinsics || []) {
      if (!entry || !entry.compilerName || !entry.intrinsic) continue;
      this.compilerOwnedIntrinsics.set(String(entry.compilerName), Object.freeze([
        String(entry.intrinsic),
        String(entry.valueKind || 'unknown')
      ]));
    }
  }

  fail(node, code, message, detail = {}) {
    this.diagnostics.push(diagnostic(this.sourceFile, node, code, message, detail));
  }

  expression(node, scope) {
    const current = unwrap(node);
    this.summary.expressionCount += 1;
    if (!current) return Object.freeze({ kind: 'undefined', valueKind: 'undefined' });

    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      return Object.freeze({ kind: 'literal', value: current.text, valueKind: 'string' });
    }
    if (ts.isNumericLiteral(current)) {
      return Object.freeze({ kind: 'literal', value: Number(current.text), valueKind: 'number' });
    }
    if (current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword) {
      return Object.freeze({ kind: 'literal', value: current.kind === ts.SyntaxKind.TrueKeyword, valueKind: 'boolean' });
    }
    if (current.kind === ts.SyntaxKind.NullKeyword) return Object.freeze({ kind: 'literal', value: null, valueKind: 'null' });

    if (ts.isIdentifier(current)) {
      if (current.text === 'undefined') return Object.freeze({ kind: 'undefined', valueKind: 'undefined' });
      if (current.text === this.ctxName) return Object.freeze({ kind: 'context-read', path: Object.freeze([]), valueKind: 'unknown' });
      const local = scope.get(current.text);
      if (!local) {
        this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.LOCAL_UNRESOLVED, `Generated canonical expression references unresolved local ${current.text}.`, { local: current.text });
        return Object.freeze({ kind: 'local', id: `unresolved:${current.text}`, name: current.text, valueKind: 'unknown' });
      }
      return Object.freeze({ kind: 'local', id: local.id, name: local.name, valueKind: local.valueKind });
    }

    if (ts.isArrayLiteralExpression(current)) {
      const items = current.elements.map((item) => {
        if (ts.isSpreadElement(item)) return Object.freeze({ kind: 'spread', value: this.expression(item.expression, scope), valueKind: 'unknown' });
        if (ts.isOmittedExpression(item)) return Object.freeze({ kind: 'undefined', valueKind: 'undefined' });
        return this.expression(item, scope);
      });
      return Object.freeze({ kind: 'array', items: Object.freeze(items), valueKind: 'array' });
    }

    if (ts.isObjectLiteralExpression(current)) {
      const entries = [];
      for (const property of current.properties) {
        if (ts.isSpreadAssignment(property)) {
          entries.push(Object.freeze({ kind: 'spread', value: this.expression(property.expression, scope) }));
          continue;
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          const local = scope.get(property.name.text);
          if (!local) {
            this.fail(property, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.LOCAL_UNRESOLVED, `Object shorthand references unresolved local ${property.name.text}.`, { local: property.name.text });
            continue;
          }
          entries.push(Object.freeze({
            kind: 'property',
            key: Object.freeze({ kind: 'literal', value: property.name.text }),
            value: Object.freeze({ kind: 'local', id: local.id, name: local.name, valueKind: local.valueKind })
          }));
          continue;
        }
        if (ts.isPropertyAssignment(property)) {
          const computed = ts.isComputedPropertyName(property.name);
          const key = computed
            ? Object.freeze({ kind: 'computed', value: this.expression(property.name.expression, scope) })
            : Object.freeze({ kind: 'literal', value: propertyName(this.sourceFile, property.name) });
          entries.push(Object.freeze({ kind: 'property', key, value: this.expression(property.initializer, scope) }));
          continue;
        }
        this.fail(property, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'Object methods and accessors are outside the canonical native value model.', { syntax: ts.SyntaxKind[property.kind] });
      }
      return Object.freeze({ kind: 'object', entries: Object.freeze(entries), valueKind: 'object' });
    }

    if (ts.isTemplateExpression(current)) {
      const parts = [Object.freeze({ kind: 'text', value: current.head.text })];
      for (const span of current.templateSpans) {
        parts.push(Object.freeze({ kind: 'value', value: this.expression(span.expression, scope) }));
        parts.push(Object.freeze({ kind: 'text', value: span.literal.text }));
      }
      return Object.freeze({ kind: 'template', parts: Object.freeze(parts), valueKind: 'string' });
    }

    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.getText(this.sourceFile);
      if (ASSIGNMENT_OPERATORS.has(operator)) {
        const target = this.expression(current.left, scope);
        const value = this.expression(current.right, scope);
        return Object.freeze({ kind: 'assignment', operator, target, value, valueKind: value.valueKind || 'unknown' });
      }
      if (!PURE_BINARY_OPERATORS.has(operator)) {
        this.fail(current.operatorToken, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Binary operator ${operator} is outside the canonical native value model.`, { operator });
      }
      const left = this.expression(current.left, scope);
      const right = this.expression(current.right, scope);
      return Object.freeze({ kind: 'binary', operator, left, right, valueKind: inferBinaryValueKind(operator, left, right) });
    }

    if (ts.isPrefixUnaryExpression(current)) {
      const operator = ts.tokenToString(current.operator) || current.getText(this.sourceFile).slice(0, 1);
      if (UPDATE_OPERATORS.has(operator)) {
        return Object.freeze({ kind: 'update', operator, prefix: true, target: this.expression(current.operand, scope), valueKind: 'number' });
      }
      if (!PREFIX_OPERATORS.has(operator)) {
        this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Prefix operator ${operator} is outside the canonical native value model.`, { operator });
      }
      const value = this.expression(current.operand, scope);
      return Object.freeze({ kind: 'unary', operator, value, valueKind: operator === '!' ? 'boolean' : (operator === 'typeof' ? 'string' : value.valueKind || 'unknown') });
    }

    if (ts.isPostfixUnaryExpression(current)) {
      const operator = ts.tokenToString(current.operator) || current.getText(this.sourceFile).slice(-2);
      if (!UPDATE_OPERATORS.has(operator)) this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Postfix operator ${operator} is outside the canonical native value model.`, { operator });
      return Object.freeze({ kind: 'update', operator, prefix: false, target: this.expression(current.operand, scope), valueKind: 'number' });
    }

    if (ts.isConditionalExpression(current)) {
      const whenTrue = this.expression(current.whenTrue, scope);
      const whenFalse = this.expression(current.whenFalse, scope);
      return Object.freeze({
        kind: 'conditional',
        test: this.expression(current.condition, scope),
        whenTrue,
        whenFalse,
        valueKind: whenTrue.valueKind === whenFalse.valueKind ? whenTrue.valueKind : 'unknown'
      });
    }

    if (ts.isPropertyAccessExpression(current)) {
      if (current.questionDotToken) {
        this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'Optional property access is outside the canonical native value model.');
      }
      const ctxPath = contextPath(current, this.ctxName);
      const eventPayloadMember = ctxPath
        && ctxPath.length > 2
        && ctxPath[0] === 'event'
        && ctxPath[1] === 'payload';
      if (ctxPath && !eventPayloadMember) {
        const key = ctxPath.join('.');
        if (!contract.CANONICAL_NATIVE_CONTEXT_READS.includes(key)) {
          this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Context read ctx.${key} is not part of the canonical native context contract.`, { path: ctxPath });
        }
        return Object.freeze({ kind: 'context-read', path: Object.freeze(ctxPath), valueKind: contextValueKind(ctxPath) });
      }
      const object = this.expression(current.expression, scope);
      let valueKind = 'unknown';
      if (object.valueKind === 'fetch-response') {
        if (current.name.text === 'status') valueKind = 'number';
        else if (current.name.text === 'ok') valueKind = 'boolean';
        else if (current.name.text === 'headers') valueKind = 'headers';
        else this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Fetch response property .${current.name.text} is outside the canonical native response contract.`, { property: current.name.text });
      }
      return Object.freeze({ kind: 'property', object, property: current.name.text, valueKind });
    }

    if (ts.isElementAccessExpression(current)) {
      if (current.questionDotToken) this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'Optional element access is outside the canonical native value model.');
      return Object.freeze({
        kind: 'element',
        object: this.expression(current.expression, scope),
        index: this.expression(current.argumentExpression, scope),
        valueKind: 'unknown'
      });
    }

    if (ts.isTypeOfExpression(current)) {
      return Object.freeze({ kind: 'unary', operator: 'typeof', value: this.expression(current.expression, scope), valueKind: 'string' });
    }

    if (ts.isVoidExpression(current)) {
      return Object.freeze({ kind: 'unary', operator: 'void', value: this.expression(current.expression, scope), valueKind: 'undefined' });
    }

    if (ts.isCallExpression(current)) return this.callExpression(current, scope);

    if (ts.isSpreadElement(current)) return Object.freeze({ kind: 'spread', value: this.expression(current.expression, scope), valueKind: 'unknown' });

    if (ts.isYieldExpression(current)) {
      this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'A generated yield must be consumed as an explicit native effect statement.');
      return Object.freeze({ kind: 'undefined', valueKind: 'undefined' });
    }

    this.fail(current, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Generated expression ${ts.SyntaxKind[current.kind]} is outside the canonical native value model.`, { syntax: ts.SyntaxKind[current.kind] });
    return Object.freeze({ kind: 'undefined', valueKind: 'undefined' });
  }

  callExpression(call, scope) {
    if (call.questionDotToken) this.fail(call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'Optional calls are outside the canonical native value model.');
    const target = unwrap(call.expression);
    const ctxPath = contextPath(target, this.ctxName);
    if (ctxPath) {
      const intrinsic = intrinsicForContextCall(ctxPath);
      if (!intrinsic) {
        this.fail(call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Context call ctx.${ctxPath.join('.')} is not part of the canonical native intrinsic set.`, { path: ctxPath });
        return Object.freeze({ kind: 'intrinsic', name: `unsupported:${ctxPath.join('.')}`, arguments: Object.freeze([]), valueKind: 'unknown' });
      }
      const argumentsArray = call.arguments.map((argument) => this.expression(argument, scope));
      if (['state.get', 'state.set'].includes(intrinsic[0])) {
        const expected = intrinsic[0] === 'state.get' ? 1 : 2;
        if (call.arguments.length !== expected) {
          this.fail(call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `${intrinsic[0]} requires exactly ${expected} argument(s).`, { intrinsic: intrinsic[0], argumentCount: call.arguments.length });
        }
        if (argumentsArray[0] && argumentsArray[0].valueKind !== 'string') {
          this.fail(call.arguments[0] || call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `${intrinsic[0]} requires a string key.`, { intrinsic: intrinsic[0], argument: 'key', valueKind: argumentsArray[0].valueKind });
        }
        if (intrinsic[0] === 'state.set' && argumentsArray[1] && argumentsArray[1].valueKind !== 'string') {
          this.fail(call.arguments[1] || call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'state.set requires a string value.', { intrinsic: intrinsic[0], argument: 'value', valueKind: argumentsArray[1].valueKind });
        }
      }
      return Object.freeze({
        kind: 'intrinsic',
        name: intrinsic[0],
        arguments: Object.freeze(argumentsArray),
        valueKind: intrinsic[1]
      });
    }

    if (ts.isIdentifier(target) && this.compilerOwnedCalls.has(target.text) && this.compilerOwnedIntrinsics.has(target.text)) {
      const intrinsic = this.compilerOwnedIntrinsics.get(target.text);
      return Object.freeze({
        kind: 'intrinsic',
        name: intrinsic[0],
        arguments: Object.freeze(call.arguments.map((argument) => this.expression(argument, scope))),
        valueKind: intrinsic[1]
      });
    }

    if (ts.isPropertyAccessExpression(target)) {
      const receiver = this.expression(target.expression, scope);
      const method = target.name.text;
      if (!FETCH_RESPONSE_METHODS.has(method) || receiver.valueKind !== 'fetch-response') {
        this.fail(call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, `Method call .${method}() is outside the canonical native fetch-response contract.`, { method, receiverKind: receiver.valueKind });
      }
      let valueKind = 'unknown';
      if (method === 'json') valueKind = 'json';
      else if (method === 'text') valueKind = 'string';
      else if (method === 'header') valueKind = 'string-or-undefined';
      return Object.freeze({
        kind: 'method-call',
        receiver,
        method,
        arguments: Object.freeze(call.arguments.map((argument) => this.expression(argument, scope))),
        valueKind
      });
    }

    this.fail(call, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EXPRESSION_UNSUPPORTED, 'Direct function calls are outside the canonical native value model.', { callee: target.getText(this.sourceFile) });
    return Object.freeze({ kind: 'intrinsic', name: 'unsupported:call', arguments: Object.freeze([]), valueKind: 'unknown' });
  }

  allocateLocal(name, valueKind, statementPath, declaration) {
    this.localIndex += 1;
    const local = Object.freeze({
      id: `local-${this.localIndex}`,
      name: String(name),
      valueKind: contract.CANONICAL_NATIVE_VALUE_KINDS.includes(valueKind) ? valueKind : 'unknown',
      declaration,
      statementPath
    });
    this.locals.push(local);
    this.summary.localCount += 1;
    return local;
  }

  pulseYield(expression) {
    let current = unwrap(expression);
    let decoder;
    if (current && ts.isCallExpression(current) && ts.isPropertyAccessExpression(unwrap(current.expression))) {
      const target = unwrap(current.expression);
      const receiver = unwrap(target.expression);
      if (receiver && ts.isYieldExpression(receiver) && ['json', 'text'].includes(target.name.text)) {
        decoder = Object.freeze({
          kind: target.name.text,
          arguments: Object.freeze(current.arguments.map((argument) => argument))
        });
        current = receiver;
      }
    }
    if (!current || !ts.isYieldExpression(current) || !current.expression) return undefined;
    const call = unwrap(current.expression);
    if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(unwrap(call.expression))) return undefined;
    const target = unwrap(call.expression);
    if (!ts.isIdentifier(unwrap(target.expression)) || unwrap(target.expression).text !== PULSE_RUNTIME_PARAMETER) return undefined;
    if (!['effect', 'group'].includes(target.name.text)) return undefined;
    return Object.freeze({ mode: target.name.text, call, decoder });
  }

  markerFields(marker) {
    if (!marker || !ts.isObjectLiteralExpression(unwrap(marker))) {
      this.fail(marker || this.handler, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Canonical native effects require an object-literal marker.');
      return new Map();
    }
    const fields = new Map();
    for (const property of unwrap(marker).properties) {
      if (!ts.isPropertyAssignment(property)) {
        this.fail(property, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Canonical native effect markers may contain only static property assignments.');
        continue;
      }
      const name = propertyName(this.sourceFile, property.name);
      if (!name || fields.has(name)) {
        this.fail(property, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Canonical native effect marker fields must have unique static names.', { name });
        continue;
      }
      fields.set(name, property.initializer);
    }
    return fields;
  }

  prepareEffect(marker, continuationId, scope, statementPath, result, groupIndex) {
    const fields = this.markerFields(marker);
    const effectId = literalString(fields.get('id'));
    const kind = literalString(fields.get('kind'));
    const site = effectId ? this.effectSites.get(effectId) : undefined;
    const continuation = this.continuationSites.get(continuationId);
    if (!effectId || !kind || !site) {
      this.fail(marker, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Generated effect marker must identify a known canonical effect site.', { effectId, kind, continuationId });
    } else if (String(site.kind) !== kind) {
      this.fail(marker, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_MISMATCH, `Generated effect ${effectId} kind ${kind} does not match canonical metadata ${site.kind}.`, { effectId, generatedKind: kind, metadataKind: site.kind });
    }
    if (!continuation || (effectId && !continuation.effectIds.includes(effectId))) {
      this.fail(marker, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.CONTINUATION_MISMATCH, `Effect ${effectId || '<unknown>'} does not belong to continuation ${continuationId}.`, { effectId, continuationId });
    }

    const inputs = [];
    for (const [name, value] of fields) {
      if (EFFECT_STATIC_FIELDS.has(name)) continue;
      inputs.push(Object.freeze({ name, value: this.expression(value, scope) }));
    }
    this.effectOrder += 1;
    const record = Object.freeze({
      order: this.effectOrder,
      id: effectId || `invalid-effect-${this.effectOrder}`,
      kind: kind || 'invalid',
      providerKind: site && site.providerKind ? String(site.providerKind) : undefined,
      operation: site && site.operation ? String(site.operation) : undefined,
      capability: site && site.capability ? String(site.capability) : undefined,
      grouped: Boolean(site && site.grouped),
      groupIndex: Number.isInteger(groupIndex) ? groupIndex : undefined,
      resource: cloneJson(site && site.resource),
      package: site && site.package ? String(site.package) : undefined,
      contractId: site && site.contractId ? String(site.contractId) : undefined,
      declaredResult: site && site.result ? String(site.result) : undefined,
      decoder: site && site.decoder ? String(site.decoder) : null,
      continuationId,
      statementPath,
      source: Object.freeze({ file: this.metadata.file, ...(cloneJson(site && site.position) || {}) }),
      routeStableId: site && site.routeStableId ? String(site.routeStableId) : undefined,
      routeRuntimeId: site && Number.isInteger(site.routeRuntimeId) ? site.routeRuntimeId : undefined,
      routeMethod: site && site.routeMethod ? String(site.routeMethod) : undefined,
      routePath: site && site.routePath ? String(site.routePath) : undefined,
      routerEntryStableId: site && site.routerEntryStableId ? String(site.routerEntryStableId) : undefined,
      routerEntryKind: site && site.routerEntryKind ? String(site.routerEntryKind) : undefined,
      routerEntryIndex: site && Number.isInteger(site.routerEntryIndex) ? site.routerEntryIndex : undefined,
      routerEntryPath: site && site.routerEntryPath ? String(site.routerEntryPath) : undefined,
      applicationEntryStableId: site && site.applicationEntryStableId ? String(site.applicationEntryStableId) : undefined,
      applicationEntryKind: site && site.applicationEntryKind ? String(site.applicationEntryKind) : undefined,
      applicationEntryPlane: site && site.applicationEntryPlane ? String(site.applicationEntryPlane) : undefined,
      applicationEntryIndex: site && Number.isInteger(site.applicationEntryIndex) ? site.applicationEntryIndex : undefined,
      eventStableId: site && site.eventStableId ? String(site.eventStableId) : undefined,
      eventRuntimeId: site && Number.isInteger(site.eventRuntimeId) ? site.eventRuntimeId : undefined,
      eventType: site && site.eventType ? String(site.eventType) : undefined,
      eventSchemaId: site && site.eventSchemaId !== undefined ? site.eventSchemaId : undefined,
      inputs: Object.freeze(inputs),
      result
    });
    this.effects.push(record);
    this.summary.effectCount += 1;
    this.effectOccurrences.set(record.id, (this.effectOccurrences.get(record.id) || 0) + 1);
    this.continuationOccurrences.set(continuationId, statementPath);
    return record;
  }

  decoderPlan(decoder, scope) {
    if (!decoder) return undefined;
    return Object.freeze({
      kind: decoder.kind,
      arguments: Object.freeze(decoder.arguments.map((argument) => this.expression(argument, scope)))
    });
  }

  lowerVariableStatement(statement, scope, pathParts, depth) {
    const out = [];
    const declaration = declarationKind(statement);
    for (let index = 0; index < statement.declarationList.declarations.length; index += 1) {
      const item = statement.declarationList.declarations[index];
      const itemPath = formatStatementPath(statement.declarationList.declarations.length === 1 ? pathParts : [...pathParts, 'declaration', index]);
      const yielded = item.initializer ? this.pulseYield(item.initializer) : undefined;

      if (yielded && yielded.mode === 'group') {
        if (!ts.isArrayBindingPattern(item.name) || statement.declarationList.declarations.length !== 1) {
          this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'Grouped canonical effects require one array binding declaration.');
          continue;
        }
        const markersNode = yielded.call.arguments[0];
        const continuationId = literalString(yielded.call.arguments[1]);
        if (!markersNode || !ts.isArrayLiteralExpression(unwrap(markersNode)) || !continuationId) {
          this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Grouped canonical effects require an effect-marker array and literal continuation ID.');
          continue;
        }
        const markers = unwrap(markersNode).elements;
        const bindings = item.name.elements;
        if (markers.length !== bindings.length) {
          this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_MISMATCH, 'Grouped effect marker and binding counts differ.', { markers: markers.length, bindings: bindings.length });
        }
        const results = [];
        const prepared = [];
        for (let groupIndex = 0; groupIndex < markers.length; groupIndex += 1) {
          const binding = bindings[groupIndex];
          if (!binding || ts.isOmittedExpression(binding) || !ts.isIdentifier(binding.name)) {
            this.fail(binding || item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'Grouped effect results require simple local bindings.', { groupIndex });
            continue;
          }
          const markerFields = this.markerFields(markers[groupIndex]);
          const effectId = literalString(markerFields.get('id'));
          const site = effectId ? this.effectSites.get(effectId) : undefined;
          const local = this.allocateLocal(binding.name.text, resultKindForEffect(site || {}, undefined), itemPath, declaration);
          scope.set(local.name, local);
          const result = Object.freeze({ mode: 'bind', localId: local.id, localName: local.name, valueKind: local.valueKind });
          prepared.push(this.prepareEffect(markers[groupIndex], continuationId, scope, itemPath, result, groupIndex));
          results.push(Object.freeze({ effectId: effectId || `invalid-effect-${groupIndex + 1}`, localId: local.id, localName: local.name, valueKind: local.valueKind }));
        }
        this.summary.effectGroupCount += 1;
        out.push(Object.freeze({
          kind: 'effect-group',
          continuationId,
          effectIds: Object.freeze(prepared.map((effect) => effect.id)),
          results: Object.freeze(results),
          statementPath: itemPath
        }));
        continue;
      }

      if (yielded && yielded.mode === 'effect') {
        if (!ts.isIdentifier(item.name)) {
          this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'Canonical effect results require a simple local binding.');
          continue;
        }
        const continuationId = literalString(yielded.call.arguments[1]);
        const marker = yielded.call.arguments[0];
        if (!continuationId || !marker) {
          this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Canonical effect requires a marker and literal continuation ID.');
          continue;
        }
        const fields = this.markerFields(marker);
        const effectId = literalString(fields.get('id'));
        const site = effectId ? this.effectSites.get(effectId) : undefined;
        const decoder = this.decoderPlan(yielded.decoder, scope);
        const local = this.allocateLocal(item.name.text, resultKindForEffect(site || {}, decoder), itemPath, declaration);
        const result = Object.freeze({ mode: 'bind', localId: local.id, localName: local.name, valueKind: local.valueKind, decoder });
        const effect = this.prepareEffect(marker, continuationId, scope, itemPath, result);
        scope.set(local.name, local);
        out.push(Object.freeze({ kind: 'effect', effectId: effect.id, continuationId, result, statementPath: itemPath }));
        continue;
      }

      if (!ts.isIdentifier(item.name)) {
        this.fail(item, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.BINDING_UNSUPPORTED, 'Canonical native locals require simple identifier bindings outside compiler-owned effect groups.', { binding: item.name.getText(this.sourceFile) });
        continue;
      }
      const value = item.initializer ? this.expression(item.initializer, scope) : Object.freeze({ kind: 'undefined', valueKind: 'undefined' });
      const local = this.allocateLocal(item.name.text, value.valueKind || 'unknown', itemPath, declaration);
      scope.set(local.name, local);
      out.push(Object.freeze({ kind: 'local', localId: local.id, name: local.name, declaration, valueKind: local.valueKind, value, statementPath: itemPath }));
    }
    return out;
  }

  lowerEffectStatement(expression, scope, statementPath, resultMode) {
    const yielded = this.pulseYield(expression);
    if (!yielded || yielded.mode !== 'effect') return undefined;
    const continuationId = literalString(yielded.call.arguments[1]);
    const marker = yielded.call.arguments[0];
    if (!continuationId || !marker) {
      this.fail(expression, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_INVALID, 'Canonical effect requires a marker and literal continuation ID.');
      return undefined;
    }
    const fields = this.markerFields(marker);
    const effectId = literalString(fields.get('id'));
    const site = effectId ? this.effectSites.get(effectId) : undefined;
    const continuation = this.continuationSites.get(continuationId);
    const result = Object.freeze({
      mode: resultMode,
      valueKind: resultKindForEffect(site || {}, undefined, continuation, resultMode)
    });
    const effect = this.prepareEffect(marker, continuationId, scope, statementPath, result);
    return Object.freeze({ kind: 'effect', effectId: effect.id, continuationId, result, statementPath });
  }

  lowerLogStatement(expression, scope, statementPath) {
    const current = unwrap(expression);
    if (!current || !ts.isCallExpression(current)) return undefined;
    const parts = contextPath(current.expression, this.ctxName);
    if (!parts || parts.length !== 2 || parts[0] !== 'log') return undefined;
    const name = parts[1];
    const level = loggingContract.LOG_METHOD_LEVELS[name];
    if (!level) return undefined;
    if (current.arguments.length !== 1) {
      this.fail(
        current,
        contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.LOG_INVALID,
        `ctx.log.${name} requires exactly one string message.`,
        { level: name, arguments: current.arguments.length }
      );
      return [];
    }
    if (!loggingContract.logStatementEnabled(level, this.reporting.level)) {
      this.prunedLogCount += 1;
      return [];
    }
    const message = this.expression(current.arguments[0], scope);
    if (message.valueKind !== 'string') {
      this.fail(
        current.arguments[0],
        contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.LOG_INVALID,
        `ctx.log.${name} requires a string message on the Native target.`,
        { level: name, valueKind: message.valueKind }
      );
      return [];
    }
    this.enabledLogCount += 1;
    return [Object.freeze({
      kind: 'expression',
      expression: Object.freeze({
        kind: 'intrinsic',
        name: 'logging.emit',
        arguments: Object.freeze([
          Object.freeze({ kind: 'literal', value: level, valueKind: 'number' }),
          message
        ]),
        valueKind: 'undefined'
      }),
      statementPath
    })];
  }

  statement(statement, scope, pathParts, depth) {
    const statementPath = formatStatementPath(pathParts);
    this.summary.maxStatementDepth = Math.max(this.summary.maxStatementDepth, depth);

    if (ts.isBlock(statement)) return this.statementList(statement.statements, new Map(scope), [...pathParts, 'body'], depth + 1);

    if (ts.isVariableStatement(statement)) return this.lowerVariableStatement(statement, scope, pathParts, depth);

    if (ts.isIfStatement(statement)) {
      this.summary.branchCount += 1;
      const thenScope = new Map(scope);
      const elseScope = new Map(scope);
      const thenBody = ts.isBlock(statement.thenStatement)
        ? this.statementList(statement.thenStatement.statements, thenScope, [...pathParts, 'then'], depth + 1)
        : this.statement(statement.thenStatement, thenScope, [...pathParts, 'then', 0], depth + 1);
      const elseBody = !statement.elseStatement
        ? []
        : ts.isBlock(statement.elseStatement)
          ? this.statementList(statement.elseStatement.statements, elseScope, [...pathParts, 'else'], depth + 1)
          : this.statement(statement.elseStatement, elseScope, [...pathParts, 'else', 0], depth + 1);
      return [Object.freeze({
        kind: 'if',
        test: this.expression(statement.expression, scope),
        then: Object.freeze(thenBody),
        else: Object.freeze(elseBody),
        statementPath
      })];
    }

    if (ts.isReturnStatement(statement)) {
      this.summary.returnCount += 1;
      if (!statement.expression) return [Object.freeze({ kind: 'return', value: Object.freeze({ kind: 'undefined', valueKind: 'undefined' }), statementPath })];
      const effect = this.lowerEffectStatement(statement.expression, scope, statementPath, 'return');
      if (effect) return [effect];
      return [Object.freeze({ kind: 'return', value: this.expression(statement.expression, scope), statementPath })];
    }

    if (ts.isExpressionStatement(statement)) {
      const log = this.lowerLogStatement(statement.expression, scope, statementPath);
      if (log) return log;
      const effect = this.lowerEffectStatement(statement.expression, scope, statementPath, 'discard');
      if (effect) return [effect];
      return [Object.freeze({ kind: 'expression', expression: this.expression(statement.expression, scope), statementPath })];
    }

    if (ts.isEmptyStatement(statement)) return [];

    this.fail(statement, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.STATEMENT_UNSUPPORTED, `Generated statement ${ts.SyntaxKind[statement.kind]} is outside the canonical native control-flow model.`, { syntax: ts.SyntaxKind[statement.kind] });
    return [];
  }

  statementList(statements, scope, pathParts, depth) {
    const out = [];
    for (let index = 0; index < statements.length; index += 1) {
      const lowered = this.statement(statements[index], scope, [...pathParts, index], depth);
      for (const item of lowered) {
        out.push(item);
        this.summary.statementCount += 1;
      }
    }
    return out;
  }

  reconcile() {
    const expectedEffectIds = (this.metadata.effectSites || []).map((site) => String(site.id));
    const actualEffectIds = this.effects.map((site) => site.id);
    if (JSON.stringify(actualEffectIds) !== JSON.stringify(expectedEffectIds)) {
      this.fail(this.handler || this.sourceFile, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_MISMATCH, 'Native-plan effect order does not match canonical compiler metadata.', { expectedEffectIds, actualEffectIds });
    }
    for (const effectId of expectedEffectIds) {
      if (this.effectOccurrences.get(effectId) !== 1) this.fail(this.handler || this.sourceFile, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.EFFECT_MISMATCH, `Canonical effect ${effectId} must appear exactly once in the native plan.`, { effectId, occurrences: this.effectOccurrences.get(effectId) || 0 });
    }
    for (const site of this.metadata.continuationSites || []) {
      if (!this.continuationOccurrences.has(String(site.id))) this.fail(this.handler || this.sourceFile, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.CONTINUATION_MISMATCH, `Canonical continuation ${site.id} is not represented in the native plan.`, { continuationId: site.id });
    }
  }

  build() {
    if (!this.handler || !this.handler.body) {
      throw new CanonicalNativePlanError(`Native-plan lowering failed for ${this.metadata.file}.`, this.diagnostics);
    }
    const body = this.statementList(this.handler.body.statements, new Map(), ['entry', 'body'], 0);
    this.reconcile();
    if (this.diagnostics.length > 0) throw new CanonicalNativePlanError(`Native-plan lowering failed for ${this.metadata.file}.`, this.diagnostics);

    const continuations = (this.metadata.continuationSites || []).map((site, index) => Object.freeze({
      id: String(site.id),
      kind: String(site.kind),
      effectIds: Object.freeze(site.effectIds.map(String)),
      stateIndex: index + 1,
      statementPath: this.continuationOccurrences.get(String(site.id)),
      source: Object.freeze({ file: this.metadata.file, ...(cloneJson(site.position) || {}) }),
      routeStableId: site.routeStableId ? String(site.routeStableId) : undefined,
      routeRuntimeId: Number.isInteger(site.routeRuntimeId) ? site.routeRuntimeId : undefined,
      routeMethod: site.routeMethod ? String(site.routeMethod) : undefined,
      routePath: site.routePath ? String(site.routePath) : undefined,
      routerEntryStableId: site.routerEntryStableId ? String(site.routerEntryStableId) : undefined,
      routerEntryKind: site.routerEntryKind ? String(site.routerEntryKind) : undefined,
      routerEntryIndex: Number.isInteger(site.routerEntryIndex) ? site.routerEntryIndex : undefined,
      routerEntryPath: site.routerEntryPath ? String(site.routerEntryPath) : undefined,
      applicationEntryStableId: site.applicationEntryStableId ? String(site.applicationEntryStableId) : undefined,
      applicationEntryKind: site.applicationEntryKind ? String(site.applicationEntryKind) : undefined,
      applicationEntryPlane: site.applicationEntryPlane ? String(site.applicationEntryPlane) : undefined,
      applicationEntryIndex: Number.isInteger(site.applicationEntryIndex) ? site.applicationEntryIndex : undefined,
      eventStableId: site.eventStableId ? String(site.eventStableId) : undefined,
      eventRuntimeId: Number.isInteger(site.eventRuntimeId) ? site.eventRuntimeId : undefined,
      eventType: site.eventType ? String(site.eventType) : undefined,
      eventSchemaId: site.eventSchemaId !== undefined ? site.eventSchemaId : undefined
    }));
    const states = [Object.freeze({ id: 'entry', kind: 'entry', stateIndex: 0 })]
      .concat(continuations.map((site) => Object.freeze({ id: site.id, kind: 'continuation', continuationKind: site.kind, effectIds: site.effectIds, stateIndex: site.stateIndex })));
    this.summary = summarizeNativePlan(body, this.locals, this.effects, continuations);
    const hasInboundEvents = Number(this.metadata.events && this.metadata.events.count || 0) > 0;

    const unsigned = {
      version: contract.CANONICAL_NATIVE_PLAN_VERSION,
      compilerVersion: CANONICAL_NATIVE_PLAN_COMPILER_VERSION,
      hashAlgorithm: contract.CANONICAL_NATIVE_PLAN_HASH_ALGORITHM,
      canonical: Object.freeze({
        programVersion: this.metadata.version,
        compilerVersion: this.metadata.compilerVersion,
        runtimeProtocolVersion: this.metadata.runtimeProtocolVersion
      }),
      source: Object.freeze({
        file: this.metadata.file,
        sourceHash: this.metadata.sourceHash,
        projectSourceHash: this.metadata.projectSourceHash
      }),
      ownership: Object.freeze({
        version: contract.CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION,
        providerNeutral: true,
        provider: null,
        providerSpecificUserland: false,
        providerSdkUserland: false,
        javascriptRuntime: false,
        promiseSemantics: false,
        asyncify: false
      }),
      logging: Object.freeze({
        contractVersion: loggingContract.LOGGING_CONTRACT_VERSION,
        reporting: this.reporting,
        enabledStatements: this.enabledLogCount,
        prunedStatements: this.prunedLogCount,
        abi: loggingContract.PULSE_LOG_ABI
      }),
      routing: this.metadata.router ? deepFreeze(cloneJson(this.metadata.router)) : undefined,
      ...(this.metadata.application ? { application: deepFreeze(cloneJson(this.metadata.application)) } : {}),
      ...(this.metadata.applicationEntries ? { applicationEntries: deepFreeze(cloneJson(this.metadata.applicationEntries)) } : {}),
      ...(hasInboundEvents ? { events: deepFreeze(cloneJson(this.metadata.events)) } : {}),
      ...(this.metadata.json ? { json: deepFreeze(cloneJson({
        ...this.metadata.json,
        parser: this.metadata.json.genericParserRequired ? 'host-generic-json' : 'schema-specialized',
        parserOwnership: this.metadata.json.genericParserRequired ? 'pulse-host-capability' : 'compiled-schema-codec',
        inclusion: this.metadata.json.genericParserRequired ? 'reachable-schema-less-call' : 'schema-bound-only',
        costClass: this.metadata.json.genericParserRequired ? 'dynamic-host' : 'specialized',
        limits: {
          maxBytes: Number(this.metadata.json.maxBytes || 65536),
          maxDepth: null,
          depthBounded: false
        }
      })) } : {}),
      ...((this.metadata.capabilities || []).some((capability) => String(capability).startsWith('state.')) ? {
        requestState: hasInboundEvents
          ? Object.freeze({ enabled: true, representation: 'guest-string-map', reset: 'invocation-start', persistence: 'invocation-only' })
          : Object.freeze({ enabled: true, representation: 'guest-string-map', reset: 'pulse-start', persistence: 'request-only' })
      } : {}),
      entry: Object.freeze({
        kind: hasInboundEvents ? 'application' : (this.metadata.router ? 'router' : 'handler'),
        name: String(this.metadata.handler || 'default'),
        contextParameter: this.ctxName,
        body: Object.freeze(body)
      }),
      locals: Object.freeze(this.locals),
      effects: Object.freeze(this.effects),
      continuations: Object.freeze(continuations),
      states: Object.freeze(states),
      capabilities: Object.freeze([...(this.metadata.capabilities || [])].map(String).sort()),
      schemas: Object.freeze({
        sourceHash: this.metadata.schemaSourceHash,
        ids: Object.freeze([...(this.metadata.schemaIds || [])].map(String)),
        responseCaseIds: Object.freeze([...(this.metadata.responseCaseIds || [])].map(String)),
        registryHash: this.metadata.schemaRegistryHash,
        codecTableHash: this.metadata.schemaCodecTableHash,
        fullCodecRealization: this.metadata.schemaFullCodecRealization === true,
        registry: deepFreeze(cloneJson(this.metadata.schemaRegistry || {})),
        references: deepFreeze(cloneJson(this.metadata.schemaReferences || []))
      }),
      ...(this.compiled.cryptoRealizationPlan && this.compiled.cryptoRealizationPlan.target === 'native' ? {
        crypto: deepFreeze(cloneJson(this.compiled.cryptoRealizationPlan))
      } : {}),
      packages: Object.freeze({ effects: deepFreeze(cloneJson(this.metadata.packageEffects || [])) }),
      summary: Object.freeze({ ...this.summary })
    };
    const planHash = stableHash(stableStringify(unsigned));
    const plan = deepFreeze({ ...unsigned, planHash });
    assertCanonicalNativePlan(plan);
    return plan;
  }
}

function walkExpression(expression, visit) {
  if (!expression || typeof expression !== 'object') return;
  visit(expression);
  switch (expression.kind) {
    case 'array':
      for (const item of expression.items || []) walkExpression(item, visit);
      break;
    case 'object':
      for (const entry of expression.entries || []) {
        if (entry.kind === 'spread') walkExpression(entry.value, visit);
        else {
          if (entry.key && entry.key.kind === 'computed') walkExpression(entry.key.value, visit);
          walkExpression(entry.value, visit);
        }
      }
      break;
    case 'template':
      for (const part of expression.parts || []) if (part.kind === 'value') walkExpression(part.value, visit);
      break;
    case 'binary':
      walkExpression(expression.left, visit);
      walkExpression(expression.right, visit);
      break;
    case 'unary':
      walkExpression(expression.value, visit);
      break;
    case 'conditional':
      walkExpression(expression.test, visit);
      walkExpression(expression.whenTrue, visit);
      walkExpression(expression.whenFalse, visit);
      break;
    case 'property':
      walkExpression(expression.object, visit);
      break;
    case 'element':
      walkExpression(expression.object, visit);
      walkExpression(expression.index, visit);
      break;
    case 'intrinsic':
      for (const argument of expression.arguments || []) walkExpression(argument, visit);
      break;
    case 'method-call':
      walkExpression(expression.receiver, visit);
      for (const argument of expression.arguments || []) walkExpression(argument, visit);
      break;
    case 'assignment':
      walkExpression(expression.target, visit);
      walkExpression(expression.value, visit);
      break;
    case 'update':
      walkExpression(expression.target, visit);
      break;
    case 'spread':
      walkExpression(expression.value, visit);
      break;
    default:
      break;
  }
}

function walkStatements(statements, visitor) {
  for (const statement of statements || []) {
    visitor(statement);
    if (statement.kind === 'local') walkExpression(statement.value, visitor.expression);
    else if (statement.kind === 'if') {
      walkExpression(statement.test, visitor.expression);
      walkStatements(statement.then, visitor);
      walkStatements(statement.else, visitor);
    } else if (statement.kind === 'return') walkExpression(statement.value, visitor.expression);
    else if (statement.kind === 'expression') walkExpression(statement.expression, visitor.expression);
  }
}

function countExpression(expression) {
  let count = 0;
  walkExpression(expression, () => { count += 1; });
  return count;
}

function summarizeNativePlan(body, locals, effects, continuations) {
  const summary = {
    statementCount: 0,
    expressionCount: 0,
    localCount: locals.length,
    branchCount: 0,
    returnCount: 0,
    effectCount: effects.length,
    effectGroupCount: 0,
    continuationCount: continuations.length,
    maxStatementDepth: 0
  };

  function visitStatements(statements, depth) {
    for (const statement of statements || []) {
      summary.statementCount += 1;
      summary.maxStatementDepth = Math.max(summary.maxStatementDepth, depth);
      if (statement.kind === 'local') summary.expressionCount += countExpression(statement.value);
      else if (statement.kind === 'if') {
        summary.branchCount += 1;
        summary.expressionCount += countExpression(statement.test);
        visitStatements(statement.then, depth + 1);
        visitStatements(statement.else, depth + 1);
      } else if (statement.kind === 'return') {
        summary.returnCount += 1;
        summary.expressionCount += countExpression(statement.value);
      } else if (statement.kind === 'expression') {
        summary.expressionCount += countExpression(statement.expression);
      } else if (statement.kind === 'effect') {
        if (statement.result && statement.result.mode === 'return') summary.returnCount += 1;
      } else if (statement.kind === 'effect-group') {
        summary.effectGroupCount += 1;
      }
    }
  }

  visitStatements(body, 0);
  for (const effect of effects) {
    for (const input of effect.inputs || []) summary.expressionCount += countExpression(input.value);
    const decoder = effect.result && effect.result.decoder;
    for (const argument of (decoder && decoder.arguments) || []) summary.expressionCount += countExpression(argument);
  }
  return summary;
}

// Normalize the callable shape expected by walkStatements without exposing mutable visitor state.
function validateExpression(expression, fail, localIds, detail = {}) {
  walkExpression(expression, (node) => {
    if (!contract.CANONICAL_NATIVE_EXPRESSION_KINDS.includes(node.kind)) fail('expression kind is unknown', { ...detail, kind: node.kind });
    if (node.kind === 'local' && !localIds.has(node.id)) fail('expression references unknown local', { ...detail, localId: node.id });
    if (node.kind === 'intrinsic' && !contract.CANONICAL_NATIVE_INTRINSICS.includes(node.name)) fail('intrinsic is unknown', { ...detail, intrinsic: node.name });
  });
}

function validateResult(result, fail, localIds, detail = {}) {
  if (!result || !contract.CANONICAL_NATIVE_RESULT_MODES.includes(result.mode)) {
    fail('effect result mode is unknown', { ...detail, mode: result && result.mode });
    return;
  }
  if (result.localId && !localIds.has(result.localId)) fail('effect result references unknown local', { ...detail, localId: result.localId });
  if (result.decoder) {
    if (!['json', 'text'].includes(result.decoder.kind)) fail('effect result decoder is unknown', { ...detail, decoder: result.decoder.kind });
    for (const argument of result.decoder.arguments || []) validateExpression(argument, fail, localIds, detail);
  }
}

function validatePlanTree(plan, fail, localIds, effectIds, continuationIds) {
  const visitor = (statement) => {
    if (!contract.CANONICAL_NATIVE_STATEMENT_KINDS.includes(statement.kind)) fail('statement kind is unknown', { kind: statement.kind });
    if (statement.kind === 'local' && !localIds.has(statement.localId)) fail('local statement references unknown local', { localId: statement.localId });
    if (statement.kind === 'effect') {
      if (!effectIds.has(statement.effectId)) fail('effect statement references unknown effect', { effectId: statement.effectId });
      if (!continuationIds.has(statement.continuationId)) fail('effect statement references unknown continuation', { continuationId: statement.continuationId });
      validateResult(statement.result, fail, localIds, { effectId: statement.effectId });
    }
    if (statement.kind === 'effect-group') {
      if (!continuationIds.has(statement.continuationId)) fail('effect group references unknown continuation', { continuationId: statement.continuationId });
      for (const effectId of statement.effectIds || []) if (!effectIds.has(effectId)) fail('effect group references unknown effect', { effectId });
      for (const result of statement.results || []) if (!localIds.has(result.localId)) fail('effect group result references unknown local', { localId: result.localId });
    }
  };
  visitor.expression = (expression) => validateExpression(expression, fail, localIds);
  walkStatements(plan.entry && plan.entry.body, visitor);
}

function assertCanonicalNativePlan(plan) {
  const errors = [];
  const fail = (message, detail = {}) => errors.push(Object.freeze({ message, detail: Object.freeze({ ...detail }) }));
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('plan must be an object');
  else {
    if (plan.version !== contract.CANONICAL_NATIVE_PLAN_VERSION) fail('plan version mismatch', { actual: plan.version });
    if (plan.compilerVersion !== CANONICAL_NATIVE_PLAN_COMPILER_VERSION) fail('plan compiler version mismatch', { actual: plan.compilerVersion });
    if (plan.hashAlgorithm !== contract.CANONICAL_NATIVE_PLAN_HASH_ALGORITHM) fail('plan hash algorithm mismatch', { actual: plan.hashAlgorithm });
    if (!plan.ownership || plan.ownership.providerNeutral !== true || plan.ownership.provider !== null) fail('plan must remain provider-neutral');
    if (plan.ownership && (plan.ownership.javascriptRuntime || plan.ownership.promiseSemantics || plan.ownership.asyncify)) fail('plan must not claim JavaScript runtime, Promise, or Asyncify semantics');
    if (!plan.entry || !['handler', 'router', 'application'].includes(plan.entry.kind) || !Array.isArray(plan.entry.body)) fail('plan must contain a handler, router, or application entry body');
    if (plan.events !== undefined) {
      if (
        !plan.events
        || !plan.events.abi
        || plan.events.abi.version !== eventContract.EVENT_NATIVE_ABI_EXTENSION_VERSION
        || plan.events.abi.abiVersion !== eventContract.EVENT_NATIVE_ABI_EXTENSION.abiVersion
        || !plan.events.catalog
      ) {
        fail('plan event ABI metadata is invalid', { events: plan.events });
      } else {
        try {
          const normalizedCatalog = eventContract.normalizeEventCatalog({
            version: plan.events.catalog.version,
            contractId: plan.events.catalog.contractId,
            events: plan.events.catalog.events
          });
          if (stableStringify(normalizedCatalog) !== stableStringify(plan.events.catalog)) {
            fail('plan event catalog is not canonical', { catalogHash: plan.events.catalog.catalogHash });
          }
        } catch (error) {
          fail('plan event catalog is invalid', { code: error && error.code, message: error && error.message });
        }
      }
      if (plan.entry && plan.entry.kind !== 'application') fail('event-reachable plans require an application entry body');
      if (!Array.isArray(plan.applicationEntries) || !plan.applicationEntries.some((entry) => entry && entry.plane === 'event')) {
        fail('event-reachable plans require plane-neutral application entry metadata');
      }
    }
    if (!Array.isArray(plan.locals)) fail('plan locals must be an array');
    if (!Array.isArray(plan.effects)) fail('plan effects must be an array');
    if (!Array.isArray(plan.continuations)) fail('plan continuations must be an array');
    if (!Array.isArray(plan.states)) fail('plan states must be an array');
    if (plan.crypto !== undefined) {
      if (
        !plan.crypto
        || typeof plan.crypto !== 'object'
        || plan.crypto.version !== cryptoContract.CRYPTO_REALIZATION_PLAN_VERSION
        || plan.crypto.target !== 'native'
        || plan.crypto.automaticFallback !== false
        || !Array.isArray(plan.crypto.algorithms)
      ) {
        fail('plan crypto realization evidence is invalid', { crypto: plan.crypto });
      } else {
        const knownRealizations = new Map(
          cryptoContract.CRYPTO_REALIZATIONS.map((entry) => [`${entry.id}:${entry.algorithm}`, entry])
        );
        for (const entry of plan.crypto.algorithms) {
          const known = entry && knownRealizations.get(`${entry.realization}:${entry.algorithm}`);
          if (
            !known
            || known.algorithm !== entry.algorithm
            || known.kind !== entry.kind
            || known.implementation !== entry.implementation
            || !known.targets.includes('native')
            || entry.automaticFallback !== false
          ) {
            fail('plan crypto algorithm realization is invalid', {
              algorithm: entry && entry.algorithm,
              realization: entry && entry.realization,
              kind: entry && entry.kind,
              implementation: entry && entry.implementation
            });
          }
        }
        const unsignedCrypto = { ...plan.crypto };
        delete unsignedCrypto.planHash;
        const expectedCryptoHash = stableHash(stableStringify(unsignedCrypto));
        if (plan.crypto.planHash !== expectedCryptoHash) {
          fail('plan crypto realization hash mismatch', {
            expectedHash: expectedCryptoHash,
            actualHash: plan.crypto.planHash
          });
        }
      }
    }
    if (
      !plan.logging
      || plan.logging.contractVersion !== loggingContract.LOGGING_CONTRACT_VERSION
      || !plan.logging.reporting
      || plan.logging.reporting.version !== loggingContract.LOGGING_CONTRACT_VERSION
      || !Number.isInteger(plan.logging.enabledStatements)
      || !Number.isInteger(plan.logging.prunedStatements)
      || !plan.logging.abi
      || plan.logging.abi.signature !== loggingContract.PULSE_LOG_ABI.signature
    ) {
      fail('plan logging evidence is invalid', { logging: plan.logging });
    }

    const unsigned = { ...plan };
    delete unsigned.planHash;
    const expectedHash = stableHash(stableStringify(unsigned));
    if (plan.planHash !== expectedHash) fail('plan hash mismatch', { expectedHash, actual: plan.planHash });

    const locals = Array.isArray(plan.locals) ? plan.locals : [];
    const effects = Array.isArray(plan.effects) ? plan.effects : [];
    const continuations = Array.isArray(plan.continuations) ? plan.continuations : [];
    const localIds = new Set();
    for (const local of locals) {
      if (!local || typeof local !== 'object' || localIds.has(local.id)) fail('local IDs must be unique', { localId: local && local.id });
      else localIds.add(local.id);
      if (local && !contract.CANONICAL_NATIVE_VALUE_KINDS.includes(local.valueKind)) fail('local value kind is unknown', { localId: local.id, valueKind: local.valueKind });
    }

    const effectIds = new Set();
    let previousOrder = 0;
    for (const effect of effects) {
      if (!effect || typeof effect !== 'object' || effectIds.has(effect.id)) fail('effect IDs must be unique', { effectId: effect && effect.id });
      else effectIds.add(effect.id);
      if (effect && effect.order !== previousOrder + 1) fail('effect order must be contiguous and deterministic', { effectId: effect.id, expected: previousOrder + 1, actual: effect.order });
      if (effect && Number.isInteger(effect.order)) previousOrder = effect.order;
      const inputNames = new Set();
      for (const input of (effect && effect.inputs) || []) {
        if (!input || typeof input.name !== 'string' || inputNames.has(input.name)) fail('effect input names must be unique strings', { effectId: effect && effect.id, input: input && input.name });
        else inputNames.add(input.name);
        validateExpression(input && input.value, fail, localIds, { effectId: effect && effect.id, input: input && input.name });
      }
      if (effect) validateResult(effect.result, fail, localIds, { effectId: effect.id });
    }

    const continuationIds = new Set();
    for (const continuation of continuations) {
      if (!continuation || typeof continuation !== 'object' || continuationIds.has(continuation.id)) fail('continuation IDs must be unique', { continuationId: continuation && continuation.id });
      else continuationIds.add(continuation.id);
      for (const effectId of (continuation && continuation.effectIds) || []) if (!effectIds.has(effectId)) fail('continuation references unknown effect', { continuationId: continuation && continuation.id, effectId });
    }
    for (const effect of effects) {
      if (!continuationIds.has(effect.continuationId)) fail('effect references unknown continuation', { effectId: effect.id, continuationId: effect.continuationId });
    }

    if (plan.entry && Array.isArray(plan.entry.body)) validatePlanTree(plan, fail, localIds, effectIds, continuationIds);

    const states = Array.isArray(plan.states) ? plan.states : [];
    if (states.length !== continuations.length + 1) fail('state table must contain entry plus one state per continuation', { expected: continuations.length + 1, actual: states.length });
    if (states[0] && (states[0].id !== 'entry' || states[0].kind !== 'entry' || states[0].stateIndex !== 0)) fail('state zero must be the entry state');
    for (let index = 0; index < continuations.length; index += 1) {
      const continuation = continuations[index];
      const state = states[index + 1];
      if (!state || state.id !== continuation.id || state.kind !== 'continuation' || state.stateIndex !== continuation.stateIndex || stableStringify(state.effectIds) !== stableStringify(continuation.effectIds)) {
        fail('continuation state table mismatch', { continuationId: continuation.id, stateIndex: index + 1 });
      }
    }

    const effectById = new Map(effects.map((entry) => [entry.id, entry]));
    const statementVisitor = (statement) => {
      if (statement.kind === 'effect') {
        const record = effectById.get(statement.effectId);
        if (record && stableStringify(statement.result) !== stableStringify(record.result)) fail('effect statement result differs from effect record', { effectId: statement.effectId });
        if (record && statement.continuationId !== record.continuationId) fail('effect statement continuation differs from effect record', { effectId: statement.effectId });
      }
      if (statement.kind === 'effect-group') {
        for (const item of statement.results || []) {
          const record = effectById.get(item.effectId);
          if (!record || !record.result || record.result.localId !== item.localId) fail('effect-group result differs from effect record', { effectId: item.effectId, localId: item.localId });
        }
      }
    };
    statementVisitor.expression = () => {};
    if (plan.entry && Array.isArray(plan.entry.body)) walkStatements(plan.entry.body, statementVisitor);

    if (!plan.summary || typeof plan.summary !== 'object') fail('plan summary is required');
    else {
      const expectedSummary = summarizeNativePlan(plan.entry && plan.entry.body, locals, effects, continuations);
      for (const [key, expected] of Object.entries(expectedSummary)) {
        if (plan.summary[key] !== expected) fail(`summary ${key} mismatch`, { expected, actual: plan.summary[key] });
      }
    }
  }
  if (errors.length > 0) {
    const diagnostics = errors.map((entry) => diagnostic(undefined, undefined, contract.CANONICAL_NATIVE_PLAN_DIAGNOSTIC_CODES.PLAN_INVALID, entry.message, entry.detail));
    throw new CanonicalNativePlanError('Canonical native plan validation failed.', diagnostics);
  }
  return Object.freeze({
    ok: true,
    version: plan.version,
    planHash: plan.planHash,
    locals: plan.locals.length,
    effects: plan.effects.length,
    continuations: plan.continuations.length,
    statements: plan.summary.statementCount,
    expressions: plan.summary.expressionCount
  });
}

function buildCanonicalNativePlanLegacy(compiled, options = {}) {
  return new NativePlanBuilder(compiled, options).build();
}

function buildCanonicalNativePlan(compiled, options = {}) {
  return executeCanonicalNativePlanSpine(compiled, options, buildCanonicalNativePlanLegacy);
}

function writeCanonicalNativePlan(plan, targetFile) {
  const report = assertCanonicalNativePlan(plan);
  const file = path.resolve(targetFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${stableStringify(plan, 2)}\n`);
  return Object.freeze({ file, bytes: fs.statSync(file).size, planHash: report.planHash });
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_PLAN_VERSION: contract.CANONICAL_NATIVE_PLAN_VERSION,
  CANONICAL_NATIVE_PLAN_COMPILER_VERSION,
  CANONICAL_NATIVE_PLAN_HASH_ALGORITHM: contract.CANONICAL_NATIVE_PLAN_HASH_ALGORITHM,
  CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION: contract.CANONICAL_NATIVE_PLAN_OWNERSHIP_VERSION,
  CanonicalNativePlanError,
  buildCanonicalNativePlan,
  validateCanonicalNativePlan: assertCanonicalNativePlan,
  writeCanonicalNativePlan,
  stableStringify
});
