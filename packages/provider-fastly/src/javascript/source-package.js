'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { reportingDescriptor } = require('@pulse-compute/wasm-contracts/logging');
const { FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR } = require('./target.js');

const FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION = 'pulse.fastly-javascript-source-package.v1';
const FASTLY_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST = 'pulse-fastly-javascript-source-package.json';
const FASTLY_JAVASCRIPT_DEPLOYMENT_MANIFEST = 'pulse-fastly-javascript-deployment.json';
const FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_VERSION = 'pulse.fastly-javascript-deployment-candidate.v1';
const FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE = 'pulse-fastly-javascript-candidate.json';
const FASTLY_JS_COMPUTE_VERSION = '3.43.1';
const ESBUILD_VERSION = '0.28.1';

class PulseFastlyJavascriptSourcePackageError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseFastlyJavascriptSourcePackageError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertInside(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new PulseFastlyJavascriptSourcePackageError(
    'PULSE_FASTLY_JAVASCRIPT_PACKAGE_PATH_UNSAFE',
    `${label} escapes the Pulse project root.`,
    { root: path.resolve(root), candidate: path.resolve(candidate) }
  );
}

function writeFile(root, relativeFile, content) {
  const file = path.join(root, relativeFile);
  assertInside(root, file, `Output file ${relativeFile}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const bytes = fs.readFileSync(file);
  return Object.freeze({
    file: slash(relativeFile),
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  });
}

function packageName(input) {
  const normalized = String(input || 'pulse-app')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pulse-app';
  return `pulse-fastly-${normalized}`;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function fastlyToml(providerConfig = {}) {
  const build = providerConfig.build || {};
  const authors = Array.isArray(build.authors) ? build.authors.map(String) : [];
  return [
    'manifest_version = 3',
    `name = ${tomlString(build.name || 'pulse-app')}`,
    `description = ${tomlString(build.description || 'Pulse application')}`,
    `authors = [${authors.map(tomlString).join(', ')}]`,
    'language = "javascript"',
    '',
    '[scripts]',
    'build = "npm run build"',
    ''
  ].join('\n');
}

function downstreamEsbuildConfig() {
  return [
    "import { build } from 'esbuild';",
    '',
    'await build({',
    "  entryPoints: ['src/index.js'],",
    "  outfile: 'dist/index.js',",
    '  bundle: true,',
    "  format: 'esm',",
    "  platform: 'neutral',",
    "  target: ['es2022'],",
    "  conditions: ['fastly', 'module', 'import', 'default'],",
    "  external: ['fastly:*'],",
    "  legalComments: 'none',",
    '  sourcemap: false,',
    "  logLevel: 'info'",
    '});',
    ''
  ].join('\n');
}

function abortControllerCompatibilitySource() {
  return [
    "if (typeof globalThis.AbortController !== 'function') {",
    '  class PulseFastlyAbortSignal {',
    '    constructor() {',
    '      this.aborted = false;',
    '      this.reason = undefined;',
    '      this.onabort = null;',
    '      this.listeners = [];',
    '    }',
    '    addEventListener(type, listener, options = undefined) {',
    "      if (type !== 'abort' || (typeof listener !== 'function' && !(listener && typeof listener.handleEvent === 'function'))) return;",
    '      if (this.listeners.some((entry) => entry.listener === listener)) return;',
    '      this.listeners.push({ listener, once: Boolean(options && options.once) });',
    '    }',
    '    removeEventListener(type, listener) {',
    "      if (type !== 'abort') return;",
    '      this.listeners = this.listeners.filter((entry) => entry.listener !== listener);',
    '    }',
    '    dispatchAbort(reason) {',
    '      if (this.aborted) return;',
    '      this.aborted = true;',
    '      this.reason = reason;',
    "      const event = Object.freeze({ type: 'abort', target: this, currentTarget: this });",
    '      const snapshot = [...this.listeners];',
    '      for (const entry of snapshot) {',
    '        if (entry.once) this.removeEventListener(\'abort\', entry.listener);',
    '        if (typeof entry.listener === \'function\') entry.listener.call(this, event);',
    '        else entry.listener.handleEvent(event);',
    '      }',
    "      if (typeof this.onabort === 'function') this.onabort.call(this, event);",
    '    }',
    '  }',
    '  class PulseFastlyAbortController {',
    '    constructor() { this.signal = new PulseFastlyAbortSignal(); }',
    "    abort(reason = new Error('This operation was aborted')) { this.signal.dispatchAbort(reason); }",
    '  }',
    "  Object.defineProperty(globalThis, 'AbortController', { configurable: true, writable: true, value: PulseFastlyAbortController });",
    '}',
  ].join('\n');
}

function bootstrapSource(deployment, runtimeConfig) {
  return [
    "import { enforceExplicitBackends } from 'fastly:backend';",
    "import { ConfigStore } from 'fastly:config-store';",
    "import { KVStore } from 'fastly:kv-store';",
    "import { SecretStore } from 'fastly:secret-store';",
    "import application, { createFastlyJavascriptHandler, schemaCodecs } from './application.js';",
    '',
    abortControllerCompatibilitySource(),
    '',
    `export const pulseDeployment = Object.freeze(${JSON.stringify(deployment)});`,
    `export const pulseRuntimeConfig = Object.freeze(${JSON.stringify(runtimeConfig)});`,
    'if (pulseRuntimeConfig.bindings.dynamicBackends !== true) enforceExplicitBackends();',
    'export const handler = createFastlyJavascriptHandler(application, {',
    '  ...pulseRuntimeConfig,',
    '  apis: { ConfigStore, SecretStore, KVStore },',
    '  fetchImplementation: globalThis.fetch.bind(globalThis),',
    '  console: globalThis.console,',
    '  schemaCodecs',
    '});',
    "addEventListener('fetch', (event) => event.respondWith(handler(event)));",
    'export { application, schemaCodecs };',
    'export default handler;',
    ''
  ].join('\n');
}

function normalizedInputPath(input, projectRoot) {
  const absolute = path.isAbsolute(input) ? input : path.resolve(projectRoot, input);
  const relative = path.relative(projectRoot, absolute);
  return slash(relative || '.');
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

function workspacePackages(projectRoot) {
  let current = path.resolve(projectRoot);
  const filesystemRoot = path.parse(current).root;
  while (true) {
    const manifestFile = path.join(current, 'package.json');
    if (fs.existsSync(manifestFile)) {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
      catch (_) { manifest = null; }
      const patterns = workspacePatterns(manifest);
      if (patterns.length > 0) {
        const packages = new Map();
        for (const pattern of patterns) {
          for (const root of expandWorkspacePattern(current, pattern)) {
            const packageFile = path.join(root, 'package.json');
            if (!fs.existsSync(packageFile)) continue;
            try {
              const packageManifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
              if (packageManifest && typeof packageManifest.name === 'string') {
                packages.set(packageManifest.name, Object.freeze({ root, manifest: packageManifest }));
              }
            } catch (_) {
              // Invalid package manifests are owned by workspace validation.
            }
          }
        }
        return packages;
      }
    }
    if (current === filesystemRoot) break;
    current = path.dirname(current);
  }
  return new Map();
}

function conditionalExportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const condition of ['fastly', 'import', 'module', 'require', 'default']) {
    const target = conditionalExportTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

function workspacePackageAliases(projectRoot) {
  const packages = workspacePackages(projectRoot);
  const aliases = {};
  for (const [name, entry] of packages) {
    const exports = entry.manifest.exports;
    if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
      for (const [subpath, value] of Object.entries(exports)) {
        if (subpath !== '.' && !subpath.startsWith('./')) continue;
        const target = conditionalExportTarget(value);
        if (!target) continue;
        const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
        aliases[specifier] = path.resolve(entry.root, target);
      }
    }
    if (!aliases[name]) {
      const target = entry.manifest.module || entry.manifest.main;
      if (target) aliases[name] = path.resolve(entry.root, target);
    }
  }
  return Object.freeze(aliases);
}

function relativeImport(projectRoot, file) {
  const relative = slash(path.relative(projectRoot, file));
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function bundleFastlyJavascriptApplication(plan, projectRoot, schemaBundle, options = {}) {
  const format = options.format === 'cjs' ? 'cjs' : 'esm';
  const external = [
    'fastly:*',
    ...(options.externalRuntime === true
      ? ['@pulse-compute/runtime', '@pulse-compute/runtime/*']
      : [])
  ];
  let esbuild;
  try { esbuild = require('esbuild'); }
  catch (error) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_ESBUILD_MISSING',
      `Fastly JavaScript source packaging requires exact esbuild ${ESBUILD_VERSION}.`,
      { package: 'esbuild', version: ESBUILD_VERSION, cause: error && error.message }
    );
  }
  if (esbuild.version !== ESBUILD_VERSION) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_ESBUILD_VERSION_MISMATCH',
      `Fastly JavaScript source packaging requires exact esbuild ${ESBUILD_VERSION}; received ${String(esbuild.version)}.`,
      { expected: ESBUILD_VERSION, actual: esbuild.version }
    );
  }
  const entryFile = path.resolve(projectRoot, plan.workspace.entry);
  assertInside(projectRoot, entryFile, 'Fastly JavaScript application entry');
  if (!fs.existsSync(entryFile) || !fs.statSync(entryFile).isFile()) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_ENTRY_MISSING',
      `Fastly JavaScript application entry is missing: ${plan.workspace.entry}.`,
      { entryFile, entry: plan.workspace.entry }
    );
  }

  const runtimeFile = path.join(__dirname, 'lifecycle.js');
  const entrySource = [
    `import application from ${JSON.stringify(relativeImport(projectRoot, entryFile))};`,
    `import fastlyRuntime from ${JSON.stringify(relativeImport(projectRoot, runtimeFile))};`,
    ...(schemaBundle && schemaBundle.active
      ? [
          'const schemaCodecs = (() => {',
          '  const module = { exports: {} };',
          schemaBundle.moduleSource,
          '  return module.exports;',
          '})();'
        ]
      : ['const schemaCodecs = null;']),
    'const { createFastlyJavascriptHandler } = fastlyRuntime;',
    'export { application, createFastlyJavascriptHandler, schemaCodecs };',
    'export default application;',
    ''
  ].join('\n');
  const workspaceAliases = workspacePackageAliases(projectRoot);
  const aliases = {
    ...Object.fromEntries(Object.entries(workspaceAliases).filter(([specifier]) =>
      options.externalRuntime !== true
      || (specifier !== '@pulse-compute/runtime' && !specifier.startsWith('@pulse-compute/runtime/'))
    )),
    ...(schemaBundle && schemaBundle.active
      ? { 'node:crypto': path.join(__dirname, 'sha256.js') }
      : {})
  };

  let result;
  try {
    result = esbuild.buildSync({
      absWorkingDir: projectRoot,
      stdin: {
        contents: entrySource,
        resolveDir: projectRoot,
        sourcefile: 'pulse-fastly-application-entry.js',
        loader: 'js'
      },
      outfile: 'application.js',
      bundle: true,
      write: false,
      metafile: true,
      format,
      platform: 'neutral',
      target: ['es2022'],
      conditions: ['fastly', 'module', 'import', 'default'],
      mainFields: ['module', 'main'],
      packages: 'bundle',
      external,
      legalComments: 'none',
      sourcemap: false,
      charset: 'utf8',
      treeShaking: true,
      logLevel: 'silent',
      alias: aliases
    });
  } catch (error) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_BUNDLE_FAILED',
      'Fastly JavaScript source packaging could not bundle the application closure.',
      {
        entry: plan.workspace.entry,
        errors: Array.isArray(error && error.errors)
          ? error.errors.map((entry) => Object.freeze({ text: entry.text, location: entry.location }))
          : [],
        cause: error && error.message
      }
    );
  }
  const output = result.outputFiles && result.outputFiles.find((entry) => entry.path.endsWith('application.js'));
  if (!output) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_BUNDLE_OUTPUT_MISSING',
      'Fastly JavaScript bundling did not produce application.js.'
    );
  }
  const text = output.text;
  const nodeImports = [...text.matchAll(/(?:from\s+|import\s*\()\s*["'](node:[^"']+|(?:fs|path|crypto|module|stream|buffer|util|events))["']/g)]
    .map((match) => match[1]);
  if (nodeImports.length > 0) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_NODE_BUILTIN',
      'Fastly JavaScript source closure contains a Node-only builtin import.',
      { imports: Object.freeze([...new Set(nodeImports)].sort()) }
    );
  }
  const inputs = Object.freeze(Object.entries(result.metafile.inputs || {})
    .map(([file, metadata]) => Object.freeze({
      file: normalizedInputPath(file, projectRoot),
      bytes: Number(metadata.bytes || 0),
      imports: Object.freeze((metadata.imports || []).map((entry) => Object.freeze({
        path: slash(entry.path),
        kind: entry.kind,
        external: entry.external === true
      })).sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)))
    }))
    .sort((left, right) => left.file.localeCompare(right.file)));
  return Object.freeze({
    format,
    source: text,
    sourceHash: sha256(Buffer.from(text)),
    inputs
  });
}

function assertDeploymentCandidateAgreement(input) {
  const {
    candidate,
    candidateRecord,
    deployment,
    deploymentRecord,
    manifest,
    plan,
    applicationRecord,
    bootstrapRecord,
    packageRecord,
    fastlyRecord
  } = input;
  const mismatches = [];
  const matches = (label, actual, expected) => {
    if (actual !== expected) mismatches.push(Object.freeze({ label, actual, expected }));
  };
  matches('candidate.provider', candidate.provider, manifest.provider);
  matches('candidate.target', candidate.target, manifest.target);
  matches('candidate.targetId', candidate.targetId, manifest.targetId);
  matches('candidate.identity.applicationPlanHash', candidate.identity.applicationPlanHash, plan.planHash);
  matches('candidate.identity.graphHash', candidate.identity.graphHash, plan.graph.graphHash);
  matches('candidate.identity.bundleSha256', candidate.identity.bundleSha256, applicationRecord.sha256);
  matches('candidate.deployment.version', candidate.deployment.version, deployment.version);
  matches('candidate.deployment.manifest', candidate.deployment.manifest, deploymentRecord.file);
  matches('candidate.deployment.sha256', candidate.deployment.sha256, deploymentRecord.sha256);
  matches('candidate.entrypoints.bootstrap', candidate.entrypoints.bootstrap, bootstrapRecord.file);
  matches('candidate.entrypoints.bundledApplication', candidate.entrypoints.bundledApplication, applicationRecord.file);
  matches('candidate.entrypoints.fastlyManifest', candidate.entrypoints.fastlyManifest, fastlyRecord.file);
  matches('candidate.entrypoints.packageManifest', candidate.entrypoints.packageManifest, packageRecord.file);
  matches('manifest.deploymentCandidate.version', manifest.deploymentCandidate.version, candidate.version);
  matches('manifest.deploymentCandidate.status', manifest.deploymentCandidate.status, candidate.status);
  matches('manifest.deploymentCandidate.file', manifest.deploymentCandidate.file, candidateRecord.file);
  matches('manifest.deploymentCandidate.sha256', manifest.deploymentCandidate.sha256, candidateRecord.sha256);
  matches('deployment.candidate.version', deployment.candidate.version, candidate.version);
  matches('deployment.candidate.file', deployment.candidate.file, candidateRecord.file);
  matches('deployment.candidate.status', deployment.candidate.status, candidate.status);
  if (stableJson(manifest.deploymentCandidate.identity) !== stableJson(candidate.identity)) {
    mismatches.push(Object.freeze({ label: 'manifest.deploymentCandidate.identity' }));
  }
  if (stableJson(manifest.deploymentCandidate.commands) !== stableJson(candidate.commands)) {
    mismatches.push(Object.freeze({ label: 'manifest.deploymentCandidate.commands' }));
  }
  if (mismatches.length > 0) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_MISMATCH',
      'Fastly JavaScript deployment candidate and source-package manifests disagree.',
      { mismatches: Object.freeze(mismatches) }
    );
  }
}

function writeFastlyJavascriptSourcePackage(options = {}) {
  const plan = options.plan;
  if (!plan || !plan.graph || plan.provider !== 'fastly' || plan.target !== 'javascript' || plan.loadable !== true) {
    throw new PulseFastlyJavascriptSourcePackageError(
      'PULSE_FASTLY_JAVASCRIPT_PACKAGE_PLAN_UNAVAILABLE',
      'Fastly JavaScript source packaging requires a loadable Fastly JavaScript application plan.',
      {
        provider: plan && plan.provider,
        target: plan && plan.target,
        blockers: plan && plan.blockers || []
      }
    );
  }
  const projectRoot = path.resolve(options.projectRoot || '.');
  const outDir = path.resolve(options.outDir || path.join(projectRoot, 'dist'));
  assertInside(projectRoot, outDir, 'Fastly JavaScript build output');
  fs.mkdirSync(outDir, { recursive: true });

  const reporting = reportingDescriptor(options.reporting);
  const descriptor = Object.freeze({
    ...FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR,
    resolvedReporting: reporting
  });
  const schemaBundle = options.schemaBundle;
  const schemaActive = Boolean(schemaBundle && schemaBundle.active);
  const bundle = bundleFastlyJavascriptApplication(plan, projectRoot, schemaBundle);
  const providerConfig = options.providerConfig || {};
  const providerBindings = providerConfig.bindings && typeof providerConfig.bindings === 'object'
    ? providerConfig.bindings
    : {};
  const targetSupport = options.targetSupport || null;
  const deployment = Object.freeze({
    version: 'pulse.fastly-javascript-deployment.v1',
    provider: 'fastly',
    target: 'javascript',
    targetId: descriptor.targetId,
    runtimeClass: 'javascript',
    automaticFallback: false,
    nativeArtifact: false,
    sourcePackage: true,
    executionReady: true,
    providerExecutionReady: true,
    generalAvailable: Boolean(targetSupport?.availability?.generalAvailable),
    deferredTo: Object.freeze([]),
    reporting,
    targetDescriptor: descriptor,
    targetSupport,
    candidate: Object.freeze({
      version: FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_VERSION,
      file: FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE,
      status: 'structurally-deployable',
      providerRealityValidated: false,
      deployed: false
    }),
    downstreamBuild: Object.freeze({
      owner: '@fastly/js-compute',
      classification: 'javascript-runtime-deployment',
      input: 'dist/index.js',
      output: 'bin/main.wasm',
      pulseNativeLowering: false
    })
  });
  const runtimeConfig = Object.freeze({
    bindings: providerBindings,
    reporting: reporting.name,
    strict: options.strict === true,
    maxStructuredBodyBytes: Number(options.maxStructuredBodyBytes || 65536)
  });
  const packageJson = Object.freeze({
    name: packageName(providerConfig.build && providerConfig.build.name),
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: Object.freeze({
      prebuild: 'node pulse-esbuild.config.js',
      build: 'js-compute-runtime ./dist/index.js ./bin/main.wasm'
    }),
    dependencies: Object.freeze({
      '@fastly/js-compute': FASTLY_JS_COMPUTE_VERSION
    }),
    devDependencies: Object.freeze({
      esbuild: ESBUILD_VERSION
    })
  });

  const records = [];
  const record = (relativeFile, content) => {
    const value = writeFile(outDir, relativeFile, content);
    records.push(value);
    return value;
  };
  const applicationRecord = record('src/application.js', bundle.source);
  const bootstrapRecord = record('src/index.js', bootstrapSource(deployment, runtimeConfig));
  const packageRecord = record('package.json', stableJson(packageJson));
  const configRecord = record('pulse-esbuild.config.js', downstreamEsbuildConfig());
  const fastlyRecord = record('fastly.toml', fastlyToml(providerConfig));
  const planRecord = record('pulse-javascript-application-plan.json', stableJson(plan));
  const deploymentRecord = record(FASTLY_JAVASCRIPT_DEPLOYMENT_MANIFEST, stableJson(deployment));
  const schemaRegistryRecord = schemaActive
    ? record('schema-json-registry.json', stableJson(schemaBundle.registry))
    : undefined;
  const schemaCodecsRecord = schemaActive
    ? record('schema-json-codecs.cjs', schemaBundle.moduleSource)
    : undefined;
  const candidate = Object.freeze({
    version: FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_VERSION,
    status: 'structurally-deployable',
    provider: 'fastly',
    target: 'javascript',
    targetId: descriptor.targetId,
    runtimeClass: 'javascript',
    automaticFallback: false,
    nativeArtifact: false,
    providerRealityValidated: false,
    deployed: false,
    identity: Object.freeze({
      applicationPlanHash: plan.planHash,
      graphHash: plan.graph.graphHash,
      bundleSha256: applicationRecord.sha256,
      targetSupportEvidenceHash: targetSupport && targetSupport.evidenceHash || null,
      schemaSourceHash: schemaActive ? schemaBundle.sourceHash : null
    }),
    sourcePackage: Object.freeze({
      version: FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
      manifest: FASTLY_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST
    }),
    deployment: Object.freeze({
      version: deployment.version,
      manifest: deploymentRecord.file,
      sha256: deploymentRecord.sha256
    }),
    entrypoints: Object.freeze({
      bootstrap: bootstrapRecord.file,
      bundledApplication: applicationRecord.file,
      fastlyManifest: fastlyRecord.file,
      packageManifest: packageRecord.file
    }),
    toolchain: Object.freeze({
      '@fastly/js-compute': FASTLY_JS_COMPUTE_VERSION,
      esbuild: ESBUILD_VERSION
    }),
    commands: Object.freeze({
      install: 'npm install',
      build: 'npm run build',
      localReality: 'fastly compute serve'
    }),
    validation: Object.freeze({
      packageClosure: 'bundled',
      loader: 'generated',
      manifestAgreement: 'verified-at-package-write',
      providerEmulation: 'pulse test and pulse dev',
      providerReality: 'not-executed',
      deployment: 'not-executed'
    }),
    files: Object.freeze(records.map((entry) => Object.freeze({
      file: entry.file,
      bytes: entry.bytes,
      sha256: entry.sha256
    })))
  });
  const candidateRecord = record(FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE, stableJson(candidate));

  const manifest = Object.freeze({
    version: FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
    status: 'packaged',
    provider: 'fastly',
    target: 'javascript',
    targetId: descriptor.targetId,
    runtimeClass: 'javascript',
    automaticFallback: false,
    nativeArtifact: false,
    nativeEligibility: plan.nativeEligibility,
    reporting,
    targetDescriptor: descriptor,
    targetSupport,
    capabilityEnvelope: plan.capabilityEnvelope,
    eligibility: Object.freeze({
      applicationPlanLoadable: plan.loadable,
      blockers: plan.blockers,
      providerExecutionReady: true,
      projectStatus: targetSupport && targetSupport.project && targetSupport.project.status || 'eligible',
      restrictions: descriptor.capabilities.restrictions,
      availability: 'evidence-controlled'
    }),
    project: Object.freeze({
      root: '.',
      entry: slash(plan.workspace.entry),
      bundledEntry: applicationRecord.file,
      bootstrap: bootstrapRecord.file
    }),
    plan: Object.freeze({
      version: plan.version,
      planHash: plan.planHash,
      graphVersion: plan.graph.version,
      graphHash: plan.graph.graphHash,
      resolverHash: plan.graph.resolverHash
    }),
    closure: Object.freeze({
      kind: 'esbuild-bundled-source-closure',
      bundle: applicationRecord.file,
      bundleSha256: applicationRecord.sha256,
      inputs: bundle.inputs,
      reachablePackages: plan.packages,
      toolchain: Object.freeze({
        '@fastly/js-compute': FASTLY_JS_COMPUTE_VERSION,
        esbuild: ESBUILD_VERSION
      }),
      workspaceLinks: false
    }),
    package: Object.freeze({
      manifest: packageRecord.file,
      entry: bootstrapRecord.file,
      applicationPlan: planRecord.file,
      deployment: deploymentRecord.file,
      candidate: candidateRecord.file,
      fastlyToml: fastlyRecord.file,
      buildConfig: configRecord.file,
      schemaRegistry: schemaRegistryRecord && schemaRegistryRecord.file,
      schemaCodecs: schemaCodecsRecord && schemaCodecsRecord.file,
      dependencies: packageJson.dependencies,
      devDependencies: packageJson.devDependencies
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
    deploymentCandidate: Object.freeze({
      version: candidate.version,
      status: candidate.status,
      file: candidateRecord.file,
      sha256: candidateRecord.sha256,
      providerRealityValidated: false,
      deployed: false,
      identity: candidate.identity,
      commands: candidate.commands
    }),
    downstreamBuild: deployment.downstreamBuild,
    files: Object.freeze([...records]),
    summary: Object.freeze({
      bundledInputs: bundle.inputs.length,
      bundledBytes: applicationRecord.bytes,
      sourcePackageBytes: records.reduce((sum, entry) => sum + entry.bytes, 0),
      wasmFiles: 0,
      nativeFiles: 0
    })
  });
  assertDeploymentCandidateAgreement({
    candidate,
    candidateRecord,
    deployment,
    deploymentRecord,
    manifest,
    plan,
    applicationRecord,
    bootstrapRecord,
    packageRecord,
    fastlyRecord
  });
  const manifestRecord = writeFile(outDir, FASTLY_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST, stableJson(manifest));

  return Object.freeze({
    version: FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
    outDir,
    entryFile: path.join(outDir, bootstrapRecord.file),
    bundledApplicationFile: path.join(outDir, applicationRecord.file),
    packageFile: path.join(outDir, packageRecord.file),
    applicationPlanFile: path.join(outDir, planRecord.file),
    deploymentFile: path.join(outDir, deploymentRecord.file),
    deploymentCandidateFile: path.join(outDir, candidateRecord.file),
    buildConfigFile: path.join(outDir, configRecord.file),
    fastlyTomlFile: path.join(outDir, fastlyRecord.file),
    schemaRegistryFile: schemaRegistryRecord ? path.join(outDir, schemaRegistryRecord.file) : undefined,
    schemaCodecsFile: schemaCodecsRecord ? path.join(outDir, schemaCodecsRecord.file) : undefined,
    manifestFile: path.join(outDir, manifestRecord.file),
    manifest,
    files: Object.freeze([...records, manifestRecord])
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_SOURCE_PACKAGE_VERSION,
  FASTLY_JAVASCRIPT_SOURCE_PACKAGE_MANIFEST,
  FASTLY_JAVASCRIPT_DEPLOYMENT_MANIFEST,
  FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE_VERSION,
  FASTLY_JAVASCRIPT_DEPLOYMENT_CANDIDATE,
  FASTLY_JS_COMPUTE_VERSION,
  ESBUILD_VERSION,
  PulseFastlyJavascriptSourcePackageError,
  bundleFastlyJavascriptApplication,
  writeFastlyJavascriptSourcePackage
});
