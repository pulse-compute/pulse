'use strict';

const ts = require('typescript');

function loadGraphContract() {
  try {
    return require('@pulse-compute/wasm-contracts/project/reachable-graph');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/project/reachable-graph.js');
    }
    throw error;
  }
}

const graph = loadGraphContract();

function loadProductProjectionContract() {
  try {
    return require('@pulse-compute/wasm-contracts/project/package-product-projection');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/project/package-product-projection.js');
    }
    throw error;
  }
}

const productProjection = loadProductProjectionContract();

const COMPILER_PACKAGE_REACHABILITY_VERSION = 'pulse.compiler-package-reachability.v2';
const KNOWN_PROVIDER_PACKAGE_PATTERN = /^@pulse-compute\/(?:provider-|wasm-provider-)/;
const KNOWN_LIFECYCLE_SYMBOLS = Object.freeze(['bindAndServe', 'listen', 'serve', 'start']);

class PackageReachabilityError extends Error {
  constructor(message, diagnostics = [], detail = {}) {
    super(message);
    this.name = 'PackageReachabilityError';
    this.code = 'PULSE_PACKAGE_REACHABILITY_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
    this.detail = Object.freeze({ ...detail });
  }
}

function sourceLocation(context, module, node) {
  const offset = node && typeof node.getStart === 'function' ? node.getStart(module.sourceFile) : 0;
  const point = module.sourceFile.getLineAndCharacterOfPosition(offset);
  return Object.freeze({ file: module.path, line: point.line + 1, column: point.character + 1 });
}

function graphDiagnostic(code, message, source, detail = {}) {
  return Object.freeze({
    code,
    kind: 'PackageReachabilityDiagnostic',
    severity: 'error',
    message,
    file: source.file,
    position: Object.freeze({ line: source.line, column: source.column }),
    detail: Object.freeze({ ...detail })
  });
}

function mapByModulePath(manifest) {
  return new Map(manifest.modules.filter((entry) => entry.kind === 'project').map((entry) => [entry.path, entry]));
}

function packageRecordForPrivateModule(manifest, module) {
  return manifest.modules.find((entry) => entry.kind === 'package'
    && entry.packageName === module.packageName
    && entry.packageVersion === module.packageVersion
    && entry.packageSubpath === module.packageSubpath
    && entry.packageManifestHash === module.packageManifestHash);
}

function packageRelation(context, module, relation) {
  const resolution = module.resolutions.find((entry) => entry.relation === relation);
  if (!resolution) return undefined;
  const target = context.packageModules.get(resolution.targetKey);
  if (!target) return undefined;
  return Object.freeze({ relation, resolution, target });
}

function originKey(origin) {
  return [origin.packageKey, origin.importedName, origin.contractId || '', origin.via].join('\u0000');
}

function compatibleOrigin(left, right) {
  return left.packageKey === right.packageKey && left.importedName === right.importedName && left.contractId === right.contractId && left.productRole === right.productRole;
}

function setBinding(map, name, origin, diagnostics, source, field) {
  if (!name) return false;
  const current = map.get(name);
  if (!current) {
    map.set(name, Object.freeze({ ...origin }));
    return true;
  }
  if (compatibleOrigin(current, origin)) {
    if (current.via === origin.via && current.direct === origin.direct) return false;
    const preferred = current.direct && !origin.direct ? current : (!current.direct && origin.direct ? origin : current);
    if (preferred !== current) map.set(name, Object.freeze({ ...preferred }));
    return false;
  }
  diagnostics.push(graphDiagnostic(
    'PULSE_PACKAGE_BINDING_OWNERSHIP_AMBIGUOUS',
    `Package binding ${field} ${name} resolves to more than one package-owned symbol.`,
    source,
    {
      name,
      existing: Object.freeze({ packageName: current.packageName, importedName: current.importedName, contractId: current.contractId, role: current.productRole }),
      candidate: Object.freeze({ packageName: origin.packageName, importedName: origin.importedName, contractId: origin.contractId, role: origin.productRole })
    }
  ));
  return false;
}

function cloneOrigin(origin, changes) {
  return Object.freeze({ ...origin, ...changes });
}

function packageOrigin(target, importedName, source, via, direct) {
  return Object.freeze({
    packageKey: target.key,
    packageName: target.packageName,
    packageSubpath: target.packageSubpath,
    contractId: target.packageContract || null,
    lowerableSubpath: target.contract && target.contract.lowerableSubpath || null,
    productRole: target.productRole || (target.contract ? 'authoring' : null),
    importedName,
    source,
    via,
    direct
  });
}

function moduleOwnershipState(context) {
  const states = new Map();
  for (const module of context.projectModules.values()) {
    states.set(module.path, { module, locals: new Map(), exports: new Map(), references: new Map() });
  }
  return states;
}

function isDeclarationName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
      || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)
      || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)
      || ts.isTypeParameterDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isEnumMember(parent))
      && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isLabeledStatement(parent) && parent.label === node) return true;
  if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return true;
  return false;
}

function inTypePosition(node) {
  let current = node.parent;
  while (current) {
    if (ts.isTypeNode(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)
      || ts.isImportTypeNode(current) || ts.isTypeParameterDeclaration(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current) || ts.isSourceFile(current)) return false;
    current = current.parent;
  }
  return false;
}

function collectValueReferences(context, state) {
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node) && !isDeclarationName(node) && !inTypePosition(node)) {
      if (!state.references.has(node.text)) state.references.set(node.text, sourceLocation(context, state.module, node));
    }
    ts.forEachChild(node, visit);
  }
  visit(state.module.sourceFile);
}

function buildPackageBindingOwnership(context) {
  const states = moduleOwnershipState(context);
  const diagnostics = [];

  for (const state of states.values()) {
    collectValueReferences(context, state);
    for (const relation of state.module.imports) {
      if (relation.kind !== 'runtime-import') continue;
      const resolved = packageRelation(context, state.module, relation);
      if (!resolved) continue;
      for (const binding of relation.bindings) {
        setBinding(state.locals, binding.localName,
          packageOrigin(resolved.target, binding.importedName, relation.source, 'direct-import', true),
          diagnostics, relation.source, 'local');
      }
    }
    for (const relation of state.module.reExports) {
      if (relation.typeOnly === true) continue;
      const resolved = packageRelation(context, state.module, relation);
      if (!resolved) continue;
      if (relation.star) {
        for (const symbol of resolved.target.contract && resolved.target.contract.facadeSymbols || []) {
          setBinding(state.exports, symbol,
            packageOrigin(resolved.target, symbol, relation.source, 'direct-re-export', true),
            diagnostics, relation.source, 'export');
        }
      } else {
        for (const mapping of relation.mappings) {
          setBinding(state.exports, mapping.exportName,
            packageOrigin(resolved.target, mapping.localName, relation.source, 'direct-re-export', true),
            diagnostics, relation.source, 'export');
        }
      }
    }
  }

  let changed = true;
  let iterations = 0;
  while (changed) {
    changed = false;
    iterations += 1;
    if (iterations > Math.max(4, states.size * 4)) throw new Error('Package ownership propagation did not converge.');
    for (const state of states.values()) {
      for (const [exportName, localName] of state.module.localExports) {
        const origin = state.locals.get(localName);
        if (!origin) continue;
        const via = origin.direct ? 'direct-re-export' : 'project-re-export';
        changed = setBinding(state.exports, exportName, cloneOrigin(origin, { via, direct: origin.direct }), diagnostics, origin.source, 'export') || changed;
      }
      for (const relation of state.module.imports) {
        if (relation.kind !== 'runtime-import') continue;
        const resolution = state.module.resolutions.find((entry) => entry.relation === relation);
        const targetState = resolution && states.get(resolution.targetKey);
        if (!targetState) continue;
        for (const binding of relation.bindings) {
          if (binding.importedName === '*') continue;
          const origin = targetState.exports.get(binding.importedName);
          if (!origin) continue;
          changed = setBinding(state.locals, binding.localName,
            cloneOrigin(origin, { source: relation.source, via: 'project-import', direct: false }),
            diagnostics, relation.source, 'local') || changed;
        }
      }
      for (const relation of state.module.reExports) {
        if (relation.typeOnly === true) continue;
        const resolution = state.module.resolutions.find((entry) => entry.relation === relation);
        const targetState = resolution && states.get(resolution.targetKey);
        if (!targetState) continue;
        if (relation.star) {
          for (const [exportName, origin] of targetState.exports) {
            changed = setBinding(state.exports, exportName,
              cloneOrigin(origin, { source: relation.source, via: 'project-re-export', direct: false }),
              diagnostics, relation.source, 'export') || changed;
          }
        } else {
          for (const mapping of relation.mappings) {
            const origin = targetState.exports.get(mapping.localName);
            if (!origin) continue;
            changed = setBinding(state.exports, mapping.exportName,
              cloneOrigin(origin, { source: relation.source, via: 'project-re-export', direct: false }),
              diagnostics, relation.source, 'export') || changed;
          }
        }
      }
    }
  }

  if (diagnostics.length > 0) throw new PackageReachabilityError(
    `Package binding ownership failed with ${diagnostics.length} diagnostic(s).`,
    diagnostics,
    { modules: states.size }
  );
  return states;
}

function packageLocalForCall(state, call) {
  if (ts.isIdentifier(call.expression)) {
    const origin = state.locals.get(call.expression.text);
    if (!origin) return undefined;
    return Object.freeze({ origin, symbol: origin.importedName, localName: call.expression.text });
  }
  if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
    const origin = state.locals.get(call.expression.expression.text);
    if (!origin || origin.importedName !== '*') return undefined;
    return Object.freeze({ origin, symbol: call.expression.name.text, localName: call.expression.expression.text });
  }
  return undefined;
}

function addKnownLifecycleEdges(context, states) {
  const findings = [];
  const seen = new Set();
  for (const state of states.values()) {
    if (!state.module.runtime) continue;
    let functionDepth = 0;
    function visit(node) {
      const entersFunction = ts.isFunctionLike(node) || ts.isClassLike(node);
      if (entersFunction) functionDepth += 1;
      if (functionDepth === 0 && ts.isCallExpression(node)) {
        const resolved = packageLocalForCall(state, node);
        if (resolved && KNOWN_PROVIDER_PACKAGE_PATTERN.test(resolved.origin.packageName)
          && KNOWN_LIFECYCLE_SYMBOLS.includes(resolved.symbol)) {
          const source = sourceLocation(context, state.module, node);
          const key = [state.module.path, resolved.origin.packageKey, resolved.symbol, source.file, source.line, source.column].join('\u0000');
          if (!seen.has(key)) {
            seen.add(key);
            const target = context.packageModules.get(resolved.origin.packageKey);
            const classification = target && target.classification;
            const edge = {
              kind: 'lifecycle',
              from: state.module.path,
              to: resolved.origin.packageKey,
              specifier: target && target.specifier || resolved.origin.packageName,
              resolutionKind: classification && classification.kind || 'package-root',
              runtime: true,
              importedNames: [resolved.symbol],
              exportedNames: [],
              packageContract: target && target.packageContract || null,
              source
            };
            context.edges.push(edge);
            findings.push(Object.freeze({ ...edge, symbol: resolved.symbol, packageName: resolved.origin.packageName }));
          }
        }
      }
      ts.forEachChild(node, visit);
      if (entersFunction) functionDepth -= 1;
    }
    visit(state.module.sourceFile);
  }
  return Object.freeze(findings);
}

function packageRelationsForModule(context, targetKey) {
  const records = [];
  for (const module of context.projectModules.values()) {
    for (const relation of [...module.imports, ...module.reExports]) {
      const resolution = module.resolutions.find((entry) => entry.relation === relation);
      if (!resolution || resolution.targetKey !== targetKey) continue;
      records.push(Object.freeze({ module, relation }));
    }
  }
  return records;
}


function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)))) current = current.expression;
  return current;
}

function isProfileTokenCall(node) {
  const current = unwrapExpression(node);
  return Boolean(current && ts.isCallExpression(current)
    && current.arguments.length === 0
    && ts.isPropertyAccessExpression(current.expression)
    && current.expression.name.text === 'profile');
}

function collectPackageCompositions(context, states) {
  const records = [];
  const diagnostics = [];
  for (const state of states.values()) {
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const expression = unwrapExpression(node.expression);
        if (expression && ts.isIdentifier(expression)) {
          const origin = state.locals.get(expression.text);
          if (origin && origin.productRole === 'helper' && origin.contractId) {
            const packageModule = context.packageModules.get(origin.packageKey);
            const contract = packageModule && packageModule.productContract;
            const source = sourceLocation(context, state.module, node);
            const valid = node.arguments.length === 1 && isProfileTokenCall(node.arguments[0]);
            records.push(Object.freeze({
              modulePath: state.module.path,
              localName: expression.text,
              contractId: origin.contractId,
              packageName: origin.packageName,
              helperSymbol: origin.importedName,
              source,
              valid,
              compositionStatus: contract && contract.composition.status || 'not-realized',
              reasonCode: contract && contract.composition.reasonCode || 'PULSE_PACKAGE_COMPOSITION_HELPER_NOT_REALIZED'
            }));
            if (!valid) diagnostics.push(graphDiagnostic(
              'PULSE_PACKAGE_COMPOSITION_HELPER_USE_INVALID',
              `Package composition helper ${expression.text} must receive exactly one direct app.profile() token.`,
              source,
              { packageName: origin.packageName, contractId: origin.contractId, argumentCount: node.arguments.length }
            ));
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(state.module.sourceFile);
  }
  return Object.freeze({ records: Object.freeze(records), diagnostics: Object.freeze(diagnostics) });
}

function derivePackageProductProjection(context, manifest, states, compositions) {
  const projectByPath = mapByModulePath(manifest);
  const contracts = context.packageContractCatalog.productCatalog.contracts.map((entry) => ({
    contractId: entry.contractId,
    packageName: entry.npmPackage,
    packageVersion: entry.packageVersion,
    metadataHash: entry.metadataHash,
    profileFragment: entry.ownership.profileFragment,
    helperImports: entry.ownership.helperImports,
    reExportImports: entry.ownership.reExportImports,
    authoringImport: entry.authoring.import,
    authoringSymbols: entry.authoring.symbols,
    compositionStatus: entry.composition.status,
    compositionHelper: entry.composition.helperSymbol,
    compositionReasonCode: entry.composition.reasonCode,
    nativeTarget: entry.targets.native,
    javascriptTarget: entry.targets.javascript,
    conformanceStatus: entry.conformance.status,
    conformanceFixtureRoots: entry.conformance.fixtureRoots,
    conformanceSemanticCases: entry.conformance.semanticCases
  }));
  const bindings = [];
  for (const state of states.values()) {
    const projectModule = projectByPath.get(state.module.path);
    if (!projectModule) continue;
    for (const [localName, origin] of state.locals) {
      if (!origin.contractId || !origin.productRole) continue;
      const packageModule = context.packageModules.get(origin.packageKey);
      const packageRecord = packageModule && packageRecordForPrivateModule(manifest, packageModule);
      if (!packageRecord) continue;
      bindings.push({
        moduleId: projectModule.id,
        localName,
        exportName: null,
        importedName: origin.importedName,
        packageModuleId: packageRecord.id,
        packageName: origin.packageName,
        contractId: origin.contractId,
        role: origin.productRole,
        source: origin.source,
        via: origin.via,
        direct: origin.direct,
        used: state.references.has(localName)
      });
    }
    for (const [exportName, origin] of state.exports) {
      if (!origin.contractId || !origin.productRole) continue;
      const packageModule = context.packageModules.get(origin.packageKey);
      const packageRecord = packageModule && packageRecordForPrivateModule(manifest, packageModule);
      if (!packageRecord) continue;
      bindings.push({
        moduleId: projectModule.id,
        localName: null,
        exportName,
        importedName: origin.importedName,
        packageModuleId: packageRecord.id,
        packageName: origin.packageName,
        contractId: origin.contractId,
        role: origin.productRole,
        source: origin.source,
        via: origin.via,
        direct: origin.direct,
        used: false
      });
    }
  }
  const selectedContracts = [...new Set(bindings.filter((entry) => entry.used).map((entry) => entry.contractId))];
  const composedContracts = [...new Set(compositions.records.filter((entry) => entry.valid).map((entry) => entry.contractId))];
  const activeContracts = new Set([...selectedContracts, ...composedContracts]);
  const fragmentKeys = new Set(Object.keys(context.projectFragments || {}));
  const fragments = contracts.map((entry) => ({
    key: entry.profileFragment,
    contractId: entry.contractId,
    packageName: entry.packageName,
    present: fragmentKeys.has(entry.profileFragment),
    selected: activeContracts.has(entry.contractId)
  }));
  for (const key of [...fragmentKeys].sort()) {
    if (!fragments.some((entry) => entry.key === key)) fragments.push({ key, contractId: null, packageName: null, present: true, selected: false });
  }
  return productProjection.normalizePackageProductProjection({
    graphHash: manifest.graphHash,
    contracts,
    bindings,
    fragments,
    selectedContracts,
    composedContracts
  });
}

function derivePackageReachabilityProjection(context, manifest, states) {
  const projectByPath = mapByModulePath(manifest);
  const packages = [];
  const bindings = [];
  const selectedContracts = new Set();
  for (const module of context.packageModules.values()) {
    const record = packageRecordForPrivateModule(manifest, module);
    if (!record) continue;
    const relations = packageRelationsForModule(context, module.key);
    const importSources = relations.filter((entry) => entry.relation.kind === 'runtime-import').map((entry) => entry.relation.source);
    const reExportSources = relations.filter((entry) => entry.relation.kind === 're-export' && entry.relation.typeOnly !== true).map((entry) => entry.relation.source);
    let nativeStatus = 'unsupported';
    if (module.coreAuthoring) nativeStatus = 'core-authoring';
    else if (module.packageContract && module.contract && module.contract.targetSupport.native === true) nativeStatus = 'trusted-lowerable';
    if (module.runtime && nativeStatus === 'trusted-lowerable') selectedContracts.add(module.packageContract);
    packages.push({
      moduleId: record.id,
      packageName: module.packageName,
      packageVersion: module.packageVersion,
      packageSubpath: module.packageSubpath,
      owner: module.owner,
      runtime: module.runtime === true,
      contractId: module.packageContract || null,
      lowerableSubpath: module.contract && module.contract.lowerableSubpath || null,
      facadeSymbols: module.contract && module.contract.facadeSymbols || [],
      importSources,
      reExportSources,
      nativeStatus
    });
  }
  for (const state of states.values()) {
    const projectModule = projectByPath.get(state.module.path);
    if (!projectModule) continue;
    for (const [localName, origin] of state.locals) {
      const packageModule = context.packageModules.get(origin.packageKey);
      const packageRecord = packageModule && packageRecordForPrivateModule(manifest, packageModule);
      if (!packageRecord) continue;
      bindings.push({
        moduleId: projectModule.id,
        localName,
        exportName: null,
        importedName: origin.importedName,
        packageModuleId: packageRecord.id,
        packageName: origin.packageName,
        contractId: origin.contractId,
        source: origin.source,
        via: origin.via,
        direct: origin.direct,
        used: state.references.has(localName)
      });
    }
    for (const [exportName, origin] of state.exports) {
      const packageModule = context.packageModules.get(origin.packageKey);
      const packageRecord = packageModule && packageRecordForPrivateModule(manifest, packageModule);
      if (!packageRecord) continue;
      bindings.push({
        moduleId: projectModule.id,
        localName: null,
        exportName,
        importedName: origin.importedName,
        packageModuleId: packageRecord.id,
        packageName: origin.packageName,
        contractId: origin.contractId,
        source: origin.source,
        via: origin.via,
        direct: origin.direct,
        used: false
      });
    }
  }
  return graph.normalizePackageReachabilityProjection({
    graphVersion: manifest.version,
    graphHash: manifest.graphHash,
    packages,
    bindings,
    selectedContracts: [...selectedContracts]
  });
}

function deriveApplicationEntrySafety(manifest) {
  const modulesById = new Map(manifest.modules.map((entry) => [entry.id, entry]));
  return graph.normalizeApplicationEntrySafety({
    graphHash: manifest.graphHash,
    lifecycleEdges: manifest.edges.filter((edge) => edge.kind === 'lifecycle').map((edge) => {
      const from = modulesById.get(edge.from);
      const target = modulesById.get(edge.to);
      return {
        edgeId: edge.id,
        moduleId: edge.from,
        packageModuleId: edge.to,
        packageName: target.packageName,
        symbol: edge.importedNames[0] || '<unknown>',
        source: edge.source
      };
    })
  });
}

function relationSpecifier(context, moduleKey) {
  const relations = packageRelationsForModule(context, moduleKey).filter((entry) => entry.relation.kind !== 'type-import');
  relations.sort((left, right) => left.relation.source.file.localeCompare(right.relation.source.file)
    || left.relation.source.line - right.relation.source.line
    || left.relation.source.column - right.relation.source.column);
  return relations[0] && relations[0].relation.specifier;
}

function deriveNativeEligibilityProjection(context, manifest, packageReachability, entrySafety, packageProduct, compositions) {
  const projectByPath = mapByModulePath(manifest);
  const packageById = new Map(packageReachability.packages.map((entry) => [entry.moduleId, entry]));
  const blockers = [];

  for (const packageEntry of packageReachability.packages) {
    if (!packageEntry.runtime || packageEntry.nativeStatus !== 'unsupported') continue;
    const privateModule = [...context.packageModules.values()].find((entry) => {
      const record = packageRecordForPrivateModule(manifest, entry);
      return record && record.id === packageEntry.moduleId;
    });
    if (!privateModule) continue;
    if (privateModule.productContract && ['helper', 're-export'].includes(privateModule.productRole)) continue;
    const relations = packageRelationsForModule(context, privateModule.key).filter((entry) => entry.relation.kind !== 'type-import');
    for (const relation of relations) {
      const projectModule = projectByPath.get(relation.module.path);
      if (!projectModule) continue;
      const knownSubpaths = context.packageContractsByPackage.get(privateModule.packageName) || [];
      const unsupportedSubpath = knownSubpaths.length > 0 && !privateModule.contract;
      blockers.push({
        kind: unsupportedSubpath ? 'unsupported-package-subpath' : 'unsupported-package',
        code: unsupportedSubpath ? 'PULSE_PACKAGE_SUBPATH_UNSUPPORTED' : 'PULSE_NATIVE_IMPORT_UNSUPPORTED',
        moduleId: projectModule.id,
        handlerIds: [],
        packageName: privateModule.packageName,
        packageSubpath: privateModule.packageSubpath,
        contractId: null,
        specifier: relation.relation.specifier,
        source: relation.relation.source,
        message: unsupportedSubpath
          ? `Package ${privateModule.packageName} participates in Pulse native lowering only through ${knownSubpaths.map((entry) => entry.lowerableSubpath).join(', ')}; ${relation.relation.specifier} is not a native-lowerable subpath.`
          : `Runtime package import ${relation.relation.specifier} has no trusted Pulse native contract.`
      });
    }
  }

  const modulesById = new Map(manifest.modules.map((entry) => [entry.id, entry]));
  for (const edge of manifest.edges) {
    if (!edge.runtime) continue;
    const target = modulesById.get(edge.to);
    const sourceModule = modulesById.get(edge.from);
    if (!target || target.kind !== 'external' || !sourceModule || sourceModule.kind !== 'project') continue;
    blockers.push({
      kind: 'unsupported-package',
      code: 'PULSE_NATIVE_IMPORT_UNSUPPORTED',
      moduleId: sourceModule.id,
      handlerIds: [],
      packageName: null,
      packageSubpath: null,
      contractId: null,
      specifier: edge.specifier,
      source: edge.source,
      message: `Runtime external import ${edge.specifier} has no Pulse native realization.`
    });
  }

  for (const binding of packageReachability.bindings) {
    if (!binding.used || !['project-import', 'project-re-export'].includes(binding.via) || !binding.contractId) continue;
    blockers.push({
      kind: 'package-re-export-lowering-deferred',
      code: 'PULSE_PACKAGE_REEXPORT_LOWERING_DEFERRED',
      moduleId: binding.moduleId,
      handlerIds: [],
      packageName: binding.packageName,
      packageSubpath: packageById.get(binding.packageModuleId).packageSubpath,
      contractId: binding.contractId,
      specifier: binding.packageName,
      source: binding.source,
      message: `Package-owned symbol ${binding.importedName} reaches application code through a project re-export. Direct package ownership is recorded, but re-exported package lowering is deferred to the package-facade proof.`
    });
  }


  const modulePathById = new Map(manifest.modules.map((entry) => [entry.id, entry.path]));
  const validCompositionBindings = new Set(compositions.records
    .filter((entry) => entry.valid)
    .map((entry) => `${entry.modulePath}:${entry.localName}`));
  for (const binding of packageProduct.bindings) {
    if (!binding.used || !binding.localName || !['helper', 're-export'].includes(binding.role)) continue;
    const modulePath = modulePathById.get(binding.moduleId);
    if (modulePath && validCompositionBindings.has(`${modulePath}:${binding.localName}`)) continue;
    blockers.push({
      kind: 'unsupported-package-subpath',
      code: 'PULSE_PACKAGE_SUBPATH_UNSUPPORTED',
      moduleId: binding.moduleId,
      handlerIds: [],
      packageName: binding.packageName,
      packageSubpath: '.',
      contractId: binding.contractId,
      specifier: binding.packageName,
      source: binding.source,
      message: `Package root ${binding.packageName} is reserved for direct composition-helper use with app.profile(); other runtime use remains unsupported.`
    });
  }

  for (const composition of compositions.records) {
    if (!composition.valid || composition.compositionStatus === 'supported') continue;
    const projectModule = projectByPath.get(composition.modulePath);
    if (!projectModule) continue;
    blockers.push({
      kind: 'package-composition-not-realized',
      code: composition.reasonCode || 'PULSE_PACKAGE_COMPOSITION_HELPER_NOT_REALIZED',
      moduleId: projectModule.id,
      handlerIds: [],
      packageName: composition.packageName,
      packageSubpath: '.',
      contractId: composition.contractId,
      specifier: composition.packageName,
      source: composition.source,
      message: `Package composition helper ${composition.helperSymbol} is graph-owned by ${composition.contractId}, but its composition behavior is ${composition.compositionStatus}.`
    });
  }

  for (const finding of entrySafety.lifecycleEdges) {
    blockers.push({
      kind: 'application-entry-lifecycle-side-effect',
      code: 'PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT',
      moduleId: finding.moduleId,
      handlerIds: [],
      packageName: finding.packageName,
      packageSubpath: '.',
      contractId: null,
      specifier: finding.packageName,
      source: finding.source,
      message: `The configured application entry graph invokes known provider lifecycle operation ${finding.symbol} during module evaluation.`
    });
  }

  const handlersByModule = new Map();
  for (const handler of manifest.handlers) {
    if (!handlersByModule.has(handler.moduleId)) handlersByModule.set(handler.moduleId, []);
    handlersByModule.get(handler.moduleId).push(handler.id);
  }
  const normalizedBlockers = blockers.map((blocker) => ({ ...blocker, handlerIds: handlersByModule.get(blocker.moduleId) || [] }));
  const preview = graph.normalizeNativeEligibilityProjection({ graphHash: manifest.graphHash, blockers: normalizedBlockers, handlers: [] });
  const blockersByModule = new Map();
  for (const blocker of preview.blockers) {
    if (!blockersByModule.has(blocker.moduleId)) blockersByModule.set(blocker.moduleId, []);
    blockersByModule.get(blocker.moduleId).push(blocker.id);
  }
  return graph.normalizeNativeEligibilityProjection({
    graphHash: manifest.graphHash,
    blockers: normalizedBlockers,
    handlers: manifest.handlers.map((handler) => ({
      handlerId: handler.id,
      moduleId: handler.moduleId,
      eligible: !blockersByModule.has(handler.moduleId),
      blockerIds: blockersByModule.get(handler.moduleId) || []
    }))
  });
}

function deriveReachableGraphProjections(context, manifest, statesInput) {
  const states = statesInput || buildPackageBindingOwnership(context);
  const compositions = collectPackageCompositions(context, states);
  if (compositions.diagnostics.length > 0) throw new PackageReachabilityError('Package composition validation failed.', compositions.diagnostics, { diagnostics: compositions.diagnostics });
  const packageReachability = derivePackageReachabilityProjection(context, manifest, states);
  const packageProduct = derivePackageProductProjection(context, manifest, states, compositions);
  const entrySafety = deriveApplicationEntrySafety(manifest);
  const nativeEligibility = deriveNativeEligibilityProjection(context, manifest, packageReachability, entrySafety, packageProduct, compositions);
  return Object.freeze({
    version: COMPILER_PACKAGE_REACHABILITY_VERSION,
    packageReachability,
    packageProduct,
    entrySafety,
    nativeEligibility
  });
}

module.exports = Object.freeze({
  COMPILER_PACKAGE_REACHABILITY_VERSION,
  KNOWN_PROVIDER_PACKAGE_PATTERN,
  KNOWN_LIFECYCLE_SYMBOLS,
  PackageReachabilityError,
  buildPackageBindingOwnership,
  addKnownLifecycleEdges,
  derivePackageReachabilityProjection,
  derivePackageProductProjection,
  deriveApplicationEntrySafety,
  deriveNativeEligibilityProjection,
  deriveReachableGraphProjections
});
