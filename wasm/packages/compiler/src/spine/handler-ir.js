'use strict';

const ts = require('typescript');
const {
  extractFetchChain,
  extractKvNamespaceDeclaration,
  extractParallelCall,
  extractProviderCall,
  recognizeHandlerSurface
} = require('./handler-surface-authority.js');
const {
  positionFor,
  createCanonicalDiagnostic,
  createHandlerDiagnostic
} = require('./diagnostic-authority.js');

function loadCanonicalRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/handler/canonical-runtime.js');
    throw error;
  }
}

const canonicalRuntimeContract = loadCanonicalRuntimeContract();
const HANDLER_IR_VERSION = 'pulse.canonical-handler-ir.v1';
const HANDLER_IR_KIND = 'plain-handler';
const ROUTER_HANDLER_IR_KIND = 'router-handler';
const HANDLER_IR_OPERATION_KINDS = Object.freeze([
  'source-statement',
  'block',
  'if',
  'fetch-single',
  'fetch-group',
  'provider-variable',
  'provider-expression',
  'package-effect',
  'package-variable',
  'package-result-adapter',
  'opaque-fetch-return'
]);
const HANDLER_IR_EXTENSION_OPERATION_KINDS = Object.freeze([
  'parallel-group'
]);
const ROUTER_HANDLER_IR_OPERATION_KINDS = Object.freeze([
  'router-transfer',
  'router-guard'
]);
const ALL_HANDLER_IR_OPERATION_KINDS = Object.freeze([
  ...HANDLER_IR_OPERATION_KINDS,
  ...HANDLER_IR_EXTENSION_OPERATION_KINDS,
  ...ROUTER_HANDLER_IR_OPERATION_KINDS
]);

function staticResource(node) {
  if (!node) return Object.freeze({ kind: 'none' });
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const value = node.text;
    let origin;
    try { origin = new URL(value).origin; } catch (_) { origin = undefined; }
    return Object.freeze({ kind: 'literal', value, origin });
  }
  return Object.freeze({ kind: 'dynamic' });
}

function diagnostic(sourceFile, node, code, message, detail = {}) {
  return createCanonicalDiagnostic({
    frontend: 'canonical-source',
    sourceFile,
    node,
    code,
    message,
    detail
  });
}

function collectIdentifiers(node, out = new Set()) {
  if (!node) return out;
  function visit(current) {
    if (ts.isIdentifier(current)) out.add(current.text);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return out;
}

function fetchVariableStatement(statement, ctxName) {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
  const chain = extractFetchChain(declaration.initializer, ctxName);
  if (!chain || !chain.url) return undefined;
  return Object.freeze({ statement, declaration, variableName: declaration.name.text, chain });
}

function providerVariableStatement(statement, ctxName, kvAliases) {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return undefined;
  const declaration = statement.declarationList.declarations[0];
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
  const operation = extractProviderCall(declaration.initializer, ctxName, kvAliases);
  if (!operation) return undefined;
  return Object.freeze({ statement, declaration, variableName: declaration.name.text, operation });
}

function providerExpressionStatement(statement, ctxName, kvAliases) {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const operation = extractProviderCall(statement.expression, ctxName, kvAliases);
  return operation ? Object.freeze({ statement, operation }) : undefined;
}

function parallelInvocationStatement(statement, ctxName) {
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0];
    const parallel = extractParallelCall(declaration.initializer, ctxName, { unwrap: true });
    if (parallel) return Object.freeze({ statement, declaration, call: parallel.call, record: parallel.record, discard: false });
  }
  if (ts.isExpressionStatement(statement)) {
    const parallel = extractParallelCall(statement.expression, ctxName, { unwrap: true });
    if (parallel) return Object.freeze({ statement, call: parallel.call, record: parallel.record, discard: true });
  }
  return undefined;
}

function portableParallelKey(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function isArrayIndexKey(key) {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const value = Number(key);
  return Number.isSafeInteger(value) && value >= 0 && value < 0xffffffff && String(value) === key;
}

function groupIsIndependent(candidates) {
  const names = new Set(candidates.map((candidate) => candidate.variableName));
  for (const candidate of candidates) {
    const identifiers = new Set();
    collectIdentifiers(candidate.chain.url, identifiers);
    collectIdentifiers(candidate.chain.init, identifiers);
    for (const name of names) if (identifiers.has(name)) return false;
  }
  return true;
}

function createHandlerOperation(kind, fields = {}) {
  if (!ALL_HANDLER_IR_OPERATION_KINDS.includes(kind)) throw new TypeError(`Unsupported canonical Handler IR operation kind: ${kind}`);
  return Object.freeze({ kind, ...fields });
}

function summarizeHandlerOperation(body) {
  const counts = {};
  function countOperation(entry) {
    if (!entry) return;
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    if (entry.kind === 'block') for (const child of entry.statements || []) countOperation(child);
    if (entry.kind === 'if') {
      countOperation(entry.thenOperation);
      if (entry.elseOperation) countOperation(entry.elseOperation);
    }
    if (entry.kind === 'router-guard') countOperation(entry.body);
  }
  countOperation(body);
  return Object.freeze({
    operationCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
    operationKinds: Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))))
  });
}

function buildPlainHandlerIr(frontend, options = {}) {
  if (!frontend || frontend.frontend !== 'canonical-source') throw new TypeError('buildPlainHandlerIr requires a prepared canonical-source frontend.');
  const { sourceFile, handler, analysis, schemaBundle, diagnostics } = frontend;
  if (!handler) return undefined;

  const ctxParameter = handler.parameters[0];
  const ctxName = ctxParameter && ts.isIdentifier(ctxParameter.name) ? ctxParameter.name.text : 'ctx';
  if (!ctxParameter || !ts.isIdentifier(ctxParameter.name)) diagnostics.push(createHandlerDiagnostic({
    frontend: 'canonical-source',
    issue: 'handler.context-identifier.required',
    sourceFile,
    node: handler
  }));

  const effectSites = [];
  const continuationSites = [];
  const effectCounters = new Map();
  let continuationIndex = 0;
  const packageEffectsByStart = new Map();
  for (const effectInput of options.packageEffects || []) {
    if (!effectInput || effectInput.version !== canonicalRuntimeContract.CANONICAL_PACKAGE_EFFECT_VERSION || !effectInput.range) continue;
    const start = Number(effectInput.range.start);
    if (!Number.isSafeInteger(start) || packageEffectsByStart.has(start)) {
      diagnostics.push(diagnostic(sourceFile, handler, 'PULSE_CANONICAL_PACKAGE_EFFECT_RANGE_INVALID', 'Package-owned canonical effects require unique source ranges.', { effect: effectInput }));
      continue;
    }
    packageEffectsByStart.set(start, effectInput);
  }
  const packageIntrinsicsByStart = new Map();
  const linkedPackageIntrinsicsByStart = new Map();
  for (const intrinsicInput of options.packageIntrinsics || []) {
    const start = Number(intrinsicInput && intrinsicInput.range && intrinsicInput.range.start);
    if (!Number.isSafeInteger(start) || packageIntrinsicsByStart.has(start)) {
      diagnostics.push(diagnostic(sourceFile, handler, 'PULSE_CANONICAL_PACKAGE_INTRINSIC_RANGE_INVALID', 'Package-owned intrinsics require unique source ranges.', { intrinsic: intrinsicInput }));
      continue;
    }
    packageIntrinsicsByStart.set(start, intrinsicInput);
  }

  function unwrapPackageCall(expression) {
    let current = expression;
    while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current))) current = current.expression;
    if (current && ts.isVoidExpression(current)) current = current.expression;
    return current && ts.isCallExpression(current) ? current : undefined;
  }

  function packageEffectForCall(call) {
    if (!call) return undefined;
    if (typeof options.packageEffectForCall === 'function') {
      const linked = options.packageEffectForCall(call);
      if (linked) {
        linkPackageIntrinsicsWithin(call);
        return linked;
      }
    }
    const effect = packageEffectsByStart.get(call.getStart(sourceFile));
    if (effect) linkPackageIntrinsicsWithin(call);
    return effect;
  }

  function packageIntrinsicForCall(call) {
    if (!call) return undefined;
    if (typeof options.packageIntrinsicForCall === 'function') {
      const linked = options.packageIntrinsicForCall(call);
      if (linked) {
        const start = call.getStart(sourceFile);
        if (!linkedPackageIntrinsicsByStart.has(start)) {
          linkedPackageIntrinsicsByStart.set(start, Object.freeze({
            ...linked,
            range: Object.freeze({ start, end: call.getEnd() })
          }));
        }
        return linked;
      }
    }
    const start = call.getStart(sourceFile);
    const intrinsic = packageIntrinsicsByStart.get(start);
    if (intrinsic && !linkedPackageIntrinsicsByStart.has(start)) linkedPackageIntrinsicsByStart.set(start, intrinsic);
    return intrinsic;
  }

  function linkPackageIntrinsicsWithin(node) {
    if (!node) return;
    if (ts.isCallExpression(node) && packageIntrinsicForCall(node)) return;
    ts.forEachChild(node, linkPackageIntrinsicsWithin);
  }

  const packageResultAdaptersByStart = new Map();
  for (const adapter of options.packageResultAdapters || []) {
    const start = Number(adapter && adapter.range && adapter.range.start);
    if (Number.isSafeInteger(start) && !packageResultAdaptersByStart.has(start)) packageResultAdaptersByStart.set(start, adapter);
  }

  function packageResultAdapterForCall(call) {
    if (!call) return undefined;
    if (typeof options.packageResultAdapterForCall === 'function') {
      const linked = options.packageResultAdapterForCall(call);
      if (linked) return linked;
    }
    return packageResultAdaptersByStart.get(call.getStart(sourceFile));
  }

  function packageVariableStatement(statement) {
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return undefined;
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return undefined;
    const call = unwrapPackageCall(declaration.initializer);
    const effect = packageEffectForCall(call);
    if (!effect) return undefined;
    return Object.freeze({ statement, declaration, call, effect, variableName: declaration.name.text });
  }

  function nextEffectId(prefix) {
    const next = (effectCounters.get(prefix) || 0) + 1;
    effectCounters.set(prefix, next);
    return `${prefix}-${next}`;
  }

  function nextFetchEffectSite(chain, grouped, groupKey) {
    const site = Object.freeze({
      id: nextEffectId('fetch'),
      kind: 'fetch',
      providerKind: 'fetch',
      operation: 'dispatch',
      decoder: chain.decoder || null,
      grouped: Boolean(grouped),
      ...(groupKey === undefined ? {} : { groupKey }),
      capability: 'fetch',
      resource: staticResource(chain.url),
      position: positionFor(sourceFile, chain.fetchCall)
    });
    effectSites.push(site);
    return site;
  }

  function nextProviderEffectSite(providerOperation, grouped = false, groupKey) {
    const prefix = providerOperation.providerKind === 'kv' ? `kv-${providerOperation.operation}` : providerOperation.providerKind;
    const site = Object.freeze({
      id: nextEffectId(prefix),
      kind: providerOperation.kind,
      providerKind: providerOperation.providerKind,
      operation: providerOperation.operation,
      grouped: Boolean(grouped),
      ...(groupKey === undefined ? {} : { groupKey }),
      capability: providerOperation.capability,
      resource: staticResource(providerOperation.resource),
      position: positionFor(sourceFile, providerOperation.call)
    });
    effectSites.push(site);
    return site;
  }

  function packageEffectPosition(effect, call) {
    const start = effect && effect.loc && effect.loc.start;
    const file = effect && effect.loc && effect.loc.file;
    if (file && start && String(file).replace(/\\/g, '/') !== String(sourceFile.fileName).replace(/\\/g, '/')) {
      return Object.freeze({
        file: String(file).replace(/\\/g, '/'),
        line: Number(start.line || 1),
        column: Number(start.column || 1)
      });
    }
    return positionFor(sourceFile, call);
  }

  function nextPackageEffectSite(effect, call, grouped = false, groupKey) {
    const prefix = String(effect.kind || 'package-effect').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const site = Object.freeze({
      id: nextEffectId(prefix || 'package-effect'),
      kind: String(effect.kind),
      providerKind: String(effect.providerKind || 'package'),
      operation: String(effect.operation || ''),
      grouped: Boolean(grouped),
      ...(groupKey === undefined ? {} : { groupKey }),
      capability: String(effect.capability || effect.kind),
      package: String(effect.package || ''),
      contractId: String(effect.contractId || ''),
      payload: Object.freeze({ ...(effect.payload || {}) }),
      result: String(effect.result || 'value'),
      resource: effect.resource || Object.freeze({ kind: 'none' }),
      position: packageEffectPosition(effect, call)
    });
    effectSites.push(site);
    return site;
  }

  function nextContinuationSite(effectIds, kind, node) {
    continuationIndex += 1;
    const site = Object.freeze({
      id: `continuation-${continuationIndex}`,
      kind,
      effectIds: Object.freeze(Array.from(effectIds)),
      position: positionFor(sourceFile, node)
    });
    continuationSites.push(site);
    return site;
  }

  function parallelCandidate(invocation, aliases) {
    const { call, record } = invocation;
    let valid = true;
    if (call.arguments.length !== 1 || !record || !ts.isObjectLiteralExpression(record)) {
      diagnostics.push(diagnostic(
        sourceFile,
        call,
        'PULSE_PARALLEL_OBJECT_LITERAL_REQUIRED',
        'ctx.parallel requires exactly one inline object literal of Pulse effects.'
      ));
      return undefined;
    }
    if (record.properties.length === 0) {
      diagnostics.push(diagnostic(
        sourceFile,
        record,
        'PULSE_PARALLEL_EMPTY',
        'ctx.parallel requires at least one keyed Pulse effect.'
      ));
      return undefined;
    }
    const members = [];
    const keys = new Set();
    for (const property of record.properties) {
      if (!ts.isPropertyAssignment(property)) {
        diagnostics.push(diagnostic(
          sourceFile,
          property,
          'PULSE_PARALLEL_PROPERTY_STATIC_REQUIRED',
          'ctx.parallel accepts only ordinary key: effect property assignments; spreads, shorthand properties, methods, getters, and setters are not portable.'
        ));
        valid = false;
        continue;
      }
      const key = portableParallelKey(property.name);
      if (key === undefined) {
        diagnostics.push(diagnostic(
          sourceFile,
          property.name,
          'PULSE_PARALLEL_KEY_STATIC_REQUIRED',
          'ctx.parallel keys must be static identifier or string-literal keys.'
        ));
        valid = false;
        continue;
      }
      if (key === '__proto__' || isArrayIndexKey(key)) {
        diagnostics.push(diagnostic(
          sourceFile,
          property.name,
          'PULSE_PARALLEL_KEY_UNSUPPORTED',
          `ctx.parallel key ${JSON.stringify(key)} is not portable; use a non-index string key.`
        ));
        valid = false;
        continue;
      }
      if (keys.has(key)) {
        diagnostics.push(diagnostic(
          sourceFile,
          property.name,
          'PULSE_PARALLEL_KEY_DUPLICATE',
          `ctx.parallel key ${JSON.stringify(key)} is duplicated.`
        ));
        valid = false;
        continue;
      }
      keys.add(key);
      const fetch = extractFetchChain(property.initializer, ctxName, { unwrap: true });
      if (fetch && fetch.url) {
        members.push(Object.freeze({ key, kind: 'fetch', property, chain: fetch }));
        continue;
      }
      const provider = extractProviderCall(property.initializer, ctxName, aliases, { unwrap: true });
      if (provider) {
        members.push(Object.freeze({ key, kind: 'provider', property, operation: provider }));
        continue;
      }
      const packageCall = unwrapPackageCall(property.initializer);
      const packageEffect = packageEffectForCall(packageCall);
      if (packageEffect && packageEffect.placement === 'statement') {
        members.push(Object.freeze({ key, kind: 'package', property, effect: packageEffect, call: packageCall }));
        continue;
      }
      diagnostics.push(diagnostic(
        sourceFile,
        property.initializer,
        'PULSE_PARALLEL_EFFECT_REQUIRED',
        `ctx.parallel property ${JSON.stringify(key)} must contain a directly recognizable Pulse effect expression.`
      ));
      valid = false;
    }
    if (!valid || members.length !== record.properties.length) return undefined;
    if (!invocation.discard) {
      const binding = invocation.declaration.name;
      if (ts.isObjectBindingPattern(binding)) {
        const memberKeys = new Set(members.map((member) => member.key));
        for (const element of binding.elements) {
          const keyNode = element.propertyName || element.name;
          const key = portableParallelKey(keyNode);
          if (element.dotDotDotToken || element.initializer || !ts.isIdentifier(element.name) || key === undefined || !memberKeys.has(key)) {
            diagnostics.push(diagnostic(
              sourceFile,
              element,
              'PULSE_PARALLEL_BINDING_UNSUPPORTED',
              'ctx.parallel result destructuring accepts only simple identifiers or static key aliases without defaults or rest elements.'
            ));
            valid = false;
          }
        }
      } else if (!ts.isIdentifier(binding)) {
        diagnostics.push(diagnostic(
          sourceFile,
          binding,
          'PULSE_PARALLEL_BINDING_UNSUPPORTED',
          'ctx.parallel results must bind to one identifier or a simple object binding pattern.'
        ));
        valid = false;
      }
    }
    if (!valid) return undefined;
    return Object.freeze({ ...invocation, members: Object.freeze(members) });
  }

  function buildStatementList(statements, inheritedAliases = new Map()) {
    const aliases = new Map(inheritedAliases);
    const out = [];
    for (let index = 0; index < statements.length;) {
      const statement = statements[index];
      const parallelInvocation = parallelInvocationStatement(statement, ctxName);
      if (parallelInvocation) {
        const candidate = parallelCandidate(parallelInvocation, aliases);
        if (!candidate) {
          out.push(createHandlerOperation('source-statement', { statement, role: 'parallel-rejected' }));
          index += 1;
          continue;
        }
        const sites = Object.freeze(candidate.members.map((member) => {
          if (member.kind === 'fetch') return nextFetchEffectSite(member.chain, true, member.key);
          if (member.kind === 'provider') return nextProviderEffectSite(member.operation, true, member.key);
          return nextPackageEffectSite(member.effect, member.call, true, member.key);
        }));
        const continuation = nextContinuationSite(sites.map((site) => site.id), 'parallel-group', candidate.call);
        out.push(createHandlerOperation('parallel-group', { candidate, sites, continuation }));
        index += 1;
        continue;
      }
      if (ts.isExpressionStatement(statement)) {
        const packageCall = unwrapPackageCall(statement.expression);
        const packageEffect = packageEffectForCall(packageCall);
        if (packageEffect) {
          if (packageEffect.placement !== 'statement') diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-source', issue: 'effect.package.position', sourceFile, node: packageCall, values: { kind: packageEffect.kind, placement: 'statement' } }));
          const site = nextPackageEffectSite(packageEffect, packageCall);
          const continuation = nextContinuationSite([site.id], site.kind, statement);
          out.push(createHandlerOperation('package-effect', { statement, call: packageCall, effect: packageEffect, site, continuation, returnResult: false }));
          index += 1;
          continue;
        }
      }
      const namespace = extractKvNamespaceDeclaration(statement, ctxName);
      if (namespace) {
        aliases.set(namespace.variableName, namespace.store);
        out.push(createHandlerOperation('source-statement', { statement, role: 'kv-namespace' }));
        index += 1;
        continue;
      }

      const packageVariable = packageVariableStatement(statement);
      if (packageVariable) {
        if (packageVariable.effect.placement !== 'variable') diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-source', issue: 'effect.package.position', sourceFile, node: packageVariable.call, values: { kind: packageVariable.effect.kind, placement: 'variable' } }));
        const site = nextPackageEffectSite(packageVariable.effect, packageVariable.call);
        const continuation = nextContinuationSite([site.id], site.kind, packageVariable.statement);
        out.push(createHandlerOperation('package-variable', { candidate: packageVariable, site, continuation }));
        index += 1;
        continue;
      }

      const firstFetch = fetchVariableStatement(statement, ctxName);
      if (firstFetch) {
        const candidates = [firstFetch];
        let next = index + 1;
        while (next < statements.length) {
          const candidate = fetchVariableStatement(statements[next], ctxName);
          if (!candidate) break;
          candidates.push(candidate);
          next += 1;
        }
        if (candidates.length > 1 && groupIsIndependent(candidates)) {
          const sites = Object.freeze(candidates.map((candidate) => nextFetchEffectSite(candidate.chain, true)));
          const continuation = nextContinuationSite(sites.map((site) => site.id), 'fetch-group', candidates[0].statement);
          out.push(createHandlerOperation('fetch-group', { candidates: Object.freeze(candidates), sites, continuation }));
        } else {
          for (const candidate of candidates) {
            const site = nextFetchEffectSite(candidate.chain, false);
            const continuation = nextContinuationSite([site.id], 'single-fetch', candidate.statement);
            out.push(createHandlerOperation('fetch-single', { candidate, site, continuation }));
          }
        }
        index = next;
        continue;
      }

      const providerDeclaration = providerVariableStatement(statement, ctxName, aliases);
      if (providerDeclaration) {
        const site = nextProviderEffectSite(providerDeclaration.operation);
        const continuation = nextContinuationSite([site.id], site.kind, providerDeclaration.statement);
        out.push(createHandlerOperation('provider-variable', { candidate: providerDeclaration, site, continuation }));
        index += 1;
        continue;
      }
      const providerStatement = providerExpressionStatement(statement, ctxName, aliases);
      if (providerStatement) {
        const site = nextProviderEffectSite(providerStatement.operation);
        const continuation = nextContinuationSite([site.id], site.kind, providerStatement.statement);
        out.push(createHandlerOperation('provider-expression', { candidate: providerStatement, site, continuation }));
        index += 1;
        continue;
      }
      out.push(buildStatement(statement, aliases));
      index += 1;
    }
    return Object.freeze(out.flat().filter(Boolean));
  }

  function buildStatement(statement, aliases) {
    if (ts.isBlock(statement)) return createHandlerOperation('block', { statement, statements: buildStatementList(statement.statements, aliases) });
    if (ts.isIfStatement(statement)) {
      const thenOperation = buildStatement(statement.thenStatement, new Map(aliases));
      const elseOperation = statement.elseStatement ? buildStatement(statement.elseStatement, new Map(aliases)) : undefined;
      return createHandlerOperation('if', { statement, expression: statement.expression, thenOperation, elseOperation });
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      const packageCall = unwrapPackageCall(statement.expression);
      const resultAdapter = packageResultAdapterForCall(packageCall);
      if (resultAdapter) {
        const argument = packageCall.arguments && packageCall.arguments[0];
        if (!argument || !ts.isIdentifier(argument)) {
          diagnostics.push(diagnostic(sourceFile, packageCall, 'PULSE_PACKAGE_RESULT_ADAPTER_INPUT_UNSUPPORTED', 'Package result adapters currently require a directly bound effect result identifier.'));
          return createHandlerOperation('source-statement', { statement, role: 'package-result-adapter-rejected' });
        }
        return createHandlerOperation('package-result-adapter', { statement, call: packageCall, adapter: resultAdapter, resultExpression: argument });
      }
      const packageEffect = packageEffectForCall(packageCall);
      if (packageEffect) {
        if (packageEffect.placement !== 'return') diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-source', issue: 'effect.package.position', sourceFile, node: packageCall, values: { kind: packageEffect.kind, placement: 'return' } }));
        const site = nextPackageEffectSite(packageEffect, packageCall);
        const continuation = nextContinuationSite([site.id], site.kind, statement);
        return createHandlerOperation('package-effect', { statement, call: packageCall, effect: packageEffect, site, continuation, returnResult: true });
      }
      const chain = extractFetchChain(statement.expression, ctxName);
      if (chain) {
        if (chain.decoder) {
          diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-source', issue: 'effect.fetch.value-return', sourceFile, node: statement }));
          return createHandlerOperation('source-statement', { statement, role: 'fetch-value-return-rejected' });
        }
        const site = nextFetchEffectSite(chain, false);
        const continuation = nextContinuationSite([site.id], 'opaque-fetch-return', statement);
        return createHandlerOperation('opaque-fetch-return', { statement, chain, site, continuation });
      }
    }
    if (ts.isTryStatement(statement) || ts.isForStatement(statement) || ts.isForOfStatement(statement) || ts.isWhileStatement(statement) || ts.isDoStatement(statement) || ts.isSwitchStatement(statement)) {
      diagnostics.push(diagnostic(sourceFile, statement, 'PULSE_CANONICAL_CONTROL_FLOW_UNSUPPORTED', 'The current canonical lowering supports straight-line code and if/else branching; loops, switch, and try/catch are reserved.'));
    }
    return createHandlerOperation('source-statement', { statement, role: 'preserved-source' });
  }

  const originalBody = ts.isBlock(handler.body) ? handler.body : ts.factory.createBlock([ts.factory.createReturnStatement(handler.body)], true);
  const body = createHandlerOperation('block', { statement: originalBody, statements: buildStatementList(originalBody.statements) });

  function scanUnsupportedCalls(node, aliases) {
    if (ts.isCallExpression(node) && packageIntrinsicForCall(node)) return;
    const surface = recognizeHandlerSurface(node, {
      ctxName,
      kvAliases: aliases,
      packageEffectForCall
    });
    if (surface && surface.surfaceId === 'package.operation') return;
    if (surface && surface.surfaceId === 'ctx.parallel') {
      diagnostics.push(diagnostic(
        sourceFile,
        node,
        'PULSE_PARALLEL_POSITION_UNSUPPORTED',
        'ctx.parallel must be awaited as a standalone variable declaration or expression statement.'
      ));
      return;
    }
    if (surface && ['ctx.fetch.opaque-return', 'ctx.fetch.projected'].includes(surface.surfaceId)
      && surface.detail.fetch.fetchCall === node) {
      diagnostics.push(createHandlerDiagnostic({ frontend: 'canonical-source', issue: 'effect.fetch.position', sourceFile, node }));
    }
    if (surface && surface.detail.provider) {
      diagnostics.push(createHandlerDiagnostic({
        frontend: 'canonical-source',
        issue: 'effect.provider.position',
        sourceFile,
        node,
        values: { kind: surface.detail.provider.kind }
      }));
      return;
    }
    ts.forEachChild(node, (child) => scanUnsupportedCalls(child, aliases));
  }

  function scanOriginalStatements(statements, inheritedAliases = new Map()) {
    const aliases = new Map(inheritedAliases);
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      const namespace = extractKvNamespaceDeclaration(statement, ctxName);
      if (namespace) { aliases.set(namespace.variableName, namespace.store); continue; }
      if (parallelInvocationStatement(statement, ctxName)) continue;
      if (packageVariableStatement(statement)) continue;
      if (fetchVariableStatement(statement, ctxName)) continue;
      if (providerVariableStatement(statement, ctxName, aliases)) continue;
      if (providerExpressionStatement(statement, ctxName, aliases)) continue;
      if (ts.isExpressionStatement(statement) && packageEffectForCall(unwrapPackageCall(statement.expression))) continue;
      if (ts.isReturnStatement(statement) && packageResultAdapterForCall(unwrapPackageCall(statement.expression))) continue;
      if (ts.isReturnStatement(statement) && packageEffectForCall(unwrapPackageCall(statement.expression))) continue;
      if (ts.isReturnStatement(statement) && extractFetchChain(statement.expression, ctxName)) continue;
      if (ts.isBlock(statement)) { scanOriginalStatements(statement.statements, aliases); continue; }
      if (ts.isIfStatement(statement)) {
        scanOriginalStatements(ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement], aliases);
        if (statement.elseStatement) scanOriginalStatements(ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement], aliases);
        scanUnsupportedCalls(statement.expression, aliases);
        continue;
      }
      scanUnsupportedCalls(statement, aliases);
    }
  }
  scanOriginalStatements(originalBody.statements);

  const operationSummary = summarizeHandlerOperation(body);

  return Object.freeze({
    version: HANDLER_IR_VERSION,
    kind: HANDLER_IR_KIND,
    frontend: frontend.frontend,
    file: frontend.fileName,
    sourceFile,
    handler,
    ctxName,
    body,
    analysis,
    schemaBundle,
    effectSites: Object.freeze(effectSites),
    continuationSites: Object.freeze(continuationSites),
    packageEffects: Object.freeze([...(options.packageEffects || [])]),
    packageIntrinsics: Object.freeze(
      typeof options.packageIntrinsicForCall === 'function'
        ? [...linkedPackageIntrinsicsByStart.values()]
        : [...(options.packageIntrinsics || [])]
    ),
    packageResultAdapters: Object.freeze([...(options.packageResultAdapters || [])]),
    summary: Object.freeze({
      operationCount: operationSummary.operationCount,
      operationKinds: operationSummary.operationKinds,
      effectCount: effectSites.length,
      continuationCount: continuationSites.length
    })
  });
}

function buildRouterHandlerIr(frontend) {
  if (!frontend || frontend.frontend !== 'canonical-router-handler') {
    throw new TypeError('buildRouterHandlerIr requires a prepared canonical-router-handler frontend.');
  }
  const operationSummary = summarizeHandlerOperation(frontend.body);
  return Object.freeze({
    version: HANDLER_IR_VERSION,
    kind: ROUTER_HANDLER_IR_KIND,
    frontend: frontend.frontend,
    file: frontend.fileName,
    sourceFile: frontend.sourceFile,
    handler: frontend.functionNode,
    ctxName: frontend.signature.ctxName || 'ctx',
    nextName: frontend.signature.nextName,
    errorName: frontend.signature.errorName,
    role: frontend.role,
    transferFlag: frontend.transferFlag,
    routerEntry: frontend.entry,
    route: frontend.route,
    body: frontend.body,
    analysis: frontend.analysis,
    schemaBundle: frontend.schemaBundle,
    effectSites: Object.freeze([]),
    continuationSites: Object.freeze([]),
    packageEffects: Object.freeze([]),
    packageResultAdapters: Object.freeze([]),
    summary: Object.freeze({
      operationCount: operationSummary.operationCount,
      operationKinds: operationSummary.operationKinds,
      effectCount: 0,
      continuationCount: 0,
      flow: frontend.flow
    })
  });
}

function handlerIrSnapshot(ir) {
  if (!ir || ir.version !== HANDLER_IR_VERSION) return undefined;
  return Object.freeze({
    version: ir.version,
    kind: ir.kind,
    frontend: ir.frontend,
    file: ir.file,
    ctxName: ir.ctxName,
    summary: ir.summary,
    analysis: Object.freeze({
      capabilities: ir.analysis.capabilities,
      fetchCount: ir.analysis.fetchCount,
      schemaReferences: ir.analysis.schemaReferences,
      providerOperations: ir.analysis.providerOperations
    }),
    effectSites: ir.effectSites,
    continuationSites: ir.continuationSites
  });
}

module.exports = Object.freeze({
  HANDLER_IR_VERSION,
  HANDLER_IR_KIND,
  ROUTER_HANDLER_IR_KIND,
  HANDLER_IR_OPERATION_KINDS,
  HANDLER_IR_EXTENSION_OPERATION_KINDS,
  ROUTER_HANDLER_IR_OPERATION_KINDS,
  ALL_HANDLER_IR_OPERATION_KINDS,
  staticResource,
  createHandlerOperation,
  summarizeHandlerOperation,
  buildPlainHandlerIr,
  buildRouterHandlerIr,
  handlerIrSnapshot
});
