'use strict';

const fs = require('node:fs');
const path = require('node:path');

const phaseName = 'grip-lowering-plan';

function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadGripContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/grip/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../wasm/packages/contracts/src/grip/contracts.js');
    }
    throw error;
  }
}

function loadCanonicalRuntimeContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
  } catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) {
      return require('../../wasm/packages/contracts/src/handler/canonical-runtime.js');
    }
    throw error;
  }
}

const {
  PACKAGE_VERSION,
  normalizeArtifact,
  normalizeDiagnostic,
  sourceLoc,
  stableFileName
} = loadContractsDiagnostics();
const gripContracts = loadGripContracts();
const canonicalRuntimeContracts = loadCanonicalRuntimeContracts();

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function loadTypeScript(inputs = {}) {
  if (inputs.typescript) return inputs.typescript;
  if (inputs.ts) return inputs.ts;
  try {
    return require('typescript');
  } catch (error) {
    const diagnostic = normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSEWASM_GRIP_TYPESCRIPT_REQUIRED',
      message: 'GRIP lowering plan extraction requires the TypeScript parser.',
      hint: 'Call buildGripLoweringPlan from the compiler orchestrator, or pass { typescript } explicitly.',
      loc: { file: '<grip-lowering-plan>' }
    });
    const thrown = new Error(diagnostic.message);
    thrown.diagnostics = [diagnostic];
    throw thrown;
  }
}

function unwrapExpression(ts, node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)))
  ) {
    current = current.expression;
  }
  return current;
}

function isStringLiteralLike(ts, node) {
  return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral));
}

function literalText(ts, node) {
  const unwrapped = unwrapExpression(ts, node);
  return isStringLiteralLike(ts, unwrapped) ? unwrapped.text : undefined;
}

function numericLiteralValue(ts, node) {
  const unwrapped = unwrapExpression(ts, node);
  if (!unwrapped) return undefined;
  return ts.isNumericLiteral(unwrapped) ? Number(unwrapped.text) : undefined;
}

function booleanLiteralValue(ts, node) {
  const unwrapped = unwrapExpression(ts, node);
  if (!unwrapped) return undefined;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function locFor(sourceFile, node) {
  return node ? sourceLoc(sourceFile, node) : { file: sourceFile ? sourceFile.fileName : '<grip-lowering-plan>' };
}

function rangeFor(sourceFile, node) {
  return Object.freeze({
    start: node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : 0,
    end: node && typeof node.getEnd === 'function' ? node.getEnd() : 0
  });
}

function placementForCall(ts, call) {
  let current = call;
  let parent = current.parent;
  if (parent && ts.isAwaitExpression(parent)) {
    current = parent;
    parent = current.parent;
  }
  if (parent && ts.isVoidExpression(parent)) {
    current = parent;
    parent = current.parent;
  }
  if (parent && ts.isExpressionStatement(parent)) return 'statement';
  if (parent && ts.isReturnStatement(parent)) return 'return';
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === current) return 'variable';
  if (
    parent
    && ts.isPropertyAssignment(parent)
    && parent.initializer === current
    && parent.parent
    && ts.isObjectLiteralExpression(parent.parent)
    && parent.parent.parent
    && ts.isCallExpression(parent.parent.parent)
  ) return 'statement';
  return 'unsupported';
}

function canonicalEffect(ts, sourceFile, call, input) {
  return Object.freeze({
    version: canonicalRuntimeContracts.CANONICAL_PACKAGE_EFFECT_VERSION,
    contractId: gripContracts.GRIP_CONTRACT_ID,
    package: '@pulse-compute/grip',
    import: '@pulse-compute/grip',
    kind: `grip.${input.operation}`,
    providerKind: 'grip',
    operation: input.operation,
    capability: `grip.${input.operation}`,
    result: input.result,
    placement: placementForCall(ts, call),
    range: rangeFor(sourceFile, call),
    resource: input.resource,
    payload: Object.freeze({ ...(input.payload || {}) }),
    loc: locFor(sourceFile, call)
  });
}

function makeDiagnostic(sourceFile, node, code, message, hint, severity = 'error', details) {
  return normalizeDiagnostic({
    phase: phaseName,
    severity,
    code,
    message,
    hint,
    details,
    loc: locFor(sourceFile, node)
  });
}

function diagnosticHasError(diagnostics) {
  return (diagnostics || []).some((entry) => (entry.severity || 'error') === 'error');
}

function propertyKey(ts, name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function firstPropertyInitializer(ts, objectExpression, names) {
  if (!objectExpression || !ts.isObjectLiteralExpression(objectExpression)) return undefined;
  const wanted = new Set(names);
  for (const property of objectExpression.properties || []) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyKey(ts, property.name);
    if (wanted.has(key)) return property.initializer;
  }
  return undefined;
}

function stringArrayPropertyValue(ts, sourceFile, objectExpression, names, diagnostics, diagnosticCode, diagnosticMessage) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  if (!initializer) return undefined;
  const unwrapped = unwrapExpression(ts, initializer);
  if (!unwrapped || !ts.isArrayLiteralExpression(unwrapped)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      initializer,
      diagnosticCode,
      diagnosticMessage,
      'Use a static array of string literal channels in the lowerable GRIP facade.',
      'error',
      { property: names[0] }
    ));
    return undefined;
  }
  const out = [];
  for (const element of unwrapped.elements || []) {
    const value = literalText(ts, element);
    if (value === undefined) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        element,
        diagnosticCode,
        diagnosticMessage,
        'Use only literal channel names in the lowerable GRIP facade.',
        'error',
        { property: names[0] }
      ));
    } else {
      out.push(value);
    }
  }
  return out;
}

function stringPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  if (!initializer) return undefined;
  return literalText(ts, initializer);
}

function numberPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  if (!initializer) return undefined;
  return numericLiteralValue(ts, initializer);
}

function booleanPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  if (!initializer) return undefined;
  return booleanLiteralValue(ts, initializer);
}

function collectFacadeBindings(ts, sourceFile, manifest) {
  const bindings = {
    imports: [],
    namespaceLocals: new Map(),
    isWebSocketLocals: new Map(),
    subscribeLocals: new Map(),
    handoffLocals: new Map(),
    broadcastLocals: new Map(),
    holdLocals: new Map(),
    channelLocals: new Map(),
    publishLocals: new Map()
  };
  const lowerableSubpath = manifest.lowerableSubpath;
  const compatibilitySubpaths = new Set(
    manifest.publicApi && Array.isArray(manifest.publicApi.compatibilitySubpaths)
      ? manifest.publicApi.compatibilitySubpaths.map(String)
      : []
  );
  const facadeNamespace = manifest.facade && manifest.facade.namespace ? manifest.facade.namespace : 'grip';

  function rememberImport(record) {
    bindings.imports.push(record);
  }

  for (const statement of sourceFile.statements || []) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = statement.moduleSpecifier && literalText(ts, statement.moduleSpecifier);
    if (moduleName !== lowerableSubpath && !compatibilitySubpaths.has(moduleName)) continue;
    const canonicalRoot = moduleName === lowerableSubpath;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      bindings.namespaceLocals.set(clause.name.text, { imported: 'default', module: moduleName, canonicalRoot, loc: locFor(sourceFile, clause.name) });
      rememberImport({ imported: 'default', local: clause.name.text, module: moduleName, canonicalRoot, loc: locFor(sourceFile, clause.name) });
    }
    const namedBindings = clause.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.namespaceLocals.set(namedBindings.name.text, { imported: '*', module: moduleName, canonicalRoot, loc: locFor(sourceFile, namedBindings.name) });
      rememberImport({ imported: '*', local: namedBindings.name.text, module: moduleName, canonicalRoot, loc: locFor(sourceFile, namedBindings.name) });
    } else if (ts.isNamedImports(namedBindings)) {
      for (const specifier of namedBindings.elements || []) {
        const imported = specifier.propertyName ? specifier.propertyName.text : specifier.name.text;
        const local = specifier.name.text;
        if (imported === facadeNamespace) {
          bindings.namespaceLocals.set(local, { imported, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
        } else if (canonicalRoot && imported === 'isWebSocket') {
          bindings.isWebSocketLocals.set(local, { imported, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
        } else if (canonicalRoot && imported === 'subscribe') {
          bindings.subscribeLocals.set(local, { imported, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
        } else if (canonicalRoot && imported === 'handoff') {
          bindings.handoffLocals.set(local, { imported, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
        } else if (canonicalRoot && imported === 'broadcast') {
          bindings.broadcastLocals.set(local, { imported, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, module: moduleName, canonicalRoot, loc: locFor(sourceFile, specifier.name) });
        } else if (imported === 'hold') {
          bindings.holdLocals.set(local, { imported, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, loc: locFor(sourceFile, specifier.name) });
        } else if (imported === 'channel') {
          bindings.channelLocals.set(local, { imported, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, loc: locFor(sourceFile, specifier.name) });
        } else if (imported === 'publish') {
          bindings.publishLocals.set(local, { imported, local, loc: locFor(sourceFile, specifier.name) });
          rememberImport({ imported, local, loc: locFor(sourceFile, specifier.name) });
        }
      }
    }
  }
  return bindings;
}

function resolveGripCall(ts, call, bindings) {
  const expression = unwrapExpression(ts, call.expression);
  if (!expression) return undefined;
  if (ts.isPropertyAccessExpression(expression)) {
    const object = unwrapExpression(ts, expression.expression);
    const method = expression.name.text;
    const namespace = object && ts.isIdentifier(object) ? bindings.namespaceLocals.get(object.text) : undefined;
    const methods = namespace && namespace.canonicalRoot
      ? ['broadcast', 'handoff', 'isWebSocket', 'subscribe']
      : ['hold', 'channel', 'publish'];
    if (namespace && methods.includes(method)) {
      return { symbol: `grip.${method}`, method, local: object.text, canonicalRoot: namespace.canonicalRoot };
    }
  }
  if (ts.isIdentifier(expression)) {
    if (bindings.isWebSocketLocals.has(expression.text)) return { symbol: 'grip.isWebSocket', method: 'isWebSocket', local: expression.text, canonicalRoot: true };
    if (bindings.subscribeLocals.has(expression.text)) return { symbol: 'grip.subscribe', method: 'subscribe', local: expression.text, canonicalRoot: true };
    if (bindings.handoffLocals.has(expression.text)) return { symbol: 'grip.handoff', method: 'handoff', local: expression.text, canonicalRoot: true };
    if (bindings.broadcastLocals.has(expression.text)) return { symbol: 'grip.broadcast', method: 'broadcast', local: expression.text, canonicalRoot: true };
    if (bindings.holdLocals.has(expression.text)) return { symbol: 'grip.hold', method: 'hold', local: expression.text };
    if (bindings.channelLocals.has(expression.text)) return { symbol: 'grip.channel', method: 'channel', local: expression.text };
    if (bindings.publishLocals.has(expression.text)) return { symbol: 'grip.publish', method: 'publish', local: expression.text };
  }
  return undefined;
}

function objectArg(ts, call, index) {
  const candidate = unwrapExpression(ts, (call.arguments || [])[index]);
  return candidate && ts.isObjectLiteralExpression(candidate) ? candidate : undefined;
}

function holdEntry(ts, sourceFile, call, diagnostics) {
  const modeArg = (call.arguments || [])[0];
  const mode = literalText(ts, modeArg);
  if (mode === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      modeArg || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_HOLD_MODE,
      'grip.hold(...) requires a literal hold mode.',
      'Use grip.hold("stream") or grip.hold("response") in the lowerable GRIP facade.',
      'error'
    ));
  } else if (!gripContracts.GRIP_ALLOWED_HOLD_MODES.includes(mode)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      modeArg,
      gripContracts.GRIP_DIAGNOSTIC_CODES.HOLD_MODE_UNSUPPORTED,
      `Unsupported GRIP hold mode ${JSON.stringify(mode)}.`,
      `Use one of: ${gripContracts.GRIP_ALLOWED_HOLD_MODES.join(', ')}.`,
      'error',
      { mode }
    ));
  }
  const options = objectArg(ts, call, 1);
  const channels = stringArrayPropertyValue(
    ts,
    sourceFile,
    options,
    ['channels'],
    diagnostics,
    gripContracts.GRIP_DIAGNOSTIC_CODES.DYNAMIC_CHANNEL_LIST_UNSUPPORTED,
    'grip.hold(...) channels must be a static array of literal channel names.'
  );
  const timeoutMs = numberPropertyValue(ts, options, ['timeoutMs', 'timeout']);
  const headersConfigured = Boolean(options && firstPropertyInitializer(ts, options, ['headers']));
  const entry = {
    kind: 'grip-hold',
    symbol: 'grip.hold',
    mode,
    channels: channels || [],
    timeoutMs,
    headersConfigured,
    asSymbol: 'pulse_grip_hold',
    hostCapabilities: ['headers'],
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call)
  };
  entry.canonicalEffect = canonicalEffect(ts, sourceFile, call, {
    import: '@pulse-compute/grip/pulsewasm',
    operation: 'hold',
    result: 'opaque-response',
    resource: Object.freeze({ kind: 'literal', value: mode || 'stream' }),
    payload: {
      mode,
      channels: channels || [],
      timeoutMs,
      headersConfigured
    }
  });
  return entry;
}

function channelEntry(ts, sourceFile, call, diagnostics) {
  const channelArg = (call.arguments || [])[0];
  const channelName = literalText(ts, channelArg);
  if (channelName === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      channelArg || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_CHANNEL,
      'grip.channel(...) requires a literal channel name.',
      'Use a static channel string in the lowerable GRIP facade. Dynamic channel expressions remain out of scope for the Beta.',
      'error'
    ));
  }
  const options = objectArg(ts, call, 1);
  const prefix = stringPropertyValue(ts, options, ['prefix']);
  const fanout = booleanPropertyValue(ts, options, ['fanout']);
  const entry = {
    kind: 'grip-channel',
    symbol: 'grip.channel',
    channel: channelName,
    prefix,
    fanout,
    asSymbol: 'pulse_grip_channel',
    hostCapabilities: ['headers', 'channel', 'broadcaster'],
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call)
  };
  entry.canonicalEffect = canonicalEffect(ts, sourceFile, call, {
    import: '@pulse-compute/grip/pulsewasm',
    operation: 'channel',
    result: 'ack',
    resource: Object.freeze({ kind: 'literal', value: channelName }),
    payload: { channel: channelName, prefix, fanout }
  });
  return entry;
}

function publishEntry(ts, sourceFile, call, diagnostics) {
  const channelArg = (call.arguments || [])[0];
  const messageArg = (call.arguments || [])[1];
  const channelName = literalText(ts, channelArg);
  const message = literalText(ts, messageArg);
  if (channelName === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      channelArg || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_CHANNEL,
      'grip.publish(...) requires a literal channel name.',
      'Use a static channel string in the lowerable GRIP facade. Dynamic channel expressions remain out of scope for the Beta.',
      'error'
    ));
  }
  if (message === undefined) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      messageArg || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_MESSAGE,
      'grip.publish(...) requires a literal message payload in the Beta.',
      'Use a static string message for the Beta lowerable contract. Schema-backed or dynamic publish payloads are future work.',
      'error'
    ));
  }
  const options = objectArg(ts, call, 2);
  const entry = {
    kind: 'grip-publish',
    symbol: 'grip.publish',
    channel: channelName,
    message,
    event: stringPropertyValue(ts, options, ['event', 'type']),
    id: stringPropertyValue(ts, options, ['id']),
    asSymbol: 'pulse_grip_publish',
    hostCapabilities: ['broadcaster', 'clock'],
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call)
  };
  entry.canonicalEffect = canonicalEffect(ts, sourceFile, call, {
    import: '@pulse-compute/grip/pulsewasm',
    operation: 'publish',
    result: 'structured-response',
    resource: Object.freeze({ kind: 'literal', value: channelName }),
    payload: {
      channel: channelName,
      message,
      event: entry.event,
      id: entry.id
    }
  });
  return entry;
}

function enclosingContextName(ts, node) {
  let current = node && node.parent;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current)
        || ts.isFunctionExpression(current)
        || ts.isArrowFunction(current)
        || ts.isMethodDeclaration(current))
      && current.parameters
      && current.parameters[0]
      && ts.isIdentifier(current.parameters[0].name)
    ) return current.parameters[0].name.text;
    current = current.parent;
  }
  return 'ctx';
}

function staticJsonValue(ts, sourceFile, node, diagnostics, diagnosticCode, message) {
  const current = unwrapExpression(ts, node);
  if (!current) return undefined;
  if (isStringLiteralLike(ts, current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (current.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(current)
    && current.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(current.operand)
  ) return -Number(current.operand.text);
  if (ts.isArrayLiteralExpression(current)) {
    const output = [];
    for (const element of current.elements || []) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          element,
          diagnosticCode,
          message,
          'Use JSON-literal arrays without spreads or omitted elements.',
          'error'
        ));
        continue;
      }
      output.push(staticJsonValue(ts, sourceFile, element, diagnostics, diagnosticCode, message));
    }
    return output;
  }
  if (ts.isObjectLiteralExpression(current)) {
    const output = {};
    const seen = new Set();
    for (const property of current.properties || []) {
      if (!ts.isPropertyAssignment(property)) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          property,
          diagnosticCode,
          message,
          'Use an ordinary JSON-literal object without spreads, shorthand properties, methods, getters, or setters.',
          'error'
        ));
        continue;
      }
      const key = propertyKey(ts, property.name);
      if (key === undefined || seen.has(key) || key === '__proto__') {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          property.name,
          diagnosticCode,
          message,
          'Use unique static object keys; computed, duplicate, and __proto__ keys are not lowerable.',
          'error'
        ));
        continue;
      }
      seen.add(key);
      output[key] = staticJsonValue(ts, sourceFile, property.initializer, diagnostics, diagnosticCode, message);
    }
    return output;
  }
  diagnostics.push(makeDiagnostic(
    sourceFile,
    current,
    diagnosticCode,
    message,
    'Use only JSON-literal values in the bounded Native GRIP surface.',
    'error',
    { expression: current.getText(sourceFile) }
  ));
  return undefined;
}

function staticObjectArgument(ts, sourceFile, call, index, diagnostics, diagnosticCode, message) {
  const argument = call.arguments && call.arguments[index];
  const current = unwrapExpression(ts, argument);
  if (!current || !ts.isObjectLiteralExpression(current)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      argument || call,
      diagnosticCode,
      message,
      'Use an inline static object literal in the bounded Native GRIP surface.',
      'error'
    ));
    return {};
  }
  return staticJsonValue(ts, sourceFile, current, diagnostics, diagnosticCode, message) || {};
}

function normalizeStaticChannels(sourceFile, node, options, diagnostics) {
  const input = options.channels !== undefined
    ? options.channels
    : (options.channel === undefined ? [] : [options.channel]);
  if (!Array.isArray(input) || input.length === 0) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      gripContracts.GRIP_DIAGNOSTIC_CODES.CHANNEL_INVALID,
      'GRIP framing requires at least one static channel.',
      'Use channel: "name" or channels: ["one", "two"].',
      'error'
    ));
    return [];
  }
  return input.map((value) => {
    const channel = typeof value === 'string' ? value.trim() : '';
    if (!channel || /[,\r\n]/.test(channel)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        node,
        gripContracts.GRIP_DIAGNOSTIC_CODES.CHANNEL_INVALID,
        'GRIP channel names must be non-empty static strings without commas or line breaks.',
        'Use one literal channel per ordered channel entry.',
        'error',
        { channel: typeof value === 'string' ? value : undefined }
      ));
    }
    return channel;
  });
}

function validateFramingOptions(sourceFile, node, options, diagnostics, kind) {
  normalizeStaticChannels(sourceFile, node, options, diagnostics);
  if (options.mode !== undefined && !gripContracts.GRIP_ALLOWED_HOLD_MODES.includes(options.mode)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      gripContracts.GRIP_DIAGNOSTIC_CODES.MODE_UNSUPPORTED,
      `Unsupported GRIP hold mode ${JSON.stringify(options.mode)}.`,
      'Use "stream" or "response".',
      'error',
      { mode: options.mode }
    ));
  }
  if (
    options.timeoutMs !== undefined
    && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0)
  ) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      gripContracts.GRIP_DIAGNOSTIC_CODES.TIMEOUT_INVALID,
      'GRIP timeoutMs must be a non-negative safe integer.',
      'Use zero or a positive integer no larger than Number.MAX_SAFE_INTEGER.',
      'error',
      { timeoutMs: options.timeoutMs }
    ));
  }
  if (
    kind === 'handoff'
    && options.status !== undefined
    && (!Number.isSafeInteger(options.status) || options.status < 200 || options.status > 599)
  ) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      node,
      gripContracts.GRIP_DIAGNOSTIC_CODES.STATIC_OPTIONS_REQUIRED,
      'GRIP handoff status must be a static integer from 200 through 599.',
      'Use a valid Web Response status.',
      'error',
      { status: options.status }
    ));
  }
}

function packageIntrinsic(sourceFile, call, operation) {
  const descriptor = gripContracts.GRIP_PACKAGE_INTRINSICS[operation];
  return Object.freeze({
    version: gripContracts.GRIP_PACKAGE_INTRINSIC_VERSION,
    contractId: gripContracts.GRIP_CONTRACT_ID,
    package: '@pulse-compute/grip',
    import: '@pulse-compute/grip',
    kind: `grip.${operation}`,
    operation,
    intrinsic: descriptor.name,
    compilerName: descriptor.compilerName,
    valueKind: descriptor.valueKind,
    argumentIndexes: descriptor.argumentIndexes,
    range: rangeFor(sourceFile, call),
    loc: locFor(sourceFile, call)
  });
}

function isWebSocketEntry(ts, sourceFile, call, diagnostics) {
  const argument = unwrapExpression(ts, call.arguments && call.arguments[0]);
  const contextName = enclosingContextName(ts, call);
  const valid = call.arguments.length === 1
    && argument
    && ts.isPropertyAccessExpression(argument)
    && argument.name.text === 'req'
    && ts.isIdentifier(unwrapExpression(ts, argument.expression))
    && unwrapExpression(ts, argument.expression).text === contextName;
  if (!valid) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      argument || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.REQUEST_EXPRESSION_UNSUPPORTED,
      'grip.isWebSocket(...) requires the current canonical handler request.',
      `Call grip.isWebSocket(${contextName}.req) directly.`,
      'error'
    ));
  }
  return Object.freeze({
    kind: 'grip-is-websocket',
    symbol: 'grip.isWebSocket',
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call),
    canonicalIntrinsic: packageIntrinsic(sourceFile, call, 'isWebSocket')
  });
}

function subscribeEntry(ts, sourceFile, call, diagnostics) {
  if (call.arguments.length !== 2) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED,
      'grip.subscribe(...) requires a response and one static options object.',
      'Call grip.subscribe(response, { channel, mode, timeoutMs }).',
      'error'
    ));
  }
  const options = staticObjectArgument(
    ts,
    sourceFile,
    call,
    1,
    diagnostics,
    gripContracts.GRIP_DIAGNOSTIC_CODES.STATIC_OPTIONS_REQUIRED,
    'grip.subscribe options must be a static object.'
  );
  validateFramingOptions(sourceFile, call.arguments[1] || call, options, diagnostics, 'subscribe');
  return Object.freeze({
    kind: 'grip-subscribe',
    symbol: 'grip.subscribe',
    options: clone(options),
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call),
    canonicalIntrinsic: packageIntrinsic(sourceFile, call, 'subscribe')
  });
}

function handoffEntry(ts, sourceFile, call, diagnostics) {
  if (call.arguments.length !== 1) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED,
      'grip.handoff(...) requires one static options object.',
      'Call grip.handoff({ channel, status, headers, body }).',
      'error'
    ));
  }
  const options = staticObjectArgument(
    ts,
    sourceFile,
    call,
    0,
    diagnostics,
    gripContracts.GRIP_DIAGNOSTIC_CODES.STATIC_OPTIONS_REQUIRED,
    'grip.handoff options must be a static object.'
  );
  validateFramingOptions(sourceFile, call.arguments[0] || call, options, diagnostics, 'handoff');
  return Object.freeze({
    kind: 'grip-handoff',
    symbol: 'grip.handoff',
    options: clone(options),
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call),
    canonicalIntrinsic: packageIntrinsic(sourceFile, call, 'handoff')
  });
}

function broadcastEntry(ts, sourceFile, call, diagnostics) {
  const contextName = enclosingContextName(ts, call);
  const contextArg = unwrapExpression(ts, call.arguments && call.arguments[0]);
  if (
    call.arguments.length !== 2
    || !contextArg
    || !ts.isIdentifier(contextArg)
    || contextArg.text !== contextName
  ) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      contextArg || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.ARGUMENT_SHAPE_UNSUPPORTED,
      'grip.broadcast(...) requires the current handler context and one static message.',
      `Call grip.broadcast(${contextName}, { channel, data, event, id }).`,
      'error'
    ));
  }
  const message = staticObjectArgument(
    ts,
    sourceFile,
    call,
    1,
    diagnostics,
    gripContracts.GRIP_DIAGNOSTIC_CODES.STATIC_MESSAGE_REQUIRED,
    'grip.broadcast message must be a static JSON-literal object.'
  );
  const channel = typeof message.channel === 'string' ? message.channel.trim() : '';
  if (!channel || /[,\r\n]/.test(channel)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call.arguments[1] || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.CHANNEL_INVALID,
      'grip.broadcast channel must be a non-empty static string without commas or line breaks.',
      'Use one literal provider channel.',
      'error'
    ));
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'data')) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call.arguments[1] || call,
      gripContracts.GRIP_DIAGNOSTIC_CODES.STATIC_MESSAGE_REQUIRED,
      'grip.broadcast message requires a static data property.',
      'Include data with a JSON-literal value.',
      'error'
    ));
  }
  const payload = {
    channel,
    data: message.data,
    ...(message.event === undefined ? {} : { event: String(message.event) }),
    ...(message.id === undefined ? {} : { id: String(message.id) })
  };
  return Object.freeze({
    kind: 'grip-broadcast',
    symbol: 'grip.broadcast',
    message: clone(payload),
    loc: locFor(sourceFile, call),
    range: rangeFor(sourceFile, call),
    placement: placementForCall(ts, call),
    canonicalEffect: canonicalEffect(ts, sourceFile, call, {
      import: '@pulse-compute/grip',
      operation: 'broadcast',
      result: 'ack',
      resource: Object.freeze({ kind: 'literal', value: channel }),
      payload
    })
  });
}

function sourceFileFromInputs(ts, inputs) {
  if (inputs.sourceFile) return inputs.sourceFile;
  const sourcePath = inputs.sourcePath || inputs.entry || inputs.appPath || inputs.file;
  const sourceText = inputs.sourceText !== undefined
    ? String(inputs.sourceText)
    : fs.readFileSync(sourcePath, 'utf8');
  const fileName = sourcePath || '<grip-lowering-plan>';
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function buildGripLoweringPlan(inputs = {}) {
  const ts = loadTypeScript(inputs);
  const sourceFile = sourceFileFromInputs(ts, inputs);
  const manifest = inputs.gripManifest || inputs.manifest || require('./pulsewasm.manifest.cjs');
  const diagnostics = [];
  const bindings = collectFacadeBindings(ts, sourceFile, manifest);
  const entries = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const resolved = resolveGripCall(ts, node, bindings);
      if (resolved) {
        if (resolved.method === 'isWebSocket') entries.push(isWebSocketEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'subscribe') entries.push(subscribeEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'handoff') entries.push(handoffEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'broadcast') entries.push(broadcastEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'hold') entries.push(holdEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'channel') entries.push(channelEntry(ts, sourceFile, node, diagnostics));
        if (resolved.method === 'publish') entries.push(publishEntry(ts, sourceFile, node, diagnostics));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  for (const entry of entries) {
    if (entry.canonicalIntrinsic) continue;
    if (entry.placement !== 'statement' && entry.placement !== 'return') {
      if (entry.symbol === 'grip.broadcast' && entry.placement === 'variable') continue;
      diagnostics.push(makeDiagnostic(
        sourceFile,
        sourceFile,
        gripContracts.GRIP_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED,
        `${entry.symbol} must be directly awaited, returned, or used as a keyed ctx.parallel member.`,
        'Keep GRIP values inside the package-owned lowering boundary; passing them through user state remains unsupported.',
        'error',
        { symbol: entry.symbol, placement: entry.placement, range: entry.range }
      ));
    }
    if (entry.symbol === 'grip.hold' && entry.placement !== 'return') {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        sourceFile,
        gripContracts.GRIP_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED,
        'grip.hold(...) must be returned directly so the opaque response stays host-owned.',
        'Return grip.hold(...) from the handler branch without inspecting or assigning the result.',
        'error',
        { placement: entry.placement, range: entry.range }
      ));
    }
  }

  if (bindings.imports.length > 0 && entries.length === 0) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      sourceFile,
      gripContracts.GRIP_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED,
      'A GRIP facade was imported but no supported package-owned calls were found.',
      'Use the bounded canonical root or the retained static compatibility facade directly in handlers.',
      'warning'
    ));
  }

  const packageCompilerBuilder = inputs.packageCompilerBuilder || {
    owner: manifest.compiler && manifest.compiler.builderOwner,
    export: manifest.compiler && manifest.compiler.export,
    trust: manifest.compiler && manifest.compiler.trust
  };
  const lowerings = manifest.modes && manifest.modes.wasm && Array.isArray(manifest.modes.wasm.lowerings)
    ? manifest.modes.wasm.lowerings.map(clone)
    : [];
  const canonicalEffects = entries.map((entry) => entry.canonicalEffect);
  const canonicalIntrinsics = entries.map((entry) => entry.canonicalIntrinsic).filter(Boolean);
  const artifact = normalizeArtifact({
    version: gripContracts.GRIP_LOWERING_PLAN_VERSION,
    generatedBy: inputs.generatedBy || PACKAGE_VERSION,
    phase: 54,
    artifact: gripContracts.GRIP_LOWERING_PLAN_ARTIFACT,
    contractId: gripContracts.GRIP_CONTRACT_ID,
    package: manifest.npmPackage,
    lowerableSubpath: manifest.lowerableSubpath,
    status: diagnosticHasError(diagnostics) ? 'error' : 'ok',
    source: stableFileName(sourceFile.fileName || '<grip-lowering-plan>', inputs.cwd || process.cwd()),
    facade: clone(manifest.facade || {}),
    manifest: {
      version: manifest.version,
      owner: 'package',
      package: manifest.npmPackage,
      lowerableSubpath: manifest.lowerableSubpath
    },
    packageCompilerBuilder,
    builderOwner: packageCompilerBuilder.owner,
    lowerings,
    entries,
    canonicalEffects: canonicalEffects.filter(Boolean),
    canonicalIntrinsics,
    diagnostics,
    policy: {
      packageOwnsCompilerBuilder: true,
      libraryKitOwnsGenericDiscovery: true,
      compilerOwnsPackageMapping: false,
      providerRuntimeImplemented: true,
      providerBehaviorImplemented: true,
      productionGripRuntimeBehavior: true,
      arbitraryThirdPartyLowererExecution: false,
      betaProofOnly: false,
      dynamicChannelsSupported: false,
      dynamicPublishPayloadsSupported: false,
      canonicalRootLowering: true,
      statelessFraming: true
    },
    summary: {
      entries: entries.length,
      holdEntries: entries.filter((entry) => entry.kind === 'grip-hold').length,
      channelEntries: entries.filter((entry) => entry.kind === 'grip-channel').length,
      publishEntries: entries.filter((entry) => entry.kind === 'grip-publish').length,
      canonicalRootEntries: entries.filter((entry) => ['grip-is-websocket', 'grip-subscribe', 'grip-handoff', 'grip-broadcast'].includes(entry.kind)).length,
      intrinsicEntries: canonicalIntrinsics.length,
      broadcastEntries: entries.filter((entry) => entry.kind === 'grip-broadcast').length,
      holdCalls: entries.filter((entry) => entry.kind === 'grip-hold').length,
      channelCalls: entries.filter((entry) => entry.kind === 'grip-channel').length,
      publishCalls: entries.filter((entry) => entry.kind === 'grip-publish').length,
      imports: bindings.imports.length,
      packageOwnedBuilder: packageCompilerBuilder.owner === '@pulse-compute/grip',
      manifestOwnedByPackage: manifest.npmPackage === '@pulse-compute/grip',
      sidecarDeclared: Boolean(manifest.modes && manifest.modes.wasm && manifest.modes.wasm.sidecar),
      sidecarSymbolsDeclared: lowerings.length >= 3,
      providerRuntimeImplemented: true,
      compiledWasmRuntimeImplemented: true,
      dynamicChannelsSupported: false,
      dynamicPublishPayloadsSupported: false,
      productionCompletenessRequired: true,
      errors: diagnostics.filter((entry) => (entry.severity || 'error') === 'error').length,
      warnings: diagnostics.filter((entry) => entry.severity === 'warning').length
    }
  });

  return {
    artifact,
    entries,
    canonicalEffects: canonicalEffects.filter(Boolean),
    canonicalIntrinsics,
    diagnostics,
    manifest,
    packageCompilerBuilder,
    hasErrors: artifact.summary.errors > 0
  };
}

const gripLoweringBuilder = Object.freeze({
  owner: '@pulse-compute/grip',
  contractId: gripContracts.GRIP_CONTRACT_ID,
  artifact: gripContracts.GRIP_LOWERING_PLAN_ARTIFACT,
  build: buildGripLoweringPlan
});

const GRIP_DIAGNOSTIC_CODES = Object.freeze({
  ...gripContracts.GRIP_DIAGNOSTIC_CODES,
  NON_LITERAL_MESSAGE: gripContracts.GRIP_DIAGNOSTIC_CODES.NON_LITERAL_PUBLISH_MESSAGE
});

module.exports = {
  buildGripLoweringPlan,
  gripLoweringBuilder,
  GRIP_DIAGNOSTIC_CODES: gripContracts.GRIP_DIAGNOSTIC_CODES
};
