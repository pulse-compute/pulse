'use strict';

const {
  versions,
  binaryenVersion,
  diagnosticCodes,
  memoryAbi,
  memoryAbiV2,
  es256FrameV2,
  es256GuestUnit,
  optimizationPostures
} = require('./constants.js');
const { fail } = require('./errors.js');
const { assertRelativePath } = require('./files.js');

const shaPattern = /^[a-f0-9]{64}$/;
const stableIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const modulePattern = /^[a-z][a-z0-9_]*$/;
const packagePattern = /^@pulse-compute\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const valueTypes = new Set(['i32', 'i64', 'f32', 'f64']);
const importKinds = new Set(['function', 'memory', 'table', 'global']);
const forbiddenExecutionFields = new Set(['command', 'commands', 'argv', 'shell', 'executable']);

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, field) {
  if (!plainObject(value)) fail(diagnosticCodes.invalid, `${field} must be an object.`);
  return value;
}

function exactKeys(value, required, optional, field) {
  assertObject(value, field);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    fail(diagnosticCodes.invalid, `${field} does not match its versioned field set.`, { unknown, missing });
  }
}

function string(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    fail(diagnosticCodes.invalid, `${field} must be a non-empty normalized string.`);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(diagnosticCodes.invalid, `${field} must be boolean.`);
  return value;
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(diagnosticCodes.invalid, `${field} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function sha(value, field) {
  if (typeof value !== 'string' || !shaPattern.test(value)) {
    fail(diagnosticCodes.invalid, `${field} must be a lowercase SHA-256.`);
  }
  return value;
}

function stableId(value, field) {
  string(value, field);
  if (!stableIdPattern.test(value)) fail(diagnosticCodes.invalid, `${field} must be a stable dotted identity.`);
  return value;
}

function moduleName(value, field) {
  string(value, field);
  if (!modulePattern.test(value)) fail(diagnosticCodes.invalid, `${field} must be a normalized core-Wasm module namespace.`);
  return value;
}

function packageName(value, field) {
  string(value, field);
  if (!packagePattern.test(value)) fail(diagnosticCodes.ownerMismatch, `${field} must be a first-party Pulse package.`);
  return value;
}

function packageVersion(value, field) {
  string(value, field);
  if (!semverPattern.test(value)) fail(diagnosticCodes.invalid, `${field} must be an exact semantic version.`);
  return value;
}

function valueType(value, field) {
  if (!valueTypes.has(value)) fail(diagnosticCodes.invalid, `${field} must be an MVP scalar value type.`);
  return value;
}

function assertNoExecutionFields(value, field, depth = 0) {
  if (depth > 12) fail(diagnosticCodes.invalid, `${field} exceeds the supported metadata depth.`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutionFields(entry, `${field}[${index}]`, depth + 1));
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenExecutionFields.has(key.toLowerCase())) {
      fail(diagnosticCodes.invalid, `${field} contains forbidden execution field ${key}.`);
    }
    assertNoExecutionFields(child, `${field}.${key}`, depth + 1);
  }
}

function normalizeMemoryType(value, field) {
  exactKeys(value, ['minimumPages', 'maximumPages', 'shared'], [], field);
  const result = {
    minimumPages: integer(value.minimumPages, `${field}.minimumPages`, 1),
    maximumPages: integer(value.maximumPages, `${field}.maximumPages`, 1),
    shared: boolean(value.shared, `${field}.shared`)
  };
  if (result.maximumPages < result.minimumPages) {
    fail(diagnosticCodes.memoryMismatch, `${field} maximum must not be smaller than minimum.`);
  }
  return Object.freeze(result);
}

function normalizeImport(value, field) {
  exactKeys(value, ['module', 'name', 'kind', 'type'], [], field);
  const module = string(value.module, `${field}.module`);
  const name = string(value.name, `${field}.name`);
  if (value.kind === 'memory') {
    return Object.freeze({ module, name, kind: 'memory', type: normalizeMemoryType(value.type, `${field}.type`) });
  }
  if (value.kind === 'function') {
    exactKeys(value.type, ['parameters', 'results'], [], `${field}.type`);
    if (!Array.isArray(value.type.parameters) || !Array.isArray(value.type.results)) {
      fail(diagnosticCodes.invalid, `${field}.type parameters and results must be arrays.`);
    }
    return Object.freeze({
      module,
      name,
      kind: 'function',
      type: Object.freeze({
        parameters: Object.freeze(value.type.parameters.map((entry, index) => valueType(entry, `${field}.type.parameters[${index}]`))),
        results: Object.freeze(value.type.results.map((entry, index) => valueType(entry, `${field}.type.results[${index}]`)))
      })
    });
  }
  fail(diagnosticCodes.invalid, `${field}.kind must be function or memory.`);
}

function normalizeExport(value, field, includeRole) {
  exactKeys(
    value,
    includeRole ? ['name', 'kind', 'parameters', 'results', 'role'] : ['name', 'kind'],
    [],
    field
  );
  const name = string(value.name, `${field}.name`);
  if (includeRole) {
    if (value.kind !== 'function') fail(diagnosticCodes.invalid, `${field}.kind must be function.`);
    if (!['abi', 'evidence-only'].includes(value.role)) fail(diagnosticCodes.invalid, `${field}.role is unsupported.`);
    if (!Array.isArray(value.parameters) || !Array.isArray(value.results)) {
      fail(diagnosticCodes.invalid, `${field} parameters and results must be arrays.`);
    }
    return Object.freeze({
      name,
      kind: 'function',
      parameters: Object.freeze(value.parameters.map((entry, index) => valueType(entry, `${field}.parameters[${index}]`))),
      results: Object.freeze(value.results.map((entry, index) => valueType(entry, `${field}.results[${index}]`))),
      role: value.role
    });
  }
  if (!['function', 'memory', 'table', 'global'].includes(value.kind)) {
    fail(diagnosticCodes.invalid, `${field}.kind is unsupported.`);
  }
  return Object.freeze({ name, kind: value.kind });
}

function uniqueSurface(values, field, includeModule = false) {
  const keys = values.map((entry) => `${includeModule ? `${entry.module}\0` : ''}${entry.name}`);
  if (new Set(keys).size !== keys.length) fail(diagnosticCodes.invalid, `${field} contains duplicate names.`);
}

function manifestRelativePath(value, field) {
  string(value, field);
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '' || part === '.')
  ) {
    fail(diagnosticCodes.invalid, `${field} must use normalized manifest-relative syntax.`);
  }
  return value;
}

function exactValue(value, expected, field, code = diagnosticCodes.invalid) {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(code, `${field} does not match the reviewed ES256 guest contract.`, { expected, actual: value });
  }
  return value;
}

function normalizeGuestUnitManifestV1(input) {
  exactKeys(input, [
    'version',
    'id',
    'module',
    'owner',
    'packageVersion',
    'abi',
    'origin',
    'artifact',
    'toolchain',
    'imports',
    'exports',
    'memory',
    'start',
    'features',
    'provenance'
  ], ['source'], 'guest unit');
  assertNoExecutionFields(input, 'guest unit');
  if (input.version !== versions.guestUnit) fail(diagnosticCodes.invalid, `Guest unit must use ${versions.guestUnit}.`);
  const id = stableId(input.id, 'guest unit id');
  const module = moduleName(input.module, 'guest unit module');
  if (module === memoryAbi.importModule) {
    fail(diagnosticCodes.invalid, 'Guest unit module must not collide with the memory-owner namespace.');
  }
  const owner = packageName(input.owner, 'guest unit owner');
  const version = packageVersion(input.packageVersion, 'guest unit packageVersion');
  const abi = stableId(input.abi, 'guest unit ABI');
  if (input.origin !== 'package-prebuilt') fail(diagnosticCodes.invalid, 'Guest unit origin must be package-prebuilt.');

  exactKeys(input.artifact, ['file', 'bytes', 'sha256'], [], 'guest unit artifact');
  const artifact = Object.freeze({
    file: assertRelativePath(input.artifact.file, 'guest unit artifact.file'),
    bytes: integer(input.artifact.bytes, 'guest unit artifact.bytes', 1),
    sha256: sha(input.artifact.sha256, 'guest unit artifact.sha256')
  });

  let source;
  if (input.source !== undefined) {
    exactKeys(input.source, ['included', 'directory', 'treeSha256'], [], 'guest unit source');
    if (input.source.included !== true) fail(diagnosticCodes.invalid, 'Present guest source metadata must set included=true.');
    source = Object.freeze({
      included: true,
      directory: assertRelativePath(input.source.directory, 'guest unit source.directory'),
      treeSha256: sha(input.source.treeSha256, 'guest unit source.treeSha256')
    });
  }

  exactKeys(input.toolchain, ['kind', 'target', 'locked', 'versions'], [], 'guest unit toolchain');
  if (input.toolchain.kind !== 'rust-cargo' || input.toolchain.target !== 'wasm32v1-none' || input.toolchain.locked !== true) {
    fail(diagnosticCodes.invalid, 'The initial guest toolchain must be locked rust-cargo for wasm32v1-none.');
  }
  exactKeys(input.toolchain.versions, ['rustc', 'cargo'], [], 'guest unit toolchain.versions');
  const toolchain = Object.freeze({
    kind: 'rust-cargo',
    target: 'wasm32v1-none',
    locked: true,
    versions: Object.freeze({
      rustc: string(input.toolchain.versions.rustc, 'guest unit rustc version'),
      cargo: string(input.toolchain.versions.cargo, 'guest unit cargo version')
    })
  });

  if (!Array.isArray(input.imports) || !Array.isArray(input.exports)) {
    fail(diagnosticCodes.invalid, 'Guest unit imports and exports must be arrays.');
  }
  const imports = Object.freeze(input.imports.map((entry, index) => normalizeImport(entry, `guest unit imports[${index}]`)));
  const exports = Object.freeze(input.exports.map((entry, index) => normalizeExport(entry, `guest unit exports[${index}]`, true)));
  uniqueSurface(imports, 'guest unit imports', true);
  uniqueSurface(exports, 'guest unit exports');
  if (exports.filter((entry) => entry.role === 'abi').length !== 1) {
    fail(diagnosticCodes.abiMismatch, 'The initial guest unit must declare exactly one ABI function export.');
  }
  const expectedMemoryImport = Object.freeze({
    module: memoryAbi.importModule,
    name: memoryAbi.importName,
    kind: 'memory',
    type: Object.freeze({
      minimumPages: memoryAbi.minimumPages,
      maximumPages: memoryAbi.maximumPages,
      shared: false
    })
  });
  if (JSON.stringify(imports) !== JSON.stringify([expectedMemoryImport])) {
    fail(diagnosticCodes.importMismatch, 'The initial guest must import only the accepted fixed env.memory.');
  }

  exactKeys(input.memory, ['identity', 'import', 'owner'], [], 'guest unit memory');
  if (
    input.memory.identity !== versions.memoryAbi
    || input.memory.import !== `${memoryAbi.importModule}.${memoryAbi.importName}`
    || input.memory.owner !== 'link-stage'
  ) {
    fail(diagnosticCodes.memoryMismatch, 'Guest unit memory does not match the accepted borrowed-span ABI.');
  }
  exactKeys(input.start, ['policy'], [], 'guest unit start');
  if (input.start.policy !== 'forbidden') fail(diagnosticCodes.startMismatch, 'Guest unit start policy must be forbidden.');
  exactKeys(input.features, ['baseline', 'allowed', 'required'], [], 'guest unit features');
  if (
    input.features.baseline !== 'mvp'
    || !Array.isArray(input.features.allowed)
    || input.features.allowed.length !== 0
    || !Array.isArray(input.features.required)
    || input.features.required.length !== 0
  ) {
    fail(diagnosticCodes.featureMismatch, 'The initial guest unit must use the MVP feature baseline without additions.');
  }

  exactKeys(input.provenance, ['packageManifest', 'lockfile', 'reproducibleSourceIncluded'], [], 'guest unit provenance');
  const provenance = Object.freeze({
    packageManifest: assertRelativePath(input.provenance.packageManifest, 'guest unit provenance.packageManifest'),
    lockfile: assertRelativePath(input.provenance.lockfile, 'guest unit provenance.lockfile'),
    reproducibleSourceIncluded: boolean(input.provenance.reproducibleSourceIncluded, 'guest unit provenance.reproducibleSourceIncluded')
  });
  if (provenance.reproducibleSourceIncluded !== Boolean(source)) {
    fail(diagnosticCodes.invalid, 'Guest source presence and provenance must agree.');
  }

  const normalized = {
    version: versions.guestUnit,
    id,
    module,
    owner,
    packageVersion: version,
    abi,
    origin: 'package-prebuilt',
    artifact
  };
  if (source) normalized.source = source;
  normalized.toolchain = toolchain;
  normalized.imports = imports;
  normalized.exports = exports;
  normalized.memory = Object.freeze({
    identity: versions.memoryAbi,
    import: `${memoryAbi.importModule}.${memoryAbi.importName}`,
    owner: 'link-stage'
  });
  normalized.start = Object.freeze({ policy: 'forbidden' });
  normalized.features = Object.freeze({ baseline: 'mvp', allowed: Object.freeze([]), required: Object.freeze([]) });
  normalized.provenance = provenance;
  return Object.freeze(normalized);
}

function normalizeGuestUnitManifestV2(input) {
  exactKeys(input, [
    'version',
    'id',
    'module',
    'owner',
    'packageVersion',
    'abi',
    'origin',
    'artifact',
    'source',
    'toolchain',
    'imports',
    'exports',
    'memory',
    'start',
    'features',
    'provenance'
  ], [], 'guest unit v2');
  assertNoExecutionFields(input, 'guest unit v2');
  exactValue(input.version, versions.guestUnitV2, 'guest unit v2 version');
  const id = stableId(input.id, 'guest unit v2 id');
  const module = moduleName(input.module, 'guest unit v2 module');
  const owner = packageName(input.owner, 'guest unit v2 owner');
  const packageVersionValue = packageVersion(input.packageVersion, 'guest unit v2 packageVersion');
  const abi = stableId(input.abi, 'guest unit v2 ABI');
  exactValue(id, es256GuestUnit.id, 'guest unit v2 id', diagnosticCodes.abiMismatch);
  exactValue(module, es256GuestUnit.module, 'guest unit v2 module', diagnosticCodes.abiMismatch);
  exactValue(owner, es256GuestUnit.owner, 'guest unit v2 owner', diagnosticCodes.ownerMismatch);
  exactValue(
    packageVersionValue,
    es256GuestUnit.packageVersion,
    'guest unit v2 packageVersion',
    diagnosticCodes.ownerMismatch
  );
  exactValue(abi, es256GuestUnit.abi, 'guest unit v2 ABI', diagnosticCodes.abiMismatch);
  exactValue(input.origin, 'package-prebuilt', 'guest unit v2 origin');

  exactKeys(input.artifact, ['file', 'bytes', 'sha256'], [], 'guest unit v2 artifact');
  const artifact = Object.freeze({
    file: assertRelativePath(input.artifact.file, 'guest unit v2 artifact.file'),
    bytes: integer(input.artifact.bytes, 'guest unit v2 artifact.bytes', 1),
    sha256: sha(input.artifact.sha256, 'guest unit v2 artifact.sha256')
  });
  exactValue(artifact, es256GuestUnit.artifact, 'guest unit v2 artifact', diagnosticCodes.hashMismatch);

  exactKeys(input.source, ['included', 'directory', 'treeSha256'], [], 'guest unit v2 source');
  if (input.source.included !== true) fail(diagnosticCodes.invalid, 'Guest unit v2 source must be included.');
  const source = Object.freeze({
    included: true,
    directory: assertRelativePath(input.source.directory, 'guest unit v2 source.directory'),
    treeSha256: sha(input.source.treeSha256, 'guest unit v2 source.treeSha256')
  });
  exactValue(source.directory, es256GuestUnit.source.directory, 'guest unit v2 source.directory');
  exactValue(
    source.treeSha256,
    es256GuestUnit.source.treeSha256,
    'guest unit v2 source.treeSha256',
    diagnosticCodes.hashMismatch
  );

  exactKeys(input.toolchain, ['kind', 'target', 'locked', 'versions'], [], 'guest unit v2 toolchain');
  exactKeys(input.toolchain.versions, ['rustc', 'cargo', 'binaryen'], [], 'guest unit v2 toolchain.versions');
  const toolchain = Object.freeze({
    kind: string(input.toolchain.kind, 'guest unit v2 toolchain.kind'),
    target: string(input.toolchain.target, 'guest unit v2 toolchain.target'),
    locked: boolean(input.toolchain.locked, 'guest unit v2 toolchain.locked'),
    versions: Object.freeze({
      rustc: string(input.toolchain.versions.rustc, 'guest unit v2 rustc version'),
      cargo: string(input.toolchain.versions.cargo, 'guest unit v2 cargo version'),
      binaryen: string(input.toolchain.versions.binaryen, 'guest unit v2 Binaryen version')
    })
  });
  exactValue(toolchain, Object.freeze({
    kind: 'rust-cargo',
    target: 'wasm32v1-none',
    locked: true,
    versions: es256GuestUnit.toolchain
  }), 'guest unit v2 toolchain', diagnosticCodes.featureMismatch);

  if (!Array.isArray(input.imports) || !Array.isArray(input.exports)) {
    fail(diagnosticCodes.invalid, 'Guest unit v2 imports and exports must be arrays.');
  }
  const imports = Object.freeze(input.imports.map((entry, index) => (
    normalizeImport(entry, `guest unit v2 imports[${index}]`)
  )));
  const exports = Object.freeze(input.exports.map((entry, index) => (
    normalizeExport(entry, `guest unit v2 exports[${index}]`, true)
  )));
  uniqueSurface(imports, 'guest unit v2 imports', true);
  uniqueSurface(exports, 'guest unit v2 exports');
  const expectedImports = Object.freeze([Object.freeze({
    module: memoryAbiV2.importModule,
    name: memoryAbiV2.importName,
    kind: 'memory',
    type: Object.freeze({
      minimumPages: memoryAbiV2.minimumPages,
      maximumPages: memoryAbiV2.maximumPages,
      shared: false
    })
  })]);
  exactValue(imports, expectedImports, 'guest unit v2 imports', diagnosticCodes.importMismatch);
  const expectedExports = Object.freeze(['pulse_crypto_es256_sign', 'pulse_crypto_es256_verify'].map(name => Object.freeze({
    name, kind: 'function', parameters: es256FrameV2.parameters, results: es256FrameV2.results, role: 'abi'
  })));
  exactValue(exports, expectedExports, 'guest unit v2 exports', diagnosticCodes.exportMismatch);

  exactKeys(input.memory, ['identity', 'import', 'owner'], [], 'guest unit v2 memory');
  exactValue(input.memory, {
    identity: versions.memoryAbiV2,
    import: `${memoryAbiV2.importModule}.${memoryAbiV2.importName}`,
    owner: 'link-stage'
  }, 'guest unit v2 memory', diagnosticCodes.memoryMismatch);
  exactKeys(input.start, ['policy'], [], 'guest unit v2 start');
  exactValue(input.start.policy, 'forbidden', 'guest unit v2 start policy', diagnosticCodes.startMismatch);
  exactKeys(input.features, ['baseline', 'allowed', 'required'], [], 'guest unit v2 features');
  exactValue(input.features, {
    baseline: 'mvp',
    allowed: [],
    required: []
  }, 'guest unit v2 features', diagnosticCodes.featureMismatch);

  exactKeys(input.provenance, [
    'packageManifest',
    'lockfile',
    'reproducibleSourceIncluded',
    'cargoLockSha256',
    'sourceTreeSha256',
    'reconstructionCommandIdentity',
    'buildScript',
    'buildScriptSha256',
    'optimizationPosture',
    'binaryenWasmOptSha256',
    'g0SourceDecision',
    'g0SourceDecisionSha256'
  ], [], 'guest unit v2 provenance');
  const provenance = Object.freeze({
    packageManifest: manifestRelativePath(
      input.provenance.packageManifest,
      'guest unit v2 provenance.packageManifest'
    ),
    lockfile: assertRelativePath(input.provenance.lockfile, 'guest unit v2 provenance.lockfile'),
    reproducibleSourceIncluded: boolean(
      input.provenance.reproducibleSourceIncluded,
      'guest unit v2 provenance.reproducibleSourceIncluded'
    ),
    cargoLockSha256: sha(input.provenance.cargoLockSha256, 'guest unit v2 provenance.cargoLockSha256'),
    sourceTreeSha256: sha(input.provenance.sourceTreeSha256, 'guest unit v2 provenance.sourceTreeSha256'),
    reconstructionCommandIdentity: stableId(
      input.provenance.reconstructionCommandIdentity,
      'guest unit v2 provenance.reconstructionCommandIdentity'
    ),
    buildScript: assertRelativePath(input.provenance.buildScript, 'guest unit v2 provenance.buildScript'),
    buildScriptSha256: sha(input.provenance.buildScriptSha256, 'guest unit v2 provenance.buildScriptSha256'),
    optimizationPosture: string(
      input.provenance.optimizationPosture,
      'guest unit v2 provenance.optimizationPosture'
    ),
    binaryenWasmOptSha256: sha(
      input.provenance.binaryenWasmOptSha256,
      'guest unit v2 provenance.binaryenWasmOptSha256'
    ),
    g0SourceDecision: manifestRelativePath(
      input.provenance.g0SourceDecision,
      'guest unit v2 provenance.g0SourceDecision'
    ),
    g0SourceDecisionSha256: sha(
      input.provenance.g0SourceDecisionSha256,
      'guest unit v2 provenance.g0SourceDecisionSha256'
    )
  });
  exactValue(
    provenance.packageManifest,
    '../../package.json',
    'guest unit v2 provenance.packageManifest'
  );
  exactValue(
    provenance.lockfile,
    'source/Cargo.lock',
    'guest unit v2 provenance.lockfile'
  );
  exactValue(provenance.reproducibleSourceIncluded, true, 'guest unit v2 source provenance');
  exactValue(
    provenance.cargoLockSha256,
    es256GuestUnit.provenance.cargoLockSha256,
    'guest unit v2 Cargo.lock',
    diagnosticCodes.hashMismatch
  );
  exactValue(
    provenance.sourceTreeSha256,
    source.treeSha256,
    'guest unit v2 provenance source tree',
    diagnosticCodes.hashMismatch
  );
  for (const key of [
    'reconstructionCommandIdentity',
    'buildScript',
    'buildScriptSha256',
    'optimizationPosture',
    'binaryenWasmOptSha256',
    'g0SourceDecision',
    'g0SourceDecisionSha256'
  ]) {
    exactValue(
      provenance[key],
      es256GuestUnit.provenance[key],
      `guest unit v2 provenance.${key}`,
      key.toLowerCase().includes('sha256') ? diagnosticCodes.hashMismatch : diagnosticCodes.invalid
    );
  }
  exactValue(toolchain.versions.binaryen, binaryenVersion, 'guest unit v2 Binaryen version', diagnosticCodes.featureMismatch);

  return Object.freeze({
    version: versions.guestUnitV2,
    id,
    module,
    owner,
    packageVersion: packageVersionValue,
    abi,
    origin: 'package-prebuilt',
    artifact,
    source,
    toolchain,
    imports,
    exports,
    memory: Object.freeze({
      identity: versions.memoryAbiV2,
      import: `${memoryAbiV2.importModule}.${memoryAbiV2.importName}`,
      owner: 'link-stage'
    }),
    start: Object.freeze({ policy: 'forbidden' }),
    features: Object.freeze({
      baseline: 'mvp',
      allowed: Object.freeze([]),
      required: Object.freeze([])
    }),
    provenance
  });
}

function normalizeGuestUnitManifest(input) {
  if (!plainObject(input)) fail(diagnosticCodes.invalid, 'Guest unit must be an object.');
  if (input.version === versions.guestUnit) return normalizeGuestUnitManifestV1(input);
  if (input.version === versions.guestUnitV2) return normalizeGuestUnitManifestV2(input);
  fail(
    diagnosticCodes.invalid,
    `Guest unit must use ${versions.guestUnit} or the selected ${versions.guestUnitV2} contract.`
  );
}

function normalizeTargetPolicy(input) {
  exactKeys(input, [
    'descriptorOwner',
    'toolchainVersion',
    'descriptorIdentity',
    'descriptorSha256',
    'allowedImports',
    'requiredExports',
    'featureBaseline',
    'allowedFeatures',
    'memory',
    'start'
  ], [], 'guest unit plan targetPolicy');
  if (!Array.isArray(input.allowedImports) || !Array.isArray(input.requiredExports) || !Array.isArray(input.allowedFeatures)) {
    fail(diagnosticCodes.invalid, 'Target policy surfaces and features must be arrays.');
  }
  const allowedImports = Object.freeze(input.allowedImports.map((entry, index) => {
    exactKeys(entry, ['module', 'name', 'kind'], [], `targetPolicy.allowedImports[${index}]`);
    if (!importKinds.has(entry.kind)) {
      fail(diagnosticCodes.invalid, `targetPolicy.allowedImports[${index}].kind is unsupported.`);
    }
    return Object.freeze({
      module: string(entry.module, `targetPolicy.allowedImports[${index}].module`),
      name: string(entry.name, `targetPolicy.allowedImports[${index}].name`),
      kind: string(entry.kind, `targetPolicy.allowedImports[${index}].kind`)
    });
  }));
  const requiredExports = Object.freeze(input.requiredExports.map((entry, index) => normalizeExport(entry, `targetPolicy.requiredExports[${index}]`, false)));
  uniqueSurface(allowedImports, 'target policy allowedImports', true);
  uniqueSurface(requiredExports, 'target policy requiredExports');
  if (input.featureBaseline !== 'mvp' || input.allowedFeatures.length !== 0) {
    fail(diagnosticCodes.featureMismatch, 'The initial target policy must require MVP without feature additions.');
  }
  exactKeys(input.memory, ['minimum', 'maximum', 'imported', 'growable'], [], 'targetPolicy.memory');
  const memory = Object.freeze({
    minimum: integer(input.memory.minimum, 'targetPolicy.memory.minimum', 0),
    maximum: integer(input.memory.maximum, 'targetPolicy.memory.maximum', 0),
    imported: integer(input.memory.imported, 'targetPolicy.memory.imported', 0),
    growable: boolean(input.memory.growable, 'targetPolicy.memory.growable')
  });
  if (JSON.stringify(memory) !== JSON.stringify({ minimum: 1, maximum: 1, imported: 0, growable: false })) {
    fail(diagnosticCodes.memoryMismatch, 'The initial target policy must require one defined non-growable memory.');
  }
  if (input.start !== 'forbidden') fail(diagnosticCodes.startMismatch, 'Target policy must forbid a start section.');
  return Object.freeze({
    descriptorOwner: packageName(input.descriptorOwner, 'targetPolicy.descriptorOwner'),
    toolchainVersion: stableId(input.toolchainVersion, 'targetPolicy.toolchainVersion'),
    descriptorIdentity: stableId(input.descriptorIdentity, 'targetPolicy.descriptorIdentity'),
    descriptorSha256: sha(input.descriptorSha256, 'targetPolicy.descriptorSha256'),
    allowedImports,
    requiredExports,
    featureBaseline: 'mvp',
    allowedFeatures: Object.freeze([]),
    memory,
    start: 'forbidden'
  });
}

function normalizeGuestUnitPlanV1(input) {
  exactKeys(input, [
    'version',
    'profile',
    'target',
    'unit',
    'targetPolicy',
    'materialization',
    'trust',
    'composition',
    'fallback'
  ], [], 'guest unit plan');
  assertNoExecutionFields(input, 'guest unit plan');
  if (input.version !== versions.guestUnitPlan) fail(diagnosticCodes.invalid, `Guest unit plan must use ${versions.guestUnitPlan}.`);
  exactKeys(input.unit, [
    'id',
    'module',
    'owner',
    'packageVersion',
    'abi',
    'origin',
    'manifestSha256',
    'artifactSha256',
    'source'
  ], [], 'guest unit plan unit');
  exactKeys(input.unit.source, ['included', 'treeSha256'], [], 'guest unit plan source');
  const unit = Object.freeze({
    id: stableId(input.unit.id, 'guest unit plan unit.id'),
    module: moduleName(input.unit.module, 'guest unit plan unit.module'),
    owner: packageName(input.unit.owner, 'guest unit plan unit.owner'),
    packageVersion: packageVersion(input.unit.packageVersion, 'guest unit plan unit.packageVersion'),
    abi: stableId(input.unit.abi, 'guest unit plan unit.abi'),
    origin: input.unit.origin,
    manifestSha256: sha(input.unit.manifestSha256, 'guest unit plan unit.manifestSha256'),
    artifactSha256: sha(input.unit.artifactSha256, 'guest unit plan unit.artifactSha256'),
    source: Object.freeze({
      included: boolean(input.unit.source.included, 'guest unit plan unit.source.included'),
      treeSha256: input.unit.source.included
        ? sha(input.unit.source.treeSha256, 'guest unit plan unit.source.treeSha256')
        : null
    })
  });
  if (unit.origin !== 'package-prebuilt') fail(diagnosticCodes.invalid, 'Guest unit plan origin must be package-prebuilt.');

  const targetPolicy = normalizeTargetPolicy(input.targetPolicy);
  const target = stableId(input.target, 'guest unit plan target');
  if (targetPolicy.descriptorIdentity !== target) fail(diagnosticCodes.invalid, 'Target policy identity must equal the selected target.');

  exactKeys(input.materialization, ['workspace', 'directory', 'artifact', 'manifest', 'contentAddress', 'generated', 'authoritative'], [], 'guest unit plan materialization');
  const workspace = assertRelativePath(input.materialization.workspace, 'guest unit plan materialization.workspace');
  const directory = assertRelativePath(input.materialization.directory, 'guest unit plan materialization.directory');
  if (
    workspace !== '.pulse/guests'
    || directory !== `${workspace}/${unit.id}/${unit.artifactSha256}/${unit.manifestSha256}`
    || input.materialization.artifact !== 'unit.wasm'
    || input.materialization.manifest !== 'unit.json'
    || input.materialization.contentAddress !== 'artifact-and-manifest-sha256'
    || input.materialization.generated !== true
    || input.materialization.authoritative !== false
  ) {
    fail(diagnosticCodes.materializationFailed, 'Guest unit plan materialization is not the accepted content-addressed workspace.');
  }

  exactKeys(input.trust, ['lowerer', 'releaseManifest', 'ownerMatchesContributionPackage', 'installedVersionMatches', 'status'], [], 'guest unit plan trust');
  if (
    input.trust.lowerer !== 'trusted-first-party'
    || input.trust.releaseManifest !== 'synchronized'
    || input.trust.ownerMatchesContributionPackage !== true
    || input.trust.installedVersionMatches !== true
    || input.trust.status !== 'passed'
  ) {
    fail(diagnosticCodes.ownerMismatch, 'Guest unit plan trust must be a fully passed synchronized first-party decision.');
  }

  exactKeys(input.composition, ['kind', 'semanticContract', 'primaryModule', 'memoryOwnerModule'], [], 'guest unit plan composition');
  if (
    input.composition.kind !== 'core-wasm-static-link'
    || input.composition.semanticContract !== 'connect-validated-core-units-into-one-final-audited-native-artifact'
    || moduleName(input.composition.primaryModule, 'guest unit plan composition.primaryModule') === unit.module
    || input.composition.primaryModule === memoryAbi.importModule
    || input.composition.memoryOwnerModule !== memoryAbi.importModule
  ) {
    fail(diagnosticCodes.invalid, 'Guest unit plan composition does not match the accepted static-link boundary.');
  }
  exactKeys(input.fallback, ['enabled', 'onFailure'], [], 'guest unit plan fallback');
  if (input.fallback.enabled !== false || input.fallback.onFailure !== 'stop-before-provider-packaging') {
    fail(diagnosticCodes.invalid, 'Guest unit plan fallback must be disabled and fail before provider packaging.');
  }

  return Object.freeze({
    version: versions.guestUnitPlan,
    profile: string(input.profile, 'guest unit plan profile'),
    target,
    unit,
    targetPolicy,
    materialization: Object.freeze({
      workspace,
      directory,
      artifact: 'unit.wasm',
      manifest: 'unit.json',
      contentAddress: 'artifact-and-manifest-sha256',
      generated: true,
      authoritative: false
    }),
    trust: Object.freeze({
      lowerer: 'trusted-first-party',
      releaseManifest: 'synchronized',
      ownerMatchesContributionPackage: true,
      installedVersionMatches: true,
      status: 'passed'
    }),
    composition: Object.freeze({
      kind: 'core-wasm-static-link',
      semanticContract: 'connect-validated-core-units-into-one-final-audited-native-artifact',
      primaryModule: input.composition.primaryModule,
      memoryOwnerModule: memoryAbi.importModule
    }),
    fallback: Object.freeze({ enabled: false, onFailure: 'stop-before-provider-packaging' })
  });
}

function normalizeGuestUnitPlanV2(input) {
  exactKeys(input, [
    'version',
    'profile',
    'target',
    'unit',
    'targetPolicy',
    'materialization',
    'trust',
    'composition',
    'optimization',
    'fallback'
  ], [], 'guest unit plan v2');
  assertNoExecutionFields(input, 'guest unit plan v2');
  exactValue(input.version, versions.guestUnitPlanV2, 'guest unit plan v2 version');
  exactKeys(input.unit, [
    'manifestVersion',
    'id',
    'module',
    'owner',
    'packageVersion',
    'abi',
    'origin',
    'manifestSha256',
    'artifact',
    'source',
    'memoryIdentity',
    'frame',
    'toolchain'
  ], [], 'guest unit plan v2 unit');
  exactKeys(input.unit.artifact, ['bytes', 'sha256'], [], 'guest unit plan v2 artifact');
  exactKeys(input.unit.source, ['included', 'treeSha256'], [], 'guest unit plan v2 source');
  exactKeys(
    input.unit.frame,
    ['identity', 'capacityBytes', 'alignmentBytes', 'pointerWidthBits'],
    [],
    'guest unit plan v2 frame'
  );
  exactKeys(
    input.unit.toolchain,
    ['binaryenVersion', 'wasmOptSha256'],
    [],
    'guest unit plan v2 toolchain'
  );
  const unit = Object.freeze({
    manifestVersion: string(input.unit.manifestVersion, 'guest unit plan v2 unit.manifestVersion'),
    id: stableId(input.unit.id, 'guest unit plan v2 unit.id'),
    module: moduleName(input.unit.module, 'guest unit plan v2 unit.module'),
    owner: packageName(input.unit.owner, 'guest unit plan v2 unit.owner'),
    packageVersion: packageVersion(input.unit.packageVersion, 'guest unit plan v2 unit.packageVersion'),
    abi: stableId(input.unit.abi, 'guest unit plan v2 unit.abi'),
    origin: string(input.unit.origin, 'guest unit plan v2 unit.origin'),
    manifestSha256: sha(input.unit.manifestSha256, 'guest unit plan v2 unit.manifestSha256'),
    artifact: Object.freeze({
      bytes: integer(input.unit.artifact.bytes, 'guest unit plan v2 unit.artifact.bytes', 1),
      sha256: sha(input.unit.artifact.sha256, 'guest unit plan v2 unit.artifact.sha256')
    }),
    source: Object.freeze({
      included: boolean(input.unit.source.included, 'guest unit plan v2 unit.source.included'),
      treeSha256: sha(input.unit.source.treeSha256, 'guest unit plan v2 unit.source.treeSha256')
    }),
    memoryIdentity: string(input.unit.memoryIdentity, 'guest unit plan v2 unit.memoryIdentity'),
    frame: Object.freeze({
      identity: stableId(input.unit.frame.identity, 'guest unit plan v2 unit.frame.identity'),
      capacityBytes: integer(input.unit.frame.capacityBytes, 'guest unit plan v2 unit.frame.capacityBytes', 1),
      alignmentBytes: integer(input.unit.frame.alignmentBytes, 'guest unit plan v2 unit.frame.alignmentBytes', 1),
      pointerWidthBits: integer(input.unit.frame.pointerWidthBits, 'guest unit plan v2 unit.frame.pointerWidthBits', 1)
    }),
    toolchain: Object.freeze({
      binaryenVersion: string(
        input.unit.toolchain.binaryenVersion,
        'guest unit plan v2 unit.toolchain.binaryenVersion'
      ),
      wasmOptSha256: sha(
        input.unit.toolchain.wasmOptSha256,
        'guest unit plan v2 unit.toolchain.wasmOptSha256'
      )
    })
  });
  exactValue(unit.manifestVersion, versions.guestUnitV2, 'guest unit plan v2 manifest version');
  exactValue(unit.id, es256GuestUnit.id, 'guest unit plan v2 unit id', diagnosticCodes.abiMismatch);
  exactValue(unit.module, es256GuestUnit.module, 'guest unit plan v2 module', diagnosticCodes.abiMismatch);
  exactValue(unit.owner, es256GuestUnit.owner, 'guest unit plan v2 owner', diagnosticCodes.ownerMismatch);
  exactValue(
    unit.packageVersion,
    es256GuestUnit.packageVersion,
    'guest unit plan v2 package version',
    diagnosticCodes.ownerMismatch
  );
  exactValue(unit.abi, es256GuestUnit.abi, 'guest unit plan v2 ABI', diagnosticCodes.abiMismatch);
  exactValue(unit.origin, 'package-prebuilt', 'guest unit plan v2 origin');
  exactValue(unit.artifact, {
    bytes: es256GuestUnit.artifact.bytes,
    sha256: es256GuestUnit.artifact.sha256
  }, 'guest unit plan v2 artifact', diagnosticCodes.hashMismatch);
  exactValue(unit.source, {
    included: true,
    treeSha256: es256GuestUnit.source.treeSha256
  }, 'guest unit plan v2 source', diagnosticCodes.hashMismatch);
  exactValue(
    unit.memoryIdentity,
    versions.memoryAbiV2,
    'guest unit plan v2 memory identity',
    diagnosticCodes.memoryMismatch
  );
  exactValue(unit.frame, {
    identity: es256FrameV2.identity,
    capacityBytes: es256FrameV2.capacityBytes,
    alignmentBytes: es256FrameV2.alignmentBytes,
    pointerWidthBits: es256FrameV2.pointerWidthBits
  }, 'guest unit plan v2 frame', diagnosticCodes.abiMismatch);
  exactValue(unit.toolchain, {
    binaryenVersion,
    wasmOptSha256: es256GuestUnit.provenance.binaryenWasmOptSha256
  }, 'guest unit plan v2 toolchain', diagnosticCodes.featureMismatch);

  const targetPolicy = normalizeTargetPolicy(input.targetPolicy);
  const target = stableId(input.target, 'guest unit plan v2 target');
  if (targetPolicy.descriptorIdentity !== target) {
    fail(diagnosticCodes.invalid, 'Guest unit plan v2 target policy identity must equal the selected target.');
  }

  exactKeys(
    input.materialization,
    ['workspace', 'directory', 'artifact', 'manifest', 'contentAddress', 'generated', 'authoritative'],
    [],
    'guest unit plan v2 materialization'
  );
  const workspace = assertRelativePath(
    input.materialization.workspace,
    'guest unit plan v2 materialization.workspace'
  );
  const directory = assertRelativePath(
    input.materialization.directory,
    'guest unit plan v2 materialization.directory'
  );
  if (
    workspace !== '.pulse/guests'
    || directory !== `${workspace}/${unit.id}/${unit.artifact.sha256}/${unit.manifestSha256}`
    || input.materialization.artifact !== 'unit.wasm'
    || input.materialization.manifest !== 'unit.json'
    || input.materialization.contentAddress !== 'artifact-and-manifest-sha256'
    || input.materialization.generated !== true
    || input.materialization.authoritative !== false
  ) {
    fail(
      diagnosticCodes.materializationFailed,
      'Guest unit plan v2 materialization is not the accepted content-addressed workspace.'
    );
  }

  exactKeys(
    input.trust,
    ['lowerer', 'catalog', 'catalogStatus', 'ownerMatchesContributionPackage', 'installedVersionMatches', 'status'],
    [],
    'guest unit plan v2 trust'
  );
  exactValue(input.trust, {
    lowerer: 'trusted-first-party',
    catalog: 'pulse.jwt-crypto-working-candidate.v1',
    catalogStatus: 'unpublished-synchronized',
    ownerMatchesContributionPackage: true,
    installedVersionMatches: true,
    status: 'passed'
  }, 'guest unit plan v2 trust', diagnosticCodes.ownerMismatch);

  exactKeys(
    input.composition,
    ['kind', 'semanticContract', 'primaryModule', 'memoryOwnerModule'],
    [],
    'guest unit plan v2 composition'
  );
  if (
    input.composition.kind !== 'core-wasm-static-link'
    || input.composition.semanticContract
      !== 'connect-validated-core-units-into-one-final-audited-native-artifact'
    || moduleName(input.composition.primaryModule, 'guest unit plan v2 composition.primaryModule') === unit.module
    || input.composition.primaryModule === memoryAbiV2.importModule
    || input.composition.memoryOwnerModule !== memoryAbiV2.importModule
  ) {
    fail(diagnosticCodes.invalid, 'Guest unit plan v2 composition does not match the private static-link boundary.');
  }

  exactKeys(
    input.optimization,
    ['mode', 'postLink', 'posture'],
    [],
    'guest unit plan v2 optimization'
  );
  const optimizationMode = string(input.optimization.mode, 'guest unit plan v2 optimization.mode');
  const expectedPosture = optimizationMode === 'default'
    ? 'native-default'
    : optimizationMode === 'experimental-native-size'
      ? 'native-size'
      : null;
  if (
    expectedPosture === null
    || input.optimization.postLink !== true
    || input.optimization.posture !== expectedPosture
  ) {
    fail(diagnosticCodes.optimizationFailed, 'Guest unit plan v2 optimization mode and posture do not match.');
  }

  exactKeys(input.fallback, ['enabled', 'onFailure'], [], 'guest unit plan v2 fallback');
  exactValue(input.fallback, {
    enabled: false,
    onFailure: 'stop-before-provider-packaging'
  }, 'guest unit plan v2 fallback');

  return Object.freeze({
    version: versions.guestUnitPlanV2,
    profile: string(input.profile, 'guest unit plan v2 profile'),
    target,
    unit,
    targetPolicy,
    materialization: Object.freeze({
      workspace,
      directory,
      artifact: 'unit.wasm',
      manifest: 'unit.json',
      contentAddress: 'artifact-and-manifest-sha256',
      generated: true,
      authoritative: false
    }),
    trust: Object.freeze({
      lowerer: 'trusted-first-party',
      catalog: 'pulse.jwt-crypto-working-candidate.v1',
      catalogStatus: 'unpublished-synchronized',
      ownerMatchesContributionPackage: true,
      installedVersionMatches: true,
      status: 'passed'
    }),
    composition: Object.freeze({
      kind: 'core-wasm-static-link',
      semanticContract: 'connect-validated-core-units-into-one-final-audited-native-artifact',
      primaryModule: input.composition.primaryModule,
      memoryOwnerModule: memoryAbiV2.importModule
    }),
    optimization: Object.freeze({
      mode: optimizationMode,
      postLink: true,
      posture: expectedPosture
    }),
    fallback: Object.freeze({
      enabled: false,
      onFailure: 'stop-before-provider-packaging'
    })
  });
}

function normalizeGuestUnitPlan(input) {
  if (!plainObject(input)) fail(diagnosticCodes.invalid, 'Guest unit plan must be an object.');
  if (input.version === versions.guestUnitPlan) return normalizeGuestUnitPlanV1(input);
  if (input.version === versions.guestUnitPlanV2) return normalizeGuestUnitPlanV2(input);
  fail(
    diagnosticCodes.invalid,
    `Guest unit plan must use ${versions.guestUnitPlan} or ${versions.guestUnitPlanV2}.`
  );
}

function assertPlanMatchesManifest(plan, manifest) {
  if (plan.version === versions.guestUnitPlanV2 || manifest.version === versions.guestUnitV2) {
    if (plan.version !== versions.guestUnitPlanV2 || manifest.version !== versions.guestUnitV2) {
      fail(diagnosticCodes.abiMismatch, 'Guest unit plan and manifest versions do not match.');
    }
    const expectedV2 = {
      manifestVersion: manifest.version,
      id: manifest.id,
      module: manifest.module,
      owner: manifest.owner,
      packageVersion: manifest.packageVersion,
      abi: manifest.abi,
      origin: manifest.origin,
      artifact: {
        bytes: manifest.artifact.bytes,
        sha256: manifest.artifact.sha256
      },
      source: {
        included: true,
        treeSha256: manifest.source.treeSha256
      },
      memoryIdentity: manifest.memory.identity,
      frame: {
        identity: es256FrameV2.identity,
        capacityBytes: es256FrameV2.capacityBytes,
        alignmentBytes: es256FrameV2.alignmentBytes,
        pointerWidthBits: es256FrameV2.pointerWidthBits
      },
      toolchain: {
        binaryenVersion: manifest.toolchain.versions.binaryen,
        wasmOptSha256: manifest.provenance.binaryenWasmOptSha256
      }
    };
    const actualV2 = {
      manifestVersion: plan.unit.manifestVersion,
      id: plan.unit.id,
      module: plan.unit.module,
      owner: plan.unit.owner,
      packageVersion: plan.unit.packageVersion,
      abi: plan.unit.abi,
      origin: plan.unit.origin,
      artifact: plan.unit.artifact,
      source: plan.unit.source,
      memoryIdentity: plan.unit.memoryIdentity,
      frame: plan.unit.frame,
      toolchain: plan.unit.toolchain
    };
    if (JSON.stringify(actualV2) !== JSON.stringify(expectedV2)) {
      fail(
        diagnosticCodes.abiMismatch,
        'Guest unit v2 plan and manifest identities do not match.',
        { expected: expectedV2, actual: actualV2 }
      );
    }
    return;
  }
  const expected = {
    id: manifest.id,
    module: manifest.module,
    owner: manifest.owner,
    packageVersion: manifest.packageVersion,
    abi: manifest.abi,
    origin: manifest.origin,
    artifactSha256: manifest.artifact.sha256,
    source: {
      included: Boolean(manifest.source),
      treeSha256: manifest.source ? manifest.source.treeSha256 : null
    }
  };
  const actual = {
    id: plan.unit.id,
    module: plan.unit.module,
    owner: plan.unit.owner,
    packageVersion: plan.unit.packageVersion,
    abi: plan.unit.abi,
    origin: plan.unit.origin,
    artifactSha256: plan.unit.artifactSha256,
    source: plan.unit.source
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(diagnosticCodes.abiMismatch, 'Guest unit plan and manifest identities do not match.', { expected, actual });
  }
}

function optimizationArguments(posture) {
  const args = optimizationPostures[posture];
  if (!args) fail(diagnosticCodes.optimizationFailed, `Unsupported guest-link optimization posture ${posture}.`);
  return args;
}

module.exports = Object.freeze({
  normalizeGuestUnitManifest,
  normalizeGuestUnitPlan,
  assertPlanMatchesManifest,
  normalizeImport,
  normalizeExport,
  optimizationArguments
});
