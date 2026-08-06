'use strict';

const { normalizeDiagnostic } = require('../diagnostics.js');

const LOWERABLE_LIBRARY_MANIFEST_VERSION = 'pulsewasm.lowerable-library-manifest.v2';
const LOWERABLE_LIBRARY_MANIFEST_KIND = 'pulsewasm.lowerable-library-manifest';

const LOWERABLE_LIBRARY_PAYLOAD_MODE_STATUSES = Object.freeze([
  'implemented-now',
  'lowering-plan-only',
  'reserved-with-diagnostic',
  'provider-specific',
  'unsupported'
]);

const LOWERABLE_LIBRARY_MANIFEST_REQUIRED_FIELDS = Object.freeze([
  'version',
  'contractId',
  'npmPackage',
  'lowerableSubpath',
  'facade.namespace',
  'facade.symbols',
  'modes.typescript.entry',
  'modes.jsEngine.entry',
  'modes.wasm.sidecar',
  'modes.wasm.lowerings',
  'compiler.version',
  'compiler.entry',
  'compiler.export',
  'compiler.builderOwner',
  'compiler.trust'
]);

const LOWERABLE_LIBRARY_MANIFEST_POLICY = Object.freeze({
  packageOwnsIdentity: true,
  packageOwnsFacadeMapping: true,
  contractsOwnSchema: true,
  contractsOwnPayloadStatusVocabulary: true,
  compilerMayValidateButNotDefinePackageRules: true,
  packageOwnsCompilerBuilder: true,
  genericLoaderMayExecuteTrustedFirstPartyBuilders: true,
  thirdPartyManifestsRequireCorePr: false
});

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortedUnique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function makeDiagnostic(code, message, hint, details) {
  return normalizeDiagnostic({
    phase: 'lowerable-library-manifest',
    severity: 'error',
    code,
    message,
    hint,
    details,
    loc: { file: '<lowerable-library-manifest>' }
  });
}

function normalizeManifest(manifest) {
  const normalized = manifest && typeof manifest === 'object' ? manifest : {};
  const facade = normalized.facade && typeof normalized.facade === 'object' ? normalized.facade : {};
  const publicApi = normalized.publicApi && typeof normalized.publicApi === 'object' ? normalized.publicApi : {};
  const modes = normalized.modes && typeof normalized.modes === 'object' ? normalized.modes : {};
  const wasm = modes.wasm && typeof modes.wasm === 'object' ? modes.wasm : {};
  const compiler = normalized.compiler && typeof normalized.compiler === 'object' ? normalized.compiler : {};

  return {
    ...normalized,
    kind: normalized.kind || LOWERABLE_LIBRARY_MANIFEST_KIND,
    facade,
    publicApi,
    compiler: {
      version: compiler.version,
      entry: compiler.entry,
      export: compiler.export,
      artifact: compiler.artifact,
      builderOwner: compiler.builderOwner,
      trust: compiler.trust,
      inputs: Array.isArray(compiler.inputs) ? compiler.inputs : []
    },
    modes: {
      typescript: modes.typescript || {},
      jsEngine: modes.jsEngine || modes.js_engine || modes['js-engine'] || {},
      wasm: {
        ...wasm,
        lowerings: Array.isArray(wasm.lowerings) ? wasm.lowerings : [],
        hostCapabilities: Array.isArray(wasm.hostCapabilities) ? wasm.hostCapabilities : []
      }
    }
  };
}

function validateLowerableLibraryManifest(manifest) {
  const diagnostics = [];
  const normalized = normalizeManifest(manifest);
  const facadeSymbols = normalized.facade.symbols;
  const publicApiSymbols = normalized.publicApi.symbols;
  const wasm = normalized.modes.wasm;
  const compiler = normalized.compiler || {};

  if (normalized.version !== LOWERABLE_LIBRARY_MANIFEST_VERSION) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_MANIFEST_VERSION_UNSUPPORTED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must use ${LOWERABLE_LIBRARY_MANIFEST_VERSION}.`,
      'Import or copy the locked manifest version for the package-owned manifest declaration.',
      { version: normalized.version }
    ));
  }

  if (!isNonEmptyString(normalized.contractId)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_CONTRACT_ID_REQUIRED',
      'Lowerable library manifests must declare a stable contractId.',
      'Add a package-owned contractId such as "vendor.feature" or a blessed platform contract id.',
      { contractId: normalized.contractId }
    ));
  }

  if (!isNonEmptyString(normalized.npmPackage)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_NPM_PACKAGE_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare the npm package that owns the facade.`,
      'Add npmPackage to the package-owned manifest instead of adding package identity to wasm-contracts.',
      { npmPackage: normalized.npmPackage }
    ));
  }

  if (!isNonEmptyString(normalized.lowerableSubpath)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_SUBPATH_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare a lowerable facade subpath.`,
      'Add lowerableSubpath to the package-owned manifest.',
      { lowerableSubpath: normalized.lowerableSubpath }
    ));
  }

  if (!isNonEmptyString(normalized.facade.namespace)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_NAMESPACE_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare facade.namespace.`,
      'Add the static namespace that compiler extraction may recognize.',
      { namespace: normalized.facade.namespace }
    ));
  }

  if (!Array.isArray(facadeSymbols) || facadeSymbols.length === 0 || facadeSymbols.some((symbol) => !isNonEmptyString(symbol))) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_SYMBOLS_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare one or more facade symbols.`,
      'Add facade.symbols with the narrow lowerable symbols only.',
      { symbols: facadeSymbols }
    ));
  }

  if (publicApiSymbols !== undefined && (!Array.isArray(publicApiSymbols) || publicApiSymbols.some((symbol) => !isNonEmptyString(symbol)))) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_PUBLIC_API_SYMBOLS_INVALID',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} has an invalid publicApi.symbols list.`,
      'Use static strings when documenting the ergonomic public package API.',
      { symbols: publicApiSymbols }
    ));
  }

  if (!isNonEmptyString(normalized.modes.typescript.entry)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_TYPESCRIPT_ENTRY_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare modes.typescript.entry.`,
      'Declare the package runtime TypeScript/ESM entry for normal JS ergonomics.',
      { entry: normalized.modes.typescript.entry }
    ));
  }

  if (!isNonEmptyString(normalized.modes.jsEngine.entry)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_JS_ENGINE_ENTRY_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare modes.jsEngine.entry.`,
      'Declare the manual JS engine escape-hatch entry.',
      { entry: normalized.modes.jsEngine.entry }
    ));
  }

  if (!isNonEmptyString(wasm.sidecar)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_WASM_SIDECAR_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare modes.wasm.sidecar.`,
      'Declare the AssemblyScript sidecar used by compiled-Wasm compatibility.',
      { sidecar: wasm.sidecar }
    ));
  }

  if (!Array.isArray(wasm.lowerings) || wasm.lowerings.length === 0) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_LOWERINGS_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare modes.wasm.lowerings.`,
      'Declare the static facade-to-sidecar symbols that lowering may recognize.',
      { lowerings: wasm.lowerings }
    ));
  }

  for (const lowering of wasm.lowerings || []) {
    if (!lowering || !isNonEmptyString(lowering.tsSymbol) || !isNonEmptyString(lowering.asSymbol)) {
      diagnostics.push(makeDiagnostic(
        'PULSEWASM_LOWERABLE_LIBRARY_LOWERING_INVALID',
        `Lowerable library manifest ${normalized.contractId || '<unknown>'} declares an invalid lowering.`,
        'Each lowering must include static tsSymbol and asSymbol strings.',
        { lowering }
      ));
    }
  }

  if (!isNonEmptyString(compiler.version)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_VERSION_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare compiler.version.`,
      'Declare the package-owned compiler builder protocol version, for example pulsewasm.lowerable-compiler-builder.v1.',
      { compiler }
    ));
  }

  if (!isNonEmptyString(compiler.entry)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_ENTRY_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare compiler.entry.`,
      'Declare the package-owned compiler builder entry path such as ./pulsewasm.compiler.cjs.',
      { compiler }
    ));
  }

  if (!isNonEmptyString(compiler.export)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_EXPORT_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare compiler.export.`,
      'Declare the exported builder function name, for example buildAssetsLoweringPlan.',
      { compiler }
    ));
  }

  if (!isNonEmptyString(compiler.builderOwner)) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_OWNER_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} must declare compiler.builderOwner.`,
      'The package that owns the facade must also own the lowerer entry for this package-out track.',
      { compiler }
    ));
  }

  if (compiler.builderOwner && normalized.npmPackage && compiler.builderOwner !== normalized.npmPackage) {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_OWNER_MISMATCH',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} compiler builderOwner must match npmPackage.`,
      'Keep package-specific lowering rules in the package that owns the lowerable facade.',
      { npmPackage: normalized.npmPackage, builderOwner: compiler.builderOwner }
    ));
  }

  if (compiler.trust !== 'first-party') {
    diagnostics.push(makeDiagnostic(
      'PULSEWASM_LOWERABLE_LIBRARY_COMPILER_TRUST_REQUIRED',
      `Lowerable library manifest ${normalized.contractId || '<unknown>'} compiler.trust must be "first-party" in this track.`,
      'Arbitrary third-party lowerer execution is not enabled; first-party package builders must opt in explicitly.',
      { trust: compiler.trust }
    ));
  }

  return {
    status: diagnostics.length === 0 ? 'ok' : 'error',
    manifest: normalized,
    contractId: normalized.contractId || '<unknown>',
    npmPackage: normalized.npmPackage,
    lowerableSubpath: normalized.lowerableSubpath,
    facade: {
      namespace: normalized.facade.namespace,
      symbols: Array.isArray(facadeSymbols) ? facadeSymbols.slice() : []
    },
    publicApi: {
      package: normalized.publicApi.package || normalized.npmPackage,
      symbols: Array.isArray(publicApiSymbols) ? publicApiSymbols.slice() : []
    },
    compiler: {
      version: normalized.compiler.version,
      entry: normalized.compiler.entry,
      export: normalized.compiler.export,
      artifact: normalized.compiler.artifact,
      builderOwner: normalized.compiler.builderOwner,
      trust: normalized.compiler.trust,
      inputs: Array.isArray(normalized.compiler.inputs) ? normalized.compiler.inputs.slice() : []
    },
    hostCapabilities: sortedUnique([...(wasm.hostCapabilities || []), ...((wasm.lowerings || []).flatMap((lowering) => lowering.hostCapabilities || []))]),
    diagnostics
  };
}

module.exports = {
  LOWERABLE_LIBRARY_MANIFEST_VERSION,
  LOWERABLE_LIBRARY_MANIFEST_KIND,
  LOWERABLE_LIBRARY_PAYLOAD_MODE_STATUSES,
  LOWERABLE_LIBRARY_MANIFEST_REQUIRED_FIELDS,
  LOWERABLE_LIBRARY_MANIFEST_POLICY,
  clone,
  sortedUnique,
  normalizeManifest,
  validateLowerableLibraryManifest
};
