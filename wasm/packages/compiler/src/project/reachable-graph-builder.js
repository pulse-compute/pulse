'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { discoverPackageContractCatalog } = require('../spine/package-operation-seam.js');
const {
  PackageReachabilityError,
  buildPackageBindingOwnership,
  addKnownLifecycleEdges,
  deriveReachableGraphProjections
} = require('./package-reachability.js');

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

const PROJECT_GRAPH_BUILDER_VERSION = 'pulse.compiler-project-graph-builder.v1';
const PROJECT_GRAPH_CONTEXT_VERSION = 'pulse.compiler-project-graph-context.v1';
const CORE_AUTHORING_PACKAGES = new Set(['@pulse-compute/runtime', '@pulse-compute/pulse']);
const contexts = new WeakMap();

class ReachableProjectGraphError extends Error {
  constructor(message, diagnostics = [], detail = {}) {
    super(message);
    this.name = 'ReachableProjectGraphError';
    this.code = 'PULSE_PROJECT_GRAPH_FAILED';
    this.diagnostics = Object.freeze([...diagnostics]);
    this.detail = Object.freeze({ ...detail });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function scriptKindForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts' || ext === '.d.ts' || ext === '.d.mts' || ext === '.d.cts') return ts.ScriptKind.TS;
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.json') return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

function moduleFormat(filePath) {
  const normalized = String(filePath).toLowerCase();
  if (/\.d\.(?:ts|mts|cts)$/.test(normalized)) return 'declaration';
  const ext = path.extname(normalized);
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'typescript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
  if (ext === '.json') return 'json';
  return 'typescript';
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function portablePath(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
  if (!relative) return '.';
  return graph.normalizePortablePath(relative, 'project module path', { allowDot: false });
}

function portableFilePath(rootDir, filePath) {
  const value = portablePath(rootDir, filePath);
  if (value === '.') throw new TypeError('Expected a file below the workspace root.');
  return value;
}

function portableSourceFileName(rootDir, fileName) {
  if (path.isAbsolute(fileName)) return portableFilePath(rootDir, fileName);
  return graph.normalizePortablePath(String(fileName).replace(/\\/g, '/'), 'project module source', { allowDot: false });
}

function sourceLocation(rootDir, sourceFile, node) {
  const target = node || sourceFile;
  const offset = target && typeof target.getStart === 'function' ? target.getStart(sourceFile) : 0;
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  const file = path.isAbsolute(sourceFile.fileName)
    ? portableFilePath(rootDir, sourceFile.fileName)
    : graph.normalizePortablePath(sourceFile.fileName, 'source file');
  return Object.freeze({
    file,
    line: point.line + 1,
    column: point.character + 1
  });
}

function diagnostic(rootDir, sourceFile, node, code, message, detail = {}) {
  const location = sourceLocation(rootDir, sourceFile, node);
  return Object.freeze({
    code,
    kind: 'ReachableProjectGraphDiagnostic',
    severity: 'error',
    message,
    file: location.file,
    position: Object.freeze({ line: location.line, column: location.column }),
    detail: Object.freeze({ ...detail })
  });
}

function hasModifier(node, kind) {
  return Boolean(node && node.modifiers && node.modifiers.some((modifier) => modifier.kind === kind));
}

function isTypeOnlyImport(statement) {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return Boolean(!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((element) => element.isTypeOnly));
}

function importBindings(statement) {
  const clause = statement.importClause;
  if (!clause) return Object.freeze([]);
  const out = [];
  if (clause.name) out.push(Object.freeze({ localName: clause.name.text, importedName: 'default', typeOnly: clause.isTypeOnly === true }));
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    out.push(Object.freeze({ localName: bindings.name.text, importedName: '*', namespace: true, typeOnly: clause.isTypeOnly === true }));
  } else if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      out.push(Object.freeze({
        localName: element.name.text,
        importedName: element.propertyName ? element.propertyName.text : element.name.text,
        typeOnly: clause.isTypeOnly === true || element.isTypeOnly === true
      }));
    }
  }
  return Object.freeze(out);
}

function exportNameForDeclaration(statement) {
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return undefined;
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return 'default';
  return statement.name && ts.isIdentifier(statement.name) ? statement.name.text : undefined;
}

function propertyNameText(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return String(node.text);
  return undefined;
}

function parseModule(rootDir, absolutePath, logicalPathInput) {
  const sourceText = fs.readFileSync(absolutePath, 'utf8');
  const logicalPath = logicalPathInput ? graph.normalizePortablePath(logicalPathInput, 'project module path') : portableFilePath(rootDir, absolutePath);
  const sourceFile = ts.createSourceFile(logicalPath, sourceText, ts.ScriptTarget.ES2022, true, scriptKindForFile(absolutePath));
  const imports = [];
  const reExports = [];
  const localExports = new Map();
  const localDeclarations = new Set();
  const parseDiagnostics = [];

  for (const entry of sourceFile.parseDiagnostics || []) {
    const start = entry.start || 0;
    const node = sourceFile;
    const point = sourceFile.getLineAndCharacterOfPosition(start);
    parseDiagnostics.push(Object.freeze({
      code: 'PULSE_PROJECT_MODULE_SYNTAX_ERROR',
      kind: 'ReachableProjectGraphDiagnostic',
      severity: 'error',
      message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
      file: logicalPath,
      position: Object.freeze({ line: point.line + 1, column: point.character + 1 }),
      detail: Object.freeze({ typescriptCode: entry.code })
    }));
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = importBindings(statement);
      const typeBindings = bindings.filter((binding) => binding.typeOnly === true);
      const runtimeBindings = bindings.filter((binding) => binding.typeOnly !== true);
      const source = sourceLocation(rootDir, sourceFile, statement.moduleSpecifier);
      if (!statement.importClause || runtimeBindings.length > 0) {
        imports.push(Object.freeze({
          kind: 'runtime-import',
          specifier: statement.moduleSpecifier.text,
          bindings: Object.freeze(runtimeBindings),
          importedNames: Object.freeze(runtimeBindings.map((binding) => binding.importedName)),
          exportedNames: Object.freeze([]),
          source,
          statement
        }));
      }
      if (statement.importClause && (statement.importClause.isTypeOnly === true || typeBindings.length > 0)) {
        const selected = statement.importClause.isTypeOnly === true ? bindings : typeBindings;
        imports.push(Object.freeze({
          kind: 'type-import',
          specifier: statement.moduleSpecifier.text,
          bindings: Object.freeze(selected),
          importedNames: Object.freeze(selected.map((binding) => binding.importedName)),
          exportedNames: Object.freeze([]),
          source,
          statement
        }));
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
      const typeOnly = statement.isTypeOnly === true;
      const mappings = [];
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          mappings.push(Object.freeze({
            localName: element.propertyName ? element.propertyName.text : element.name.text,
            exportName: element.name.text,
            typeOnly: typeOnly || element.isTypeOnly === true
          }));
        }
      }
      if (moduleSpecifier) {
        const source = sourceLocation(rootDir, sourceFile, statement.moduleSpecifier);
        if (!statement.exportClause) {
          reExports.push(Object.freeze({
            kind: 're-export',
            specifier: moduleSpecifier,
            star: true,
            typeOnly,
            mappings: Object.freeze([]),
            importedNames: Object.freeze([]),
            exportedNames: Object.freeze([]),
            source,
            statement
          }));
        } else {
          const runtimeMappings = mappings.filter((mapping) => mapping.typeOnly !== true);
          const typeMappings = mappings.filter((mapping) => mapping.typeOnly === true);
          if (runtimeMappings.length > 0) reExports.push(Object.freeze({
            kind: 're-export',
            specifier: moduleSpecifier,
            star: false,
            typeOnly: false,
            mappings: Object.freeze(runtimeMappings),
            importedNames: Object.freeze(runtimeMappings.map((entry) => entry.localName)),
            exportedNames: Object.freeze(runtimeMappings.map((entry) => entry.exportName)),
            source,
            statement
          }));
          if (typeOnly || typeMappings.length > 0) {
            const selected = typeOnly ? mappings : typeMappings;
            reExports.push(Object.freeze({
              kind: 're-export',
              specifier: moduleSpecifier,
              star: false,
              typeOnly: true,
              mappings: Object.freeze(selected),
              importedNames: Object.freeze(selected.map((entry) => entry.localName)),
              exportedNames: Object.freeze(selected.map((entry) => entry.exportName)),
              source,
              statement
            }));
          }
        }
      } else {
        for (const mapping of mappings) localExports.set(mapping.exportName, mapping.localName);
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      localExports.set('default', statement.expression.text);
      continue;
    }

    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name) localDeclarations.add(statement.name.text);
      const exported = exportNameForDeclaration(statement);
      if (exported && statement.name) localExports.set(exported, statement.name.text);
      continue;
    }

    if (ts.isClassDeclaration(statement)) {
      if (statement.name) localDeclarations.add(statement.name.text);
      const exported = exportNameForDeclaration(statement);
      if (exported && statement.name) localExports.set(exported, statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        localDeclarations.add(declaration.name.text);
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) localExports.set(declaration.name.text, declaration.name.text);
      }
      continue;
    }
  }

  return {
    path: logicalPath,
    absolutePath,
    sourceText,
    sourceFile,
    contentHash: sha256(sourceText),
    format: moduleFormat(absolutePath),
    imports,
    reExports,
    localExports,
    localDeclarations,
    parseDiagnostics,
    resolutions: []
  };
}

function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (_) { return undefined; }
}

function canonicalExistingPath(value) {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
}

function findTsconfig(rootDir, explicit) {
  if (explicit) return canonicalExistingPath(explicit);

  const candidate = path.join(rootDir, 'tsconfig.json');
  return fs.existsSync(candidate)
    ? canonicalExistingPath(candidate)
    : undefined;
}

function resolverInputFromProject(rootDir, options = {}) {
  if (options.resolver) return graph.normalizeModuleResolverInput(options.resolver);
  const configFile = findTsconfig(rootDir, options.tsconfigFile);
  if (!configFile || !fs.existsSync(configFile)) return graph.normalizeModuleResolverInput({ baseUrl: '.' });
  const source = fs.readFileSync(configFile, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(configFile, source);
  if (parsed.error) {
    throw new ReachableProjectGraphError('Unable to parse the project tsconfig for reachable graph resolution.', [Object.freeze({
      code: 'PULSE_PROJECT_TSCONFIG_INVALID',
      kind: 'ReachableProjectGraphDiagnostic',
      severity: 'error',
      message: ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'),
      file: portableFilePath(rootDir, configFile),
      position: Object.freeze({ line: 1, column: 1 }),
      detail: Object.freeze({ typescriptCode: parsed.error.code })
    })], { configFile: portableFilePath(rootDir, configFile) });
  }
  if (parsed.config && parsed.config.extends != null) {
    throw new ReachableProjectGraphError('The first reachable graph resolver does not implement tsconfig extends.', [Object.freeze({
      code: 'PULSE_PROJECT_TSCONFIG_EXTENDS_UNSUPPORTED',
      kind: 'ReachableProjectGraphDiagnostic',
      severity: 'error',
      message: 'Reachable graph resolution currently supports direct compilerOptions.baseUrl and compilerOptions.paths only.',
      file: portableFilePath(rootDir, configFile),
      position: Object.freeze({ line: 1, column: 1 }),
      detail: Object.freeze({ extends: parsed.config.extends })
    })], { configFile: portableFilePath(rootDir, configFile) });
  }
  const compilerOptions = parsed.config && parsed.config.compilerOptions || {};
  const baseUrlAbsolute = path.resolve(path.dirname(configFile), compilerOptions.baseUrl || '.');
  const baseUrl = portablePath(rootDir, baseUrlAbsolute);
  const paths = compilerOptions.paths && isPlainObject(compilerOptions.paths) ? compilerOptions.paths : {};
  const pathAliases = Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets: Array.isArray(targets) ? targets.map((target) => {
      const absolute = path.resolve(baseUrlAbsolute, target);
      return portablePath(rootDir, absolute.replace('*', '__PULSE_WILDCARD__')).replace('__PULSE_WILDCARD__', '*');
    }) : []
  })).filter((entry) => entry.targets.length > 0);
  return graph.normalizeModuleResolverInput({
    baseUrl,
    pathAliases,
    configFile: portableFilePath(rootDir, configFile),
    configContentHash: sha256(source)
  });
}

function findPackageWorkspaceRoot(startDir) {
  const fallback = path.resolve(startDir);
  let current = fallback;
  while (true) {
    const manifestPath = path.join(current, 'package.json');
    const manifest = fs.existsSync(manifestPath) ? readJsonFile(manifestPath) : undefined;
    if ((manifest && manifest.workspaces) || fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

function workspacePackageIndex(workspaceRoot) {
  const out = new Map();
  for (const parent of ['packages', path.join('wasm', 'packages')]) {
    const root = path.join(workspaceRoot, parent);
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort()) {
      const manifestPath = path.join(root, name, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = readJsonFile(manifestPath);
      if (manifest && typeof manifest.name === 'string') out.set(manifest.name, manifestPath);
    }
  }
  return out;
}

function searchNodeModulesPackage(importerFile, packageName, stopDir) {
  let current = path.dirname(importerFile);
  const stop = path.resolve(stopDir);
  while (true) {
    const candidate = path.join(current, 'node_modules', ...packageName.split('/'), 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    if (current === stop || current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  return undefined;
}

function packageOwner(packageName) {
  if (CORE_AUTHORING_PACKAGES.has(packageName)) return 'pulse-runtime';
  if (packageName.startsWith('@pulse-compute/')) return 'pulse-package';
  return 'third-party';
}

function packageModuleForSpecifier(context, importer, classification) {
  const packageName = classification.packageName;
  const specifier = classification.specifier;
  const contract = context.packageContractsBySubpath.get(specifier) || null;
  const productBinding = context.packageProductContractsBySpecifier.get(specifier) || null;
  const productContract = productBinding && productBinding.contract || context.packageProductContractsByPackage.get(packageName) || null;
  const productRole = productBinding && productBinding.role || null;
  let manifestPath = context.workspacePackages.get(packageName);
  if (!manifestPath) manifestPath = searchNodeModulesPackage(importer.absolutePath, packageName, context.workspaceRoot);
  let manifest;
  let manifestHash;
  if (manifestPath) {
    const source = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(source);
    manifestHash = sha256(source);
  } else {
    manifest = { name: packageName, version: 'unresolved' };
    manifestHash = sha256(JSON.stringify(manifest));
  }
  const packageSubpath = classification.packageSubpath || '.';
  const key = `package:${packageName}:${packageSubpath}:${manifestHash}`;
  if (!context.packageModules.has(key)) {
    context.packageModules.set(key, {
      key,
      kind: 'package',
      owner: packageOwner(packageName),
      format: 'javascript',
      runtime: false,
      packageName,
      packageVersion: String(manifest.version || 'unresolved'),
      packageSubpath,
      packageManifestHash: manifestHash,
      packageContract: productContract && productContract.contractId || contract && contract.contractId || null,
      contentHash: sha256(`${manifestHash}:${packageSubpath}:${productContract && productContract.metadataHash || ''}:${productRole || ''}`),
      exports: contract && contract.facadeSymbols || (productRole === 'helper' || productRole === 're-export'
        ? [productContract && productContract.composition && productContract.composition.helperSymbol].filter(Boolean)
        : productContract && productContract.authoring && productContract.authoring.symbols || []),
      reExports: [],
      source: null,
      specifier,
      classification,
      contract,
      productContract,
      productRole,
      coreAuthoring: CORE_AUTHORING_PACKAGES.has(packageName)
    });
  }
  return context.packageModules.get(key);
}

function generatedConfigModule(context) {
  if (!context.configFile) return undefined;
  const key = 'generated:pulse-project-config';
  if (!context.generatedModules.has(key)) {
    const source = fs.existsSync(context.configFile) ? fs.readFileSync(context.configFile) : Buffer.from('');
    context.generatedModules.set(key, {
      key,
      kind: 'generated',
      owner: 'generated',
      format: 'generated',
      runtime: true,
      generator: 'pulse.project-config',
      logicalName: 'configured-project-plan',
      contentHash: sha256(source),
      exports: ['default'],
      reExports: [],
      source: null
    });
  }
  return context.generatedModules.get(key);
}

function realContainedPath(rootDir, candidate) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return undefined;
  const rootReal = fs.realpathSync(rootDir);
  const candidateReal = fs.realpathSync(candidate);
  const relative = path.relative(rootReal, candidateReal);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  return candidateReal;
}

function resolveProjectSpecifier(context, importer, specifier) {
  const candidates = graph.projectResolutionCandidates(importer.path, specifier, context.resolver);
  const existing = [];
  for (const portable of candidates) {
    const absolute = realContainedPath(context.rootDir, path.resolve(context.rootDir, portable));
    if (absolute) existing.push({ portable, absolute });
  }
  const unique = Array.from(new Map(existing.map((entry) => [entry.absolute, entry])).values());
  if (unique.length === 0) return { status: 'missing', candidates };
  if (unique.length > 1) return { status: 'ambiguous', candidates: unique.map((entry) => entry.portable) };
  return { status: 'resolved', ...unique[0] };
}

function scanUnsupportedBoundaries(context, module) {
  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        const specifier = argument && ts.isStringLiteral(argument) ? argument.text : '<computed-dynamic-import>';
        context.unsupportedBoundaries.push({
          kind: argument && ts.isStringLiteral(argument) ? 'dynamic-import' : 'computed-specifier',
          from: module.path,
          specifier,
          source: sourceLocation(context.rootDir, module.sourceFile, node)
        });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const argument = node.arguments[0];
        const specifier = argument && ts.isStringLiteral(argument) ? argument.text : '<computed-require>';
        context.unsupportedBoundaries.push({
          kind: argument && ts.isStringLiteral(argument) ? 'commonjs-require' : 'computed-specifier',
          from: module.path,
          specifier,
          source: sourceLocation(context.rootDir, module.sourceFile, node)
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(module.sourceFile);
}

function resolveModuleEdges(context, module) {
  const relations = [...module.imports, ...module.reExports];
  for (const relation of relations) {
    const classification = graph.classifyModuleSpecifier(relation.specifier, context.resolver);
    if (classification.kind === 'project-relative' || classification.kind === 'tsconfig-path') {
      const resolved = resolveProjectSpecifier(context, module, relation.specifier);
      if (resolved.status === 'missing') {
        context.diagnostics.push(diagnostic(context.rootDir, module.sourceFile, relation.statement, 'PULSE_PROJECT_MODULE_NOT_FOUND', `Unable to resolve project module ${JSON.stringify(relation.specifier)} from ${module.path}.`, { specifier: relation.specifier, candidates: resolved.candidates }));
        continue;
      }
      if (resolved.status === 'ambiguous') {
        context.diagnostics.push(diagnostic(context.rootDir, module.sourceFile, relation.statement, 'PULSE_PROJECT_MODULE_AMBIGUOUS', `Project module ${JSON.stringify(relation.specifier)} resolves to more than one file.`, { specifier: relation.specifier, candidates: resolved.candidates }));
        continue;
      }
      if (context.configFile && path.resolve(resolved.absolute) === context.configFile) {
        const target = generatedConfigModule(context);
        module.resolutions.push(Object.freeze({ relation, classification: Object.freeze({ kind: 'generated', specifier: relation.specifier }), targetKey: target.key, generated: true }));
        context.edges.push({
          kind: relation.kind,
          from: module.path,
          to: target.key,
          specifier: relation.specifier,
          resolutionKind: 'generated',
          runtime: relation.kind === 'type-import' ? false : relation.typeOnly !== true,
          importedNames: relation.importedNames || [],
          exportedNames: relation.exportedNames || [],
          packageContract: null,
          source: relation.source
        });
        continue;
      }
      const target = loadProjectModule(context, resolved.absolute, resolved.portable);
      module.resolutions.push(Object.freeze({ relation, classification, targetKey: target.path }));
      context.edges.push({
        kind: relation.kind,
        from: module.path,
        to: target.path,
        specifier: relation.specifier,
        resolutionKind: classification.kind,
        runtime: relation.kind === 'type-import' ? false : relation.typeOnly !== true,
        importedNames: relation.importedNames || [],
        exportedNames: relation.exportedNames || [],
        packageContract: null,
        source: relation.source
      });
      continue;
    }

    if (classification.kind === 'external') {
      const key = `external:${classification.specifier}`;
      if (!context.externalModules.has(key)) context.externalModules.set(key, {
        key,
        kind: 'external',
        owner: 'external',
        format: 'external',
        runtime: relation.kind !== 'type-import',
        specifier: classification.specifier,
        contentHash: null,
        exports: [],
        reExports: [],
        source: null
      });
      module.resolutions.push(Object.freeze({ relation, classification, targetKey: key }));
      context.edges.push({
        kind: relation.kind,
        from: module.path,
        to: key,
        specifier: relation.specifier,
        resolutionKind: 'external',
        runtime: relation.kind !== 'type-import',
        importedNames: relation.importedNames || [],
        exportedNames: relation.exportedNames || [],
        packageContract: null,
        source: relation.source
      });
      continue;
    }

    const packageModule = packageModuleForSpecifier(context, module, classification);
    module.resolutions.push(Object.freeze({ relation, classification, targetKey: packageModule.key }));
    const packageContractEdge = relation.kind !== 'type-import' && packageModule.packageContract != null;
    context.edges.push({
      kind: packageContractEdge ? 'package-contract' : relation.kind,
      from: module.path,
      to: packageModule.key,
      specifier: relation.specifier,
      resolutionKind: classification.kind,
      runtime: relation.kind !== 'type-import',
      importedNames: relation.importedNames || [],
      exportedNames: relation.exportedNames || [],
      packageContract: packageContractEdge ? packageModule.packageContract : null,
      source: relation.source
    });
  }
}

function loadProjectModule(context, absolutePath, logicalPath) {
  const contained = realContainedPath(context.rootDir, absolutePath);
  if (!contained) throw new ReachableProjectGraphError(`Project module ${absolutePath} is outside the workspace or missing.`, [], { rootDir: context.rootDir, file: absolutePath });
  const key = logicalPath
    ? graph.normalizePortablePath(logicalPath, 'project module path')
    : portablePath(context.rootDir, path.resolve(absolutePath));
  if (context.projectModules.has(key)) return context.projectModules.get(key);
  const folded = key.toLocaleLowerCase('en-US');
  const collision = [...context.projectModules.keys()].find((existing) => existing.toLocaleLowerCase('en-US') === folded && existing !== key);
  if (collision) {
    throw new ReachableProjectGraphError(`Project module path ${key} collides by case with ${collision}.`, [Object.freeze({
      code: 'PULSE_PROJECT_MODULE_CASE_COLLISION',
      kind: 'ReachableProjectGraphDiagnostic',
      severity: 'error',
      message: `Project module paths ${collision} and ${key} differ only by case.`,
      file: key,
      position: Object.freeze({ line: 1, column: 1 }),
      detail: Object.freeze({ existing: collision, candidate: key })
    })], { rootDir: context.rootDir, existing: collision, candidate: key });
  }
  const module = parseModule(context.rootDir, contained, key);
  context.projectModules.set(key, module);
  context.diagnostics.push(...module.parseDiagnostics);
  scanUnsupportedBoundaries(context, module);
  resolveModuleEdges(context, module);
  return module;
}

function markRuntimeReachability(context, entryKey) {
  const runtime = new Set([entryKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of context.edges) {
      if (!edge.runtime || !runtime.has(edge.from) || runtime.has(edge.to)) continue;
      runtime.add(edge.to);
      changed = true;
    }
  }
  for (const module of context.projectModules.values()) module.runtime = runtime.has(module.path);
  for (const module of context.packageModules.values()) module.runtime = runtime.has(module.key);
  for (const module of context.generatedModules.values()) module.runtime = runtime.has(module.key) || module.runtime === true;
  for (const module of context.externalModules.values()) module.runtime = runtime.has(module.key);
  return runtime;
}

function relationTarget(module, relation) {
  const record = module.resolutions.find((entry) => entry.relation === relation);
  return record && record.targetKey;
}

function exportedNamesForModule(module) {
  const names = new Set(module.localExports.keys());
  for (const relation of module.reExports) {
    if (relation.star) names.add('*');
    for (const mapping of relation.mappings) names.add(mapping.exportName);
  }
  return [...names].sort();
}

function moduleInputs(context) {
  const modules = [];
  for (const module of context.projectModules.values()) {
    modules.push({
      key: module.path,
      kind: 'project',
      owner: 'application',
      format: module.format,
      runtime: module.runtime === true,
      path: module.path,
      contentHash: module.contentHash,
      exports: exportedNamesForModule(module),
      reExports: module.reExports.flatMap((entry) => entry.star ? ['*'] : entry.mappings.map((mapping) => mapping.exportName)),
      source: { file: module.path, line: 1, column: 1 }
    });
  }
  for (const module of context.packageModules.values()) modules.push({
    key: module.key,
    kind: module.kind,
    owner: module.owner,
    format: module.format,
    runtime: module.runtime,
    packageName: module.packageName,
    packageVersion: module.packageVersion,
    packageSubpath: module.packageSubpath,
    packageManifestHash: module.packageManifestHash,
    packageContract: module.packageContract,
    contentHash: module.contentHash,
    exports: module.exports,
    reExports: module.reExports,
    source: module.source
  });
  for (const module of context.generatedModules.values()) modules.push(module);
  for (const module of context.externalModules.values()) modules.push(module);
  return modules;
}

function edgeInputs(context) {
  return context.edges.map((edge) => ({ ...edge }));
}

function createContext(entryFile, options = {}) {
  const requestedRoot = path.resolve(options.rootDir || path.dirname(path.resolve(entryFile)));
  const rootDir = fs.existsSync(requestedRoot) ? fs.realpathSync(requestedRoot) : requestedRoot;
  const requestedWorkspace = path.resolve(options.workspaceRoot || findPackageWorkspaceRoot(rootDir));
  const workspaceRoot = fs.existsSync(requestedWorkspace) ? fs.realpathSync(requestedWorkspace) : requestedWorkspace;
  const packageContractCatalog = options.packageContractCatalog || discoverPackageContractCatalog({
    cwd: rootDir,
    workspaceRoot,
    scanNodeModules: true
  });
  const packageContractsBySubpath = new Map();
  for (const entry of packageContractCatalog.contracts) {
    packageContractsBySubpath.set(entry.lowerableSubpath, entry);
    for (const compatibilitySubpath of entry.compatibilitySubpaths || []) packageContractsBySubpath.set(compatibilitySubpath, entry);
  }
  const packageContractsByPackage = new Map();
  for (const entry of packageContractCatalog.contracts) {
    if (!packageContractsByPackage.has(entry.packageName)) packageContractsByPackage.set(entry.packageName, []);
    packageContractsByPackage.get(entry.packageName).push(entry);
  }
  const packageProductContractsByPackage = new Map();
  const packageProductContractsBySpecifier = new Map();
  for (const entry of packageContractCatalog.productCatalog.contracts) {
    packageProductContractsByPackage.set(entry.npmPackage, entry);
    packageProductContractsBySpecifier.set(entry.authoring.import, Object.freeze({ contract: entry, role: 'authoring' }));
    for (const specifier of entry.ownership.helperImports) packageProductContractsBySpecifier.set(specifier, Object.freeze({ contract: entry, role: 'helper' }));
    for (const specifier of entry.ownership.reExportImports) packageProductContractsBySpecifier.set(specifier, Object.freeze({ contract: entry, role: 're-export' }));
  }
  for (const entries of packageContractsByPackage.values()) entries.sort((left, right) => left.lowerableSubpath.localeCompare(right.lowerableSubpath));
  const context = {
    version: PROJECT_GRAPH_CONTEXT_VERSION,
    rootDir,
    workspaceRoot,
    entryFile: canonicalExistingPath(entryFile),
    configFile: options.configFile
      ? canonicalExistingPath(options.configFile)
      : undefined,
    projectFragments: options.projectFragments && typeof options.projectFragments === 'object' && !Array.isArray(options.projectFragments)
      ? Object.freeze({ ...options.projectFragments })
      : Object.freeze({}),
    resolver: resolverInputFromProject(rootDir, options),
    workspacePackages: workspacePackageIndex(workspaceRoot),
    packageContractCatalog,
    packageContractsBySubpath,
    packageContractsByPackage,
    packageProductContractsByPackage,
    packageProductContractsBySpecifier,
    projectModules: new Map(),
    packageModules: new Map(),
    generatedModules: new Map(),
    externalModules: new Map(),
    edges: [],
    unsupportedBoundaries: [],
    diagnostics: []
  };
  return context;
}

function projectGraphContext(build) {
  return build && typeof build === 'object' ? contexts.get(build) : undefined;
}

function finalizeReachableProjectGraph(build, handlerReferences = []) {
  const context = projectGraphContext(build);
  if (!context) throw new TypeError('finalizeReachableProjectGraph requires a project graph build result.');
  return graph.normalizeReachableGraphManifestV2({
    resolver: context.resolver,
    entry: build.entryKey,
    modules: moduleInputs(context),
    edges: edgeInputs(context),
    handlers: handlerReferences,
    unsupportedBoundaries: context.unsupportedBoundaries
  });
}

function reachableProjectGraphProjections(build, manifest) {
  const context = projectGraphContext(build);
  if (!context) throw new TypeError('reachableProjectGraphProjections requires a project graph build result.');
  const targetManifest = manifest || build.graph;
  return deriveReachableGraphProjections(context, targetManifest, context.packageBindingStates);
}

function buildReachableProjectGraph(entryFile, options = {}) {
  const context = createContext(entryFile, options);
  const entry = loadProjectModule(context, context.entryFile, portableFilePath(context.rootDir, context.entryFile));
  markRuntimeReachability(context, entry.path);
  let packageBindingStates;
  try {
    packageBindingStates = buildPackageBindingOwnership(context);
    addKnownLifecycleEdges(context, packageBindingStates);
    markRuntimeReachability(context, entry.path);
  } catch (error) {
    if (error instanceof PackageReachabilityError) {
      throw new ReachableProjectGraphError(error.message, error.diagnostics, error.detail);
    }
    throw error;
  }

  const runtimeUnsupported = context.unsupportedBoundaries.filter((boundary) => {
    const module = context.projectModules.get(boundary.from);
    return module && module.runtime;
  });
  if (runtimeUnsupported.length > 0) {
    for (const boundary of runtimeUnsupported) {
      context.diagnostics.push(Object.freeze({
        code: boundary.kind === 'dynamic-import' ? 'PULSE_PROJECT_DYNAMIC_IMPORT_UNSUPPORTED'
          : boundary.kind === 'commonjs-require' ? 'PULSE_PROJECT_COMMONJS_REQUIRE_UNSUPPORTED'
            : 'PULSE_PROJECT_COMPUTED_MODULE_SPECIFIER_UNSUPPORTED',
        kind: 'ReachableProjectGraphDiagnostic',
        severity: 'error',
        message: `Unsupported ${boundary.kind} module boundary ${JSON.stringify(boundary.specifier)} in ${boundary.source.file}.`,
        file: boundary.source.file,
        position: Object.freeze({ line: boundary.source.line, column: boundary.source.column }),
        detail: Object.freeze({ boundaryKind: boundary.kind, specifier: boundary.specifier })
      }));
    }
  }

  const preliminary = graph.normalizeReachableGraphManifestV2({
    resolver: context.resolver,
    entry: entry.path,
    modules: moduleInputs(context),
    edges: edgeInputs(context),
    handlers: [],
    unsupportedBoundaries: context.unsupportedBoundaries
  });
  if (preliminary.cycles.length > 0) {
    const modulesById = new Map(preliminary.modules.map((module) => [module.id, module]));
    for (const cycle of preliminary.cycles) {
      const memberIds = new Set(cycle.modules);
      const cycleEdges = preliminary.edges.filter((edge) => memberIds.has(edge.from) && memberIds.has(edge.to) && edge.runtime && edge.source);
      cycleEdges.sort((left, right) => left.source.file.localeCompare(right.source.file) || left.source.line - right.source.line || left.source.column - right.source.column || left.id.localeCompare(right.id));
      const source = cycleEdges[0] && cycleEdges[0].source || { file: entry.path, line: 1, column: 1 };
      const modulePaths = cycle.modules.map((moduleId) => {
        const module = modulesById.get(moduleId);
        return module && (module.path || module.packageName || module.externalSpecifier) || moduleId;
      });
      context.diagnostics.push(Object.freeze({
        code: 'PULSE_PROJECT_MODULE_CYCLE_UNSUPPORTED',
        kind: 'ReachableProjectGraphDiagnostic',
        severity: 'error',
        message: `Runtime project module cycle ${modulePaths.join(' -> ')} is not supported in the first multi-module compiler implementation.`,
        file: source.file,
        position: Object.freeze({ line: source.line, column: source.column }),
        detail: Object.freeze({ cycleId: cycle.id, modules: Object.freeze(modulePaths) })
      }));
    }
  }

  if (context.diagnostics.length > 0) {
    throw new ReachableProjectGraphError(`Reachable project graph failed with ${context.diagnostics.length} diagnostic(s).`, context.diagnostics, { entryFile: context.entryFile, rootDir: context.rootDir });
  }

  const build = Object.freeze({
    version: PROJECT_GRAPH_BUILDER_VERSION,
    contractVersion: graph.REACHABLE_GRAPH_MANIFEST_V2_VERSION,
    entryKey: entry.path,
    graph: preliminary,
    projectFiles: Object.freeze([...context.projectModules.values()].map((module) => module.absolutePath).sort()),
    runtimeProjectFiles: Object.freeze([...context.projectModules.values()].filter((module) => module.runtime).map((module) => module.absolutePath).sort()),
    projectModulePaths: Object.freeze([...context.projectModules.values()].map((module) => module.path).sort()),
    runtimeProjectModulePaths: Object.freeze([...context.projectModules.values()].filter((module) => module.runtime).map((module) => module.path).sort()),
    deferredPackageModules: Object.freeze([...context.packageModules.values()].map((module) => Object.freeze({
      key: module.key,
      packageName: module.packageName,
      packageVersion: module.packageVersion,
      packageSubpath: module.packageSubpath,
      runtime: module.runtime,
      packageContract: module.packageContract || null
    })).sort((a, b) => a.key.localeCompare(b.key))),
    packageContractCatalog: Object.freeze({
      version: context.packageContractCatalog.version,
      contracts: Object.freeze(context.packageContractCatalog.contracts.map((entry) => Object.freeze({
        contractId: entry.contractId,
        packageName: entry.packageName,
        lowerableSubpath: entry.lowerableSubpath,
        compatibilitySubpaths: entry.compatibilitySubpaths || Object.freeze([]),
        facadeSymbols: entry.facadeSymbols,
        hostCapabilities: entry.hostCapabilities,
        targetSupport: entry.targetSupport,
        productContract: entry.productContract
      })))
    }),
    summary: Object.freeze({
      projectModules: context.projectModules.size,
      runtimeProjectModules: [...context.projectModules.values()].filter((module) => module.runtime).length,
      typeOnlyProjectModules: [...context.projectModules.values()].filter((module) => !module.runtime).length,
      packageModules: context.packageModules.size,
      edges: context.edges.length,
      unsupportedBoundaries: context.unsupportedBoundaries.length,
      cycles: preliminary.cycles.length
    })
  });
  context.packageBindingStates = packageBindingStates;
  contexts.set(build, context);
  const projections = deriveReachableGraphProjections(context, preliminary, packageBindingStates);
  const result = Object.freeze({
    ...build,
    packageReachability: projections.packageReachability,
    packageProduct: projections.packageProduct,
    entrySafety: projections.entrySafety,
    nativeEligibility: projections.nativeEligibility
  });
  contexts.set(result, context);
  return result;
}

function resolutionForImport(build, modulePath, localName) {
  const context = projectGraphContext(build);
  const module = context && context.projectModules.get(modulePath);
  if (!module) return undefined;
  for (const relation of module.imports) {
    const binding = relation.bindings.find((entry) => entry.localName === localName);
    if (!binding) continue;
    return Object.freeze({
      module,
      relation,
      binding,
      targetKey: relationTarget(module, relation)
    });
  }
  return undefined;
}

module.exports = Object.freeze({
  PROJECT_GRAPH_BUILDER_VERSION,
  PROJECT_GRAPH_CONTEXT_VERSION,
  ReachableProjectGraphError,
  buildReachableProjectGraph,
  finalizeReachableProjectGraph,
  reachableProjectGraphProjections,
  projectGraphContext,
  resolutionForImport
});
