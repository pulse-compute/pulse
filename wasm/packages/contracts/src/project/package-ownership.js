'use strict';

const PACKAGE_OWNERSHIP_CONTRACT_VERSION = 'pulse.package-ownership.v1';
const APPLICATION_IR_ENVELOPE_VERSION = 'pulse.application-ir-envelope.v1';

function freezeList(values) {
  return Object.freeze(Array.from(values || []));
}

function packageOwner(definition) {
  return Object.freeze({
    ...definition,
    owns: freezeList(definition.owns),
    mustNotOwn: freezeList(definition.mustNotOwn),
    directRecognizedImports: freezeList(definition.directRecognizedImports)
  });
}

const PACKAGE_OWNERSHIP_DEFINITIONS = Object.freeze([
  packageOwner({
    package: '@pulse-compute/runtime',
    layer: 'low-level-application-contract',
    currentStatus: 'public',
    sprint1Status: 'public-vnext-candidate',
    owns: [
      'Router topology and terminal control flow',
      'request, response, context, capability, and handler types',
      'low-level plain-handler and Router authoring',
      'target-neutral application semantics'
    ],
    mustNotOwn: [
      'workspace discovery',
      'profile selection',
      'configuration factory normalization',
      'provider lifecycle',
      'compiler internals'
    ],
    directRecognizedImports: ['Router'],
    publicationGate: 'already-public'
  }),
  packageOwner({
    package: '@pulse-compute/pulse',
    layer: 'ergonomic-project-wrapper',
    currentStatus: 'private-reserved',
    sprint1Status: 'implementation-candidate-not-yet-released',
    owns: [
      'Pulse application root',
      'defineConfig deferred factory marker',
      'symbolic config scope types',
      'project/profile composition ergonomics',
      'opaque profile composition token'
    ],
    mustNotOwn: [
      'a second Router dispatcher',
      'host lifecycle',
      'runtime filesystem discovery',
      'resolved config or secret values',
      'compiler rule registration'
    ],
    directRecognizedImports: ['Pulse', 'defineConfig'],
    publicationGate: 'separate-human-authorized-release-change'
  }),
  packageOwner({
    package: '@pulse-compute/cli',
    layer: 'project-tooling',
    currentStatus: 'public',
    sprint1Status: 'public-convergence-candidate',
    owns: [
      'workspace and config discovery',
      'profile selection precedence',
      'project command orchestration',
      'provider lifecycle delegation',
      'inspection and local artifact evidence'
    ],
    mustNotOwn: [
      'Router semantics',
      'handler semantic classification',
      'package capability semantics',
      'resolved secret values in artifacts'
    ],
    directRecognizedImports: [],
    publicationGate: 'existing-public-package'
  }),
  packageOwner({
    package: '@pulse-compute/wasm-contracts',
    layer: 'internal-shared-contract-authority',
    currentStatus: 'public-implementation-package',
    sprint1Status: 'shared-authority',
    owns: [
      'compiler spine phase vocabulary',
      'handler surface classifications',
      'project/profile plan schema',
      'package ownership declarations',
      'provider-neutral operation contracts'
    ],
    mustNotOwn: [
      'TypeScript AST traversal',
      'provider execution',
      'package-specific lowering behavior',
      'public third-party compiler plugins'
    ],
    directRecognizedImports: [],
    publicationGate: 'existing-public-package'
  })
]);

const IMPLEMENTATION_ROLE_OWNERSHIP = Object.freeze([
  Object.freeze({
    role: 'compiler-orchestration',
    owner: 'pulse.compiler-orchestration',
    owns: Object.freeze([
      'TypeScript source extraction',
      'surface recognition and normalization adapters',
      'contract validation',
      'canonical IR construction',
      'provider-neutral native lowering orchestration'
    ]),
    mustNotOwn: Object.freeze([
      'provider runtime behavior',
      'arbitrary package source interpretation',
      'public plugin discovery',
      'alternate Router semantics for Pulse'
    ])
  })
]);

const PUBLIC_SYMBOL_OWNERSHIP = Object.freeze([
  Object.freeze({ symbol: 'Router', package: '@pulse-compute/runtime', role: 'application-root', importPolicy: 'direct-named-import', aliases: false }),
  Object.freeze({ symbol: 'Pulse', package: '@pulse-compute/pulse', role: 'application-root', importPolicy: 'direct-named-import', aliases: false }),
  Object.freeze({ symbol: 'defineConfig', package: '@pulse-compute/pulse', role: 'config-factory-marker', importPolicy: 'direct-named-import', aliases: false })
]);

const APPLICATION_IR_ENVELOPE = Object.freeze({
  version: APPLICATION_IR_ENVELOPE_VERSION,
  kind: 'pulse.application-ir',
  routerField: 'router',
  projectField: 'project',
  router: Object.freeze({
    required: true,
    authority: 'existing-canonical-router-ir',
    semanticsMayDependOnProjectMetadata: false
  }),
  project: Object.freeze({
    requiredFor: Object.freeze(['pulse-root']),
    forbiddenFor: Object.freeze([]),
    contents: Object.freeze([
      'construction-mode',
      'config-plan-hash',
      'selected-profile',
      'strict-policy',
      'symbolic-bindings',
      'package-fragments'
    ]),
    resolvedSecretValues: false
  }),
  policies: Object.freeze({
    pulseCreatesSecondRouterIr: false,
    pulseChangesRouterCursorSemantics: false,
    pulseChangesErrorLaneSemantics: false,
    pulseChangesResponseOwnership: false,
    configurationBranchesInsideRouterIr: false
  })
});

function validatePackageOwnership(
  definitions = PACKAGE_OWNERSHIP_DEFINITIONS,
  symbols = PUBLIC_SYMBOL_OWNERSHIP,
  implementationRoles = IMPLEMENTATION_ROLE_OWNERSHIP
) {
  const packages = new Map();
  for (const definition of definitions) {
    if (!definition || typeof definition.package !== 'string' || definition.package.length === 0) {
      throw new TypeError('Package ownership definition requires a package name.');
    }
    if (packages.has(definition.package)) throw new TypeError(`Duplicate package ownership definition: ${definition.package}`);
    packages.set(definition.package, definition);
  }
  const symbolOwners = new Map();
  for (const entry of symbols) {
    if (!packages.has(entry.package)) throw new TypeError(`Public symbol ${entry.symbol} references unknown package ${entry.package}.`);
    if (symbolOwners.has(entry.symbol)) throw new TypeError(`Public symbol ${entry.symbol} has multiple package owners.`);
    symbolOwners.set(entry.symbol, entry);
  }
  const roles = new Map();
  for (const entry of implementationRoles) {
    if (!entry || typeof entry.role !== 'string' || entry.role.length === 0) {
      throw new TypeError('Implementation-role ownership definition requires a role.');
    }
    if (typeof entry.owner !== 'string' || entry.owner.length === 0) {
      throw new TypeError(`Implementation role ${entry.role} requires an owner.`);
    }
    if (roles.has(entry.role)) throw new TypeError(`Duplicate implementation-role ownership definition: ${entry.role}`);
    roles.set(entry.role, entry);
  }
  return Object.freeze({ packages, symbolOwners, roles });
}

const DEFAULT_PACKAGE_OWNERSHIP_REGISTRY = validatePackageOwnership();

function packageOwnerFor(name) {
  return DEFAULT_PACKAGE_OWNERSHIP_REGISTRY.packages.get(name);
}

function publicSymbolOwner(symbol) {
  return DEFAULT_PACKAGE_OWNERSHIP_REGISTRY.symbolOwners.get(symbol);
}

function implementationRoleOwner(role) {
  return DEFAULT_PACKAGE_OWNERSHIP_REGISTRY.roles.get(role);
}

function defaultPackageOwnershipContract() {
  return Object.freeze({
    version: PACKAGE_OWNERSHIP_CONTRACT_VERSION,
    packages: PACKAGE_OWNERSHIP_DEFINITIONS,
    symbols: PUBLIC_SYMBOL_OWNERSHIP,
    implementationRoles: IMPLEMENTATION_ROLE_OWNERSHIP,
    applicationIr: APPLICATION_IR_ENVELOPE,
    policies: Object.freeze({
      runtimeIsLowLevelEscapeHatch: true,
      pulseSharesRouterIr: true,
      cliOwnsProjectOrchestration: true,
      packageLowerersReceiveCanonicalOperations: true,
      publicCompilerPluginApi: false
    })
  });
}

module.exports = {
  PACKAGE_OWNERSHIP_CONTRACT_VERSION,
  APPLICATION_IR_ENVELOPE_VERSION,
  PACKAGE_OWNERSHIP_DEFINITIONS,
  PUBLIC_SYMBOL_OWNERSHIP,
  IMPLEMENTATION_ROLE_OWNERSHIP,
  APPLICATION_IR_ENVELOPE,
  DEFAULT_PACKAGE_OWNERSHIP_REGISTRY,
  validatePackageOwnership,
  packageOwnerFor,
  publicSymbolOwner,
  implementationRoleOwner,
  defaultPackageOwnershipContract
};
