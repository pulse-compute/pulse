'use strict';

const { normalizeDiagnostic } = require('../diagnostics.js');
const {
  LOWERABLE_LIBRARY_MANIFEST_VERSION,
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  clone,
  validateLowerableLibraryManifest
} = require('./manifest.js');

const LIBRARY_CONTRACTS_PHASE = '11D';
const HANDLER_LIBRARY_CONTRACTS_PHASE = LIBRARY_CONTRACTS_PHASE;
const HANDLER_LIBRARY_CONTRACTS_VERSION = 'pulsewasm.handler-library-contracts.v1';
const HANDLER_EXECUTION_MODES_VERSION = 'pulsewasm.handler-execution-modes.v1';
const LIBRARY_CONTRACT_SCHEMA_VERSION = 'pulsewasm.library-contract-schema.v1';
const LIBRARY_CONTRACT_VERSION = 'pulsewasm.library-contract.v1';
const LIBRARY_CAPABILITIES_VERSION = 'pulsewasm.library-capabilities.v1';
const LIBRARY_COMPATIBILITY_REPORT_VERSION = 'pulsewasm.library-compatibility-report.v1';

const ALLOWED_HANDLER_EXECUTION_MODES = ['host-imports', 'compiled-wasm', 'js-engine'];
const ALLOWED_LIBRARY_MODES = ['typescript', 'js-engine', 'wasm-sidecar'];
const ALLOWED_HOST_CAPABILITIES = [
  'headers',
  'broadcaster',
  'clock',
  'assets',
  'json',
  'body',
  'backend-fetch',
  'state',
  'params',
  'result',
  'error',
  'lifecycle',
  'channel'
];

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'handler-library-contracts',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<library-contract>' }
  });
}

function sortedUnique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function defaultLibraryContracts() {
  return [
    {
      version: LIBRARY_CONTRACT_VERSION,
      package: 'pulse.grip',
      description: 'Contract fixture for GRIP/Fanout-style header and channel control-plane helpers.',
      modes: {
        typescript: { entry: './dist/index.js' },
        jsEngine: { entry: './dist/index.js' },
        wasm: {
          mode: 'wasm-sidecar',
          sidecar: './as/index.as.ts',
          lowerings: [
            { tsSymbol: 'grip.hold', asSymbol: 'pulse_grip_hold', callShape: 'literal-mode', hostCapabilities: ['headers'] },
            { tsSymbol: 'grip.channel', asSymbol: 'pulse_grip_channel', callShape: 'literal-channel', hostCapabilities: ['headers', 'channel', 'broadcaster'] },
            { tsSymbol: 'grip.publish', asSymbol: 'pulse_grip_publish', callShape: 'declared-channel-message', hostCapabilities: ['broadcaster', 'clock'] }
          ],
          hostCapabilities: ['headers', 'channel', 'broadcaster', 'clock']
        }
      },
      policy: {
        inferredCompatibility: false,
        arbitraryTsCompilation: false,
        sidecarRequiredForWasm: true,
        effectRuntimeRequired: false,
        driftRequiresParityTests: true
      }
    }
  ];
}

function libraryContractFromLowerableManifest(manifest, options = {}) {
  const validation = validateLowerableLibraryManifest(manifest);
  const normalized = validation.manifest;
  const wasm = normalized.modes.wasm;
  const facadeImport = normalized.facade.import || normalized.lowerableSubpath;
  const publicApiPackage = normalized.publicApi.package || normalized.npmPackage;
  const policy = {
    inferredCompatibility: false,
    arbitraryTsCompilation: false,
    sidecarRequiredForWasm: true,
    effectRuntimeRequired: true,
    driftRequiresParityTests: true,
    ...(normalized.policy || {})
  };

  return {
    version: options.libraryContractVersion || LIBRARY_CONTRACT_VERSION,
    package: normalized.contractId,
    npmPackage: normalized.npmPackage,
    lowerableSubpath: normalized.lowerableSubpath,
    manifest: {
      version: normalized.version || LOWERABLE_LIBRARY_MANIFEST_VERSION,
      kind: normalized.kind || LOWERABLE_LIBRARY_MANIFEST_KIND,
      owner: 'package'
    },
    facade: {
      namespace: normalized.facade.namespace,
      import: facadeImport,
      symbols: Array.isArray(normalized.facade.symbols) ? normalized.facade.symbols.slice() : []
    },
    publicApi: {
      package: publicApiPackage,
      symbols: Array.isArray(normalized.publicApi.symbols) ? normalized.publicApi.symbols.slice() : [],
      loweringIntentionallyNarrow: Boolean(normalized.publicApi.loweringIntentionallyNarrow)
    },
    compiler: normalized.compiler ? clone(normalized.compiler) : undefined,
    description: normalized.description || `Package-owned lowerable library manifest for ${normalized.contractId}.`,
    modes: {
      typescript: clone(normalized.modes.typescript),
      jsEngine: clone(normalized.modes.jsEngine),
      wasm: {
        mode: wasm.mode || 'wasm-sidecar',
        sidecar: wasm.sidecar,
        lowerings: (wasm.lowerings || []).map((lowering) => ({
          ...lowering,
          hostCapabilities: Array.isArray(lowering.hostCapabilities) ? lowering.hostCapabilities.slice() : []
        })),
        hostCapabilities: Array.isArray(wasm.hostCapabilities) ? wasm.hostCapabilities.slice() : []
      }
    },
    policy,
    diagnostics: validation.diagnostics
  };
}

function normalizeContractModeKeys(modes) {
  const out = {};
  if (modes && typeof modes === 'object') {
    if (modes.typescript) out.typescript = modes.typescript;
    if (modes.jsEngine || modes.js_engine || modes['js-engine']) out.jsEngine = modes.jsEngine || modes.js_engine || modes['js-engine'];
    if (modes.wasm || modes.wasmSidecar || modes['wasm-sidecar']) out.wasm = modes.wasm || modes.wasmSidecar || modes['wasm-sidecar'];
  }
  return out;
}

function validateLibraryContract(contract) {
  const diagnostics = [];
  const normalized = contract && typeof contract === 'object' ? contract : {};
  const modes = normalizeContractModeKeys(normalized.modes);
  const wasm = modes.wasm || {};
  const lowerings = Array.isArray(wasm.lowerings) ? wasm.lowerings : [];
  const hostCapabilities = sortedUnique([...(wasm.hostCapabilities || []), ...lowerings.flatMap((lowering) => lowering.hostCapabilities || [])]);

  if (normalized.version !== LIBRARY_CONTRACT_VERSION) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_CONTRACT_VERSION_UNSUPPORTED',
      `Library contract ${normalized.package || '<unknown>'} must use ${LIBRARY_CONTRACT_VERSION}.`,
      'Update pulse.library.json to the locked v1 contract version.',
      { version: normalized.version }
    ));
  }
  if (!normalized.package || typeof normalized.package !== 'string') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_CONTRACT_PACKAGE_REQUIRED',
      'Library contracts must declare a static package name.',
      'Add "package": "your.package" to pulse.library.json.',
      { package: normalized.package }
    ));
  }
  if (!modes.typescript || typeof modes.typescript.entry !== 'string') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_TYPESCRIPT_ENTRY_REQUIRED',
      `Library ${normalized.package || '<unknown>'} must declare a TypeScript entry.`,
      'Declare modes.typescript.entry for normal TS/dev ergonomics.',
      { package: normalized.package }
    ));
  }
  if (!modes.jsEngine || typeof modes.jsEngine.entry !== 'string') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_JS_ENGINE_ENTRY_REQUIRED',
      `Library ${normalized.package || '<unknown>'} must declare a JS engine entry.`,
      'Declare modes.jsEngine.entry for the manual JS escape hatch path.',
      { package: normalized.package }
    ));
  }
  if (!wasm || typeof wasm.sidecar !== 'string') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_WASM_SIDECAR_REQUIRED',
      `Library ${normalized.package || '<unknown>'} must declare a Wasm sidecar for Wasm compatibility.`,
      'Declare modes.wasm.sidecar, or do not claim Wasm-sidecar compatibility.',
      { package: normalized.package }
    ));
  }
  if (!Array.isArray(wasm.lowerings) || wasm.lowerings.length === 0) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LIBRARY_LOWERINGS_REQUIRED',
      `Library ${normalized.package || '<unknown>'} must declare at least one TS-to-AS lowering.`,
      'Declare modes.wasm.lowerings with tsSymbol and asSymbol entries.',
      { package: normalized.package }
    ));
  }
  for (const lowering of lowerings) {
    if (!lowering || typeof lowering.tsSymbol !== 'string' || typeof lowering.asSymbol !== 'string') {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_LOWERING_INVALID',
        `Library ${normalized.package || '<unknown>'} declares an invalid lowering.`,
        'Each lowering must include static tsSymbol and asSymbol strings.',
        { package: normalized.package, lowering }
      ));
    }
  }
  for (const capability of hostCapabilities) {
    if (!ALLOWED_HOST_CAPABILITIES.includes(capability)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LIBRARY_UNKNOWN_HOST_CAPABILITY',
        `Library ${normalized.package || '<unknown>'} requires unknown host capability ${JSON.stringify(capability)}.`,
        `Use one of: ${ALLOWED_HOST_CAPABILITIES.join(', ')}.`,
        { package: normalized.package, capability }
      ));
    }
  }

  return {
    package: normalized.package || '<unknown>',
    status: diagnostics.length === 0 ? 'ok' : 'error',
    modes: {
      typescript: Boolean(modes.typescript),
      jsEngine: Boolean(modes.jsEngine),
      wasmSidecar: Boolean(wasm && wasm.sidecar)
    },
    sidecar: wasm.sidecar,
    lowerings: lowerings.map((lowering) => ({
      tsSymbol: lowering.tsSymbol,
      asSymbol: lowering.asSymbol,
      callShape: lowering.callShape || 'unspecified',
      hostCapabilities: sortedUnique(lowering.hostCapabilities || [])
    })),
    hostCapabilities,
    policy: {
      inferredCompatibility: false,
      arbitraryTsCompilation: false,
      sidecarRequiredForWasm: true,
      contractRequiredForWasm: true,
      debtRecordedInJsEngineMode: true,
      effectRuntimeRequired: Boolean(normalized.policy && normalized.policy.effectRuntimeRequired)
    },
    diagnostics: [...(normalized.diagnostics || []), ...diagnostics]
  };
}

module.exports = {
  LIBRARY_CONTRACTS_PHASE,
  HANDLER_LIBRARY_CONTRACTS_PHASE,
  HANDLER_LIBRARY_CONTRACTS_VERSION,
  HANDLER_EXECUTION_MODES_VERSION,
  LIBRARY_CONTRACT_SCHEMA_VERSION,
  LIBRARY_CONTRACT_VERSION,
  LIBRARY_CAPABILITIES_VERSION,
  LIBRARY_COMPATIBILITY_REPORT_VERSION,
  ALLOWED_HANDLER_EXECUTION_MODES,
  ALLOWED_LIBRARY_MODES,
  ALLOWED_HOST_CAPABILITIES,
  defaultLibraryContracts,
  libraryContractFromLowerableManifest,
  normalizeContractModeKeys,
  normalizeLibraryContractModeKeys: normalizeContractModeKeys,
  sortedUnique,
  validateLibraryContract
};
