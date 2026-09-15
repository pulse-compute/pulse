'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const {
  JAVASCRIPT_APPLICATION_LOADER_VERSION,
  isJavascriptApplicationPlan
} = require('@pulse-compute/wasm-contracts/project/javascript-application');

const TYPESCRIPT_MODULE_LOADER_VERSION = 'pulse.typescript-module-loader.v1';
const PROJECT_HARNESS_VERSION = 'pulse.project-harness.v1';
class PulseModuleLoadError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'PulseModuleLoadError'; this.code = code; this.detail = Object.freeze({ ...detail }); }
}
function isInside(root, candidate) { const relative = path.relative(path.resolve(root), path.resolve(candidate)); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); }
function resolveRelative(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, ...['.ts','.tsx','.js','.cjs','.mjs','.json'].map((extension) => `${base}${extension}`), ...['.ts','.tsx','.js','.cjs','.mjs','.json'].map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch (_) { return false; } });
}

function canonicalExistingPath(value) {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved)
    ? fs.realpathSync(resolved)
    : resolved;
}

function loadTypescriptModule(entryFile, options = {}) {
  const entry = canonicalExistingPath(entryFile);
  const workspaceRoot = canonicalExistingPath(
    options.workspaceRoot || options.root || path.dirname(entry)
  );
  const allowedPackages = new Map(Object.entries(options.allowedPackages || {}));
  const cache = new Map();
  function load(file) {
    const requested = path.resolve(file);
    const resolved = fs.realpathSync(requested);
    if (!isInside(workspaceRoot, resolved)) throw new PulseModuleLoadError('PULSE_TOOLING_MODULE_OUTSIDE_WORKSPACE', `Tooling module escapes the Pulse workspace: ${resolved}`, { workspaceRoot, file: resolved });
    if (cache.has(resolved)) return cache.get(resolved).exports;
    if (path.extname(resolved).toLowerCase() === '.json') { const value = JSON.parse(fs.readFileSync(resolved, 'utf8')); cache.set(resolved, { exports: value }); return value; }
    const source = fs.readFileSync(resolved, 'utf8');
    const transpiled = ts.transpileModule(source, { fileName: resolved, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, allowJs: true, resolveJsonModule: true }, reportDiagnostics: true });
    const failures = (transpiled.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
    if (failures.length) throw new PulseModuleLoadError('PULSE_TOOLING_MODULE_COMPILE_FAILED', `Tooling module could not be compiled: ${resolved}`, { file: resolved, diagnostics: failures.map((entry) => ({ code: entry.code, message: ts.flattenDiagnosticMessageText(entry.messageText, '\n') })) });
    const module = { exports: {} }; cache.set(resolved, module);
    const localRequire = (request) => {
      if (allowedPackages.has(request)) return allowedPackages.get(request);
      if (request.startsWith('.') || request.startsWith('/')) {
        const target = resolveRelative(resolved, request);
        if (!target) throw new PulseModuleLoadError('PULSE_TOOLING_MODULE_IMPORT_NOT_FOUND', `Cannot resolve tooling import ${request} from ${resolved}.`, { request, from: resolved });
        return load(target);
      }
      throw new PulseModuleLoadError('PULSE_TOOLING_MODULE_PACKAGE_UNSUPPORTED', `Tooling module package import is not allowed: ${request}`, { request, from: resolved });
    };
    new vm.Script(`(function(module,exports,require,__filename,__dirname){\n${transpiled.outputText}\n})`, { filename: resolved }).runInThisContext()(module, module.exports, localRequire, resolved, path.dirname(resolved));
    return module.exports;
  }
  return Object.freeze({ version: TYPESCRIPT_MODULE_LOADER_VERSION, file: entry, exports: load(entryFile) });
}
function moduleDefault(exports) { return exports && Object.prototype.hasOwnProperty.call(exports, 'default') ? exports.default : exports; }
function loadProjectHarness(file, options = {}) {
  const loaded = loadTypescriptModule(file, options);
  const exported = moduleDefault(loaded.exports);
  const cases = Array.isArray(exported) ? exported : exported && Array.isArray(exported.cases) ? exported.cases : null;
  if (!cases) throw new PulseModuleLoadError('PULSE_TEST_HARNESS_EXPORT_INVALID', 'Pulse test harness must export an ordered case array or an object with a cases array.');
  return Object.freeze({ version: PROJECT_HARNESS_VERSION, file: loaded.file, cases: Object.freeze([...cases]) });
}


function sourceSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadJavascriptApplication(plan, options = {}) {
  if (!isJavascriptApplicationPlan(plan)) {
    throw new PulseModuleLoadError('PULSE_JAVASCRIPT_APPLICATION_PLAN_INVALID', 'JavaScript application loading requires a normalized Pulse application plan.');
  }
  if (plan.loadable !== true) {
    throw new PulseModuleLoadError(
      plan.blockers[0]?.code || 'PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE',
      plan.blockers[0]?.message || 'The JavaScript application plan has unresolved target blockers.',
      { blockers: plan.blockers, planHash: plan.planHash, automaticFallback: false }
    );
  }
  if (typeof options.validateApplication !== 'function') {
    throw new TypeError('JavaScript application loading requires a provider application validator.');
  }

  const workspaceRoot = canonicalExistingPath( options.workspaceRoot || options.root || '.');
  const modules = new Map(plan.graph.modules.map((entry) => [entry.id, entry]));
  const packages = new Map(plan.packages.map((entry) => [entry.moduleId, entry]));
  const runtimeEdges = new Map();
  for (const edge of plan.graph.edges.filter((entry) => entry.runtime)) {
    const key = `${edge.from}\u0000${edge.specifier}`;
    if (runtimeEdges.has(key)) {
      throw new PulseModuleLoadError(
        'PULSE_JAVASCRIPT_GRAPH_EDGE_AMBIGUOUS',
        `JavaScript application graph has more than one runtime edge for ${edge.specifier}.`,
        { from: edge.from, specifier: edge.specifier }
      );
    }
    runtimeEdges.set(key, edge);
  }
  const allowedPackages = new Map(Object.entries(options.allowedPackages || {}));
  const workspaceRequire = options.require || createRequire(path.join(workspaceRoot, 'package.json'));
  const cache = new Map();
  const loadedPackages = new Set();

  function loadPackage(target, edge) {
    const packageEntry = packages.get(target.id);
    if (!packageEntry) {
      throw new PulseModuleLoadError(
        'PULSE_JAVASCRIPT_PACKAGE_PLAN_MISSING',
        `JavaScript application package ${target.packageName || edge.specifier} is absent from the target plan.`,
        { moduleId: target.id, specifier: edge.specifier, source: edge.source }
      );
    }
    if (packageEntry.status === 'unavailable') {
      throw new PulseModuleLoadError(
        packageEntry.reasonCode || 'PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE',
        `Package ${packageEntry.packageName} is unavailable under the JavaScript target.`,
        { ...packageEntry, source: edge.source, automaticFallback: false }
      );
    }
    // The runtime entry is package-file metadata, not an exported subpath.
    // Preserve the graph's public import and let package exports resolve it.
    const request = edge.specifier;
    if (allowedPackages.has(request)) {
      loadedPackages.add(request);
      return allowedPackages.get(request);
    }
    try {
      const value = workspaceRequire(request);
      loadedPackages.add(request);
      return value;
    } catch (error) {
      const code = error && error.code === 'ERR_REQUIRE_ESM'
        ? 'PULSE_JAVASCRIPT_PACKAGE_ESM_UNSUPPORTED'
        : 'PULSE_JAVASCRIPT_PACKAGE_MODULE_UNAVAILABLE';
      throw new PulseModuleLoadError(
        code,
        `Cannot load JavaScript package import ${request} from ${edge.source?.file || plan.workspace.entry}.`,
        { request, packageName: packageEntry.packageName, source: edge.source, causeCode: error && error.code }
      );
    }
  }

  function loadModule(moduleId) {
    if (cache.has(moduleId)) return cache.get(moduleId).exports;
    const moduleRecord = modules.get(moduleId);
    if (!moduleRecord) throw new PulseModuleLoadError('PULSE_JAVASCRIPT_GRAPH_MODULE_MISSING', `Unknown JavaScript application module ${moduleId}.`, { moduleId });
    if (moduleRecord.kind !== 'project') {
      throw new PulseModuleLoadError('PULSE_JAVASCRIPT_APPLICATION_ENTRY_INVALID', 'The JavaScript application entry must be a project module.', { moduleId, kind: moduleRecord.kind });
    }
    const requested = path.resolve(workspaceRoot, moduleRecord.path);
    if (!isInside(workspaceRoot, requested)) {
      throw new PulseModuleLoadError('PULSE_JAVASCRIPT_MODULE_OUTSIDE_WORKSPACE', `JavaScript application module escapes the Pulse workspace: ${moduleRecord.path}`, { workspaceRoot, module: moduleRecord.path });
    }
    let resolved;
    try {
      resolved = fs.realpathSync(requested);
    } catch (_) {
      throw new PulseModuleLoadError('PULSE_JAVASCRIPT_MODULE_NOT_FOUND', `JavaScript application module is missing: ${moduleRecord.path}`, { workspaceRoot, module: moduleRecord.path });
    }
    if (!isInside(workspaceRoot, resolved)) {
      throw new PulseModuleLoadError('PULSE_JAVASCRIPT_MODULE_OUTSIDE_WORKSPACE', `JavaScript application module resolves outside the Pulse workspace: ${moduleRecord.path}`, { workspaceRoot, module: moduleRecord.path, resolved });
    }
    if (path.extname(resolved).toLowerCase() === '.json') {
      const bytes = fs.readFileSync(resolved);
      if (sourceSha256(bytes) !== moduleRecord.contentHash) throw new PulseModuleLoadError('PULSE_JAVASCRIPT_MODULE_SOURCE_CHANGED', `JavaScript application module changed after planning: ${moduleRecord.path}`, { module: moduleRecord.path, expected: moduleRecord.contentHash, actual: sourceSha256(bytes) });
      const value = JSON.parse(bytes.toString('utf8'));
      cache.set(moduleId, { exports: value });
      return value;
    }
    const source = fs.readFileSync(resolved, 'utf8');
    const actualHash = sourceSha256(source);
    if (actualHash !== moduleRecord.contentHash) {
      throw new PulseModuleLoadError(
        'PULSE_JAVASCRIPT_MODULE_SOURCE_CHANGED',
        `JavaScript application module changed after planning: ${moduleRecord.path}`,
        { module: moduleRecord.path, expected: moduleRecord.contentHash, actual: actualHash }
      );
    }
    const transpiled = ts.transpileModule(source, {
      fileName: resolved,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        esModuleInterop: true,
        allowJs: true,
        resolveJsonModule: true
      },
      reportDiagnostics: true
    });
    const failures = (transpiled.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
    if (failures.length) {
      throw new PulseModuleLoadError(
        'PULSE_JAVASCRIPT_MODULE_COMPILE_FAILED',
        `JavaScript application module could not be compiled: ${moduleRecord.path}`,
        { module: moduleRecord.path, diagnostics: failures.map((entry) => ({ code: entry.code, message: ts.flattenDiagnosticMessageText(entry.messageText, '\n') })) }
      );
    }
    const module = { exports: {} };
    cache.set(moduleId, module);
    const localRequire = (request) => {
      const edge = runtimeEdges.get(`${moduleId}\u0000${request}`);
      if (!edge) {
        throw new PulseModuleLoadError(
          'PULSE_JAVASCRIPT_IMPORT_NOT_IN_GRAPH',
          `Runtime import ${request} is not present in the sealed reachable graph for ${moduleRecord.path}.`,
          { request, from: moduleRecord.path, graphHash: plan.graph.graphHash }
        );
      }
      const target = modules.get(edge.to);
      if (!target) throw new PulseModuleLoadError('PULSE_JAVASCRIPT_GRAPH_MODULE_MISSING', `JavaScript application edge ${edge.id} has no target module.`, { edge });
      if (target.kind === 'project') return loadModule(target.id);
      if (target.kind === 'package') return loadPackage(target, edge);
      if (target.kind === 'external') {
        try {
          return workspaceRequire(target.externalSpecifier || request);
        } catch (error) {
          throw new PulseModuleLoadError('PULSE_JAVASCRIPT_EXTERNAL_MODULE_UNAVAILABLE', `Cannot load external JavaScript module ${request}.`, { request, source: edge.source, causeCode: error && error.code });
        }
      }
      throw new PulseModuleLoadError('PULSE_JAVASCRIPT_MODULE_KIND_UNSUPPORTED', `Unsupported JavaScript application module kind ${target.kind}.`, { target, edge });
    };
    new vm.Script(`(function(module,exports,require,__filename,__dirname){\n${transpiled.outputText}\n})`, { filename: resolved })
      .runInThisContext()(module, module.exports, localRequire, resolved, path.dirname(resolved));
    return module.exports;
  }

  const exports = loadModule(plan.graph.entryModuleId);
  const application = moduleDefault(exports);
  let validated;
  try {
    validated = options.validateApplication(application);
  } catch (error) {
    throw new PulseModuleLoadError(
      error && error.code || 'PULSE_JAVASCRIPT_APPLICATION_EXPORT_INVALID',
      error && error.message || 'Pulse JavaScript application default export is invalid.',
      { entry: plan.workspace.entry, planHash: plan.planHash }
    );
  }
  return Object.freeze({
    version: JAVASCRIPT_APPLICATION_LOADER_VERSION,
    plan,
    application: validated,
    entry: plan.workspace.entry,
    modulesLoaded: cache.size,
    packagesLoaded: Object.freeze([...loadedPackages].sort())
  });
}

module.exports = Object.freeze({ TYPESCRIPT_MODULE_LOADER_VERSION, PROJECT_HARNESS_VERSION, JAVASCRIPT_APPLICATION_LOADER_VERSION, PulseModuleLoadError, loadTypescriptModule, moduleDefault, loadProjectHarness, loadJavascriptApplication });
