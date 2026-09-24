'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { executeCanonicalNativeModuleSpine } = require('./spine/canonical-native-module.js');
const {
  packageLoweringForCanonicalNativePlan,
  providerRequirementsForCanonicalNativePlan
} = require('./spine/canonical-native-plan.js');
const { packageOperationRecognitionFromEffects, lowerCanonicalPackageOperations } = require('./spine/package-operation-seam.js');
const { collectProviderRequirements, assertProviderRequirementsForPlan } = require('./spine/provider-requirement-authority.js');
const { realizeSelectedGuestUnits } = require('./spine/guest-unit-stage.js');
const {
  PACKAGE_REALIZATION_ARTIFACT_SET_VERSION
} = require('@pulse-compute/wasm-contracts/package/package-contract');

function loadNativePlanCompiler() {
  try { return require('@pulse-compute/wasm-compiler/canonical-native-plan'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('./canonical-native-plan.js');
    throw error;
  }
}

function loadRuntimeCore() {
  try { return require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../runtime-core-as/src/compiler/canonical-native.js');
    throw error;
  }
}

function loadRuntimeContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../contracts/src/handler/canonical-native-runtime.js');
    throw error;
  }
}

function loadEventContract() {
  try { return require('@pulse-compute/wasm-contracts/events'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../contracts/src/events/contracts.js');
    throw error;
  }
}

function loadBuildSupport() {
  try { return require('@pulse-compute/wasm-build-support/assemblyscript-compile'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../build-support/src/assemblyscript-compile.js');
    throw error;
  }
}

const nativePlanCompiler = loadNativePlanCompiler();
const runtimeCore = loadRuntimeCore();
const runtimeContract = loadRuntimeContract();
const eventContract = loadEventContract();
const { resolveAsc } = loadBuildSupport();
const { memoryAbi } = (() => {
  try {
    return require('@pulse-compute/wasm-guest-link');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return require('../../wasm-guest-link/src/index.js');
    throw error;
  }
})();
const {
  appendAssemblyScriptOptimizationArgs,
  resolveNativeOptimization
} = require('@pulse-compute/wasm-build-support/native-optimization');

class CanonicalNativeCompileError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'CanonicalNativeCompileError';
    this.code = 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED';
    this.detail = Object.freeze({ ...detail });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = stableObject(value[key]);
  return out;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableStringify(value, space = 0) {
  return JSON.stringify(stableObject(value), null, space);
}

function inspectCanonicalNativeWasm(input, options = {}) {
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(path.resolve(input));
  if (!WebAssembly.validate(bytes)) throw new CanonicalNativeCompileError('Generated canonical native Wasm is not valid WebAssembly.');
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module).map((entry) => Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind }));
  const exports = WebAssembly.Module.exports(module).map((entry) => Object.freeze({ name: entry.name, kind: entry.kind }));
  const unexpectedModules = [...new Set(imports.map((entry) => entry.module).filter((name) => !['pulse_host', 'env'].includes(name)))];
  if (unexpectedModules.length > 0) throw new CanonicalNativeCompileError('Canonical native Wasm imports an unsupported module.', { unexpectedModules, imports });

  const allowedPulseImports = new Set(runtimeContract.CANONICAL_NATIVE_IMPORT_NAMES);
  const pulseImports = imports.filter((entry) => entry.module === 'pulse_host').map((entry) => entry.name).sort();
  const unexpectedPulseImports = pulseImports.filter((name) => !allowedPulseImports.has(name));
  if (unexpectedPulseImports.length > 0) {
    throw new CanonicalNativeCompileError('Canonical native Wasm imports a function outside the versioned pulse_host ABI.', { unexpectedPulseImports, pulseImports });
  }

  const allowedEnvImports = new Set(runtimeContract.CANONICAL_NATIVE_ALLOWED_ENV_IMPORTS);
  const unexpectedEnvImports = imports.filter((entry) => entry.module === 'env' && !allowedEnvImports.has(entry.name));
  if (unexpectedEnvImports.length > 0) {
    throw new CanonicalNativeCompileError('Canonical native Wasm imports an unsupported AssemblyScript environment function.', { unexpectedEnvImports });
  }

  const exportNames = new Set(exports.map((entry) => entry.name));
  const missingExports = runtimeContract.CANONICAL_NATIVE_EXPORT_NAMES.filter((name) => !exportNames.has(name));
  if (missingExports.length > 0) throw new CanonicalNativeCompileError('Canonical native Wasm is missing required ABI exports.', { missingExports, exports });
  const plan = options.plan;
  const eventReachable = Boolean(plan && plan.events && plan.events.catalog && plan.events.catalog.events.length > 0);
  const eventExportNames = eventContract.EVENT_NATIVE_ABI_EXTENSION.exports.map((entry) => entry.name);
  const presentEventExports = eventExportNames.filter((name) => exportNames.has(name));
  if (eventReachable && presentEventExports.length !== eventExportNames.length) {
    throw new CanonicalNativeCompileError('Event-reachable canonical native Wasm is missing its conditional event ABI exports.', {
      missingEventExports: eventExportNames.filter((name) => !exportNames.has(name)),
      exports
    });
  }
  if (plan && !eventReachable && presentEventExports.length > 0) {
    throw new CanonicalNativeCompileError('HTTP-only canonical native Wasm unexpectedly exposes the conditional event ABI.', { presentEventExports });
  }
  return Object.freeze({
    valid: true,
    bytes: bytes.length,
    sha256: sha256(bytes),
    magic: bytes.subarray(0, 8).toString('hex'),
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    importModules: Object.freeze([...new Set(imports.map((entry) => entry.module))].sort())
  });
}

function resolveProviderRequirements(plan) {
  const attached = providerRequirementsForCanonicalNativePlan(plan);
  if (attached) return attached;
  const recognition = packageOperationRecognitionFromEffects((plan.packages && plan.packages.effects) || []);
  return collectProviderRequirements(plan, lowerCanonicalPackageOperations(recognition));
}

function realizeCanonicalNativePlan(plan, options = {}, providerRequirements) {
  try {
    assertProviderRequirementsForPlan(providerRequirements, plan);
  } catch (error) {
    throw new CanonicalNativeCompileError('Canonical native realization requires the matching provider-neutral requirement record.', {
      causeCode: error && error.code,
      cause: error && error.message,
      causeDetail: error && error.detail
    });
  }
  const validation = nativePlanCompiler.validateCanonicalNativePlan(plan);
  const packageLowering = packageLoweringForCanonicalNativePlan(plan);
  const realizationArtifacts = Object.freeze((packageLowering && packageLowering.realizationArtifacts || [])
    .map((artifact) => deepFreeze(stableObject(artifact))));
  const guestUnits = Object.freeze((packageLowering && packageLowering.guestUnits || [])
    .map((unit) => deepFreeze(stableObject(unit))));
  const cwd = path.resolve(options.cwd || process.cwd());
  const compilerPackageRoot = path.resolve(__dirname, '..');
  const asc = resolveAsc(cwd) || resolveAsc(compilerPackageRoot);
  if (!asc) throw new CanonicalNativeCompileError('AssemblyScript compiler dependency was not found.', { cwd, remediation: 'Install the lockfile-pinned AssemblyScript dependency before compiling native Wasm.' });
  const generated = runtimeCore.generateCanonicalNativeAssemblyScript(plan, options);
  const schemaCodecsActive = generated.manifest.schemaCodecs && generated.manifest.schemaCodecs.active === true;
  let jsonAs;
  if (schemaCodecsActive) {
    let transform;
    try {
      transform = require.resolve('json-as', { paths: [compilerPackageRoot, cwd] });
    } catch (error) {
      throw new CanonicalNativeCompileError('The lockfile-pinned json-as transform was not found for Native schema codec compilation.', {
        cwd,
        package: 'json-as',
        version: '1.5.0',
        cause: error && error.message
      });
    }
    const packageRoot = path.resolve(transform, '..', '..', '..');
    const dependencyRoot = path.dirname(packageRoot);
    const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (packageJson.version !== '1.5.0') {
      throw new CanonicalNativeCompileError('Native schema codec compilation requires json-as 1.5.0 exactly.', {
        expected: '1.5.0',
        actual: packageJson.version,
        packageRoot
      });
    }
    jsonAs = Object.freeze({ transform, packageRoot, dependencyRoot, version: packageJson.version });
  }
  if (options.emitWat !== undefined && typeof options.emitWat !== 'boolean') throw new TypeError('emitWat must be a boolean.');
  const emitWat = options.emitWat === true;
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-canonical-native-'));
  const requestedOutDir = options.outDir ? path.resolve(options.outDir) : undefined;
  const outputDir = requestedOutDir || stagingDir;
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFile = path.join(stagingDir, 'canonical-native.as.ts');
  const wasmFile = path.join(outputDir, options.wasmFile || 'canonical-native.wasm');
  const watFile = path.join(outputDir, options.watFile || 'canonical-native.wat');
  if (!emitWat) fs.rmSync(watFile, { force: true });
  try {
    fs.writeFileSync(sourceFile, generated.source, 'utf8');
    // Compile from a stable, relative entry name so AssemblyScript's name section and
    // text output do not capture the random staging directory.
    const args = [
      asc.script,
      path.basename(sourceFile),
      '--outFile', wasmFile,
      '--runtime', schemaCodecsActive ? 'incremental' : 'stub',
      '--noAssert',
      '--optimize'
    ];
    if (emitWat) args.push('--textFile', watFile);
    const optimization = appendAssemblyScriptOptimizationArgs(args, options.nativeOptimization, {
      guestLinked: guestUnits.length > 0
    });
    // The text capacity profile bounds each Native module to 256 MiB.
    // Linked guests retain their separately owned fixed-memory ABI.
    if (guestUnits.length === 0 && (runtimeContract.hasBoundedReadLoop(plan) || plan.effects.some(effect => effect.kind === 'crypto.digestText' || effect.kind.startsWith('s3.')))) {
      args.push('--maximumMemory', String(runtimeContract.CANONICAL_NATIVE_READ_LOOP_MEMORY.maximumMemoryPages));
    }
    if (guestUnits.length > 0) {
      args.push(
        '--disable', 'bulk-memory',
        '--disable', 'nontrapping-f2i',
        '--disable', 'sign-extension',
        '--importMemory',
        '--noExportMemory',
        '--initialMemory', String(memoryAbi.minimumPages),
        '--maximumMemory', String(memoryAbi.maximumPages),
        '--memoryBase', String(memoryAbi.layout.primaryStatic.start)
      );
    }
    if (schemaCodecsActive) {
      args.push(
        '--exportRuntime',
        '--transform', jsonAs.transform,
        '--path', path.join(compilerPackageRoot, 'node_modules'),
        '--path', jsonAs.dependencyRoot
      );
    }
    const startedAt = Date.now();
    const result = spawnSync(asc.executable, args, {
      cwd: stagingDir,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: Number(options.timeoutMs || 120000),
      env: schemaCodecsActive
        ? { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' }
        : process.env
    });
    const durationMs = Date.now() - startedAt;
    if (result.error || result.status !== 0 || !fs.existsSync(wasmFile)) {
      throw new CanonicalNativeCompileError('AssemblyScript failed to compile the canonical native plan.', {
        status: result.status,
        signal: result.signal,
        error: result.error && result.error.message,
        stdout: String(result.stdout || '').slice(-12000),
        stderr: String(result.stderr || '').slice(-12000),
        source: generated.source,
        durationMs
      });
    }
    return Object.freeze({
      plan,
      validation,
      realizationArtifacts,
      guestUnits,
      generated,
      wasm: fs.readFileSync(wasmFile),
      wat: emitWat ? fs.readFileSync(watFile, 'utf8') : '',
      textEmitted: emitWat,
      assemblyScriptVersion: require(path.join(asc.packageRoot, 'package.json')).version,
      jsonAsVersion: jsonAs && jsonAs.version,
      optimization,
      durationMs,
      output: requestedOutDir ? Object.freeze({ outDir: outputDir, wasmFile, watFile: emitWat ? watFile : null }) : undefined
    });
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function realizeCanonicalNativeGuestUnits(realization, plan, options = {}) {
  return realizeSelectedGuestUnits(realization, realization.guestUnits, options);
}

function verifyCanonicalNativeRealization(realization) {
  const inspection = inspectCanonicalNativeWasm(realization.wasm, { plan: realization.plan });
  const artifactBytes = Buffer.from(stableStringify(realization.realizationArtifacts), 'utf8');
  const packageRealizationArtifacts = Object.freeze({
    version: PACKAGE_REALIZATION_ARTIFACT_SET_VERSION,
    count: realization.realizationArtifacts.length,
    ids: Object.freeze(realization.realizationArtifacts.map((artifact) => String(artifact.id)).sort()),
    bytes: artifactBytes.length,
    sha256: sha256(artifactBytes)
  });
  const manifest = Object.freeze({
    ...realization.generated.manifest,
    compilerVersion: runtimeContract.CANONICAL_NATIVE_COMPILER_VERSION,
    assemblyScript: Object.freeze({ package: 'assemblyscript', version: realization.assemblyScriptVersion }),
    optimization: resolveNativeOptimization(realization.optimization),
    jsonAs: realization.jsonAsVersion
      ? Object.freeze({ package: 'json-as', version: realization.jsonAsVersion, transform: true, strict: true, mode: 'NAIVE', fastPath: false })
      : null,
    wasm: Object.freeze({ bytes: inspection.bytes, sha256: inspection.sha256, magic: inspection.magic }),
    wat: Object.freeze(realization.textEmitted
      ? { emitted: true, bytes: Buffer.byteLength(realization.wat), sha256: sha256(realization.wat) }
      : { emitted: false, bytes: 0, sha256: null }),
    importModules: inspection.importModules,
    imports: inspection.imports,
    exports: inspection.exports,
    packageRealizationArtifacts,
    ...(realization.guestLink ? {
      guestUnitPlan: realization.guestLink.plan,
      guestLinkReport: realization.guestLink.report,
      finalWasmAudit: realization.guestLink.audit,
      providerPackaging: realization.guestLink.providerPackaging
    } : {}),
    policy: realization.generated.manifest.policy
  });
  return Object.freeze({
    version: runtimeContract.CANONICAL_NATIVE_WASM_VERSION,
    compilerVersion: runtimeContract.CANONICAL_NATIVE_COMPILER_VERSION,
    plan: realization.plan,
    validation: realization.validation,
    generated: realization.generated,
    source: realization.generated.source,
    sourceHash: realization.generated.sourceHash,
    realizationArtifacts: realization.realizationArtifacts,
    guestUnits: realization.guestUnits,
    guestLink: realization.guestLink,
    wasm: realization.wasm,
    wat: realization.wat,
    inspection,
    manifest,
    durationMs: realization.durationMs,
    output: realization.output
  });
}

function compileCanonicalNativePlan(plan, options = {}) {
  return executeCanonicalNativeModuleSpine(plan, options, {
    resolveProviderRequirements,
    realize: realizeCanonicalNativePlan,
    realizeGuests: realizeCanonicalNativeGuestUnits,
    verify: verifyCanonicalNativeRealization
  });
}

function writeCanonicalNativeModule(compiled, outDir, options = {}) {
  if (!compiled || !Buffer.isBuffer(compiled.wasm) || !compiled.manifest) throw new TypeError('writeCanonicalNativeModule requires a compiled canonical native module.');
  const target = path.resolve(outDir);
  fs.mkdirSync(target, { recursive: true });
  const sourceFile = path.join(target, options.sourceFile || 'canonical-native.as.ts');
  const wasmFile = path.join(target, options.wasmFile || 'canonical-native.wasm');
  const watFile = path.join(target, options.watFile || 'canonical-native.wat');
  const planFile = path.join(target, options.planFile || 'canonical-native-plan.json');
  const manifestFile = path.join(target, options.manifestFile || 'canonical-native-manifest.json');
  const realizationArtifactsFile = compiled.realizationArtifacts.length > 0
    ? path.join(target, options.realizationArtifactsFile || 'package-artifacts.json')
    : undefined;
  const guestUnitPlanFile = compiled.guestLink
    ? path.join(target, options.guestUnitPlanFile || 'guest-unit-plan.json')
    : undefined;
  const guestLinkReportFile = compiled.guestLink
    ? path.join(target, options.guestLinkReportFile || 'guest-link-report.json')
    : undefined;
  const finalWasmAuditFile = compiled.guestLink
    ? path.join(target, options.finalWasmAuditFile || 'final-wasm-audit.json')
    : undefined;
  fs.writeFileSync(sourceFile, compiled.source, 'utf8');
  fs.writeFileSync(wasmFile, compiled.wasm);
  const emitWat = compiled.manifest.wat.emitted !== false;
  if (emitWat) fs.writeFileSync(watFile, compiled.wat, 'utf8');
  else fs.rmSync(watFile, { force: true });
  fs.writeFileSync(planFile, `${nativePlanCompiler.stableStringify(compiled.plan, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestFile, `${stableStringify(compiled.manifest, 2)}\n`, 'utf8');
  if (realizationArtifactsFile) {
    fs.writeFileSync(realizationArtifactsFile, `${stableStringify(compiled.realizationArtifacts, 2)}\n`, 'utf8');
  }
  if (guestUnitPlanFile) fs.writeFileSync(guestUnitPlanFile, `${stableStringify(compiled.guestLink.plan, 2)}\n`, 'utf8');
  if (guestLinkReportFile) fs.writeFileSync(guestLinkReportFile, `${stableStringify(compiled.guestLink.report, 2)}\n`, 'utf8');
  if (finalWasmAuditFile) fs.writeFileSync(finalWasmAuditFile, `${stableStringify(compiled.guestLink.audit, 2)}\n`, 'utf8');
  return Object.freeze({
    target,
    sourceFile,
    wasmFile,
    watFile: emitWat ? watFile : null,
    planFile,
    manifestFile,
    realizationArtifactsFile,
    guestUnitPlanFile,
    guestLinkReportFile,
    finalWasmAuditFile,
    manifest: compiled.manifest
  });
}

module.exports = Object.freeze({
  CANONICAL_NATIVE_WASM_VERSION: runtimeContract.CANONICAL_NATIVE_WASM_VERSION,
  CANONICAL_NATIVE_COMPILER_VERSION: runtimeContract.CANONICAL_NATIVE_COMPILER_VERSION,
  CanonicalNativeCompileError,
  compileCanonicalNativePlan,
  inspectCanonicalNativeWasm,
  writeCanonicalNativeModule,
  stableStringify
});
