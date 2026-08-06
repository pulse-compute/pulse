'use strict';

const ts = require('typescript');
const { prefixedStableId } = require('@pulse-compute/wasm-contracts/stable-id');
const { stableFileName } = require('../diagnostics.js');
const { createCanonicalDiagnostic } = require('../spine/diagnostic-authority.js');
const {
  extractEventEmitCall,
  extractParallelCall,
  unwrapExpression
} = require('../spine/handler-surface-authority.js');

function loadEventContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/events');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../../contracts/src/events/contracts.js');
    }
    throw error;
  }
}

const events = loadEventContracts();
const EVENT_EMIT_CALLSITE_VERSION = 'pulse.event-emit-callsite.v1';
const EVENT_EMIT_ANALYSIS_VERSION = 'pulse.event-emit-analysis.v1';

function diagnostic(sourceFile, node, code, message, detail = {}) {
  return createCanonicalDiagnostic({
    frontend: 'canonical-router',
    sourceFile,
    node,
    code,
    message,
    detail: Object.freeze({ ...detail, automaticFallback: false })
  });
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function sourceFor(sourceFile, node, cwd) {
  const offset = node.getStart(sourceFile);
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({
    file: String(stableFileName(sourceFile.fileName, cwd) || '').replace(/\\/g, '/'),
    line: point.line + 1,
    column: point.character
  });
}

function emitPlacement(call, ctxName) {
  let root = call;
  let parent = root.parent;
  while (parent && (
    ts.isParenthesizedExpression(parent)
    || ts.isAsExpression(parent)
    || ts.isSatisfiesExpression?.(parent)
    || ts.isNonNullExpression(parent)
    || ts.isTypeAssertionExpression(parent)
  )) {
    root = parent;
    parent = root.parent;
  }
  if (parent && ts.isAwaitExpression(parent)) return Object.freeze({ awaited: true, grouped: false });
  if (parent && ts.isPropertyAssignment(parent) && unwrapExpression(parent.initializer) === call) {
    const record = parent.parent;
    const parallel = record && ts.isObjectLiteralExpression(record)
      ? extractParallelCall(record.parent, ctxName, { unwrap: true })
      : undefined;
    if (parallel && parallel.record === record) {
      let parallelRoot = parallel.call;
      let parallelParent = parallelRoot.parent;
      while (parallelParent && (
        ts.isParenthesizedExpression(parallelParent)
        || ts.isAsExpression(parallelParent)
        || ts.isSatisfiesExpression?.(parallelParent)
        || ts.isNonNullExpression(parallelParent)
        || ts.isTypeAssertionExpression(parallelParent)
      )) {
        parallelRoot = parallelParent;
        parallelParent = parallelRoot.parent;
      }
      return Object.freeze({
        awaited: Boolean(parallelParent && ts.isAwaitExpression(parallelParent)),
        grouped: true,
        groupKey: propertyName(parent.name)
      });
    }
  }
  return Object.freeze({ awaited: false, grouped: false });
}

function parseEmitCall(emit, sourceFile, handler, ctxName, options, diagnostics) {
  const call = emit.call;
  if (emit.argumentCount !== 2) {
    diagnostics.push(diagnostic(sourceFile, call, 'PULSEWASM_EVENTS_EMIT_ARITY', 'ctx.emit requires exactly an event type and one schema declaration/payload object.'));
    return undefined;
  }
  const typeNode = unwrapExpression(emit.type);
  if (!typeNode || (!ts.isStringLiteral(typeNode) && !ts.isNoSubstitutionTemplateLiteral(typeNode))) {
    diagnostics.push(diagnostic(sourceFile, emit.type || call, 'PULSEWASM_EVENTS_EMIT_TYPE_STATIC_REQUIRED', 'ctx.emit event types must be direct string literals.'));
    return undefined;
  }
  let type;
  try {
    type = events.normalizeEventType(typeNode.text);
  } catch (error) {
    diagnostics.push(diagnostic(sourceFile, typeNode, error.code || 'PULSEWASM_EVENTS_TYPE_INVALID', error.message));
    return undefined;
  }

  const eventNode = unwrapExpression(emit.event);
  if (!eventNode || !ts.isObjectLiteralExpression(eventNode)) {
    diagnostics.push(diagnostic(sourceFile, emit.event || call, 'PULSEWASM_EVENTS_EMIT_DECLARATION_STATIC_REQUIRED', 'ctx.emit requires one direct object literal containing schema and its conditional payload.'));
    return undefined;
  }
  const properties = new Map();
  let valid = true;
  for (const property of eventNode.properties) {
    if (!ts.isPropertyAssignment(property)) {
      diagnostics.push(diagnostic(sourceFile, property, 'PULSEWASM_EVENTS_EMIT_PROPERTY_STATIC_REQUIRED', 'ctx.emit accepts only ordinary schema and payload property assignments.'));
      valid = false;
      continue;
    }
    const name = propertyName(property.name);
    if (name !== 'schema' && name !== 'payload') {
      diagnostics.push(diagnostic(sourceFile, property.name, 'PULSEWASM_EVENTS_EMIT_FIELD_UNSUPPORTED', `ctx.emit does not support field ${JSON.stringify(name || property.name.getText(sourceFile))}.`));
      valid = false;
      continue;
    }
    if (properties.has(name)) {
      diagnostics.push(diagnostic(sourceFile, property.name, 'PULSEWASM_EVENTS_EMIT_FIELD_DUPLICATE', `ctx.emit field ${JSON.stringify(name)} is duplicated.`));
      valid = false;
      continue;
    }
    properties.set(name, property.initializer);
  }
  if (!properties.has('schema')) {
    diagnostics.push(diagnostic(sourceFile, eventNode, 'PULSEWASM_EVENTS_EMIT_SCHEMA_REQUIRED', 'ctx.emit requires an explicit literal schema field.'));
    valid = false;
  }
  if (!valid) return undefined;

  const schemaNode = unwrapExpression(properties.get('schema'));
  let schemaId;
  if (schemaNode && schemaNode.kind === ts.SyntaxKind.NullKeyword) schemaId = null;
  else if (schemaNode && (ts.isStringLiteral(schemaNode) || ts.isNoSubstitutionTemplateLiteral(schemaNode))) schemaId = schemaNode.text;
  else {
    diagnostics.push(diagnostic(sourceFile, schemaNode || eventNode, 'PULSEWASM_EVENTS_EMIT_SCHEMA_STATIC_REQUIRED', 'ctx.emit schema must be a direct dotted schema ID literal or null.'));
    return undefined;
  }
  try {
    schemaId = events.normalizeEventSchemaId(schemaId);
  } catch (error) {
    diagnostics.push(diagnostic(sourceFile, schemaNode, error.code || 'PULSEWASM_EVENTS_SCHEMA_ID_INVALID', error.message));
    return undefined;
  }
  const hasPayload = properties.has('payload');
  if (schemaId === null && hasPayload) {
    diagnostics.push(diagnostic(sourceFile, properties.get('payload'), 'PULSEWASM_EVENTS_EMIT_PAYLOAD_FORBIDDEN', 'ctx.emit no-payload events must omit payload.'));
    return undefined;
  }
  if (schemaId !== null && !hasPayload) {
    diagnostics.push(diagnostic(sourceFile, eventNode, 'PULSEWASM_EVENTS_EMIT_PAYLOAD_REQUIRED', 'ctx.emit schema-bound events require payload.'));
    return undefined;
  }
  if (schemaId !== null && !options.schemaIds.has(schemaId)) {
    diagnostics.push(diagnostic(sourceFile, schemaNode, 'PULSEWASM_EVENTS_EMIT_SCHEMA_UNRESOLVED', `ctx.emit schema ${JSON.stringify(schemaId)} is not present in the compiled project schema registry.`, { schemaId }));
    return undefined;
  }

  const placement = emitPlacement(call, ctxName);
  if (!placement.awaited) {
    diagnostics.push(diagnostic(sourceFile, call, 'PULSE_EFFECT_AWAIT_REQUIRED', 'Pulse effect ctx.emit must be awaited directly or through an awaited ctx.parallel group.', { surfaceId: 'ctx.emit' }));
    return undefined;
  }
  if (placement.grouped && placement.groupKey === undefined) {
    diagnostics.push(diagnostic(sourceFile, call, 'PULSE_PARALLEL_KEY_STATIC_REQUIRED', 'A ctx.emit parallel member requires a static identifier or string-literal key.'));
    return undefined;
  }

  const source = sourceFor(sourceFile, call, options.cwd);
  const stableId = prefixedStableId('emit', {
    version: EVENT_EMIT_CALLSITE_VERSION,
    type,
    schemaId,
    handlerStableId: handler.id,
    source
  });
  return Object.freeze({
    version: EVENT_EMIT_CALLSITE_VERSION,
    stableId,
    type,
    schemaId,
    handlerStableId: handler.id,
    ownerRoles: Object.freeze([...(handler.roles || [])].sort()),
    source,
    capability: 'event.emit',
    grouped: placement.grouped,
    ...(placement.grouped ? { groupKey: placement.groupKey } : {})
  });
}

function analyzeEventEmitHandlers(handlerTable, options = {}) {
  const diagnostics = [];
  const callsites = [];
  const schemaIds = new Set((options.schemaIds || []).map(String));
  const handlers = [...(handlerTable && handlerTable.handlers || [])]
    .sort((left, right) => Number(left.order) - Number(right.order) || left.id.localeCompare(right.id));
  for (const handler of handlers) {
    const functionNode = typeof options.functionNodeForHandler === 'function'
      ? options.functionNodeForHandler(handler)
      : undefined;
    const sourceFile = typeof options.sourceFileForHandler === 'function'
      ? options.sourceFileForHandler(handler)
      : functionNode && functionNode.getSourceFile();
    if (!functionNode || !sourceFile) continue;
    const parameters = functionNode.parameters || [];
    const eventOrHttpRole = (handler.roles || []).some((role) => role !== 'error' && role !== 'error-middleware');
    const ctxParameter = parameters[eventOrHttpRole ? 0 : 1];
    const ctxName = ctxParameter && ts.isIdentifier(ctxParameter.name) ? ctxParameter.name.text : 'ctx';

    function visit(node, root = false) {
      if (!root && ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const emit = extractEventEmitCall(node, ctxName, { unwrap: true });
        if (emit) {
          const callsite = parseEmitCall(emit, sourceFile, handler, ctxName, {
            cwd: options.cwd || process.cwd(),
            schemaIds
          }, diagnostics);
          if (callsite) callsites.push(callsite);
          return;
        }
      }
      ts.forEachChild(node, (child) => visit(child, false));
    }
    if (functionNode.body) visit(functionNode.body, true);
  }
  callsites.sort((left, right) => left.source.file.localeCompare(right.source.file)
    || left.source.line - right.source.line
    || left.source.column - right.source.column
    || left.stableId.localeCompare(right.stableId));
  return Object.freeze({
    version: EVENT_EMIT_ANALYSIS_VERSION,
    callsites: Object.freeze(callsites),
    diagnostics: Object.freeze(diagnostics),
    summary: Object.freeze({
      callsites: callsites.length,
      schemaBound: callsites.filter((entry) => entry.schemaId !== null).length,
      noPayload: callsites.filter((entry) => entry.schemaId === null).length,
      grouped: callsites.filter((entry) => entry.grouped).length,
      handlers: new Set(callsites.map((entry) => entry.handlerStableId)).size
    })
  });
}

module.exports = Object.freeze({
  EVENT_EMIT_CALLSITE_VERSION,
  EVENT_EMIT_ANALYSIS_VERSION,
  analyzeEventEmitHandlers
});
