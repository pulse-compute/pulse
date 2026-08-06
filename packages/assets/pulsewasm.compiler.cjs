'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const phaseName = 'assets-lowering-plan';
const sidecarPhaseName = 'assets-compiled-wasm-sidecar-plan';
const compileLinkPhaseName = 'assets-sidecar-compile-link-proof';

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


function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../wasm/packages/contracts/src/assets/contracts.js');
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

const assetsContracts = loadAssetsContracts();

function loadCanonicalRuntimeContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return require('../../wasm/packages/contracts/src/handler/canonical-runtime.js');
    }
    throw error;
  }
}

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
      code: 'PULSEWASM_ASSETS_TYPESCRIPT_REQUIRED',
      message: 'Assets lowering plan extraction requires the TypeScript parser.',
      hint: 'Call buildAssetsLoweringPlan from the compiler orchestrator, or pass { typescript } explicitly.',
      loc: { file: '<assets-lowering-plan>' }
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

function nodeText(sourceFile, node) {
  return node ? node.getText(sourceFile).trim() : '<unknown>';
}

function locFor(sourceFile, node) {
  return node ? sourceLoc(sourceFile, node) : { file: sourceFile ? sourceFile.fileName : '<assets-lowering-plan>' };
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

function assetProtocolDiagnostic(sourceFile, payloadMode, severity, message, hint) {
  const entry = assetsContracts.assetsPayloadMode(payloadMode);
  return normalizeDiagnostic({
    phase: phaseName,
    severity,
    code: entry && entry.diagnosticCode ? entry.diagnosticCode : assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED,
    message,
    hint,
    details: {
      payloadMode,
      status: entry ? entry.status : 'unknown',
      hostSurfaceStatus: entry ? entry.hostSurfaceStatus : undefined
    },
    loc: { file: sourceFile ? sourceFile.fileName : '<assets-lowering-plan>' }
  });
}

function diagnosticHasError(diagnostics) {
  return (diagnostics || []).some((entry) => (entry.severity || 'error') === 'error');
}

function firstPropertyInitializer(ts, objectExpression, names) {
  if (!objectExpression || !ts.isObjectLiteralExpression(objectExpression)) return undefined;
  const wanted = new Set(names);
  for (const property of objectExpression.properties || []) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
    if (wanted.has(key)) return property.initializer;
  }
  return undefined;
}

function booleanPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  const unwrapped = unwrapExpression(ts, initializer);
  if (!unwrapped) return undefined;
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function numericPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  const unwrapped = unwrapExpression(ts, initializer);
  if (!unwrapped) return undefined;
  if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
  return undefined;
}

function stringPropertyValue(ts, objectExpression, names) {
  const initializer = firstPropertyInitializer(ts, objectExpression, names);
  if (!initializer) return undefined;
  return literalText(ts, initializer);
}

function collectFacadeBindings(ts, sourceFile, manifest) {
  const bindings = {
    imports: [],
    namespaceLocals: new Map(),
    lookupLocals: new Map(),
    respondLocals: new Map()
  };
  const lowerableSubpath = manifest.lowerableSubpath;
  const compatibilitySubpaths = manifest.publicApi && Array.isArray(manifest.publicApi.compatibilitySubpaths)
    ? manifest.publicApi.compatibilitySubpaths.map(String)
    : [];
  const acceptedSubpaths = new Set([lowerableSubpath, ...compatibilitySubpaths]);
  const facadeNamespace = manifest.facade && manifest.facade.namespace ? manifest.facade.namespace : 'assets';

  function rememberImport(record) {
    bindings.imports.push(record);
    if (record.kind === 'namespace-object') bindings.namespaceLocals.set(record.local, record);
    if (record.kind === 'named-lookup') bindings.lookupLocals.set(record.local, record);
    if (record.kind === 'named-respond') bindings.respondLocals.set(record.local, record);
  }

  for (const statement of sourceFile.statements || []) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!isStringLiteralLike(ts, specifier) || !acceptedSubpaths.has(specifier.text)) continue;
    const importClause = statement.importClause;
    if (!importClause) continue;

    if (importClause.name) {
      rememberImport({
        kind: 'namespace-object',
        importStyle: 'default',
        imported: 'default',
        local: importClause.name.text,
        module: specifier.text,
        loc: locFor(sourceFile, importClause.name)
      });
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings) continue;

    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements || []) {
        const imported = element.propertyName ? element.propertyName.text : element.name.text;
        const local = element.name.text;
        if (imported === facadeNamespace) {
          rememberImport({ kind: 'namespace-object', importStyle: 'named', imported, local, module: specifier.text, loc: locFor(sourceFile, element) });
        } else if (imported === 'lookup') {
          rememberImport({ kind: 'named-lookup', importStyle: 'named', imported, local, module: specifier.text, loc: locFor(sourceFile, element) });
        } else if (imported === 'respond') {
          rememberImport({ kind: 'named-respond', importStyle: 'named', imported, local, module: specifier.text, loc: locFor(sourceFile, element) });
        }
      }
    }
  }

  return bindings;
}

function classifyAssetCall(ts, sourceFile, call, bindings) {
  const expression = unwrapExpression(ts, call.expression);
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = unwrapExpression(ts, expression.expression);
    const member = expression.name.text;
    if (ts.isIdentifier(receiver) && bindings.namespaceLocals.has(receiver.text) && (member === 'lookup' || member === 'respond')) {
      return {
        kind: member,
        callStyle: 'namespace',
        symbol: `${receiver.text}.${member}`,
        local: receiver.text,
        imported: member,
        import: bindings.namespaceLocals.get(receiver.text),
        loc: locFor(sourceFile, expression)
      };
    }
  }

  if (ts.isIdentifier(expression)) {
    if (bindings.lookupLocals.has(expression.text)) {
      return {
        kind: 'lookup',
        callStyle: 'named',
        symbol: expression.text,
        local: expression.text,
        imported: 'lookup',
        import: bindings.lookupLocals.get(expression.text),
        loc: locFor(sourceFile, expression)
      };
    }
    if (bindings.respondLocals.has(expression.text)) {
      return {
        kind: 'respond',
        callStyle: 'named',
        symbol: expression.text,
        local: expression.text,
        imported: 'respond',
        import: bindings.respondLocals.get(expression.text),
        loc: locFor(sourceFile, expression)
      };
    }
  }

  return undefined;
}

function assignedHandleName(ts, call) {
  let current = call;
  let parent = current.parent;
  if (parent && ts.isAwaitExpression(parent)) { current = parent; parent = current.parent; }
  if (!parent) return undefined;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isBinaryExpression(parent) && parent.right === current && parent.operatorToken && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(parent.left)) return parent.left.text;
  return undefined;
}

function enclosingHandlerName(ts, node) {
  let current = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name && ts.isIdentifier(current.name)) return current.name.text;
    if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && current.parent) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    }
    if (ts.isMethodDeclaration(current) && current.name && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return undefined;
}

function buildRoutesByHandler(routePlan) {
  const routes = Array.isArray(routePlan && routePlan.routes) ? routePlan.routes : [];
  const byHandler = new Map();
  for (const route of routes) {
    const handlerName = route.handlerName || route.handler;
    if (!handlerName) continue;
    if (!byHandler.has(handlerName)) byHandler.set(handlerName, []);
    byHandler.get(handlerName).push({
      route: `${String(route.method || 'ANY').toUpperCase()} ${route.path || '/'}`,
      method: String(route.method || 'ANY').toUpperCase(),
      path: route.path || '/',
      handlerName
    });
  }
  return byHandler;
}

function applyRouteMethodAlignment(sourceFile, entry, handlerName, routesByHandler, diagnostics) {
  const lookup = entry && entry.lookup;
  const assetMethod = lookup && lookup.method ? String(lookup.method).toUpperCase() : 'GET';
  const routes = handlerName && routesByHandler ? (routesByHandler.get(handlerName) || []) : [];
  const alignment = {
    status: routes.length === 0 ? 'not-route-bound' : 'aligned',
    handler: handlerName,
    assetMethod,
    routes
  };
  if (routes.length > 0) {
    const routeMethods = Array.from(new Set(routes.map((route) => route.method)));
    alignment.routeMethods = routeMethods;
    if (!routeMethods.includes(assetMethod)) {
      alignment.status = 'mismatch';
      diagnostics.push(makeDiagnostic(
        sourceFile,
        lookup && lookup.loc && lookup.loc.start ? undefined : undefined,
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.ROUTE_METHOD_MISMATCH,
        `assets.lookup method ${JSON.stringify(assetMethod)} does not match route method ${routeMethods.map((method) => JSON.stringify(method)).join(' or ')} for handler ${JSON.stringify(handlerName)}.`,
        'Align the router method and assets.lookup method, for example router.head("/metadata.txt", serveMetadata) with assets.lookup(..., { method: "HEAD" }).',
        'error',
        { handler: handlerName, assetMethod, routeMethods, routes }
      ));
      const last = diagnostics[diagnostics.length - 1];
      if (lookup && lookup.loc) last.loc = lookup.loc;
    }
  }
  entry.routeAlignment = alignment;
  return alignment;
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
  if (parent && ts.isAwaitExpression(parent)) { current = parent; parent = current.parent; }
  if (parent && ts.isPropertyAssignment(parent) && parent.initializer === current) {
    const object = parent.parent;
    const invocation = object && object.parent;
    if (object && ts.isObjectLiteralExpression(object) && invocation && ts.isCallExpression(invocation)) return 'statement';
  }
  if (parent && ts.isExpressionStatement(parent)) return 'statement';
  if (parent && ts.isReturnStatement(parent)) return 'return';
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === current) return 'variable';
  return 'unsupported';
}

function canonicalLookupEffect(ts, sourceFile, call, entry) {
  return Object.freeze({
    version: canonicalRuntimeContracts.CANONICAL_PACKAGE_EFFECT_VERSION,
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    package: '@pulse-compute/assets',
    import: '@pulse-compute/assets',
    kind: 'assets.lookup',
    providerKind: 'assets',
    operation: 'lookup',
    capability: 'assets.lookup',
    result: 'opaque-response',
    placement: placementForCall(ts, call),
    range: rangeFor(sourceFile, call),
    resource: Object.freeze({ kind: 'literal', value: `${entry.lookup.store || ''}:${entry.lookup.key || ''}` }),
    payload: Object.freeze({
      store: entry.lookup.store,
      key: entry.lookup.key,
      method: entry.lookup.method,
      payloadMode: entry.lookup.payloadMode,
      ...(entry.lookup.passThroughOn404 === undefined ? {} : { passThroughOn404: entry.lookup.passThroughOn404 }),
      ...(entry.lookup.cacheControl === undefined ? {} : { cacheControl: entry.lookup.cacheControl })
    }),
    loc: locFor(sourceFile, call)
  });
}

function parseLookupOptions(ts, sourceFile, call, diagnostics, argumentOffset = 0) {
  const optionIndex = argumentOffset + 2;
  const optionArg = call.arguments && call.arguments[optionIndex] ? unwrapExpression(ts, call.arguments[optionIndex]) : undefined;
  const options = {
    method: 'GET',
    passThroughOn404: undefined,
    cacheControl: undefined,
    payloadMode: 'text-response-body'
  };

  if (!optionArg) return options;
  if (!ts.isObjectLiteralExpression(optionArg)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      optionArg,
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NON_LITERAL_LOOKUP,
      'assets.lookup options must be a static object literal in the first lowering plan.',
      'Use literal store/key arguments and a literal options object; move dynamic asset selection to a later provider/runtime pass.',
      'error',
      { expression: nodeText(sourceFile, optionArg) }
    ));
    return options;
  }

  const methodInitializer = firstPropertyInitializer(ts, optionArg, ['method']);
  if (methodInitializer) {
    const method = literalText(ts, methodInitializer);
    if (!method) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        methodInitializer,
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD,
        'assets.lookup method must be a static GET or HEAD literal.',
        'Use { method: "GET" } or { method: "HEAD" }; dynamic methods are not lowerable yet.',
        'error',
        { expression: nodeText(sourceFile, methodInitializer) }
      ));
    } else if (!assetsContracts.ASSETS_ALLOWED_METHODS.includes(method)) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        methodInitializer,
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD,
        `assets.lookup method ${JSON.stringify(method)} is not supported by the assets response policy.`,
        `Use one of: ${assetsContracts.ASSETS_ALLOWED_METHODS.join(', ')}.`,
        'error',
        { method, allowedMethods: assetsContracts.ASSETS_ALLOWED_METHODS }
      ));
      options.method = method;
    } else {
      options.method = method;
    }
  }

  const passThroughOn404 = booleanPropertyValue(ts, optionArg, ['passThroughOn404']);
  if (passThroughOn404 !== undefined) options.passThroughOn404 = passThroughOn404;
  const cacheControl = stringPropertyValue(ts, optionArg, ['cacheControl']);
  if (cacheControl !== undefined) options.cacheControl = cacheControl;

  const payloadMode = stringPropertyValue(ts, optionArg, ['payloadMode', 'bodyKind', 'bodyMode']);
  if (payloadMode) {
    options.payloadMode = payloadMode;
    const mode = assetsContracts.assetsPayloadMode(payloadMode);
    if (!mode) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        firstPropertyInitializer(ts, optionArg, ['payloadMode', 'bodyKind', 'bodyMode']),
        'PULSEWASM_ASSETS_PAYLOAD_MODE_UNSUPPORTED',
        `assets.lookup payload mode ${JSON.stringify(payloadMode)} is not an assets payload mode.`,
        'Use the payload modes classified by @pulse-compute/wasm-contracts/assets/contracts.',
        'error',
        { payloadMode }
      ));
    } else if (mode.status === 'reserved-with-diagnostic') {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        firstPropertyInitializer(ts, optionArg, ['payloadMode', 'bodyKind', 'bodyMode']),
        mode.diagnosticCode || assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED,
        `assets.lookup payload mode ${JSON.stringify(payloadMode)} is reserved for a later binary/body ABI pass.`,
        'Serve this asset through text/stream proof paths for now, or wait for the provider binary-body pass.',
        'error',
        { payloadMode, status: mode.status }
      ));
    } else if (mode.status === 'unsupported') {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        firstPropertyInitializer(ts, optionArg, ['payloadMode', 'bodyKind', 'bodyMode']),
        'PULSEWASM_ASSETS_PAYLOAD_MODE_UNSUPPORTED',
        `assets.lookup payload mode ${JSON.stringify(payloadMode)} is unsupported for assets lowering.`,
        'Assets JSON files should be served as text or stream payloads with headers, not through JSON result helpers.',
        'error',
        { payloadMode, status: mode.status }
      ));
    } else if (mode.status === 'lowering-plan-only') {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        firstPropertyInitializer(ts, optionArg, ['payloadMode', 'bodyKind', 'bodyMode']),
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED,
        `assets.lookup payload mode ${JSON.stringify(payloadMode)} is present in the plan but not provider-wired yet.`,
        'Provider proofs must consume this planned stream response path before it becomes implemented for assets.',
        'warning',
        { payloadMode, status: mode.status, hostSurfaceStatus: mode.hostSurfaceStatus }
      ));
    }
  }

  return options;
}

function parseResponseOptions(ts, sourceFile, call, diagnostics) {
  const optionArg = call.arguments && call.arguments[1] ? unwrapExpression(ts, call.arguments[1]) : undefined;
  const options = {};
  if (!optionArg) return options;
  if (!ts.isObjectLiteralExpression(optionArg)) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      optionArg,
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.RESPOND_REQUIRES_LOOKUP,
      'assets.respond options must be a static object literal in the first lowering plan.',
      'Use literal status/header metadata for now; provider-specific dynamic response behavior comes later.',
      'error',
      { expression: nodeText(sourceFile, optionArg) }
    ));
    return options;
  }
  const status = numericPropertyValue(ts, optionArg, ['status']);
  if (status !== undefined) options.status = status;
  return options;
}

function makeLookupEntry(ts, sourceFile, call, classified, diagnostics, id, manifest, routeAlignmentInputs) {
  const argumentOffset = classified.import && classified.import.module === '@pulse-compute/assets' ? 1 : 0;
  const store = literalText(ts, call.arguments && call.arguments[argumentOffset]);
  const key = literalText(ts, call.arguments && call.arguments[argumentOffset + 1]);
  const handle = assignedHandleName(ts, call);
  const details = {
    expression: nodeText(sourceFile, call),
    arguments: Array.from(call.arguments || []).map((arg) => nodeText(sourceFile, arg))
  };

  if (!store || !key) {
    diagnostics.push(makeDiagnostic(
      sourceFile,
      call,
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NON_LITERAL_LOOKUP,
      'assets.lookup requires static string literal store and key arguments in the first lowering plan.',
      'Use assets.lookup("public", "/app.js") or a named import equivalent. Dynamic keys are reserved for a later pass.',
      'error',
      details
    ));
  }

  const lookupOptions = parseLookupOptions(ts, sourceFile, call, diagnostics, argumentOffset);
  const payloadMode = assetsContracts.assetsPayloadMode(lookupOptions.payloadMode) ? lookupOptions.payloadMode : 'text-response-body';
  const handlerName = enclosingHandlerName(ts, call);

  const entry = {
    id: `asset-${id}`,
    status: store && key ? 'planned' : 'unsupported',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    npmPackage: manifest.npmPackage,
    lowerableSubpath: manifest.lowerableSubpath,
    source: stableFileName(sourceFile.fileName, undefined),
    import: {
      style: classified.callStyle,
      local: classified.local,
      symbol: classified.symbol,
      module: manifest.lowerableSubpath
    },
    lookup: {
      call: classified.symbol,
      store,
      key,
      method: lookupOptions.method,
      handle: handle || undefined,
      payloadMode,
      passThroughOn404: lookupOptions.passThroughOn404,
      cacheControl: lookupOptions.cacheControl,
      loc: locFor(sourceFile, call)
    },
    handler: handlerName ? { name: handlerName } : undefined,
    response: undefined,
    hostCapabilities: ['assets', 'body', 'headers', 'result'],
    provider: {
      initialTarget: 'node',
      targets: assetsContracts.ASSETS_INITIAL_PROVIDER_TARGETS.slice(),
      status: 'deferred-to-provider-proofs'
    }
  };

  entry.range = rangeFor(sourceFile, call);
  entry.placement = placementForCall(ts, call);
  entry.canonicalEffect = canonicalLookupEffect(ts, sourceFile, call, entry);

  if (routeAlignmentInputs && routeAlignmentInputs.routeMetadataAvailable && routeAlignmentInputs.routesByHandler) {
    applyRouteMethodAlignment(sourceFile, entry, handlerName, routeAlignmentInputs.routesByHandler, diagnostics);
  }

  return entry;
}

function makeResponsePlan(ts, sourceFile, call, classified, lookupEntry, diagnostics) {
  const options = parseResponseOptions(ts, sourceFile, call, diagnostics);
  const payloadMode = lookupEntry.lookup.payloadMode || 'text-response-body';
  const mode = assetsContracts.assetsPayloadMode(payloadMode) || assetsContracts.assetsPayloadMode('text-response-body');
  return {
    call: classified.symbol,
    handle: lookupEntry.lookup.handle,
    lookupId: lookupEntry.id,
    status: options.status,
    payloadMode,
    payloadStatus: mode ? mode.status : 'unsupported',
    headerMode: 'header-pass-through',
    statusMode: 'status-result-pass-through',
    notFoundMode: '404-pass-through',
    loc: locFor(sourceFile, call)
  };
}

function findAssetsManifest(inputs, manifestRecords) {
  if (inputs.manifest) return inputs.manifest;
  if (inputs.assetsManifest) return inputs.assetsManifest;
  const direct = (manifestRecords || []).find((record) => record.manifest && record.manifest.contractId === assetsContracts.ASSETS_CONTRACT_ID);
  if (direct) return direct.manifest;
  try {
    return require('./pulsewasm.manifest.cjs');
  } catch (_error) {
    return undefined;
  }
}

function findAssetsContract(inputs, manifest) {
  const contracts = Array.isArray(inputs.libraryContracts) && inputs.libraryContracts.length > 0
    ? inputs.libraryContracts
    : [];
  const found = contracts.find((contract) => contract.package === assetsContracts.ASSETS_CONTRACT_ID);
  if (found) return found;
  if (!manifest) return undefined;
  return {
    package: assetsContracts.ASSETS_CONTRACT_ID,
    npmPackage: manifest.npmPackage,
    lowerableSubpath: manifest.lowerableSubpath,
    facade: clone(manifest.facade || {}),
    publicApi: clone(manifest.publicApi || {}),
    compiler: clone(manifest.compiler || {}),
    assets: assetsContracts.assetsProtocolExtension().assets,
    policy: clone(manifest.policy || {})
  };
}


function buildUnsupportedList(diagnostics) {
  return (diagnostics || [])
    .filter((entry) => (entry.severity || 'error') === 'error')
    .map((entry) => ({
      code: entry.code,
      message: entry.message,
      hint: entry.hint,
      loc: entry.loc,
      details: entry.details
    }));
}

function buildPayloadModes(sourceFile) {
  const classification = assetsContracts.assetsPayloadModeClassification();
  const diagnostics = [
    assetProtocolDiagnostic(
      sourceFile,
      'binary-buffer',
      'info',
      'Assets binary body/buffer responses are reserved with a planning diagnostic.',
      'The current lowering stage validates and plans only; provider proofs must not claim binary/static-file completion yet.'
    ),
    assetProtocolDiagnostic(
      sourceFile,
      'stream-pass-through-response',
      'info',
      'assets stream pass-through responses are represented in the plan but not provider-wired yet.',
      'The host RESULT_STREAM surface exists, but provider tests must prove consumption before this becomes supported.'
    )
  ];

  return {
    payloadModes: {
      classification,
      supportedBodyKinds: clone(assetsContracts.ASSETS_SUPPORTED_BODY_KINDS),
      loweringPlanOnlyBodyKinds: clone(assetsContracts.ASSETS_LOWERING_PLAN_ONLY_BODY_KINDS),
      reservedBodyKinds: clone(assetsContracts.ASSETS_RESERVED_BODY_KINDS),
      unsupportedBodyKinds: clone(assetsContracts.ASSETS_UNSUPPORTED_BODY_KINDS),
      responsePolicy: clone(assetsContracts.ASSETS_RESPONSE_POLICY),
      stream: {
        mode: classification.streamPassThroughResponse.mode,
        status: classification.streamPassThroughResponse.status,
        hostSurfaceStatus: classification.streamPassThroughResponse.hostSurfaceStatus,
        providerWired: false,
        diagnosticCode: assetsContracts.ASSETS_DIAGNOSTIC_CODES.STREAM_PROVIDER_NOT_WIRED
      },
      binary: {
        mode: classification.binaryBodyBufferResponse.mode,
        status: classification.binaryBodyBufferResponse.status,
        providerWired: false,
        diagnosticCode: assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED
      }
    },
    diagnostics
  };
}

function buildAssetsLoweringPlan(inputs = {}) {
  const ts = loadTypeScript(inputs);
  const sourceFile = inputs.sourceFile || (inputs.kind === ts.SyntaxKind.SourceFile ? inputs : undefined);
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const entries = [];
  const lookupEntriesByHandle = new Map();
  const lookupEntriesByNode = new Map();
  const resultAdapters = [];
  const routeMetadataAvailable = Boolean(inputs.routePlan && Array.isArray(inputs.routePlan.routes));
  const routesByHandler = routeMetadataAvailable ? buildRoutesByHandler(inputs.routePlan) : new Map();

  const manifestRecords = Array.isArray(inputs.manifestRecords) ? inputs.manifestRecords : [];
  const manifest = findAssetsManifest(inputs, manifestRecords);
  const assetsContract = findAssetsContract({ ...inputs, cwd }, manifest);

  if (!sourceFile) {
    diagnostics.push(normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSEWASM_ASSETS_SOURCE_REQUIRED',
      message: 'Assets lowering plan generation requires a TypeScript SourceFile.',
      hint: 'Pass the compiler sourceFile into the library-kit assets lowering builder.',
      loc: { file: '<assets-lowering-plan>' }
    }));
  }

  if (!manifest) {
    diagnostics.push(normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSEWASM_ASSETS_MANIFEST_NOT_FOUND',
      message: 'Could not discover the package-owned @pulse-compute/assets PulseWasm manifest.',
      hint: 'Ensure packages/assets/package.json advertises pulsewasm.manifest and the workspace root is passed to library-kit.',
      loc: { file: sourceFile ? sourceFile.fileName : '<assets-lowering-plan>' }
    }));
  }

  if (!assetsContract) {
    diagnostics.push(normalizeDiagnostic({
      phase: phaseName,
      severity: 'error',
      code: 'PULSEWASM_ASSETS_LIBRARY_CONTRACT_NOT_FOUND',
      message: 'Could not resolve the pulse.assets library contract from package-owned manifests.',
      hint: 'Run the handler-library-contracts builder or pass libraryContracts containing pulse.assets.',
      loc: { file: sourceFile ? sourceFile.fileName : '<assets-lowering-plan>' }
    }));
  }

  const payload = buildPayloadModes(sourceFile);
  diagnostics.push(...payload.diagnostics);
  diagnostics.push(normalizeDiagnostic({
    phase: phaseName,
    severity: 'info',
    code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.RUNTIME_EXECUTION_UNSUPPORTED,
    message: 'The normal @pulse-compute/assets package root executes directly in JavaScript and is recognized by its package-owned native compiler builder.',
    hint: 'JavaScript executes the package runtime; native compilation consumes this package-owned plan without changing application imports.',
    details: {
      contractId: assetsContracts.ASSETS_CONTRACT_ID,
      providerBehaviorImplemented: true
    },
    loc: { file: sourceFile ? sourceFile.fileName : '<assets-lowering-plan>' }
  }));

  let bindings = { imports: [], namespaceLocals: new Map(), lookupLocals: new Map(), respondLocals: new Map() };
  if (sourceFile && manifest) bindings = collectFacadeBindings(ts, sourceFile, manifest);

  function nextEntryId() {
    return entries.length;
  }

  function ensureLookupEntry(call, classified) {
    if (lookupEntriesByNode.has(call)) return lookupEntriesByNode.get(call);
    const entry = makeLookupEntry(ts, sourceFile, call, classified, diagnostics, nextEntryId(), manifest, { routesByHandler, routeMetadataAvailable });
    entries.push(entry);
    lookupEntriesByNode.set(call, entry);
    if (entry.lookup.handle) lookupEntriesByHandle.set(entry.lookup.handle, entry);
    return entry;
  }

  function handleRespondCall(call, classified) {
    const arg = call.arguments && call.arguments[0] ? unwrapExpression(ts, call.arguments[0]) : undefined;
    let lookupEntry;
    if (arg && ts.isIdentifier(arg)) {
      lookupEntry = lookupEntriesByHandle.get(arg.text);
      if (!lookupEntry) {
        diagnostics.push(makeDiagnostic(
          sourceFile,
          arg,
          assetsContracts.ASSETS_DIAGNOSTIC_CODES.RESPOND_REQUIRES_LOOKUP,
          `assets.respond(${arg.text}) does not reference a statically lowerable assets.lookup handle.`,
          'Assign assets.lookup("store", "/key") to a const and pass that handle to assets.respond(handle).',
          'error',
          { handle: arg.text, expression: nodeText(sourceFile, call) }
        ));
        return;
      }
    } else if (arg && ts.isCallExpression(arg)) {
      const nested = classifyAssetCall(ts, sourceFile, arg, bindings);
      if (nested && nested.kind === 'lookup') {
        lookupEntry = ensureLookupEntry(arg, nested);
      }
    }

    if (!lookupEntry) {
      diagnostics.push(makeDiagnostic(
        sourceFile,
        call,
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.RESPOND_REQUIRES_LOOKUP,
        'assets.respond requires a statically lowerable assets.lookup handle.',
        'Use const found = assets.lookup("public", "/app.js"); return assets.respond(found).',
        'error',
        { expression: nodeText(sourceFile, call) }
      ));
      return;
    }

    lookupEntry.response = makeResponsePlan(ts, sourceFile, call, classified, lookupEntry, diagnostics);
    lookupEntry.status = lookupEntry.status === 'unsupported' ? 'unsupported' : 'planned';
    resultAdapters.push(Object.freeze({
      version: 'pulse.package-result-adapter.v1',
      contractId: assetsContracts.ASSETS_CONTRACT_ID,
      package: '@pulse-compute/assets',
      import: '@pulse-compute/assets',
      kind: 'assets.respond',
      operation: 'respond',
      range: rangeFor(sourceFile, call),
      input: arg && ts.isIdentifier(arg) ? Object.freeze({ kind: 'identifier', name: arg.text }) : Object.freeze({ kind: 'nested-effect' }),
      loc: locFor(sourceFile, call)
    }));
  }

  if (sourceFile && manifest) {
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const classified = classifyAssetCall(ts, sourceFile, node, bindings);
        if (classified && classified.kind === 'lookup') {
          ensureLookupEntry(node, classified);
        } else if (classified && classified.kind === 'respond') {
          handleRespondCall(node, classified);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const unsupported = buildUnsupportedList(diagnostics);
  const plannedResponses = entries.filter((entry) => entry.response).length;
  const routeAlignments = entries.map((entry) => entry.routeAlignment).filter(Boolean);
  const routeAlignmentMismatches = routeAlignments.filter((alignment) => alignment.status === 'mismatch').length;
  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_LOWERING_PLAN_VERSION,
    generatedBy,
    phase: phaseName,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    npmPackage: manifest ? manifest.npmPackage : undefined,
    lowerableSubpath: manifest ? manifest.lowerableSubpath : undefined,
    facade: manifest ? clone(manifest.facade) : undefined,
    source: sourceFile ? sourceFile.fileName : undefined,
    validateAndPlanOnly: true,
    providerBehaviorImplemented: false,
    entries,
    canonicalEffects: entries.map((entry) => entry.canonicalEffect),
    resultAdapters,
    unsupported,
    payloadModes: payload.payloadModes,
    authoringAlignment: {
      routeMethodConsistency: routeAlignmentMismatches === 0,
      entriesChecked: routeAlignments.length,
      matchedEntries: routeAlignments.filter((alignment) => alignment.status === 'aligned').length,
      mismatches: routeAlignmentMismatches,
      diagnosticCode: assetsContracts.ASSETS_DIAGNOSTIC_CODES.ROUTE_METHOD_MISMATCH,
      policy: 'asset lookup method must match the owning route method when route metadata is available'
    },
    policy: {
      packageIdentityOwnedByManifest: true,
      compilerOwnsPackageMapping: false,
      builderOwner: manifest && manifest.compiler && manifest.compiler.builderOwner ? manifest.compiler.builderOwner : '@pulse-compute/assets',
      compilerBuilder: manifest && manifest.compiler ? clone(manifest.compiler) : undefined,
      directRuntimeExecution: {
        status: 'implemented',
        entry: './dist/index.js'
      },
      nodeProviderProof: 'pass-27',
      fastlyProviderProof: 'pass-28'
    },
    summary: {
      imports: bindings.imports.length,
      lookups: entries.length,
      responses: plannedResponses,
      entries: entries.length,
      unsupported: unsupported.length,
      diagnostics: diagnostics.length,
      errorDiagnostics: errorDiagnostics.length,
      payloadModes: Object.keys(payload.payloadModes.classification || {}).length,
      binaryStatus: payload.payloadModes.binary.status,
      streamStatus: payload.payloadModes.stream.status,
      routeAlignmentChecked: routeAlignments.length,
      routeMethodMismatches: routeAlignmentMismatches,
      routeMethodConsistency: routeAlignmentMismatches === 0
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics,
    unsupported,
    entries: artifact.entries,
    canonicalEffects: artifact.canonicalEffects,
    resultAdapters: artifact.resultAdapters,
    payloadModes: artifact.payloadModes,
    hasErrors: diagnosticHasError(diagnostics)
  };
}


function resolveAssetsPackageDir(inputs = {}) {
  const base = inputs.cwd || process.cwd();
  if (inputs.packageDir) return path.isAbsolute(inputs.packageDir) ? path.resolve(inputs.packageDir) : path.resolve(base, inputs.packageDir);
  if (inputs.manifestRecord && inputs.manifestRecord.packageDir) {
    return path.isAbsolute(inputs.manifestRecord.packageDir) ? path.resolve(inputs.manifestRecord.packageDir) : path.resolve(base, inputs.manifestRecord.packageDir);
  }
  return __dirname;
}

function declaredSidecarSymbols(manifest) {
  const wasm = manifest && manifest.modes && manifest.modes.wasm ? manifest.modes.wasm : {};
  return (wasm.lowerings || []).map((lowering) => ({
    tsSymbol: lowering.tsSymbol,
    asSymbol: lowering.asSymbol,
    callShape: lowering.callShape,
    hostCapabilities: clone(lowering.hostCapabilities || [])
  }));
}

function sidecarExportPresent(source, symbol) {
  const pattern = new RegExp(`export\\s+function\\s+${symbol}\\s*\\(`);
  return pattern.test(source);
}

function assetEntriesForSidecar(inputs, manifest) {
  if (inputs.assetsLoweringPlan) {
    const artifact = inputs.assetsLoweringPlan.artifact || inputs.assetsLoweringPlan;
    return Array.isArray(artifact.entries) ? artifact.entries : [];
  }
  if (inputs.sourceFile) {
    const plan = buildAssetsLoweringPlan({
      ...inputs,
      manifest,
      assetsManifest: manifest,
      generatedBy: inputs.generatedBy || PACKAGE_VERSION
    });
    return Array.isArray(plan.artifact.entries) ? plan.artifact.entries : [];
  }
  return [];
}

function buildAssetsCompiledWasmSidecarPlan(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const manifestRecords = Array.isArray(inputs.manifestRecords) ? inputs.manifestRecords : [];
  const manifest = findAssetsManifest(inputs, manifestRecords);
  const manifestRecord = manifestRecords.find((record) => record && record.manifest && record.manifest.contractId === assetsContracts.ASSETS_CONTRACT_ID);
  const packageDir = resolveAssetsPackageDir(inputs);
  const wasm = manifest && manifest.modes && manifest.modes.wasm ? manifest.modes.wasm : {};
  const sidecarRef = wasm.sidecar;
  const sidecarFile = sidecarRef ? path.resolve(packageDir, sidecarRef) : undefined;
  const sidecarSource = sidecarFile && fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile, 'utf8') : '';
  const symbols = declaredSidecarSymbols(manifest);
  const missingSymbols = symbols.filter((symbol) => !symbol.asSymbol || !sidecarExportPresent(sidecarSource, symbol.asSymbol));
  const entries = assetEntriesForSidecar(inputs, manifest);
  const diagnostics = [];

  if (!manifest) {
    diagnostics.push(normalizeDiagnostic({
      phase: sidecarPhaseName,
      severity: 'error',
      code: 'PULSEWASM_ASSETS_MANIFEST_NOT_FOUND',
      message: 'Could not discover the package-owned @pulse-compute/assets PulseWasm manifest for sidecar planning.',
      hint: 'Pass the package-owned manifest or ensure package.json advertises pulsewasm.manifest.',
      loc: { file: '<assets-compiled-wasm-sidecar-plan>' }
    }));
  }

  if (!sidecarRef || !sidecarFile || !fs.existsSync(sidecarFile)) {
    diagnostics.push(normalizeDiagnostic({
      phase: sidecarPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_FILE_MISSING,
      message: 'The assets manifest declares a Wasm sidecar, but the sidecar file was not found.',
      hint: 'Ship packages/assets/as/index.as.ts and include it in the package files list.',
      loc: { file: sidecarRef || '<assets-sidecar>' },
      details: { sidecar: sidecarRef, packageDir: stableFileName(packageDir, cwd) }
    }));
  }

  for (const missing of missingSymbols) {
    diagnostics.push(normalizeDiagnostic({
      phase: sidecarPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_SYMBOL_MISSING,
      message: `The assets sidecar does not export ${missing.asSymbol}.`,
      hint: 'Every modes.wasm.lowerings[].asSymbol must be exported by the package-owned AssemblyScript sidecar.',
      loc: { file: sidecarRef || '<assets-sidecar>' },
      details: missing
    }));
  }

  const sidecarSymbols = symbols.map((symbol) => ({
    ...symbol,
    exported: Boolean(symbol.asSymbol && sidecarExportPresent(sidecarSource, symbol.asSymbol))
  }));

  for (const entry of entries.filter((candidate) => !candidate.response)) {
    diagnostics.push(normalizeDiagnostic({
      phase: sidecarPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED,
      message: 'assets.lookup handles must be consumed by a terminal assets.respond(...) call in the compiled-Wasm sidecar plan.',
      hint: 'Use return assets.respond(found) or return assets.respond(assets.lookup("public", "/app.js")). Arbitrary asset handle values are not materialized in Wasm.',
      loc: entry.lookup && entry.lookup.loc ? entry.lookup.loc : { file: '<assets-compiled-wasm-sidecar-plan>' },
      details: { id: entry.id, store: entry.lookup && entry.lookup.store, key: entry.lookup && entry.lookup.key }
    }));
  }

  const terminalEffects = entries
    .filter((entry) => entry.response)
    .map((entry) => ({
      id: entry.id,
      store: entry.lookup && entry.lookup.store,
      key: entry.lookup && entry.lookup.key,
      method: entry.lookup && entry.lookup.method,
      lookupSymbol: 'pulse_assets_lookup',
      respondSymbol: 'pulse_assets_respond',
      effect: 'terminal-asset-response',
      continuationRequired: false,
      payloadMode: entry.response && entry.response.payloadMode,
      statusMode: entry.response && entry.response.statusMode,
      headerMode: entry.response && entry.response.headerMode
    }));

  const packageOut = manifestRecord ? {
    discoveredFromNodeModules: manifestRecord.source === 'node_modules' || String(manifestRecord.source || '').includes('node_modules'),
    builderLoadedFromNodeModules: manifestRecord.source === 'node_modules' || String(manifestRecord.source || '').includes('node_modules'),
    packageDir: stableFileName(manifestRecord.packageDir || packageDir, cwd),
    manifestFile: stableFileName(manifestRecord.manifestFile, cwd),
    sidecarFile: sidecarFile ? stableFileName(sidecarFile, cwd) : undefined
  } : undefined;

  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_COMPILED_WASM_SIDECAR_PLAN_VERSION,
    generatedBy,
    phase: sidecarPhaseName,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    package: manifest ? manifest.npmPackage : '@pulse-compute/assets',
    lowerableSubpath: manifest ? manifest.lowerableSubpath : '@pulse-compute/assets/pulsewasm',
    sourceAssetsLoweringPlanVersion: inputs.assetsLoweringPlan && (inputs.assetsLoweringPlan.artifact || inputs.assetsLoweringPlan).version,
    sidecar: {
      declared: Boolean(sidecarRef),
      path: sidecarRef,
      file: sidecarFile ? stableFileName(sidecarFile, cwd) : undefined,
      exists: Boolean(sidecarFile && fs.existsSync(sidecarFile)),
      packageDir: stableFileName(packageDir, cwd),
      sourceBytes: sidecarSource.length,
      symbols: sidecarSymbols
    },
    lowerings: sidecarSymbols,
    terminalAssetResponseEffects: terminalEffects,
    runtimeModel: {
      terminalAssetResponseEffectPlanned: true,
      continuationRequired: false,
      providerEffectBoundary: 'assets.respond terminal response request',
      userAuthoredAsync: false,
      promises: false,
      asyncAwait: false,
      asyncify: false
    },
    packageOut,
    compiledWasmReadiness: {
      sidecarDeclared: Boolean(sidecarRef),
      sidecarFileExists: Boolean(sidecarFile && fs.existsSync(sidecarFile)),
      sidecarSymbolsValidated: missingSymbols.length === 0 && sidecarSymbols.length > 0,
      lookupSymbol: 'pulse_assets_lookup',
      respondSymbol: 'pulse_assets_respond',
      nodeLifecycleProof: 'pass-49',
      fastlyParityProof: 'pass-50'
    },
    restrictions: {
      dynamicKeysSupported: false,
      dynamicStoresSupported: false,
      arbitraryAssetHandleUseSupported: false,
      handleEscapeSupported: false,
      binaryBodySupported: false,
      streamBodyCompiledWasmReadiness: 'plan-only',
      uploadsSupported: false,
      mutationApisSupported: false,
      rangeRequestsSupported: false,
      diagnostics: {
        dynamicKey: assetsContracts.ASSETS_DIAGNOSTIC_CODES.DYNAMIC_KEY_UNSUPPORTED,
        handleEscape: assetsContracts.ASSETS_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED,
        binaryBody: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_BINARY_RESERVED,
        streamBody: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_STREAM_PLAN_ONLY,
        unsupportedMethod: assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_METHOD_UNSUPPORTED
      }
    },
    policy: {
      packageOwnsSidecar: true,
      packageOwnsLoweringManifest: true,
      packageOwnsCompilerBuilder: true,
      compilerOrchestratesOnly: true,
      providersOwnRuntimeBehavior: true,
      compiledWasmRuntimeBehaviorImplemented: false,
      directProviderProofsRemainSeparate: true
    },
    summary: {
      sidecarDeclared: Boolean(sidecarRef),
      sidecarFileExists: Boolean(sidecarFile && fs.existsSync(sidecarFile)),
      sidecarSymbolsValidated: missingSymbols.length === 0 && sidecarSymbols.length > 0,
      lowerings: sidecarSymbols.length,
      terminalAssetResponseEffects: terminalEffects.length,
      terminalAssetResponseEffectPlanned: true,
      continuationRequired: false,
      dynamicKeysSupported: false,
      binaryBodySupported: false,
      streamBodyCompiledWasmReadiness: 'plan-only',
      errors: errorDiagnostics.length
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics,
    sidecarFile,
    sidecarSymbols,
    terminalAssetResponseEffects: terminalEffects,
    hasErrors: diagnosticHasError(diagnostics)
  };
}


function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function encodeU32(value) {
  let n = Number(value) >>> 0;
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return out;
}

function encodeString(value) {
  const bytes = Array.from(Buffer.from(String(value), 'utf8'));
  return [...encodeU32(bytes.length), ...bytes];
}

function wasmSection(id, payload) {
  return [id, ...encodeU32(payload.length), ...payload];
}

function wasmVec(items) {
  return [...encodeU32(items.length), ...items.flat()];
}

function instrI32Const(value) {
  return [0x41, ...encodeU32(Number(value))];
}

function instrLocalGet(index) {
  return [0x20, ...encodeU32(Number(index))];
}

function methodCodeForAssetMethod(method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (normalized === 'HEAD') return 2;
  return 1;
}

function methodFromAssetMethodCode(code) {
  return Number(code) === 2 ? 'HEAD' : 'GET';
}

function normalizeAssetKey(key) {
  const text = String(key || '/');
  return text.startsWith('/') ? text : `/${text}`;
}

function makeLinkedAssetsSidecarHarnessWasm(effects = []) {
  const normalizedEffects = effects.map((effect, index) => ({
    index,
    id: effect.id || `asset-${index}`,
    store: String(effect.store || (effect.lookup && effect.lookup.store) || 'public'),
    key: normalizeAssetKey(effect.key || (effect.lookup && effect.lookup.key) || '/'),
    method: String(effect.method || (effect.lookup && effect.lookup.method) || 'GET').toUpperCase()
  }));
  let offset = 16;
  const data = [];
  const layouts = [];
  for (const effect of normalizedEffects) {
    const storeBytes = Buffer.from(effect.store, 'utf8');
    const keyBytes = Buffer.from(effect.key, 'utf8');
    const storePtr = offset;
    data.push({ offset: storePtr, bytes: Array.from(storeBytes) });
    offset += storeBytes.length + 1;
    const keyPtr = offset;
    data.push({ offset: keyPtr, bytes: Array.from(keyBytes) });
    offset += keyBytes.length + 1;
    layouts.push({ ...effect, storePtr, storeLen: storeBytes.length, keyPtr, keyLen: keyBytes.length, methodCode: methodCodeForAssetMethod(effect.method) });
  }

  const typeSection = wasmSection(1, wasmVec([
    [0x60, ...wasmVec([[0x7f], [0x7f], [0x7f], [0x7f], [0x7f], [0x7f]]), ...wasmVec([[0x7f]])],
    [0x60, ...wasmVec([[0x7f], [0x7f]]), ...wasmVec([[0x7f]])],
    [0x60, ...wasmVec([]), ...wasmVec([[0x7f]])]
  ]));
  const importSection = wasmSection(2, wasmVec([
    [...encodeString('pulse_assets_host'), ...encodeString('lookup'), 0x00, ...encodeU32(0)],
    [...encodeString('pulse_assets_host'), ...encodeString('respond'), 0x00, ...encodeU32(1)]
  ]));
  const functionTypes = [encodeU32(0), encodeU32(1)].concat(layouts.map(() => encodeU32(2)));
  const functionSection = wasmSection(3, wasmVec(functionTypes));
  const memorySection = wasmSection(5, wasmVec([[0x00, ...encodeU32(1)]]));
  const exports = [
    [...encodeString('memory'), 0x02, ...encodeU32(0)],
    [...encodeString('pulse_assets_lookup'), 0x00, ...encodeU32(2)],
    [...encodeString('pulse_assets_respond'), 0x00, ...encodeU32(3)]
  ];
  layouts.forEach((layout, index) => {
    exports.push([...encodeString(`pulse_assets_route_${index}`), 0x00, ...encodeU32(4 + index)]);
  });
  const exportSection = wasmSection(7, wasmVec(exports));

  const lookupBodyInstr = [];
  for (let i = 0; i < 6; i += 1) lookupBodyInstr.push(...instrLocalGet(i));
  lookupBodyInstr.push(0x10, ...encodeU32(0), 0x0b);
  const respondBodyInstr = [...instrLocalGet(0), ...instrLocalGet(1), 0x10, ...encodeU32(1), 0x0b];
  const codeBodies = [lookupBodyInstr, respondBodyInstr].map((instructions) => {
    const body = [...wasmVec([]), ...instructions];
    return [...encodeU32(body.length), ...body];
  });

  for (const layout of layouts) {
    const instructions = [
      ...instrI32Const(layout.storePtr),
      ...instrI32Const(layout.storeLen),
      ...instrI32Const(layout.keyPtr),
      ...instrI32Const(layout.keyLen),
      ...instrI32Const(layout.methodCode),
      ...instrI32Const(0),
      0x10, ...encodeU32(2),
      ...instrI32Const(0),
      0x10, ...encodeU32(3),
      0x0b
    ];
    const body = [...wasmVec([]), ...instructions];
    codeBodies.push([...encodeU32(body.length), ...body]);
  }
  const codeSection = wasmSection(10, wasmVec(codeBodies));
  const dataSegments = data.map((segment) => [0x00, ...instrI32Const(segment.offset), 0x0b, ...wasmVec(segment.bytes.map((byte) => [byte]))]);
  const dataSection = wasmSection(11, wasmVec(dataSegments));
  const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...typeSection, ...importSection, ...functionSection, ...memorySection, ...exportSection, ...codeSection, ...dataSection]);
  const module = new WebAssembly.Module(bytes);
  return {
    module,
    bytes,
    effects: layouts,
    imports: WebAssembly.Module.imports(module).map(clone),
    exports: WebAssembly.Module.exports(module).map(clone)
  };
}

function executeLinkedAssetsSidecarHarness(effects = []) {
  const wasm = makeLinkedAssetsSidecarHarnessWasm(effects);
  let instance;
  const decoder = new TextDecoder();
  const lookups = [];
  const responses = [];
  let handleSeq = 1;
  let resultSeq = 1;
  const handles = new Map();
  function memory() { return instance.exports.memory; }
  function readUtf8(ptr, len) {
    if (!ptr || !len) return '';
    return decoder.decode(new Uint8Array(memory().buffer, ptr, len));
  }
  const imports = {
    pulse_assets_host: {
      lookup(storePtr, storeLen, keyPtr, keyLen, methodCode, optionsRef) {
        const handle = handleSeq++;
        const lookup = {
          handle,
          store: readUtf8(storePtr, storeLen),
          key: normalizeAssetKey(readUtf8(keyPtr, keyLen)),
          method: methodFromAssetMethodCode(methodCode),
          methodCode: Number(methodCode),
          optionsRef: Number(optionsRef || 0)
        };
        handles.set(handle, lookup);
        lookups.push(lookup);
        return handle;
      },
      respond(assetHandle, optionsRef) {
        const resultHandle = resultSeq++;
        const lookup = handles.get(Number(assetHandle));
        const response = { resultHandle, assetHandle: Number(assetHandle), optionsRef: Number(optionsRef || 0), lookup };
        responses.push(response);
        return resultHandle;
      }
    }
  };
  instance = new WebAssembly.Instance(wasm.module, imports);
  const routeExports = wasm.exports.filter((entry) => entry.kind === 'function' && /^pulse_assets_route_/.test(entry.name));
  const executions = [];
  for (const route of routeExports) {
    const beforeLookup = lookups.length;
    const beforeResponse = responses.length;
    const resultHandle = instance.exports[route.name]();
    executions.push({
      exportName: route.name,
      resultHandle: Number(resultHandle),
      lookup: lookups[beforeLookup],
      response: responses[beforeResponse]
    });
  }
  return { wasm, imports, instance, lookups, responses, executions };
}

function sidecarHostImportPresent(source, moduleName, importName, localName) {
  const pattern = new RegExp(`@external\\(\\s*[\"']${moduleName}[\"']\\s*,\\s*[\"']${importName}[\"']\\s*\\)\\s*declare\\s+function\\s+${localName}\\s*\\(`, 'm');
  return pattern.test(source);
}

function sidecarExportDelegatesTo(source, exportName, localName) {
  const pattern = new RegExp(`export\\s+function\\s+${exportName}\\s*\\([\\s\\S]*?\\)\\s*:\\s*i32\\s*\\{[\\s\\S]*?return\\s+${localName}\\s*\\(`, 'm');
  return pattern.test(source);
}

function resolveAssemblyScriptPackage(cwd) {
  const searchRoots = [cwd, path.join(cwd, 'wasm'), __dirname].filter(Boolean);
  for (const root of searchRoots) {
    try {
      const packageJson = require.resolve('assemblyscript/package.json', { paths: [root] });
      const packageRoot = path.dirname(packageJson);
      const ascScript = path.join(packageRoot, 'bin', 'asc.js');
      if (fs.existsSync(ascScript)) {
        let version;
        try { version = JSON.parse(fs.readFileSync(packageJson, 'utf8')).version; } catch (_) {}
        return { packageRoot, packageJson, ascScript, version, searchRoot: root };
      }
    } catch (_) {}
  }
  return undefined;
}

function tryCompileAssetsSidecarWithAsc(cwd, sidecarFile) {
  const asc = resolveAssemblyScriptPackage(cwd);
  if (!asc) {
    return {
      available: false,
      status: 'dependency-gated',
      diagnostic: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_ASC_DEPENDENCY_GATED,
      message: 'AssemblyScript compiler dependency was not found in this workspace; strict sidecar compile remains dependency-gated.',
      command: 'corepack pnpm install --frozen-lockfile && corepack pnpm run -s test:assets-sidecar-compile-link'
    };
  }
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-assets-sidecar-asc-'));
  const wasmFile = path.join(stagingDir, 'assets-sidecar.wasm');
  const watFile = path.join(stagingDir, 'assets-sidecar.wat');
  const args = [
    asc.ascScript,
    sidecarFile,
    '--outFile', wasmFile,
    '--textFile', watFile,
    '--runtime', 'stub',
    '--noAssert'
  ];
  const proc = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 12 });
  const ok = proc.status === 0 && fs.existsSync(wasmFile);
  return {
    available: true,
    status: ok ? 'ok' : 'error',
    version: asc.version,
    executable: `node ${stableFileName(asc.ascScript, cwd)}`,
    command: args.slice(1).map((arg) => path.isAbsolute(arg) ? stableFileName(arg, cwd) : arg),
    exitCode: proc.status,
    signal: proc.signal,
    stdout: String(proc.stdout || '').slice(0, 4000),
    stderr: String(proc.stderr || '').slice(0, 8000),
    outputs: {
      wasmBytes: fs.existsSync(wasmFile) ? fs.statSync(wasmFile).size : 0,
      watBytes: fs.existsSync(watFile) ? fs.statSync(watFile).size : 0
    }
  };
}

function buildAssetsSidecarCompileLinkProof(inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const manifestRecords = Array.isArray(inputs.manifestRecords) ? inputs.manifestRecords : [];
  const manifest = findAssetsManifest(inputs, manifestRecords);
  const manifestRecord = manifestRecords.find((record) => record && record.manifest && record.manifest.contractId === assetsContracts.ASSETS_CONTRACT_ID);
  const packageDir = resolveAssetsPackageDir(inputs);
  const wasm = manifest && manifest.modes && manifest.modes.wasm ? manifest.modes.wasm : {};
  const sidecarRef = wasm.sidecar;
  const sidecarFile = sidecarRef ? path.resolve(packageDir, sidecarRef) : undefined;
  const sidecarSource = sidecarFile && fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile, 'utf8') : '';
  const diagnostics = [];

  const hostImports = {
    lookup: sidecarHostImportPresent(sidecarSource, 'pulse_assets_host', 'lookup', '__pulse_assets_host_lookup'),
    respond: sidecarHostImportPresent(sidecarSource, 'pulse_assets_host', 'respond', '__pulse_assets_host_respond')
  };
  const delegations = {
    lookup: sidecarExportDelegatesTo(sidecarSource, 'pulse_assets_lookup', '__pulse_assets_host_lookup'),
    respond: sidecarExportDelegatesTo(sidecarSource, 'pulse_assets_respond', '__pulse_assets_host_respond')
  };

  if (!hostImports.lookup || !hostImports.respond) {
    diagnostics.push(normalizeDiagnostic({
      phase: compileLinkPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_HOST_IMPORT_MISSING,
      message: 'The assets AssemblyScript sidecar must declare explicit host imports for lookup and respond.',
      hint: 'Declare @external("pulse_assets_host", "lookup") and @external("pulse_assets_host", "respond") host functions in packages/assets/as/index.as.ts.',
      loc: { file: sidecarRef || '<assets-sidecar>' },
      details: { hostImports }
    }));
  }
  if (!delegations.lookup || !delegations.respond) {
    diagnostics.push(normalizeDiagnostic({
      phase: compileLinkPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_LINK_SMOKE_FAILED,
      message: 'The assets sidecar exports must delegate to the host imports so the linked module exercises real sidecar symbols.',
      hint: 'pulse_assets_lookup/respond should return the corresponding __pulse_assets_host_* call result.',
      loc: { file: sidecarRef || '<assets-sidecar>' },
      details: { delegations }
    }));
  }

  const sidecarPlan = inputs.assetsCompiledWasmSidecarPlan && (inputs.assetsCompiledWasmSidecarPlan.artifact || inputs.assetsCompiledWasmSidecarPlan);
  const terminalEffects = Array.isArray(sidecarPlan && sidecarPlan.terminalAssetResponseEffects)
    ? sidecarPlan.terminalAssetResponseEffects
    : assetEntriesForSidecar(inputs, manifest).filter((entry) => entry.response).map((entry) => ({
      id: entry.id,
      store: entry.lookup && entry.lookup.store,
      key: entry.lookup && entry.lookup.key,
      method: entry.lookup && entry.lookup.method
    }));

  let linkSmoke;
  try {
    const executed = executeLinkedAssetsSidecarHarness(terminalEffects);
    linkSmoke = {
      status: 'ok',
      wasmBytes: executed.wasm.bytes.length,
      imports: executed.wasm.imports,
      exports: executed.wasm.exports,
      routeExports: executed.wasm.exports.filter((entry) => /^pulse_assets_route_/.test(entry.name)).map((entry) => entry.name),
      executions: executed.executions.map((entry) => ({
        exportName: entry.exportName,
        resultHandle: entry.resultHandle,
        lookup: entry.lookup,
        response: entry.response
      })),
      lookups: executed.lookups.length,
      responses: executed.responses.length
    };
  } catch (error) {
    linkSmoke = { status: 'error', message: error.message };
    diagnostics.push(normalizeDiagnostic({
      phase: compileLinkPhaseName,
      severity: 'error',
      code: assetsContracts.ASSETS_DIAGNOSTIC_CODES.SIDECAR_LINK_SMOKE_FAILED,
      message: `The assets sidecar linked Wasm harness failed: ${error.message}`,
      hint: 'Validate sidecar exports, host import signatures, and terminal effect layout.',
      loc: { file: '<assets-sidecar-link-proof>' }
    }));
  }

  const ascCompile = tryCompileAssetsSidecarWithAsc(cwd, sidecarFile || '');
  if (ascCompile.available && ascCompile.status !== 'ok') {
    diagnostics.push(normalizeDiagnostic({
      phase: compileLinkPhaseName,
      severity: 'error',
      code: 'PULSEWASM_ASSETS_SIDECAR_ASC_COMPILE_FAILED',
      message: 'AssemblyScript was available but failed to compile the package-owned assets sidecar.',
      hint: 'Inspect assets-sidecar-compile-link-proof.json asc.stderr for compiler details.',
      loc: { file: sidecarRef || '<assets-sidecar>' },
      details: { exitCode: ascCompile.exitCode, stderr: ascCompile.stderr }
    }));
  }

  const placeholderRemoved = !/export\s+function\s+pulse_assets_lookup[\s\S]*?\{[\s\S]*?return\s+0\s*;/.test(sidecarSource);
  const routeExports = linkSmoke && Array.isArray(linkSmoke.routeExports) ? linkSmoke.routeExports : [];
  const linkedModuleImportsHost = Boolean(linkSmoke && linkSmoke.imports && linkSmoke.imports.some((entry) => entry.module === 'pulse_assets_host' && entry.name === 'lookup') && linkSmoke.imports.some((entry) => entry.module === 'pulse_assets_host' && entry.name === 'respond'));
  const linkedModuleExportsSidecar = Boolean(linkSmoke && linkSmoke.exports && linkSmoke.exports.some((entry) => entry.name === 'pulse_assets_lookup') && linkSmoke.exports.some((entry) => entry.name === 'pulse_assets_respond'));
  const linkedModuleExecutesRoutes = Boolean(linkSmoke && linkSmoke.status === 'ok' && linkSmoke.executions && linkSmoke.executions.length === terminalEffects.length && terminalEffects.length > 0);
  const errorDiagnostics = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');

  const artifact = normalizeArtifact({
    version: assetsContracts.ASSETS_SIDECAR_COMPILE_LINK_PROOF_VERSION,
    artifact: assetsContracts.ASSETS_SIDECAR_COMPILE_LINK_PROOF_ARTIFACT,
    generatedBy,
    phase: compileLinkPhaseName,
    status: errorDiagnostics.length === 0 ? 'ok' : 'error',
    contractId: assetsContracts.ASSETS_CONTRACT_ID,
    package: manifest ? manifest.npmPackage : '@pulse-compute/assets',
    lowerableSubpath: manifest ? manifest.lowerableSubpath : '@pulse-compute/assets/pulsewasm',
    sourceAssetsCompiledWasmSidecarPlanVersion: sidecarPlan && sidecarPlan.version,
    sidecar: {
      path: sidecarRef,
      file: sidecarFile || undefined,
      sourceBytes: sidecarSource.length,
      sourceSha256: sidecarSource ? sha256Text(sidecarSource) : undefined,
      hostImports,
      delegations,
      placeholderImplementationRemoved: placeholderRemoved
    },
    assemblyScript: {
      compilerAvailable: ascCompile.available,
      compileStatus: ascCompile.status,
      version: ascCompile.version,
      dependencyGated: ascCompile.status === 'dependency-gated',
      strictInstalledWorkspaceCommand: 'corepack pnpm install --frozen-lockfile && corepack pnpm run -s test:assets-sidecar-compile-link',
      output: ascCompile.outputs,
      exitCode: ascCompile.exitCode,
      stderr: ascCompile.stderr,
      diagnostic: ascCompile.diagnostic
    },
    linkModel: {
      hostImportModule: 'pulse_assets_host',
      hostImports: ['lookup', 'respond'],
      sidecarExports: ['pulse_assets_lookup', 'pulse_assets_respond'],
      generatedUserRouteHarness: true,
      routeCallsSidecarExports: true,
      terminalAssetResponseEffect: true,
      continuationRequired: false,
      directProviderProofFallback: false,
      generatedInMemoryRouteHarness: true,
      actualPackageSidecarSourceValidated: true
    },
    wasmModule: {
      byteLength: linkSmoke && linkSmoke.wasmBytes || 0,
      imports: linkSmoke && linkSmoke.imports || [],
      exports: linkSmoke && linkSmoke.exports || [],
      routeExports
    },
    linkSmoke,
    packageOut: manifestRecord ? {
      discoveredFromNodeModules: manifestRecord.source === 'node_modules' || String(manifestRecord.source || '').includes('node_modules'),
      packageDir: stableFileName(manifestRecord.packageDir || packageDir, cwd),
      manifestFile: stableFileName(manifestRecord.manifestFile, cwd)
    } : undefined,
    policy: {
      betaQualityProof: true,
      productionCompletenessRequired: false,
      packageOwnsSidecarSource: true,
      packageOwnsCompilerBuilder: true,
      compilerOrchestratesOnly: true,
      providersOwnRuntimeBehavior: true,
      arbitraryThirdPartyLowererExecution: false,
      actualAscCompileStrictWhenDependencyPresent: true,
      dependencyMissingDoesNotWeakenInstalledWorkspaceLane: true
    },
    summary: {
      sidecarSourceValidated: Boolean(sidecarSource),
      sidecarHostImportsValidated: hostImports.lookup && hostImports.respond,
      sidecarExportDelegationValidated: delegations.lookup && delegations.respond,
      placeholderImplementationRemoved: placeholderRemoved,
      linkedModuleImportsHost: linkedModuleImportsHost,
      linkedModuleExportsSidecar: linkedModuleExportsSidecar,
      linkedModuleExecuted: linkedModuleExecutesRoutes,
      routeExports: routeExports.length,
      terminalAssetResponseEffects: terminalEffects.length,
      actualAssemblyScriptCompilerAvailable: ascCompile.available,
      actualAssemblyScriptCompileValidated: ascCompile.available ? ascCompile.status === 'ok' : false,
      actualAssemblyScriptCompileReadiness: ascCompile.available ? (ascCompile.status === 'ok' ? 'implemented' : ascCompile.status) : 'dependency-gated',
      dependencyGatedInThisWorkspace: ascCompile.status === 'dependency-gated',
      directProviderProofFallback: false,
      errors: errorDiagnostics.length
    },
    diagnostics
  }, cwd);

  return {
    artifact,
    diagnostics,
    linkSmoke,
    ascCompile,
    hasErrors: diagnosticHasError(diagnostics)
  };
}

const assetsLoweringBuilder = Object.freeze({
  name: 'assets-lowering-builder',
  owner: '@pulse-compute/assets',
  contractId: assetsContracts.ASSETS_CONTRACT_ID,
  buildAssetsLoweringPlan
});

const assetsCompiledWasmSidecarBuilder = Object.freeze({
  name: 'assets-compiled-wasm-sidecar-builder',
  owner: '@pulse-compute/assets',
  contractId: assetsContracts.ASSETS_CONTRACT_ID,
  buildAssetsCompiledWasmSidecarPlan
});

const assetsSidecarCompileLinkBuilder = Object.freeze({
  name: 'assets-sidecar-compile-link-builder',
  owner: '@pulse-compute/assets',
  contractId: assetsContracts.ASSETS_CONTRACT_ID,
  buildAssetsSidecarCompileLinkProof
});

module.exports = {
  buildAssetsLoweringPlan,
  buildAssetsCompiledWasmSidecarPlan,
  buildAssetsSidecarCompileLinkProof,
  assetsLoweringBuilder,
  assetsCompiledWasmSidecarBuilder,
  assetsSidecarCompileLinkBuilder,
  phaseName,
  sidecarPhaseName,
  compileLinkPhaseName
};
