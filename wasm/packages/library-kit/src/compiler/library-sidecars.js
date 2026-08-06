'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultArtifactsDir } = loadBuildSupportArtifactsDir();
const { spawnSync } = require('node:child_process');

function loadBuildSupportArtifactsDir() {
  try {
    return require('@pulse-compute/wasm-build-support/artifacts-dir');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-build-support')) {
      return require('../../../build-support/src/artifacts-dir.js');
    }
    throw error;
  }
}

function loadBuildSupportAssemblyScriptCompile() {
  try {
    return require('@pulse-compute/wasm-build-support/assemblyscript-compile');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-build-support')) {
      return require('../../../build-support/src/assemblyscript-compile.js');
    }
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact, normalizeDiagnostic } = loadContractsDiagnostics();
const { resolveAsc } = loadBuildSupportAssemblyScriptCompile();
const {
  normalizeContractModeKeys,
  sortedUnique,
  validateLibraryContract
} = loadContractsLibraryContracts();
const {
  LIBRARY_SIDECAR_PHASE: PHASE,
  LIBRARY_SIDECAR_CONSUMPTION_VERSION,
  CTX_EXTENSION_SCOPE_MAP_VERSION,
  LIBRARY_SIDECAR_SMOKE_VERSION,
  defaultCtxExtensionContract,
  validateCtxExtensions,
  ctxExtensionValidationExamples
} = loadContractsLibrarySidecars();
const {
  API_SURFACE_VERSION,
  LIFECYCLE_ORDERING_VERSION,
  buildApiSurfaceContract,
  buildLifecycleOrderingContract
} = loadContractsLibraryApiSurface();


function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/diagnostics.js');
    }
    throw error;
  }
}

function loadContractsLibraryContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/library/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/library/contracts.js');
    }
    throw error;
  }
}

function loadContractsLibrarySidecars() {
  try {
    return require('@pulse-compute/wasm-contracts/library/sidecars');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/library/sidecars.js');
    }
    throw error;
  }
}

function loadContractsLibraryApiSurface() {
  try {
    return require('@pulse-compute/wasm-contracts/library/api-surface');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../contracts/src/library/api-surface.js');
    }
    throw error;
  }
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}
function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function makeFile(file, text) {
  return { file, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text), text };
}
function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}
function truncate(value, max = 20000) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max)}\n... <truncated ${text.length - max} chars>`;
}
function parseAscWarnings(stderr) {
  const text = stripAnsi(stderr);
  const warnings = [];
  const regex = /WARNING\s+(AS\d+):\s+([^\n]+)(?:.|\n)*?in ([^\n]+)\((\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(text))) {
    warnings.push({ code: match[1], message: match[2].trim(), file: match[3], line: Number(match[4]), column: Number(match[5]) });
  }
  if (warnings.length === 0 && /WARNING\s+AS\d+:/m.test(text)) {
    warnings.push({ code: 'AS_WARNING', message: 'AssemblyScript emitted one or more warnings. Inspect stderr.' });
  }
  return warnings;
}
function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'library-sidecars',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<library-sidecars>' }
  });
}
function fileRecord(filePath, cwd, kind) {
  const buffer = fs.readFileSync(filePath);
  return { file: path.relative(cwd, filePath).replace(/\\/g, '/'), kind, bytes: buffer.length, sha256: sha256Buffer(buffer) };
}

function buildApiSurface() {
  return buildApiSurfaceContract({ generatedBy: PACKAGE_VERSION });
}

function buildLifecycleOrdering(executionPlan) {
  return buildLifecycleOrderingContract(executionPlan, { generatedBy: PACKAGE_VERSION, phase: PHASE });
}


function buildCtxExtensionScopeMap(contract, executionPlan) {
  const modes = normalizeContractModeKeys(contract.modes);
  const extensions = Array.isArray(modes.wasm?.ctxExtensions) ? modes.wasm.ctxExtensions : [];
  const scopes = Array.isArray(executionPlan?.scopes) ? executionPlan.scopes : [];
  const entries = Array.isArray(executionPlan?.entries) ? executionPlan.entries : [];
  const extension = extensions[0];
  const installerName = extension?.installedBy?.tsSymbol || 'testExtension';
  const installerEntries = entries.filter((entry) => entry.kind === 'use' && entry.handler && entry.handler.name === installerName);

  // The fixture proves the scope metadata shape. Real route/scope proof will attach exact scope ranges later.
  const installedScopes = installerEntries.length > 0
    ? sortedUnique(installerEntries.map((entry) => entry.scopeId))
    : [0];
  const scopeExtensions = scopes.map((scope) => ({
    scopeId: scope.id,
    extensions: installedScopes.includes(scope.id) || scope.id === 0 ? [{ namespace: extension?.namespace || 'test', package: contract.package, installedBy: installerName }] : []
  }));

  return {
    version: CTX_EXTENSION_SCOPE_MAP_VERSION,
    generatedBy: PACKAGE_VERSION,
    phase: PHASE,
    status: 'ok',
    policy: {
      dynamicCtxMutationAllowedInTsMode: true,
      compiledWasmRequiresDeclaredCtxExtension: true,
      ctxExtensionAvailabilityIsScopeChecked: true,
      arbitraryCtxDecorationRejected: true,
      fixtureOnly: true
    },
    summary: {
      libraries: 1,
      ctxExtensions: extensions.length,
      installedScopes: installedScopes.length,
      methods: extensions.reduce((sum, item) => sum + (item.methods || []).length, 0),
      fixture: true
    },
    extensions: extensions.map((item) => ({
      namespace: item.namespace,
      package: contract.package,
      installedBy: item.installedBy,
      methods: item.methods || []
    })),
    installedScopes,
    scopeExtensions,
    validationExamples: ctxExtensionValidationExamples()
  };
}

function buildSidecarSource() {
  return `/*
 * Generated Phase 12C fixture sidecar.
 * Proves generic library ctx extension linking. Do not treat as real pulse.grip.
 */
let __lastMark: string = ''
let __markCount: i32 = 0

export function pulse_test_mark(ctx: usize, value: string): void {
  __lastMark = value
  __markCount += 1
}

export function pulse_test_last_mark(): string {
  return __lastMark
}

export function pulse_test_mark_count(): i32 {
  return __markCount
}
`;
}

function buildSmokeRunnerSource() {
  return `/* Generated Phase 12C sidecar smoke runner. */
import {
  pulse_test_mark,
  pulse_test_last_mark,
  pulse_test_mark_count
} from '../as/library-sidecars/test-extension.as'

export function smoke_sidecar_mark(): i32 {
  pulse_test_mark(1, 'ok')
  return pulse_test_last_mark() == 'ok' ? 1 : 0
}

export function smoke_sidecar_count(): i32 {
  pulse_test_mark(1, 'first')
  pulse_test_mark(1, 'second')
  return pulse_test_mark_count() >= 3 ? 1 : 0
}
`;
}

function compileSidecarSmoke({ cwd, outDir, files }) {
  const diagnostics = [];
  const asc = resolveAsc(cwd);
  if (!asc) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_ASSEMBLYSCRIPT_ASC_MISSING',
      'AssemblyScript compiler dependency was not found.',
      'Run npm install before library sidecar smoke.',
      { dependency: 'assemblyscript' }
    ));
    return { diagnostics, smoke: undefined, outputs: [], warnings: [] };
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-library-sidecars-'));
  const outputDir = path.join(outDir || getDefaultArtifactsDir(cwd), 'generated', 'library-sidecars');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const file of files) {
    const abs = path.join(stagingDir, file.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.text, 'utf8');
  }

  const wasmFile = path.join(outputDir, 'pulsewasm-library-sidecar.wasm');
  const watFile = path.join(outputDir, 'pulsewasm-library-sidecar.wat');
  const entry = path.join(stagingDir, 'generated/as-smoke/library-sidecar-smoke-runner.as.ts');
  const ascArgs = [asc.script, entry, '--outFile', wasmFile, '--textFile', watFile, '--runtime', 'stub', '--noAssert'];
  const proc = spawnSync(asc.executable, ascArgs, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
  const warnings = parseAscWarnings(proc.stderr);
  if (proc.error || proc.status !== 0) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_SIDECAR_AS_COMPILE_FAILED',
      `Library sidecar AssemblyScript smoke failed${proc.status !== undefined ? ` with exit code ${proc.status}` : ''}.`,
      'Inspect library-sidecar-smoke.json stderr/stdout.',
      { stdout: truncate(proc.stdout, 8000), stderr: truncate(proc.stderr, 8000), exitCode: proc.status }
    ));
  }

  const outputFiles = [];
  if (fs.existsSync(wasmFile)) outputFiles.push(fileRecord(wasmFile, cwd, 'library-sidecar-wasm'));
  if (fs.existsSync(watFile)) outputFiles.push(fileRecord(watFile, cwd, 'library-sidecar-wat'));

  let smoke;
  if (diagnostics.length === 0 && fs.existsSync(wasmFile)) {
    const wasm = fs.readFileSync(wasmFile);
    const module = new WebAssembly.Module(wasm);
    const imports = WebAssembly.Module.imports(module);
    const importObject = { env: { abort() { throw new Error('AssemblyScript abort'); } } };
    for (const imp of imports) {
      if (!importObject[imp.module]) importObject[imp.module] = {};
      if (!importObject[imp.module][imp.name]) importObject[imp.module][imp.name] = () => 0;
    }
    const instance = new WebAssembly.Instance(module, importObject);
    const checkDefs = [
      ['smoke_sidecar_mark', 1],
      ['smoke_sidecar_count', 1]
    ];
    const checks = [];
    for (const [name, expected] of checkDefs) {
      let actual;
      let status = 'ok';
      let message;
      try {
        const fn = instance.exports[name];
        if (typeof fn !== 'function') {
          status = 'error';
          message = 'Missing smoke export.';
        } else {
          actual = fn();
          if (actual !== expected) {
            status = 'error';
            message = `Expected ${expected}, got ${actual}.`;
          }
        }
      } catch (error) {
        status = 'error';
        message = error && error.message ? error.message : String(error);
      }
      checks.push({ name, expected, actual, status, message });
    }
    smoke = {
      imports,
      exports: WebAssembly.Module.exports(module),
      checks,
      failedChecks: checks.filter((check) => check.status !== 'ok'),
      wasmBytes: wasm.length
    };
    if (smoke.failedChecks.length > 0) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_SIDECAR_SMOKE_FAILED',
        'Library sidecar smoke checks failed.',
        'Inspect library-sidecar-smoke.json checks.',
        { failedChecks: smoke.failedChecks }
      ));
    }
  }

  return {
    diagnostics,
    warnings,
    smoke,
    outputFiles,
    command: {
      executable: asc.display,
      args: ascArgs.slice(1).map((arg) => path.isAbsolute(arg) ? path.relative(cwd, arg).replace(/\\/g, '/') : arg)
    },
    result: { exitCode: proc.status, stdout: truncate(proc.stdout), stderr: truncate(proc.stderr) }
  };
}

function markdownForSidecars(artifact, apiSurface, ctxExtensionScopeMap, lifecycleOrdering) {
  const lines = [];
  lines.push('# PulseWasm Phase 12C — Library Sidecar Consumption + ctx Extension Fixture');
  lines.push('');
  lines.push('## Status');
  lines.push('Implemented as a generic compiler-side fixture. This is not a real `pulse.grip` or `pulse.assets` implementation.');
  lines.push('');
  lines.push('## Locked boundary');
  lines.push('The PulseWasm compiler owns compatibility enforcement. Libraries own their own Wasm compatibility, sidecars, parity tests, and package-specific semantics.');
  lines.push('');
  lines.push('## Fixture proved');
  lines.push('- `pulse.library.json` ctx extension declaration');
  lines.push('- middleware-installed ctx extension scope metadata');
  lines.push('- declared `ctx.<extension>.<method>` lowering surface');
  lines.push('- AS sidecar linking and smoke execution');
  lines.push('- unknown/unstaged ctx extension behavior remains rejectable by contract');
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- sidecars: ${artifact.summary.sidecars}`);
  lines.push(`- ctx extensions: ${artifact.summary.ctxExtensions}`);
  lines.push(`- lowerings: ${artifact.summary.lowerings}`);
  lines.push(`- smoke checks: ${artifact.summary.smokeChecks}`);
  lines.push('');
  lines.push('## API surface ledger');
  for (const surface of apiSurface.surfaces) {
    lines.push(`- **${surface.symbol}** — ${surface.status}; ${surface.notes || ''}`);
  }
  lines.push('');
  lines.push('## Lifecycle ordering');
  lines.push(`Default lifecycle ordering: ${lifecycleOrdering.policy.defaultOrdering}. Parallel lifecycle execution is reserved and must be explicit if ever added.`);
  lines.push('');
  lines.push('## Non-goals');
  lines.push('- no real GRIP implementation');
  lines.push('- no real assets implementation');
  lines.push('- no package-specific semantics in the compiler');
  lines.push('- no effect/result interceptors yet');
  lines.push('- no platform target');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildLibrarySidecarConsumption({ executionPlan, handlerLibraryContracts, cwd, outDir, generatedBy } = {}) {
  cwd = cwd || process.cwd();
  generatedBy = generatedBy || PACKAGE_VERSION;
  const contract = defaultCtxExtensionContract();
  const diagnostics = [];

  const baseValidation = validateLibraryContract(contract);
  diagnostics.push(...(baseValidation.diagnostics || []).map((diag) => normalizeDiagnostic(diag)));
  const extensionValidation = validateCtxExtensions(contract);
  diagnostics.push(...extensionValidation.diagnostics);

  const apiSurface = normalizeArtifact(buildApiSurface(), cwd);
  const lifecycleOrdering = normalizeArtifact(buildLifecycleOrdering(executionPlan), cwd);
  const ctxExtensionScopeMap = normalizeArtifact(buildCtxExtensionScopeMap(contract, executionPlan), cwd);

  const sidecarSource = buildSidecarSource();
  const smokeRunnerSource = buildSmokeRunnerSource();
  const files = [
    makeFile('generated/as/library-sidecars/test-extension.as.ts', sidecarSource),
    makeFile('generated/as-smoke/library-sidecar-smoke-runner.as.ts', smokeRunnerSource)
  ];

  const smokeResult = compileSidecarSmoke({ cwd, outDir, files });
  diagnostics.push(...(smokeResult.diagnostics || []));

  const smoke = normalizeArtifact({
    version: LIBRARY_SIDECAR_SMOKE_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    compiled: Boolean(smokeResult.smoke || (smokeResult.outputFiles || []).some((file) => file.kind === 'library-sidecar-wasm')),
    executed: Boolean(smokeResult.smoke),
    warnings: smokeResult.warnings || [],
    command: smokeResult.command,
    result: smokeResult.result,
    checks: smokeResult.smoke?.checks || [],
    failedChecks: smokeResult.smoke?.failedChecks || [],
    outputFiles: smokeResult.outputFiles || [],
    summary: {
      compiled: Boolean(smokeResult.smoke || (smokeResult.outputFiles || []).some((file) => file.kind === 'library-sidecar-wasm')),
      executed: Boolean(smokeResult.smoke),
      checks: smokeResult.smoke?.checks?.length || 0,
      failedChecks: smokeResult.smoke?.failedChecks?.length || 0,
      warnings: (smokeResult.warnings || []).length,
      diagnostics: diagnostics.length
    }
  }, cwd);

  const artifact = normalizeArtifact({
    version: LIBRARY_SIDECAR_CONSUMPTION_VERSION,
    generatedBy,
    phase: PHASE,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    scope: {
      genericCompilerMechanism: true,
      fixtureOnly: true,
      realGripImplemented: false,
      realAssetsImplemented: false,
      packageSpecificSemanticsInCompiler: false,
      effectInterceptorsImplemented: false,
      resultDecoratorsImplemented: false,
      platformTarget: false
    },
    policy: {
      compilerOwnsCompatibilityEnforcement: true,
      librariesOwnSidecarsAndSemantics: true,
      dynamicCtxDecorationInTsMode: true,
      compiledWasmRequiresDeclaredCtxExtensions: true,
      ctxExtensionUsageMustBeInScope: true,
      lifecycleOrdering: 'serial-source-order',
      noGuessedLibraryCompatibility: true
    },
    fixture: {
      package: contract.package,
      sidecar: contract.modes.wasm.sidecar,
      ctxExtensions: extensionValidation.extensions.map((extension) => ({
        namespace: extension.namespace,
        installedBy: extension.installedBy,
        methods: extension.methods || []
      })),
      lowerings: contract.modes.wasm.lowerings
    },
    summary: {
      sidecars: 1,
      ctxExtensions: extensionValidation.extensions.length,
      lowerings: contract.modes.wasm.lowerings.length,
      hostCapabilities: sortedUnique(contract.modes.wasm.hostCapabilities).length,
      scopesWithExtensions: ctxExtensionScopeMap.summary.installedScopes,
      apiSurfaces: apiSurface.summary.surfaces,
      lifecycleSerial: true,
      smokeChecks: smoke.summary.checks,
      failedSmokeChecks: smoke.summary.failedChecks,
      diagnostics: diagnostics.length,
      readyForGripPackageAnalysis: diagnostics.length === 0,
      readyForRealAssets: false
    },
    diagnostics: diagnostics.map((diag) => diag.code)
  }, cwd);

  const markdown = markdownForSidecars(artifact, apiSurface, ctxExtensionScopeMap, lifecycleOrdering);

  return {
    artifact,
    apiSurface,
    ctxExtensionScopeMap,
    lifecycleOrdering,
    smoke,
    diagnostics,
    files: [
      ...files,
      { file: 'generated/host/library-sidecar-consumption.md', text: markdown }
    ],
    outputFiles: smokeResult.outputFiles || []
  };
}

module.exports = {
  LIBRARY_SIDECAR_CONSUMPTION_VERSION,
  CTX_EXTENSION_SCOPE_MAP_VERSION,
  API_SURFACE_VERSION,
  LIFECYCLE_ORDERING_VERSION,
  LIBRARY_SIDECAR_SMOKE_VERSION,
  defaultCtxExtensionContract,
  validateCtxExtensions,
  buildLibrarySidecarConsumption
};
