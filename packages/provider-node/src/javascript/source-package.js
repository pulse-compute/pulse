'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire } = require('node:module');
const ts = require('typescript');

const NODE_JAVASCRIPT_SOURCE_PACKAGE_VERSION = 'pulse.node-javascript-source-package.v2';
const NODE_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST = 'pulse-javascript-source-package.json';
const BUILTIN_MODULES = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

class PulseNodeJavascriptSourcePackageError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseNodeJavascriptSourcePackageError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new PulseNodeJavascriptSourcePackageError(
    'PULSE_JAVASCRIPT_SOURCE_PACKAGE_PATH_UNSAFE',
    `${label} escapes the JavaScript source package root.`,
    { root: path.resolve(root), candidate: path.resolve(candidate) }
  );
}

function outputModulePath(modulePath) {
  const normalized = slash(modulePath);
  if (normalized.endsWith('.json')) return normalized;
  return normalized.replace(/\.(?:[cm]?[jt]sx?)$/i, '.js');
}

function sourceKind(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.json') return 'json';
  return 'javascript';
}

function transpileModule(source, file) {
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      allowJs: true,
      resolveJsonModule: true,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      declaration: false
    },
    reportDiagnostics: true
  });
  const errors = (result.diagnostics || []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    throw new PulseNodeJavascriptSourcePackageError(
      'PULSE_JAVASCRIPT_SOURCE_PACKAGE_COMPILE_FAILED',
      `JavaScript source packaging could not transpile ${file}.`,
      {
        file,
        diagnostics: errors.map((entry) => Object.freeze({
          code: entry.code,
          message: ts.flattenDiagnosticMessageText(entry.messageText, '\n')
        }))
      }
    );
  }
  return result.outputText;
}

function packageNameFromSpecifier(specifier) {
  const value = String(specifier || '');
  if (!value || value.startsWith('.') || value.startsWith('/') || BUILTIN_MODULES.has(value)) return null;
  if (value.startsWith('@')) {
    const parts = value.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return value.split('/')[0] || null;
}

function projectPackageManifest(projectRoot) {
  const file = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    throw new PulseNodeJavascriptSourcePackageError(
      'PULSE_JAVASCRIPT_SOURCE_PACKAGE_PROJECT_MANIFEST_INVALID',
      `Cannot parse project package manifest ${file}.`,
      { file, cause: error && error.message }
    );
  }
}

function declaredVersion(manifest, name) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    const value = manifest && manifest[field] && manifest[field][name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function packageVersionFromEntry(entry, name) {
  let current = path.dirname(entry);
  const root = path.parse(current).root;
  while (current !== root) {
    const manifestFile = path.join(current, 'package.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        if (manifest && manifest.name === name && typeof manifest.version === 'string') return manifest.version;
      } catch (_) {
        // Continue searching toward the package root.
      }
    }
    current = path.dirname(current);
  }
  return null;
}

function workspacePatterns(manifest) {
  if (!manifest) return [];
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  if (manifest.workspaces && Array.isArray(manifest.workspaces.packages)) return manifest.workspaces.packages;
  return [];
}

function expandWorkspacePattern(root, pattern) {
  const segments = slash(pattern).split('/').filter(Boolean);
  let candidates = [root];
  for (const segment of segments) {
    const next = [];
    for (const candidate of candidates) {
      if (segment === '*') {
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
        for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            next.push(path.join(candidate, entry.name));
          }
        }
      } else if (!segment.includes('*')) {
        next.push(path.join(candidate, segment));
      }
    }
    candidates = next;
  }
  return candidates;
}

function workspacePackageVersion(projectRoot, name) {
  let current = path.resolve(projectRoot);
  const filesystemRoot = path.parse(current).root;
  while (true) {
    const manifestFile = path.join(current, 'package.json');
    if (fs.existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        const patterns = workspacePatterns(manifest);
        for (const pattern of patterns) {
          for (const candidate of expandWorkspacePattern(current, pattern)) {
            const candidateManifestFile = path.join(candidate, 'package.json');
            if (!fs.existsSync(candidateManifestFile)) continue;
            const candidateManifest = JSON.parse(fs.readFileSync(candidateManifestFile, 'utf8'));
            if (candidateManifest && candidateManifest.name === name && typeof candidateManifest.version === 'string') {
              return candidateManifest.version;
            }
          }
        }
      } catch (_) {
        // Ignore non-workspace or invalid ancestor manifests here; project manifest
        // validation is handled separately by projectPackageManifest().
      }
    }
    if (current === filesystemRoot) break;
    current = path.dirname(current);
  }
  return null;
}

function resolvedPackageVersion(projectRoot, name) {
  const request = createRequire(path.join(projectRoot, 'package.json'));
  try {
    const entry = request.resolve(name);
    const version = packageVersionFromEntry(entry, name);
    if (version) return version;
  } catch (_) {
    // Fall through to workspace discovery for source-tree projects that have not
    // installed package links into the application directory.
  }
  return workspacePackageVersion(projectRoot, name);
}

function normalizeDependencyVersion(projectRoot, manifest, name) {
  const declared = declaredVersion(manifest, name);
  if (declared && !/^(?:workspace:|file:|link:)/.test(declared)) return declared;
  const resolved = resolvedPackageVersion(projectRoot, name);
  if (resolved) return resolved;
  if (declared) return declared;
  throw new PulseNodeJavascriptSourcePackageError(
    'PULSE_JAVASCRIPT_SOURCE_PACKAGE_DEPENDENCY_VERSION_UNKNOWN',
    `Cannot determine a package version for reachable dependency ${name}.`,
    { projectRoot, packageName: name }
  );
}

function reachableDependencies(plan, projectRoot) {
  const names = new Set();
  for (const module of plan.graph.modules || []) {
    if (!module.runtime) continue;
    if (module.kind === 'package' && module.packageName) names.add(module.packageName);
    if (module.kind === 'external' && module.externalSpecifier) {
      const name = packageNameFromSpecifier(module.externalSpecifier);
      if (name) names.add(name);
    }
  }
  const manifest = projectPackageManifest(projectRoot);
  return Object.freeze(Object.fromEntries([...names].sort().map((name) => [
    name,
    normalizeDependencyVersion(projectRoot, manifest, name)
  ])));
}

function sourcePackageName(projectRoot) {
  const manifest = projectPackageManifest(projectRoot);
  const candidate = manifest && typeof manifest.name === 'string'
    ? manifest.name
    : path.basename(projectRoot);
  const normalized = String(candidate || 'pulse-application')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pulse-application';
  return `pulse-build-${normalized}`;
}

function writeFile(root, relativeFile, content) {
  const file = path.join(root, relativeFile);
  assertInside(root, file, `Output file ${relativeFile}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const bytes = fs.readFileSync(file);
  return Object.freeze({ file: slash(relativeFile), bytes: bytes.byteLength, sha256: sha256(bytes) });
}

function defaultExportLoader(entryFile) {
  return `'use strict';\n\nconst loaded = require(${JSON.stringify(`./application/${slash(entryFile)}`)});\nconst application = loaded && Object.prototype.hasOwnProperty.call(loaded, 'default') ? loaded.default : loaded;\nmodule.exports = application;\n`;
}

function writeNodeJavascriptSourcePackage(options = {}) {
  const plan = options.plan;
  if (!plan || !plan.graph || plan.loadable !== true) {
    throw new PulseNodeJavascriptSourcePackageError(
      'PULSE_JAVASCRIPT_SOURCE_PACKAGE_PLAN_UNAVAILABLE',
      'Node JavaScript source packaging requires a loadable JavaScript application plan.',
      { blockers: plan && plan.blockers || [] }
    );
  }
  const projectRoot = path.resolve(options.projectRoot || '.');
  const outDir = path.resolve(options.outDir || path.join(projectRoot, 'dist'));
  assertInside(projectRoot, outDir, 'JavaScript build output');
  fs.mkdirSync(outDir, { recursive: true });

  const moduleRecords = [];
  const projectModules = (plan.graph.modules || [])
    .filter((entry) => entry.runtime && entry.kind === 'project' && entry.path)
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const module of projectModules) {
    const sourceFile = path.resolve(projectRoot, module.path);
    assertInside(projectRoot, sourceFile, `Project module ${module.path}`);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      throw new PulseNodeJavascriptSourcePackageError(
        'PULSE_JAVASCRIPT_SOURCE_PACKAGE_MODULE_MISSING',
        `JavaScript source package module is missing: ${module.path}.`,
        { module: module.path, sourceFile }
      );
    }
    const sourceBytes = fs.readFileSync(sourceFile);
    const actualHash = sha256(sourceBytes);
    if (actualHash !== module.contentHash) {
      throw new PulseNodeJavascriptSourcePackageError(
        'PULSE_JAVASCRIPT_SOURCE_PACKAGE_SOURCE_CHANGED',
        `JavaScript source package module changed after planning: ${module.path}.`,
        { module: module.path, expected: module.contentHash, actual: actualHash }
      );
    }
    const outputPath = outputModulePath(module.path);
    const kind = sourceKind(module.path);
    const output = kind === 'json'
      ? sourceBytes
      : Buffer.from(transpileModule(sourceBytes.toString('utf8'), module.path));
    const record = writeFile(outDir, `application/${outputPath}`, output);
    moduleRecords.push(Object.freeze({
      moduleId: module.id,
      source: slash(module.path),
      sourceSha256: module.contentHash,
      output: record.file,
      outputSha256: record.sha256,
      bytes: record.bytes,
      kind
    }));
  }

  const entryOutput = outputModulePath(plan.workspace.entry);
  const schemaBundle = options.schemaBundle;
  const schemaActive = Boolean(schemaBundle && schemaBundle.active);
  const baseDependencies = reachableDependencies(plan, projectRoot);
  const dependencies = Object.freeze({
    ...baseDependencies,
    ...(schemaActive
      ? {
          '@pulse-compute/wasm-contracts': normalizeDependencyVersion(
            projectRoot,
            projectPackageManifest(projectRoot),
            '@pulse-compute/wasm-contracts'
          )
        }
      : {})
  });
  const packageJson = Object.freeze({
    name: sourcePackageName(projectRoot),
    version: '0.0.0',
    private: true,
    type: 'commonjs',
    main: 'index.cjs',
    dependencies
  });
  const packageRecord = writeFile(outDir, 'package.json', stableJson(packageJson));
  const entryRecord = writeFile(outDir, 'index.cjs', defaultExportLoader(entryOutput));
  const planRecord = writeFile(outDir, 'pulse-javascript-application-plan.json', stableJson(plan));
  const schemaRegistryRecord = schemaActive
    ? writeFile(outDir, 'schema-json-registry.json', stableJson(schemaBundle.registry))
    : undefined;
  const schemaCodecsRecord = schemaActive
    ? writeFile(outDir, 'schema-json-codecs.cjs', schemaBundle.moduleSource)
    : undefined;

  const manifest = Object.freeze({
    version: NODE_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
    status: 'packaged',
    provider: 'node',
    target: 'javascript',
    targetId: plan.targetId,
    automaticFallback: false,
    project: Object.freeze({
      root: '.',
      entry: slash(plan.workspace.entry),
      packagedEntry: `application/${slash(entryOutput)}`
    }),
    plan: Object.freeze({
      version: plan.version,
      planHash: plan.planHash,
      graphVersion: plan.graph.version,
      graphHash: plan.graph.graphHash,
      resolverHash: plan.graph.resolverHash,
      loadable: plan.loadable,
      blockers: plan.blockers
    }),
    package: Object.freeze({
      manifest: packageRecord.file,
      entry: entryRecord.file,
      applicationPlan: planRecord.file,
      schemaRegistry: schemaRegistryRecord && schemaRegistryRecord.file,
      schemaCodecs: schemaCodecsRecord && schemaCodecsRecord.file,
      dependencies
    }),
    schemas: Object.freeze({
      active: schemaActive,
      registry: schemaRegistryRecord && schemaRegistryRecord.file,
      codecs: schemaCodecsRecord && schemaCodecsRecord.file,
      ids: Object.freeze(schemaActive ? [...schemaBundle.schemaIds] : []),
      responseCaseIds: Object.freeze(schemaActive ? [...schemaBundle.responseCaseIds] : []),
      registryHash: schemaActive ? schemaBundle.registry.registryHash : null,
      codecTableHash: schemaActive ? schemaBundle.codecTableHash : null,
      sourceHash: schemaActive ? schemaBundle.sourceHash : null,
      fullCodecRealization: schemaActive ? schemaBundle.fullCodecRealization === true : false
    }),
    modules: Object.freeze(moduleRecords),
    summary: Object.freeze({
      modules: moduleRecords.length,
      packages: Object.keys(dependencies).length,
      bytes: moduleRecords.reduce((sum, entry) => sum + entry.bytes, 0)
        + packageRecord.bytes
        + entryRecord.bytes
        + planRecord.bytes
        + (schemaRegistryRecord ? schemaRegistryRecord.bytes : 0)
        + (schemaCodecsRecord ? schemaCodecsRecord.bytes : 0)
    })
  });
  const manifestRecord = writeFile(outDir, NODE_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST, stableJson(manifest));
  return Object.freeze({
    version: NODE_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
    outDir,
    entryFile: path.join(outDir, entryRecord.file),
    packageFile: path.join(outDir, packageRecord.file),
    applicationPlanFile: path.join(outDir, planRecord.file),
    schemaRegistryFile: schemaRegistryRecord ? path.join(outDir, schemaRegistryRecord.file) : undefined,
    schemaCodecsFile: schemaCodecsRecord ? path.join(outDir, schemaCodecsRecord.file) : undefined,
    manifestFile: path.join(outDir, manifestRecord.file),
    manifest,
    files: Object.freeze([
      packageRecord,
      entryRecord,
      planRecord,
      ...(schemaRegistryRecord ? [schemaRegistryRecord] : []),
      ...(schemaCodecsRecord ? [schemaCodecsRecord] : []),
      manifestRecord,
      ...moduleRecords.map((entry) => Object.freeze({ file: entry.output, bytes: entry.bytes, sha256: entry.outputSha256 }))
    ])
  });
}

module.exports = Object.freeze({
  NODE_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
  NODE_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST,
  PulseNodeJavascriptSourcePackageError,
  outputModulePath,
  reachableDependencies,
  writeNodeJavascriptSourcePackage
});
