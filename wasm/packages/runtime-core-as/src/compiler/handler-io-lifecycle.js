'use strict';

const ts = require('typescript');

function loadContractsDiagnostics() {
  try { return require('@pulse-compute/wasm-contracts/diagnostics'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/diagnostics.js');
    throw error;
  }
}
function loadHandlerIoContracts() {
  try { return require('@pulse-compute/wasm-contracts/handler/io-lifecycle'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/handler/io-lifecycle.js');
    throw error;
  }
}
function loadSchemaJsonGenericParserContracts() {
  try { return require('@pulse-compute/wasm-contracts/schema-json/generic-parser'); }
  catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) return require('../../../contracts/src/schema-json/generic-parser.js');
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, sourceLoc, stableFileName } = loadContractsDiagnostics();
const {
  HANDLER_IO_LIFECYCLE_PLAN_VERSION,
  HANDLER_IO_LIFECYCLE_PLAN_PHASE,
  HANDLER_IO_LIFECYCLE_PLAN_ARTIFACT,
  HANDLER_IO_LIFECYCLE_CONTRACT_ID,
  HANDLER_IO_LIFECYCLE_SCOPE,
  HANDLER_IO_LIFECYCLE_STAGES,
  HANDLER_IO_REQUEST_BODY_MODES,
  HANDLER_IO_BACKEND_REQUEST_BODY_MODES,
  HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES,
  HANDLER_IO_FINAL_RESPONSE_MODES,
  HANDLER_IO_SCHEMA_SURFACE,
  HANDLER_IO_LAZY_EVALUATION_POLICY,
  HANDLER_IO_LIFECYCLE_DIAGNOSTICS,
  defaultHandlerIoLifecyclePolicy
} = loadHandlerIoContracts();
const { normalizeJsonParserConfig, normalizeGenericParserConfig } = loadSchemaJsonGenericParserContracts();

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function configArtifact(value) { return value && typeof value === 'object' && value.artifact ? value.artifact : value; }
function unique(values) { return Array.from(new Set((values || []).filter((value) => value !== undefined && value !== null).map(String))).sort(); }
function nodeText(sourceFile, node) { return node ? node.getText(sourceFile).trim() : ''; }
function isStringLiteralLike(node) { return Boolean(node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)); }
function hasModifier(node, kind) { return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind)); }
function isExported(node) { return hasModifier(node, ts.SyntaxKind.ExportKeyword); }
function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) current = current.expression;
  return current;
}
function propertyChain(node) {
  const parts = [];
  let current = node;
  while (current && ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (current && ts.isIdentifier(current)) parts.unshift(current.text);
  else return undefined;
  return parts;
}
function literalArg(node) {
  const expr = unwrapExpression(node);
  return isStringLiteralLike(expr) ? expr.text : undefined;
}
function objectProp(sourceFile, objectNode, key) {
  const object = unwrapExpression(objectNode);
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) || isStringLiteralLike(prop.name) ? prop.name.text : undefined;
    if (name === key) return prop.initializer;
  }
  return undefined;
}
function collectFunctionNodes(sourceFile, cwd) {
  const byName = new Map();
  const byOffset = new Map();
  function record(name, node, declaration, kind, exported) {
    const functionLoc = sourceLoc(sourceFile, node);
    const info = { name, node, declaration, kind, exported: Boolean(exported), loc: sourceLoc(sourceFile, declaration || node), functionLoc, file: stableFileName(sourceFile.fileName, cwd) };
    if (name) byName.set(name, info);
    const offset = functionLoc && functionLoc.start && functionLoc.start.offset;
    if (typeof offset === 'number') byOffset.set(offset, info);
    return info;
  }
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, statement, statement, 'function-declaration', isExported(statement));
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const exported = isExported(statement);
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const init = declaration.initializer;
      if (!init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
      record(declaration.name.text, init, declaration, ts.isArrowFunction(init) ? 'const-arrow' : 'const-function-expression', exported);
    }
  }
  return { byName, byOffset };
}
function handlerById(handlerTable) {
  const map = new Map();
  for (const handler of handlerTable?.handlers || []) map.set(handler.id, handler);
  return map;
}
function handlerNameForRoute(route, handlersById) {
  if (route?.handlerName) return route.handlerName;
  const handler = route?.handler ? handlersById.get(route.handler) : undefined;
  return handler?.localName || handler?.exportName || handler?.inlineName;
}
function ctxNameFor(node) {
  const param = Array.from(node?.parameters || [])[0];
  return param && ts.isIdentifier(param.name) ? param.name.text : 'ctx';
}
function makeDiagnostic(sourceFile, code, severity, message, hint, details) {
  const diagnostic = { phase: 'handler-io-lifecycle', severity, code, message, hint, loc: { file: sourceFile ? stableFileName(sourceFile.fileName, process.cwd()) : '<handler-io-lifecycle>' } };
  if (details !== undefined) diagnostic.details = details;
  return diagnostic;
}
function modeStatus(registry, mode) {
  return registry && registry[mode] ? registry[mode].status : 'unknown';
}
function addMode(record, mode, registry) {
  if (!mode) return;
  if (!record.modes.includes(mode)) record.modes.push(mode);
  const status = modeStatus(registry, mode);
  if (!record.modeStatuses.some((entry) => entry.mode === mode)) record.modeStatuses.push({ mode, status });
}
function scanFunctionSurface(sourceFile, fnInfo) {
  const ctxName = ctxNameFor(fnInfo?.node);
  const resolvedLocals = new Map();
  const surface = {
    name: fnInfo?.name,
    ctxName,
    requestBodyReads: [],
    schemaOperations: [],
    resultEncodes: [],
    resolvedResponseReads: [],
    contextReads: [],
    headerReads: [],
    diagnostics: []
  };

  function recordRequestBody(call, chain) {
    const joined = chain.join('.');
    const localSurface = `ctx.${chain.slice(1).join('.')}`;
    const first = literalArg(call.arguments[0]);
    if (joined === `${ctxName}.req.json` || joined === `${ctxName}.request.json`) {
      surface.requestBodyReads.push({ surface: localSurface, mode: first ? 'schemaJson' : 'genericJson', schema: first, lazy: true, loc: sourceLoc(sourceFile, call) });
      surface.schemaOperations.push({ kind: first ? 'request-decode-schema-json' : 'request-decode-generic-json', schema: first, surface: localSurface, loc: sourceLoc(sourceFile, call) });
    } else if (joined === `${ctxName}.req.parse`) {
      surface.requestBodyReads.push({ surface: localSurface, mode: 'schemaJson', schema: first, lazy: true, loc: sourceLoc(sourceFile, call) });
      surface.schemaOperations.push({ kind: 'request-decode-schema-json', schema: first, surface: localSurface, loc: sourceLoc(sourceFile, call) });
    } else if (joined === `${ctxName}.req.text` || joined === `${ctxName}.request.bodyText` || joined === `${ctxName}.bodyText`) {
      surface.requestBodyReads.push({ surface: localSurface, mode: 'text', lazy: true, loc: sourceLoc(sourceFile, call) });
    } else if (joined === `${ctxName}.req.arrayBuffer` || joined === `${ctxName}.request.arrayBuffer`) {
      surface.requestBodyReads.push({ surface: localSurface, mode: 'binary', lazy: true, loc: sourceLoc(sourceFile, call) });
    } else if (joined === `${ctxName}.req.stream` || joined === `${ctxName}.request.stream`) {
      surface.requestBodyReads.push({ surface: localSurface, mode: 'stream', lazy: true, loc: sourceLoc(sourceFile, call) });
    }
  }

  function recordCtxCall(call, chain) {
    const joined = chain.join('.');
    const localSurface = `ctx.${chain.slice(1).join('.')}`;
    if ([`${ctxName}.param`, `${ctxName}.paramI32`, `${ctxName}.request.method`, `${ctxName}.request.path`].includes(joined)) {
      surface.contextReads.push({ surface: localSurface, argument: literalArg(call.arguments[0]), loc: sourceLoc(sourceFile, call) });
    }
    if ([`${ctxName}.request.header.first`, `${ctxName}.request.header.count`, `${ctxName}.request.header.at`].includes(joined)) {
      surface.headerReads.push({ surface: localSurface, name: literalArg(call.arguments[0]), loc: sourceLoc(sourceFile, call) });
    }
    if ([`${ctxName}.req.json`, `${ctxName}.request.json`, `${ctxName}.req.parse`, `${ctxName}.req.text`, `${ctxName}.request.bodyText`, `${ctxName}.bodyText`, `${ctxName}.req.arrayBuffer`, `${ctxName}.request.arrayBuffer`, `${ctxName}.req.stream`, `${ctxName}.request.stream`].includes(joined)) {
      recordRequestBody(call, chain);
    }
    if ([`${ctxName}.result.text`, `${ctxName}.result.jsonText`, `${ctxName}.result.empty`, `${ctxName}.result.json`, `${ctxName}.result.from`].includes(joined)) {
      const mode = joined.endsWith('.jsonText') ? 'jsonText' : joined.endsWith('.empty') ? 'empty' : joined.endsWith('.json') ? 'schemaJson' : joined.endsWith('.from') ? 'passthrough' : 'text';
      surface.resultEncodes.push({ mode, surface: localSurface, schema: joined.endsWith('.json') ? literalArg(call.arguments[0]) : undefined, loc: sourceLoc(sourceFile, call) });
      if (joined.endsWith('.json')) surface.schemaOperations.push({ kind: 'final-response-encode-schema-json', schema: literalArg(call.arguments[0]), surface: localSurface, loc: sourceLoc(sourceFile, call) });
    }
    if (joined === `${ctxName}.schema.encode`) {
      surface.schemaOperations.push({ kind: 'schema-encode', schema: literalArg(call.arguments[0]), surface: localSurface, loc: sourceLoc(sourceFile, call) });
    }
    if (joined === `${ctxName}.resolved`) {
      const name = literalArg(call.arguments[0]) || '$default';
      surface.resolvedResponseReads.push({ name, method: 'handle', mode: 'status', surface: localSurface, loc: sourceLoc(sourceFile, call) });
    }
  }

  function scanResolvedLocal(statement) {
    if (!ts.isVariableStatement(statement)) return;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const init = unwrapExpression(declaration.initializer);
      if (!init || !ts.isCallExpression(init) || !ts.isPropertyAccessExpression(init.expression)) continue;
      const chain = propertyChain(init.expression);
      if (!chain || chain.join('.') !== `${ctxName}.resolved`) continue;
      resolvedLocals.set(declaration.name.text, literalArg(init.arguments[0]) || '$default');
    }
  }

  if (fnInfo?.node?.body && ts.isBlock(fnInfo.node.body)) {
    for (const statement of fnInfo.node.body.statements) scanResolvedLocal(statement);
  }

  function walk(node) {
    if (!node) return;
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const chain = propertyChain(node.expression);
        if (chain && chain[0] === ctxName) recordCtxCall(node, chain);
        if (chain && chain.length === 2 && resolvedLocals.has(chain[0])) {
          const method = chain[1];
          const mode = method === 'text' ? 'text' : method === 'jsonText' ? 'jsonText' : method === 'header' ? 'header' : method === 'status' || method === 'ok' ? 'status' : method === 'json' ? 'json' : method === 'bytes' ? 'binary' : method === 'stream' ? 'stream' : 'status';
          surface.resolvedResponseReads.push({ name: resolvedLocals.get(chain[0]), variable: chain[0], method, mode, schema: method === 'json' ? literalArg(node.arguments[0]) : undefined, loc: sourceLoc(sourceFile, node) });
          if (method === 'json') surface.schemaOperations.push({ kind: 'origin-response-decode-schema-json', schema: literalArg(node.arguments[0]), surface: `${chain[0]}.json`, loc: sourceLoc(sourceFile, node) });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  if (fnInfo?.node?.body) walk(fnInfo.node.body);
  return surface;
}
function mapByRouteId(artifact) {
  const map = new Map();
  for (const route of artifact?.routes || []) map.set(route.routeId || route.stableId || route.id, route);
  return map;
}
function schemaJsonSelection(inputs) {
  const resolvedConfig = configArtifact(inputs.resolvedConfig || {});
  const genericSelection = normalizeJsonParserConfig(resolvedConfig || {});
  const genericConfig = normalizeGenericParserConfig(resolvedConfig || {});
  const genericArtifact = inputs.schemaJsonGenericParser?.artifact || inputs.schemaJsonGenericParser;
  const sidecarArtifact = inputs.schemaJsonSidecar?.artifact || inputs.schemaJsonSidecar;
  return {
    target: genericSelection.target,
    effectiveTarget: genericSelection.effectiveTarget,
    parser: genericSelection.parser,
    mode: genericSelection.mode,
    schemaCount: genericSelection.schemaCount,
    schemasPresent: genericSelection.schemasPresent,
    genericParserConfigured: Boolean(genericSelection.genericParser),
    genericParserArtifactActive: Boolean(genericArtifact && genericArtifact.active !== false),
    genericParserArtifact: genericArtifact?.artifact,
    schemaSidecarConfigured: Boolean(genericSelection.schemaSidecar),
    schemaSidecarArtifactActive: Boolean(sidecarArtifact),
    schemaSidecarArtifact: sidecarArtifact?.artifact,
    contentTypePolicy: genericConfig.contentTypePolicy,
    maxBytes: genericConfig.maxBytes,
    defaultNamespace: genericConfig.defaultNamespace,
    diagnostics: [...(genericSelection.diagnostics || [])],
    warnings: [...(genericSelection.warnings || [])]
  };
}
function backendConfig(resolvedConfig) {
  const root = configArtifact(resolvedConfig || {});
  return plainObject(plainObject(plainObject(root.runtime).capabilities).backends);
}
function classifyBackendRequestBody(effect, backends) {
  const method = String(effect?.request?.method || '').toUpperCase();
  const backend = effect?.backend;
  const config = plainObject(backends[backend]);
  const allowed = Array.isArray(config.requestBody) ? config.requestBody : undefined;
  const mode = method === 'GET' || method === 'HEAD' ? 'none' : effect?.request?.json ? 'json' : effect?.request?.body ? 'text' : 'none';
  return {
    mode,
    status: modeStatus(HANDLER_IO_BACKEND_REQUEST_BODY_MODES, mode),
    allowedByBackendConfig: allowed ? allowed.includes(mode) : undefined,
    backendConfigRequestBody: allowed,
    method
  };
}
function summarizeRequestBody(scans) {
  const record = { required: false, modes: [], modeStatuses: [], lazy: true, reads: [] };
  for (const scan of scans || []) {
    for (const read of scan.requestBodyReads || []) {
      record.required = true;
      record.reads.push(read);
      addMode(record, read.mode, HANDLER_IO_REQUEST_BODY_MODES);
    }
  }
  if (!record.required) addMode(record, 'none', HANDLER_IO_REQUEST_BODY_MODES);
  return record;
}
function summarizeResultEncodes(scans) {
  const record = { modes: [], modeStatuses: [], encodes: [] };
  for (const scan of scans || []) {
    for (const encode of scan.resultEncodes || []) {
      record.encodes.push(encode);
      addMode(record, encode.mode, HANDLER_IO_FINAL_RESPONSE_MODES);
    }
  }
  return record;
}
function summarizeOriginResponse(scans, continuationPlans) {
  const record = { modes: [], modeStatuses: [], reads: [] };
  for (const scan of scans || []) {
    for (const read of scan.resolvedResponseReads || []) {
      record.reads.push(read);
      addMode(record, read.mode, HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES);
    }
  }
  for (const continuation of continuationPlans || []) {
    for (const call of continuation.responseMethodCalls || []) {
      const method = call.method;
      const mode = method === 'text' ? 'text' : method === 'jsonText' ? 'jsonText' : method === 'header' ? 'header' : method === 'status' || method === 'ok' ? 'status' : method === 'json' ? 'json' : method === 'bytes' ? 'binary' : method === 'stream' ? 'stream' : undefined;
      if (!mode) continue;
      const read = { name: call.name, variable: call.variable, method, mode, loc: call.loc };
      if (!record.reads.some((existing) => existing.name === read.name && existing.variable === read.variable && existing.method === read.method)) record.reads.push(read);
      addMode(record, mode, HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES);
    }
  }
  return record;
}
function lifecycleStatus(route) {
  const blockingDiagnostics = (route.diagnostics || []).filter((code) => code !== 'PULSEWASM_CONTEXT_EFFECT_BOUNDARY_RESERVED');
  if (blockingDiagnostics.length > 0) return 'diagnostic';
  if (route.effects.required) return 'effect-lifecycle-planned';
  if (route.finalResponse.encodes.length > 0) return 'sync-response-planned';
  return 'metadata-only';
}
function buildHandlerIoLifecyclePlan(sourceFile, routePlan, handlerTable, inputs = {}) {
  const cwd = inputs.cwd || process.cwd();
  const generatedBy = inputs.generatedBy || PACKAGE_VERSION;
  const diagnostics = [];
  const contextArtifact = inputs.routeHandlerContextLoweringPlan?.artifact || inputs.routeHandlerContextLoweringPlan;
  const effectArtifact = inputs.routeHandlerEffectPlan?.artifact || inputs.routeHandlerEffectPlan;
  const requestJsonArtifact = inputs.requestJsonBodyPlan?.artifact || inputs.requestJsonBodyPlan;
  const nodeRequestJsonProofArtifact = inputs.nodeRequestJsonBodyProof?.artifact || inputs.nodeRequestJsonBodyProof;
  if (!routePlan || !Array.isArray(routePlan.routes)) diagnostics.push(makeDiagnostic(sourceFile, HANDLER_IO_LIFECYCLE_DIAGNOSTICS.routePlanMissing, 'error', 'Handler I/O lifecycle planning requires a route plan.', 'Run the normal route extraction pipeline first.'));
  if (!contextArtifact) diagnostics.push(makeDiagnostic(sourceFile, HANDLER_IO_LIFECYCLE_DIAGNOSTICS.contextPlanMissing, 'warning', 'Handler I/O lifecycle planning works best with route-handler-context-lowering-plan.json.', 'Enable --features route-context or the handler-io lifecycle feature.'));
  if (!effectArtifact) diagnostics.push(makeDiagnostic(sourceFile, HANDLER_IO_LIFECYCLE_DIAGNOSTICS.effectPlanMissing, 'warning', 'Handler I/O lifecycle planning works best with route-handler-effect-plan.json.', 'Enable --features route-effects or the handler-io lifecycle feature.'));

  const functions = collectFunctionNodes(sourceFile, cwd);
  const handlersById = handlerById(handlerTable);
  const contextByRouteId = mapByRouteId(contextArtifact);
  const effectByRouteId = mapByRouteId(effectArtifact);
  const requestJsonByRouteId = mapByRouteId(requestJsonArtifact);
  const continuationByName = new Map((effectArtifact?.continuations || []).map((entry) => [entry.name, entry]));
  const backends = backendConfig(inputs.resolvedConfig || {});
  const schemaJson = schemaJsonSelection(inputs);
  const routes = [];

  for (const route of routePlan?.routes || []) {
    const routeId = route.stableId || route.id;
    const contextRoute = contextByRouteId.get(routeId);
    const effectRoute = effectByRouteId.get(routeId);
    const handlerName = handlerNameForRoute(route, handlersById) || effectRoute?.handlerName;
    const handlerScan = scanFunctionSurface(sourceFile, functions.byName.get(handlerName));
    const continuationScans = [];
    const continuationPlans = [];
    for (const resolve of effectRoute?.resolves || []) {
      const name = resolve.continuation && resolve.continuation.name;
      if (!name) continue;
      const plan = continuationByName.get(name);
      if (plan) continuationPlans.push(plan);
      const info = functions.byName.get(name);
      if (info) continuationScans.push(scanFunctionSurface(sourceFile, info));
    }
    const scans = [handlerScan, ...continuationScans].filter(Boolean);
    const requestBody = summarizeRequestBody(scans);
    const requestJsonRoute = requestJsonByRouteId.get(routeId);
    if (requestJsonRoute && requestJsonRoute.required) {
      requestBody.runtime = {
        requestJsonBodyPlan: requestJsonArtifact?.artifact,
        routePlanned: true,
        compiledWasmRuntimeImplemented: Boolean(requestJsonArtifact?.summary?.compiledWasmRuntimeImplemented),
        nodeProofAvailable: Boolean(nodeRequestJsonProofArtifact),
        lazyRequestBodyRead: Boolean(requestJsonRoute.lazy),
        perRequestDecodeCache: Boolean(requestJsonArtifact?.summary?.perRequestDecodeCache)
      };
    }
    const finalResponse = summarizeResultEncodes(scans);
    const originResponse = summarizeOriginResponse(continuationScans, continuationPlans);
    const effects = [];
    for (const resolve of effectRoute?.resolves || []) {
      for (const effect of resolve.effects || []) {
        effects.push({
          name: effect.name,
          kind: effect.kind,
          backend: effect.backend,
          method: effect.request?.method,
          path: effect.request?.path,
          headers: effect.request?.headers,
          requestBody: classifyBackendRequestBody(effect, backends),
          continuation: resolve.continuation?.name,
          groupShape: resolve.groupShape
        });
      }
    }
    const schemaOperations = scans.flatMap((scan) => scan.schemaOperations || []);
    const routeEntry = {
      routeId,
      runtimeId: route.runtimeId,
      method: route.method,
      path: route.path,
      handlerId: route.handler,
      handlerName,
      status: 'metadata-only',
      stages: [...HANDLER_IO_LIFECYCLE_STAGES],
      syncContext: {
        status: contextRoute?.status || 'not-planned',
        surfaces: unique([...(contextRoute?.contextCallSurfaces || []), ...handlerScan.contextReads.map((read) => read.surface), ...handlerScan.headerReads.map((read) => read.surface)]),
        paramsRead: unique(handlerScan.contextReads.filter((read) => read.surface === 'ctx.param' || read.surface === 'ctx.paramI32').map((read) => read.argument)),
        headersRead: unique(scans.flatMap((scan) => scan.headerReads || []).map((read) => read.name)),
        requestMethodRead: scans.some((scan) => (scan.contextReads || []).some((read) => read.surface === 'ctx.request.method')),
        requestPathRead: scans.some((scan) => (scan.contextReads || []).some((read) => read.surface === 'ctx.request.path'))
      },
      requestBody,
      effects: {
        required: effects.length > 0,
        resolveBoundaries: (effectRoute?.resolves || []).map((resolve) => ({ groupShape: resolve.groupShape, continuation: resolve.continuation?.name, effects: (resolve.effects || []).map((effect) => effect.name) })),
        backendFetches: effects,
        providerExecution: {
          nodeProofAvailable: Boolean(inputs.nodeRouteHandlerEffectProof),
          fastlyProofAvailable: Boolean(inputs.fastlyRouteHandlerEffectProof),
          compiledWasmSuspendResumeBridgeImplemented: false
        }
      },
      originResponse,
      finalResponse,
      schema: {
        operations: schemaOperations,
        requestDecode: schemaOperations.filter((op) => op.kind.startsWith('request-decode')),
        originDecode: schemaOperations.filter((op) => op.kind.startsWith('origin-response-decode')),
        encode: schemaOperations.filter((op) => op.kind.includes('encode')),
        genericParserNeeded: requestBody.modes.includes('genericJson'),
        schemaSidecarNeeded: requestBody.modes.includes('schemaJson') || schemaOperations.some((op) => op.schema)
      },
      reserved: {
        requestBody: requestBody.modeStatuses.filter((entry) => entry.status === 'reserved-with-diagnostic').map((entry) => entry.mode),
        backendRequestBody: effects.map((effect) => effect.requestBody).filter((entry) => entry.status === 'reserved-with-diagnostic').map((entry) => entry.mode),
        originResponseBody: originResponse.modeStatuses.filter((entry) => entry.status === 'reserved-with-diagnostic').map((entry) => entry.mode),
        finalResponseBody: finalResponse.modeStatuses.filter((entry) => entry.status === 'reserved-with-diagnostic').map((entry) => entry.mode)
      },
      diagnostics: unique([...(contextRoute?.diagnostics || []), ...(effectRoute?.diagnostics || [])])
    };
    routeEntry.status = lifecycleStatus(routeEntry);
    routes.push(routeEntry);
  }

  const errors = diagnostics.filter((entry) => (entry.severity || 'error') === 'error');
  const routesWithBodyReads = routes.filter((route) => route.requestBody.required).length;
  const routesWithBackendEffects = routes.filter((route) => route.effects.required).length;
  const artifact = normalizeArtifact({
    version: HANDLER_IO_LIFECYCLE_PLAN_VERSION,
    generatedBy,
    phase: HANDLER_IO_LIFECYCLE_PLAN_PHASE,
    artifact: HANDLER_IO_LIFECYCLE_PLAN_ARTIFACT,
    contractId: HANDLER_IO_LIFECYCLE_CONTRACT_ID,
    status: errors.length > 0 ? 'error' : 'ok',
    source: stableFileName(sourceFile.fileName, cwd),
    validateAndPlanOnly: true,
    runtimeBehaviorChanged: false,
    providerBehaviorImplemented: false,
    compiledWasmEffectExecutionImplemented: false,
    scope: JSON.parse(JSON.stringify(HANDLER_IO_LIFECYCLE_SCOPE)),
    lifecycleStages: [...HANDLER_IO_LIFECYCLE_STAGES],
    policy: defaultHandlerIoLifecyclePolicy(),
    lazyEvaluation: JSON.parse(JSON.stringify(HANDLER_IO_LAZY_EVALUATION_POLICY)),
    requestBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_REQUEST_BODY_MODES)),
    backendRequestBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_BACKEND_REQUEST_BODY_MODES)),
    originResponseBodyModes: JSON.parse(JSON.stringify(HANDLER_IO_ORIGIN_RESPONSE_BODY_MODES)),
    finalResponseModes: JSON.parse(JSON.stringify(HANDLER_IO_FINAL_RESPONSE_MODES)),
    schemaSurface: JSON.parse(JSON.stringify(HANDLER_IO_SCHEMA_SURFACE)),
    inputs: {
      routePlan: routePlan ? 'route-plan.json' : undefined,
      routeHandlerContextLoweringPlan: contextArtifact?.artifact,
      routeHandlerEffectPlan: effectArtifact?.artifact,
      schemaJsonGenericParser: inputs.schemaJsonGenericParser?.artifact?.artifact || inputs.schemaJsonGenericParser?.artifact,
      schemaJsonSidecar: inputs.schemaJsonSidecar?.artifact?.artifact || inputs.schemaJsonSidecar?.artifact,
      requestJsonBodyPlan: requestJsonArtifact?.artifact,
      nodeRequestJsonBodyProof: nodeRequestJsonProofArtifact?.artifact
    },
    schemaJson,
    routes,
    diagnostics,
    summary: {
      routes: routes.length,
      routesWithBodyReads,
      routesWithSchemaDecode: routes.filter((route) => route.schema.requestDecode.length > 0).length,
      routesWithGenericJsonDecode: routes.filter((route) => route.requestBody.modes.includes('genericJson')).length,
      routesWithBackendEffects,
      backendFetchEffects: routes.reduce((count, route) => count + route.effects.backendFetches.length, 0),
      routesWithOriginResponseReads: routes.filter((route) => route.originResponse.reads.length > 0).length,
      routesWithFinalResponseEncode: routes.filter((route) => route.finalResponse.encodes.length > 0).length,
      providerBehaviorImplemented: false,
      compiledWasmEffectExecutionImplemented: false,
      requestBodyRuntimeImplemented: Boolean(nodeRequestJsonProofArtifact || requestJsonArtifact?.summary?.compiledWasmRuntimeImplemented),
      binaryRequestBodyParsing: false,
      streamRequestBodyParsing: false,
      lazyRequestBodyPolicy: HANDLER_IO_LAZY_EVALUATION_POLICY.requestBodyRead,
      diagnostics: diagnostics.length,
      errors: errors.length,
      warnings: diagnostics.filter((entry) => (entry.severity || 'error') === 'warning').length
    }
  }, cwd);
  return { artifact, diagnostics };
}

module.exports = { buildHandlerIoLifecyclePlan };
