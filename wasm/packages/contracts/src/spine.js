'use strict';

const COMPILER_SPINE_CONTRACT_VERSION = 'pulse.compiler-spine.v1';
const COMPILER_SPINE_CONTRACT_ID = 'pulse.compiler-spine';

const COMPILER_RULE_KINDS = Object.freeze([
  'root-recognizer',
  'surface-recognizer',
  'surface-normalizer',
  'semantic-classifier',
  'semantic-validator',
  'canonical-ir-builder',
  'native-lowerer',
  'package-lowerer-adapter',
  'native-realizer',
  'guest-realizer',
  'provider-realizer',
  'artifact-verifier'
]);

const COMPILER_SPINE_PHASES = Object.freeze([
  Object.freeze({
    id: 'root-extraction',
    order: 10,
    input: 'typescript-source-graph',
    output: 'application-root-facts',
    ruleKinds: Object.freeze(['root-recognizer']),
    ownsTraversal: true,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'surface-recognition',
    order: 20,
    input: 'application-root-facts',
    output: 'recognized-authoring-surfaces',
    ruleKinds: Object.freeze(['surface-recognizer']),
    ownsTraversal: true,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'surface-normalization',
    order: 30,
    input: 'recognized-authoring-surfaces',
    output: 'normalized-handler-operations',
    ruleKinds: Object.freeze(['surface-normalizer']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'semantic-classification',
    order: 40,
    input: 'normalized-handler-operations',
    output: 'classified-handler-operations',
    ruleKinds: Object.freeze(['semantic-classifier']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'contract-validation',
    order: 50,
    input: 'classified-handler-operations',
    output: 'validated-handler-program',
    ruleKinds: Object.freeze(['semantic-validator']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'canonical-ir',
    order: 60,
    input: 'validated-handler-program',
    output: 'application-ir',
    ruleKinds: Object.freeze(['canonical-ir-builder']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'native-lowering',
    order: 70,
    input: 'application-ir',
    output: 'native-plan',
    ruleKinds: Object.freeze(['native-lowerer']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'package-lowering',
    order: 80,
    input: 'native-plan-package-operations',
    output: 'package-lowered-native-plan',
    ruleKinds: Object.freeze(['package-lowerer-adapter']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'native-realization',
    order: 90,
    input: 'package-lowered-native-plan',
    output: 'primary-native-wasm',
    ruleKinds: Object.freeze(['native-realizer']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'guest-realization',
    order: 100,
    input: 'primary-native-wasm',
    output: 'composed-native-wasm',
    ruleKinds: Object.freeze(['guest-realizer']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'artifact-verification',
    order: 110,
    input: 'composed-native-wasm',
    output: 'verified-build-evidence',
    ruleKinds: Object.freeze(['artifact-verifier']),
    ownsTraversal: false,
    mutatesSourceAst: false
  }),
  Object.freeze({
    id: 'provider-realization',
    order: 120,
    input: 'verified-build-evidence',
    output: 'provider-artifacts',
    ruleKinds: Object.freeze(['provider-realizer']),
    ownsTraversal: false,
    mutatesSourceAst: false
  })
]);

const COMPILER_SPINE_POLICY = Object.freeze({
  internalOnly: true,
  publicPluginApi: false,
  externalRuleRegistration: false,
  dynamicRuleRegistration: false,
  runtimeRuleDiscovery: false,
  phaseOrdering: 'fixed-and-versioned',
  traversalOwnership: 'phase-owned',
  sharedMutableCompilerContext: false,
  sourceAstMutation: false,
  canonicalIrPaths: 1,
  packageLoweringInput: 'canonical-package-operation-only',
  packageLowererTrust: 'manifest-declared-first-party',
  providerRealizationInput: 'provider-neutral-native-plan',
  behaviorChangeInContractFreeze: false
});

const DEFAULT_COMPILER_SPINE_RULES = Object.freeze([
  Object.freeze({
    id: 'pulse.root.plain-handler',
    phase: 'root-extraction',
    kind: 'root-recognizer',
    owner: 'pulse.compiler-orchestration',
    status: 'existing',
    priority: 10,
    dependsOn: Object.freeze([])
  }),
  Object.freeze({
    id: 'pulse.root.router',
    phase: 'root-extraction',
    kind: 'root-recognizer',
    owner: 'pulse.compiler-orchestration',
    status: 'existing',
    priority: 20,
    dependsOn: Object.freeze([])
  }),
  Object.freeze({
    id: 'pulse.root.pulse',
    phase: 'root-extraction',
    kind: 'root-recognizer',
    owner: 'pulse.compiler-orchestration',
    status: 'planned',
    priority: 30,
    dependsOn: Object.freeze([])
  }),
  Object.freeze({
    id: 'pulse.surface.ctx',
    phase: 'surface-recognition',
    kind: 'surface-recognizer',
    owner: 'pulse.compiler-orchestration',
    status: 'contract-frozen',
    priority: 10,
    dependsOn: Object.freeze(['pulse.root.plain-handler', 'pulse.root.router', 'pulse.root.pulse'])
  }),
  Object.freeze({
    id: 'pulse.surface.authoring-sugar',
    phase: 'surface-normalization',
    kind: 'surface-normalizer',
    owner: 'pulse.compiler-orchestration',
    status: 'planned',
    priority: 10,
    dependsOn: Object.freeze(['pulse.surface.ctx'])
  }),
  Object.freeze({
    id: 'pulse.semantic.handler-surface',
    phase: 'semantic-classification',
    kind: 'semantic-classifier',
    owner: '@pulse-compute/wasm-contracts',
    status: 'contract-frozen',
    priority: 10,
    dependsOn: Object.freeze(['pulse.surface.authoring-sugar'])
  }),
  Object.freeze({
    id: 'pulse.validate.handler-contract',
    phase: 'contract-validation',
    kind: 'semantic-validator',
    owner: 'pulse.compiler-orchestration',
    status: 'existing-to-converge',
    priority: 10,
    dependsOn: Object.freeze(['pulse.semantic.handler-surface'])
  }),
  Object.freeze({
    id: 'pulse.ir.application',
    phase: 'canonical-ir',
    kind: 'canonical-ir-builder',
    owner: 'pulse.compiler-orchestration',
    status: 'existing-to-envelope',
    priority: 10,
    dependsOn: Object.freeze(['pulse.validate.handler-contract'])
  }),
  Object.freeze({
    id: 'pulse.lower.native-effects',
    phase: 'native-lowering',
    kind: 'native-lowerer',
    owner: 'pulse.compiler-orchestration',
    status: 'existing',
    priority: 10,
    dependsOn: Object.freeze(['pulse.ir.application'])
  }),
  Object.freeze({
    id: 'pulse.lower.package-contracts',
    phase: 'package-lowering',
    kind: 'package-lowerer-adapter',
    owner: 'pulse.package-lowering',
    status: 'existing',
    priority: 10,
    dependsOn: Object.freeze(['pulse.lower.native-effects'])
  }),
  Object.freeze({
    id: 'pulse.realize.native-primary',
    phase: 'native-realization',
    kind: 'native-realizer',
    owner: 'pulse.compiler-orchestration',
    status: 'existing',
    priority: 10,
    dependsOn: Object.freeze(['pulse.lower.package-contracts'])
  }),
  Object.freeze({
    id: 'pulse.realize.guest-units',
    phase: 'guest-realization',
    kind: 'guest-realizer',
    owner: '@pulse-compute/wasm-guest-link',
    status: 'implemented',
    priority: 10,
    dependsOn: Object.freeze(['pulse.realize.native-primary'])
  }),
  Object.freeze({
    id: 'pulse.verify.final-wasm',
    phase: 'artifact-verification',
    kind: 'artifact-verifier',
    owner: 'pulse.artifact-tooling',
    status: 'existing-to-converge',
    priority: 10,
    dependsOn: Object.freeze(['pulse.realize.guest-units'])
  }),
  Object.freeze({
    id: 'pulse.realize.provider',
    phase: 'provider-realization',
    kind: 'provider-realizer',
    owner: 'pulse.selected-provider',
    status: 'existing',
    priority: 10,
    dependsOn: Object.freeze(['pulse.verify.final-wasm'])
  })
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function phaseMap() {
  return new Map(COMPILER_SPINE_PHASES.map((phase) => [phase.id, phase]));
}

function validateRule(rule, phases) {
  if (!rule || typeof rule !== 'object') throw new TypeError('Compiler spine rule must be an object.');
  if (!isNonEmptyString(rule.id)) throw new TypeError('Compiler spine rule requires a stable id.');
  if (!isNonEmptyString(rule.phase) || !phases.has(rule.phase)) throw new TypeError(`Compiler spine rule ${rule.id} references an unknown phase.`);
  if (!COMPILER_RULE_KINDS.includes(rule.kind)) throw new TypeError(`Compiler spine rule ${rule.id} uses unsupported kind ${rule.kind}.`);
  const phase = phases.get(rule.phase);
  if (!phase.ruleKinds.includes(rule.kind)) throw new TypeError(`Compiler spine rule ${rule.id} kind ${rule.kind} is not allowed in phase ${rule.phase}.`);
  if (!isNonEmptyString(rule.owner)) throw new TypeError(`Compiler spine rule ${rule.id} requires an owner.`);
  if (!Array.isArray(rule.dependsOn)) throw new TypeError(`Compiler spine rule ${rule.id} requires a dependsOn array.`);
}

function assertAcyclic(byId) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, stack) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TypeError(`Compiler spine rule dependency cycle: ${[...stack, id].join(' -> ')}`);
    const rule = byId.get(id);
    if (!rule) throw new TypeError(`Compiler spine rule dependency is unknown: ${id}`);
    visiting.add(id);
    for (const dependency of rule.dependsOn) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of byId.keys()) visit(id, []);
}

function buildCompilerSpineRegistry(rules = DEFAULT_COMPILER_SPINE_RULES) {
  const phases = phaseMap();
  const byId = new Map();
  for (const rule of rules) {
    validateRule(rule, phases);
    if (byId.has(rule.id)) throw new TypeError(`Duplicate compiler spine rule id: ${rule.id}`);
    byId.set(rule.id, rule);
  }
  for (const rule of byId.values()) {
    for (const dependency of rule.dependsOn) {
      if (!byId.has(dependency)) throw new TypeError(`Compiler spine rule ${rule.id} depends on unknown rule ${dependency}.`);
      const dependencyPhase = phases.get(byId.get(dependency).phase);
      const rulePhase = phases.get(rule.phase);
      if (dependencyPhase.order > rulePhase.order) {
        throw new TypeError(`Compiler spine rule ${rule.id} depends on later phase rule ${dependency}.`);
      }
    }
  }
  assertAcyclic(byId);

  const ordered = Array.from(byId.values()).sort((left, right) => {
    const phaseOrder = phases.get(left.phase).order - phases.get(right.phase).order;
    if (phaseOrder !== 0) return phaseOrder;
    const priorityOrder = Number(left.priority || 0) - Number(right.priority || 0);
    if (priorityOrder !== 0) return priorityOrder;
    return left.id.localeCompare(right.id);
  });

  return Object.freeze({
    version: COMPILER_SPINE_CONTRACT_VERSION,
    contractId: COMPILER_SPINE_CONTRACT_ID,
    phases: COMPILER_SPINE_PHASES,
    policy: COMPILER_SPINE_POLICY,
    rules: Object.freeze(ordered),
    get(id) {
      return byId.get(id);
    },
    rulesForPhase(phaseId) {
      if (!phases.has(phaseId)) throw new TypeError(`Unknown compiler spine phase: ${phaseId}`);
      return Object.freeze(ordered.filter((rule) => rule.phase === phaseId));
    }
  });
}

const DEFAULT_COMPILER_SPINE_REGISTRY = buildCompilerSpineRegistry();

function defaultCompilerSpineContract() {
  return Object.freeze({
    version: COMPILER_SPINE_CONTRACT_VERSION,
    contractId: COMPILER_SPINE_CONTRACT_ID,
    phases: COMPILER_SPINE_PHASES,
    policy: COMPILER_SPINE_POLICY,
    rules: DEFAULT_COMPILER_SPINE_REGISTRY.rules
  });
}

module.exports = {
  COMPILER_SPINE_CONTRACT_VERSION,
  COMPILER_SPINE_CONTRACT_ID,
  COMPILER_RULE_KINDS,
  COMPILER_SPINE_PHASES,
  COMPILER_SPINE_POLICY,
  DEFAULT_COMPILER_SPINE_RULES,
  DEFAULT_COMPILER_SPINE_REGISTRY,
  buildCompilerSpineRegistry,
  defaultCompilerSpineContract
};
