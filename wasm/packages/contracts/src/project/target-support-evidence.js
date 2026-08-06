'use strict';

const { sha256Hex, stableStringify } = require('../stable-id.js');
const { normalizeNativeEligibilityProjection } = require('./reachable-graph-projections.js');

const TARGET_SUPPORT_DECLARATION_VERSION = 'pulse.target-support-declaration.v1';
const TARGET_AVAILABILITY_POLICY_VERSION = 'pulse.target-availability-policy.v1';
const TARGET_SUPPORT_EVIDENCE_VERSION = 'pulse.target-support-evidence.v1';
const TARGET_SUPPORT_OBSERVATION_VERSION = 'pulse.target-support-observation.v1';
const TARGET_SUPPORT_KIND = 'pulse.target-support-evidence';
const TARGET_SUPPORT_DECLARATION_KIND = 'pulse.target-support-declaration';

const SUPPORT_STATUSES = Object.freeze(['eligible', 'pending', 'blocked', 'irrelevant']);
const GATE_STATUSES = Object.freeze(['satisfied', 'pending', 'blocked']);
const AVAILABILITY_DEFINITIONS = Object.freeze(['full-target-support', 'descriptor-supported']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) throw new TypeError(`${field} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value, field) {
  if (value == null) return null;
  return nonEmptyString(value, field);
}

function nonNegativeInteger(value, field) {
  const normalized = Number(value || 0);
  if (!Number.isInteger(normalized) || normalized < 0) throw new TypeError(`${field} must be a non-negative integer.`);
  return normalized;
}

function sortedUniqueStrings(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze([...new Set(values.map((value, index) => nonEmptyString(value, `${field}[${index}]`)))].sort());
}

function normalizeEvidenceReference(value, field) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new TypeError(`${field} must be an object.`);
  assertKnownKeys(value, ['artifact', 'version', 'sha256', 'status', 'cases', 'matched', 'mismatches'], field);
  const normalized = {
    artifact: optionalString(value.artifact, `${field}.artifact`),
    version: optionalString(value.version, `${field}.version`),
    sha256: optionalString(value.sha256, `${field}.sha256`),
    status: optionalString(value.status, `${field}.status`),
    cases: nonNegativeInteger(value.cases, `${field}.cases`),
    matched: nonNegativeInteger(value.matched, `${field}.matched`),
    mismatches: nonNegativeInteger(value.mismatches, `${field}.mismatches`)
  };
  if (normalized.matched + normalized.mismatches > normalized.cases) {
    throw new TypeError(`${field} matched plus mismatches cannot exceed cases.`);
  }
  if (normalized.status === 'passed' && (normalized.mismatches !== 0 || normalized.matched !== normalized.cases)) {
    throw new TypeError(`${field} passed evidence must match every case with zero mismatches.`);
  }
  return deepFreeze(normalized);
}

function normalizeGate(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`target support gate ${index} must be an object.`);
  assertKnownKeys(value, ['id', 'status', 'reasonId', 'owner', 'summary', 'evidence'], `target support gate ${index}`);
  const status = nonEmptyString(value.status, `target support gate ${index}.status`);
  if (!GATE_STATUSES.includes(status)) throw new TypeError(`target support gate ${index}.status must be one of ${GATE_STATUSES.join(', ')}.`);
  return deepFreeze({
    id: nonEmptyString(value.id, `target support gate ${index}.id`),
    status,
    reasonId: nonEmptyString(value.reasonId, `target support gate ${index}.reasonId`),
    owner: nonEmptyString(value.owner, `target support gate ${index}.owner`),
    summary: nonEmptyString(value.summary, `target support gate ${index}.summary`),
    evidence: normalizeEvidenceReference(value.evidence, `target support gate ${index}.evidence`)
  });
}

function normalizeDeclarationCommand(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`target support command ${index} must be an object.`);
  assertKnownKeys(value, ['id', 'implemented', 'status', 'reasonId', 'owner'], `target support command ${index}`);
  const status = nonEmptyString(value.status, `target support command ${index}.status`);
  if (!['eligible', 'pending', 'blocked'].includes(status)) {
    throw new TypeError(`target support command ${index}.status must be eligible, pending, or blocked.`);
  }
  const implemented = value.implemented === true;
  if (implemented !== (status === 'eligible')) {
    throw new TypeError(`target support command ${index} must be eligible exactly when implemented is true.`);
  }
  return deepFreeze({
    id: nonEmptyString(value.id, `target support command ${index}.id`),
    implemented,
    status,
    reasonId: nonEmptyString(value.reasonId, `target support command ${index}.reasonId`),
    owner: nonEmptyString(value.owner, `target support command ${index}.owner`)
  });
}

function normalizeProjectCommand(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`target support project command ${index} must be an object.`);
  assertKnownKeys(value, ['id', 'implemented', 'status', 'reasonId', 'owner'], `target support project command ${index}`);
  const status = nonEmptyString(value.status, `target support project command ${index}.status`);
  if (!['eligible', 'pending', 'blocked'].includes(status)) {
    throw new TypeError(`target support project command ${index}.status must be eligible, pending, or blocked.`);
  }
  const implemented = value.implemented === true;
  if (!implemented && status === 'eligible') {
    throw new TypeError(`target support project command ${index} cannot be eligible when it is not implemented.`);
  }
  return deepFreeze({
    id: nonEmptyString(value.id, `target support project command ${index}.id`),
    implemented,
    status,
    reasonId: nonEmptyString(value.reasonId, `target support project command ${index}.reasonId`),
    owner: nonEmptyString(value.owner, `target support project command ${index}.owner`)
  });
}

function assertUniqueIds(values, field) {
  const ids = values.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new TypeError(`${field} IDs must be unique.`);
}

function normalizeTargetSupportDeclaration(input) {
  if (!isPlainObject(input)) throw new TypeError('Target support declaration input must be an object.');
  assertKnownKeys(input, [
    'provider', 'target', 'targetId', 'runtimeClass', 'definition', 'coreExecutionReady',
    'fullTargetSupportReady', 'generalAvailable', 'automaticFallback', 'gates', 'commands', 'parity'
  ], 'target support declaration');

  const definition = nonEmptyString(input.definition, 'target support declaration.definition');
  if (!AVAILABILITY_DEFINITIONS.includes(definition)) {
    throw new TypeError(`target support declaration.definition must be one of ${AVAILABILITY_DEFINITIONS.join(', ')}.`);
  }
  if (input.automaticFallback === true) throw new TypeError('Target support declaration automaticFallback must remain false.');

  const gates = Object.freeze((input.gates || []).map(normalizeGate).sort((a, b) => a.id.localeCompare(b.id)));
  const commands = Object.freeze((input.commands || []).map(normalizeDeclarationCommand).sort((a, b) => a.id.localeCompare(b.id)));
  assertUniqueIds(gates, 'Target support gate');
  assertUniqueIds(commands, 'Target support command');

  const allGatesSatisfied = gates.length > 0 && gates.every((entry) => entry.status === 'satisfied');
  const coreExecutionReady = input.coreExecutionReady === true;
  const fullTargetSupportReady = input.fullTargetSupportReady === true;
  const generalAvailable = input.generalAvailable === true;
  if (fullTargetSupportReady !== allGatesSatisfied) {
    throw new TypeError('fullTargetSupportReady must be true exactly when every declared support gate is satisfied.');
  }
  if (fullTargetSupportReady && !coreExecutionReady) {
    throw new TypeError('A fully supported target must declare coreExecutionReady.');
  }
  if (definition === 'full-target-support' && generalAvailable !== fullTargetSupportReady) {
    throw new TypeError('full-target-support generalAvailable must equal fullTargetSupportReady.');
  }
  if (generalAvailable && commands.some((entry) => entry.status !== 'eligible')) {
    throw new TypeError('A generally available target cannot declare a pending or blocked command.');
  }

  const semantic = {
    version: TARGET_SUPPORT_DECLARATION_VERSION,
    kind: TARGET_SUPPORT_DECLARATION_KIND,
    provider: nonEmptyString(input.provider, 'target support declaration.provider'),
    target: nonEmptyString(input.target, 'target support declaration.target'),
    targetId: nonEmptyString(input.targetId, 'target support declaration.targetId'),
    runtimeClass: nonEmptyString(input.runtimeClass, 'target support declaration.runtimeClass'),
    availability: deepFreeze({
      version: TARGET_AVAILABILITY_POLICY_VERSION,
      definition,
      coreExecutionReady,
      fullTargetSupportReady,
      generalAvailable,
      automaticFallback: false,
      gates,
      summary: deepFreeze({
        total: gates.length,
        satisfied: gates.filter((entry) => entry.status === 'satisfied').length,
        pending: gates.filter((entry) => entry.status === 'pending').length,
        blocked: gates.filter((entry) => entry.status === 'blocked').length
      })
    }),
    commands,
    parity: normalizeEvidenceReference(input.parity, 'target support declaration.parity'),
    policy: deepFreeze({
      selectedTargetAuthoritative: true,
      descriptorAndCommandTruthSeparateFromAvailability: true,
      projectEligibilitySeparateFromGeneralAvailability: true,
      automaticFallback: false
    })
  };
  return deepFreeze({ ...semantic, declarationHash: sha256Hex(stableStringify(semantic)) });
}

function normalizeSource(value, index, field) {
  if (!isPlainObject(value)) throw new TypeError(`${field}[${index}] must be an object.`);
  assertKnownKeys(value, ['file', 'line', 'column'], `${field}[${index}]`);
  return deepFreeze({
    file: nonEmptyString(value.file, `${field}[${index}].file`),
    line: Number.isInteger(value.line) && value.line > 0 ? value.line : 1,
    column: Number.isInteger(value.column) && value.column > 0 ? value.column : 1
  });
}

function normalizeEligibilityItem(value, index, field) {
  if (!isPlainObject(value)) throw new TypeError(`${field}[${index}] must be an object.`);
  assertKnownKeys(value, ['id', 'status', 'required', 'reasonId', 'owner'], `${field}[${index}]`);
  const status = nonEmptyString(value.status, `${field}[${index}].status`);
  if (!SUPPORT_STATUSES.includes(status)) throw new TypeError(`${field}[${index}].status must be one of ${SUPPORT_STATUSES.join(', ')}.`);
  const required = value.required !== false;
  if (status === 'irrelevant' && required) throw new TypeError(`${field}[${index}] cannot be required and irrelevant.`);
  if (status !== 'irrelevant' && !required) throw new TypeError(`${field}[${index}] must be irrelevant when it is not required.`);
  return deepFreeze({
    id: nonEmptyString(value.id, `${field}[${index}].id`),
    status,
    required,
    reasonId: nonEmptyString(value.reasonId, `${field}[${index}].reasonId`),
    owner: nonEmptyString(value.owner, `${field}[${index}].owner`)
  });
}

function normalizePackageEligibility(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`target support package ${index} must be an object.`);
  assertKnownKeys(value, [
    'moduleId', 'packageName', 'packageSubpath', 'contractId', 'reachable', 'runtime', 'selected',
    'configured', 'required', 'status', 'reasonId', 'reasonCode', 'owner', 'realization',
    'targetStatus', 'runtimeEntry', 'sources'
  ], `target support package ${index}`);
  const status = nonEmptyString(value.status, `target support package ${index}.status`);
  if (!SUPPORT_STATUSES.includes(status)) throw new TypeError(`target support package ${index}.status must be one of ${SUPPORT_STATUSES.join(', ')}.`);
  const reachable = value.reachable === true;
  const runtime = value.runtime === true;
  const selected = value.selected === true;
  const configured = value.configured === true;
  const required = value.required === true;
  if (runtime && !reachable) throw new TypeError(`target support package ${index} cannot be runtime without being reachable.`);
  if (required !== (runtime || selected || configured)) {
    throw new TypeError(`target support package ${index}.required must equal runtime || selected || configured.`);
  }
  if (required && status === 'irrelevant') throw new TypeError(`target support package ${index} cannot be required and irrelevant.`);
  if (!required && status !== 'irrelevant') throw new TypeError(`target support package ${index} must be irrelevant when it is not required.`);
  return deepFreeze({
    moduleId: nonEmptyString(value.moduleId, `target support package ${index}.moduleId`),
    packageName: nonEmptyString(value.packageName, `target support package ${index}.packageName`),
    packageSubpath: value.packageSubpath == null ? '.' : String(value.packageSubpath),
    contractId: optionalString(value.contractId, `target support package ${index}.contractId`),
    reachable,
    runtime,
    selected,
    configured,
    required,
    status,
    reasonId: nonEmptyString(value.reasonId, `target support package ${index}.reasonId`),
    reasonCode: optionalString(value.reasonCode, `target support package ${index}.reasonCode`),
    owner: nonEmptyString(value.owner, `target support package ${index}.owner`),
    realization: optionalString(value.realization, `target support package ${index}.realization`),
    targetStatus: optionalString(value.targetStatus, `target support package ${index}.targetStatus`),
    runtimeEntry: optionalString(value.runtimeEntry, `target support package ${index}.runtimeEntry`),
    sources: Object.freeze((value.sources || []).map((entry, sourceIndex) => normalizeSource(entry, sourceIndex, `target support package ${index}.sources`))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column))
  });
}

function normalizeNativeEligibility(value) {
  if (!isPlainObject(value)) throw new TypeError('Target support nativeEligibility must be an object.');
  assertKnownKeys(value, ['version', 'graphHash', 'eligible', 'blockers', 'firstUnsupportedBoundary', 'handlers', 'policy', 'projectionHash'], 'target support nativeEligibility');
  const normalized = normalizeNativeEligibilityProjection({
    graphHash: value.graphHash,
    blockers: (value.blockers || []).map((entry) => {
      const { id: _id, ...semantic } = entry;
      return semantic;
    }),
    handlers: value.handlers || []
  });
  if (value.version !== normalized.version) throw new TypeError('Target support nativeEligibility version does not match the canonical projection.');
  if (value.projectionHash !== normalized.projectionHash) throw new TypeError('Target support nativeEligibility projectionHash does not match its canonical content.');
  if ((value.eligible === true) !== normalized.eligible) throw new TypeError('Target support nativeEligibility eligible does not match its blockers.');
  if (stableStringify(value.firstUnsupportedBoundary || null) !== stableStringify(normalized.firstUnsupportedBoundary)) {
    throw new TypeError('Target support nativeEligibility firstUnsupportedBoundary does not match the canonical projection.');
  }
  if (!isPlainObject(value.policy) || value.policy.automaticFallback !== false) {
    throw new TypeError('Target support nativeEligibility must prohibit automatic fallback.');
  }
  return normalized;
}

function summarizeStatuses(values) {
  return deepFreeze({
    total: values.length,
    eligible: values.filter((entry) => entry.status === 'eligible').length,
    pending: values.filter((entry) => entry.status === 'pending').length,
    blocked: values.filter((entry) => entry.status === 'blocked').length,
    irrelevant: values.filter((entry) => entry.status === 'irrelevant').length
  });
}

function requiredEvidence(application, capabilities, providerRequirements, packages) {
  return [
    ...application.filter((entry) => entry.required),
    ...capabilities.filter((entry) => entry.required),
    ...providerRequirements.filter((entry) => entry.required),
    ...packages.filter((entry) => entry.required)
  ];
}

function expectedProjectStatus(application, capabilities, providerRequirements, packages) {
  const required = requiredEvidence(application, capabilities, providerRequirements, packages);
  if (required.some((entry) => entry.status === 'blocked')) return 'blocked';
  if (required.some((entry) => entry.status === 'pending')) return 'pending';
  return 'eligible';
}

function expectedReasonIds(application, capabilities, providerRequirements, packages) {
  return [...new Set(requiredEvidence(application, capabilities, providerRequirements, packages)
    .filter((entry) => entry.status !== 'eligible')
    .map((entry) => entry.reasonId))].sort();
}

function normalizeProjectEligibility(input) {
  if (!isPlainObject(input)) throw new TypeError('Target support project eligibility must be an object.');
  assertKnownKeys(input, [
    'status', 'reasonIds', 'projectHash', 'configPlanHash', 'sourceHash', 'graphHash', 'applicationPlanHash',
    'packageProjectionHash', 'packageProductHash', 'nativeEligibility', 'commands', 'application',
    'capabilities', 'providerRequirements', 'packages'
  ], 'target support project eligibility');
  const status = nonEmptyString(input.status, 'target support project eligibility.status');
  if (!['eligible', 'pending', 'blocked'].includes(status)) throw new TypeError('Target support project eligibility status must be eligible, pending, or blocked.');
  const commands = Object.freeze((input.commands || []).map(normalizeProjectCommand).sort((a, b) => a.id.localeCompare(b.id)));
  const application = Object.freeze((input.application || []).map((entry, index) => normalizeEligibilityItem(entry, index, 'target support application decisions'))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const capabilities = Object.freeze((input.capabilities || []).map((entry, index) => normalizeEligibilityItem(entry, index, 'target support capabilities'))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const providerRequirements = Object.freeze((input.providerRequirements || []).map((entry, index) => normalizeEligibilityItem(entry, index, 'target support provider requirements'))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const packages = Object.freeze((input.packages || []).map(normalizePackageEligibility)
    .sort((a, b) => a.packageName.localeCompare(b.packageName) || a.packageSubpath.localeCompare(b.packageSubpath) || a.moduleId.localeCompare(b.moduleId)));
  const nativeEligibility = normalizeNativeEligibility(input.nativeEligibility);
  assertUniqueIds(commands, 'Target support project command');
  assertUniqueIds(application, 'Target support application decision');
  assertUniqueIds(capabilities, 'Target support capability');
  assertUniqueIds(providerRequirements, 'Target support provider requirement');
  if (new Set(packages.map((entry) => entry.moduleId)).size !== packages.length) throw new TypeError('Target support package module IDs must be unique.');

  const expectedStatus = expectedProjectStatus(application, capabilities, providerRequirements, packages);
  if (status !== expectedStatus) throw new TypeError(`Target support project eligibility status must be ${expectedStatus} for the supplied evidence.`);
  const reasonIds = sortedUniqueStrings(input.reasonIds || [], 'target support project eligibility.reasonIds');
  const expectedReasons = expectedReasonIds(application, capabilities, providerRequirements, packages);
  if (stableStringify(reasonIds) !== stableStringify(expectedReasons)) {
    throw new TypeError(`Target support project eligibility reasonIds must equal the non-eligible required evidence reasons: ${expectedReasons.join(', ')}.`);
  }

  return deepFreeze({
    status,
    reasonIds,
    projectHash: optionalString(input.projectHash, 'target support project eligibility.projectHash'),
    configPlanHash: optionalString(input.configPlanHash, 'target support project eligibility.configPlanHash'),
    sourceHash: nonEmptyString(input.sourceHash, 'target support project eligibility.sourceHash'),
    graphHash: nonEmptyString(input.graphHash, 'target support project eligibility.graphHash'),
    applicationPlanHash: nonEmptyString(input.applicationPlanHash, 'target support project eligibility.applicationPlanHash'),
    packageProjectionHash: optionalString(input.packageProjectionHash, 'target support project eligibility.packageProjectionHash'),
    packageProductHash: optionalString(input.packageProductHash, 'target support project eligibility.packageProductHash'),
    nativeEligibility,
    commands,
    application,
    capabilities,
    providerRequirements,
    packages,
    summary: deepFreeze({
      commands: summarizeStatuses(commands),
      application: summarizeStatuses(application),
      capabilities: summarizeStatuses(capabilities),
      providerRequirements: summarizeStatuses(providerRequirements),
      packages: summarizeStatuses(packages)
    })
  });
}

function assertProjectCommandsAlign(declaration, project) {
  const declarationById = new Map(declaration.commands.map((entry) => [entry.id, entry]));
  const projectById = new Map(project.commands.map((entry) => [entry.id, entry]));
  if (stableStringify([...declarationById.keys()].sort()) !== stableStringify([...projectById.keys()].sort())) {
    throw new TypeError('Target support project commands must cover the declaration command matrix exactly.');
  }
  for (const [id, declared] of declarationById) {
    const effective = projectById.get(id);
    if (effective.implemented !== declared.implemented) {
      throw new TypeError(`Target support project command ${id} implementation truth diverges from the declaration.`);
    }
    if (declared.status !== 'eligible' && effective.status !== declared.status) {
      throw new TypeError(`Target support project command ${id} must preserve declaration status ${declared.status}.`);
    }
  }

  for (const id of ['test', 'dev']) {
    const declared = declarationById.get(id);
    const effective = projectById.get(id);
    if (declared && declared.status === 'eligible' && effective.status !== project.status) {
      throw new TypeError(`Target support project command ${id} must follow project execution eligibility ${project.status}.`);
    }
  }
  const compile = projectById.get('compile');
  if (compile && declarationById.get('compile')?.status === 'eligible') {
    const expected = project.nativeEligibility.eligible ? 'eligible' : 'blocked';
    if (compile.status !== expected) throw new TypeError(`Target support project command compile must be ${expected} for the native eligibility projection.`);
  }
  for (const id of ['inspect', 'doctor']) {
    const declared = declarationById.get(id);
    const effective = projectById.get(id);
    if (declared && declared.status === 'eligible' && effective.status !== 'eligible') {
      throw new TypeError(`Target support project command ${id} must remain eligible when deterministic evidence was produced.`);
    }
  }
}

function normalizeLoaderObservation(input) {
  if (input == null) return null;
  if (!isPlainObject(input)) throw new TypeError('Target support evidence loader must be an object or null.');
  assertKnownKeys(input, ['version', 'attempted', 'loaded', 'modulesLoaded', 'packagesLoaded', 'errorCode', 'skippedReason'], 'target support evidence loader');
  const attempted = input.attempted === true;
  const loaded = input.loaded === true;
  const modulesLoaded = nonNegativeInteger(input.modulesLoaded, 'target support evidence loader.modulesLoaded');
  const packagesLoaded = sortedUniqueStrings(input.packagesLoaded || [], 'target support evidence loader.packagesLoaded');
  const errorCode = optionalString(input.errorCode, 'target support evidence loader.errorCode');
  const skippedReason = optionalString(input.skippedReason, 'target support evidence loader.skippedReason');
  if (loaded && !attempted) throw new TypeError('A loaded JavaScript application must record that loading was attempted.');
  if (loaded && !input.version) throw new TypeError('A loaded JavaScript application must record the loader version.');
  if (errorCode && (!attempted || loaded)) throw new TypeError('A JavaScript application load error requires an unsuccessful load attempt.');
  if (attempted && !loaded && !errorCode) throw new TypeError('An unsuccessful JavaScript application load attempt must record an errorCode.');
  if (!attempted && (loaded || modulesLoaded !== 0 || packagesLoaded.length !== 0 || errorCode)) {
    throw new TypeError('JavaScript application loader counts and errors must be empty when loading was not attempted.');
  }
  if (!attempted && !skippedReason) throw new TypeError('A skipped JavaScript application load must include skippedReason.');
  if (attempted && skippedReason) throw new TypeError('An attempted JavaScript application load cannot include skippedReason.');
  return deepFreeze({
    version: optionalString(input.version, 'target support evidence loader.version'),
    status: loaded ? 'passed' : attempted ? 'failed' : 'skipped',
    attempted,
    loaded,
    modulesLoaded,
    packagesLoaded,
    errorCode,
    skippedReason
  });
}

function assertDeclarationIntegrity(declaration) {
  const { declarationHash, ...semantic } = declaration;
  if (declarationHash !== sha256Hex(stableStringify(semantic))) {
    throw new TypeError('Target support declaration hash does not match its normalized content.');
  }
}

function normalizeTargetSupportEvidence(input) {
  if (!isPlainObject(input)) throw new TypeError('Target support evidence input must be an object.');
  assertKnownKeys(input, ['declaration', 'descriptor', 'project', 'loader'], 'target support evidence');
  const declaration = input.declaration;
  if (!declaration || declaration.version !== TARGET_SUPPORT_DECLARATION_VERSION || declaration.kind !== TARGET_SUPPORT_DECLARATION_KIND) {
    throw new TypeError('Target support evidence requires a normalized target support declaration.');
  }
  assertDeclarationIntegrity(declaration);
  if (!isPlainObject(input.descriptor)) throw new TypeError('Target support evidence descriptor must be an object.');
  assertKnownKeys(input.descriptor, ['version', 'status', 'commands', 'descriptorHash'], 'target support evidence descriptor');
  const descriptorCommands = input.descriptor.commands || {};
  if (!isPlainObject(descriptorCommands)) throw new TypeError('Target support evidence descriptor.commands must be an object.');
  const normalizedDescriptorCommands = deepFreeze(Object.fromEntries(Object.keys(descriptorCommands).sort().map((key) => [key, descriptorCommands[key] === true])));
  const declarationCommandIds = declaration.commands.map((entry) => entry.id).sort();
  if (stableStringify(Object.keys(normalizedDescriptorCommands)) !== stableStringify(declarationCommandIds)) {
    throw new TypeError('Target support descriptor commands must cover the declaration command matrix exactly.');
  }
  for (const command of declaration.commands) {
    if (normalizedDescriptorCommands[command.id] !== command.implemented) {
      throw new TypeError(`Target support descriptor command ${command.id} implementation truth diverges from the declaration.`);
    }
  }
  const project = normalizeProjectEligibility(input.project);
  assertProjectCommandsAlign(declaration, project);
  const loader = normalizeLoaderObservation(input.loader);

  const semantic = {
    version: TARGET_SUPPORT_EVIDENCE_VERSION,
    kind: TARGET_SUPPORT_KIND,
    provider: declaration.provider,
    target: declaration.target,
    targetId: declaration.targetId,
    runtimeClass: declaration.runtimeClass,
    availability: declaration.availability,
    commands: declaration.commands,
    descriptor: deepFreeze({
      version: nonEmptyString(input.descriptor.version, 'target support evidence descriptor.version'),
      status: nonEmptyString(input.descriptor.status, 'target support evidence descriptor.status'),
      commands: normalizedDescriptorCommands,
      descriptorHash: nonEmptyString(input.descriptor.descriptorHash, 'target support evidence descriptor.descriptorHash')
    }),
    project,
    provenance: deepFreeze({
      declarationVersion: declaration.version,
      declarationHash: declaration.declarationHash,
      parity: declaration.parity,
      selectedProvider: declaration.provider,
      selectedTarget: declaration.target,
      targetId: declaration.targetId,
      sourceHash: project.sourceHash,
      graphHash: project.graphHash,
      applicationPlanHash: project.applicationPlanHash,
      packageProjectionHash: project.packageProjectionHash,
      packageProductHash: project.packageProductHash,
      nativeEligibilityVersion: project.nativeEligibility.version,
      nativeEligibilityProjectionHash: project.nativeEligibility.projectionHash,
      nativeEligibilityEligible: project.nativeEligibility.eligible,
      automaticFallback: false
    }),
    policy: deepFreeze({
      fullTargetSupportDefinesGeneralAvailability: declaration.availability.definition === 'full-target-support',
      coreExecutionReadinessDoesNotImplyGeneralAvailability: true,
      projectEligibilityDoesNotChangeSelectedTarget: true,
      compileRemainsProviderNeutral: true,
      staticEligibilityIndependentOfLoaderObservation: true,
      failClosedOnUnknownCapabilityOrPackage: true,
      automaticFallback: false
    })
  };
  const evidenceHash = sha256Hex(stableStringify(semantic));
  const observation = deepFreeze({
    version: TARGET_SUPPORT_OBSERVATION_VERSION,
    evidenceHash,
    loader
  });
  return deepFreeze({
    ...semantic,
    evidenceHash,
    loader,
    observationHash: sha256Hex(stableStringify(observation))
  });
}

module.exports = Object.freeze({
  TARGET_SUPPORT_DECLARATION_VERSION,
  TARGET_AVAILABILITY_POLICY_VERSION,
  TARGET_SUPPORT_EVIDENCE_VERSION,
  TARGET_SUPPORT_OBSERVATION_VERSION,
  TARGET_SUPPORT_KIND,
  TARGET_SUPPORT_DECLARATION_KIND,
  SUPPORT_STATUSES,
  GATE_STATUSES,
  AVAILABILITY_DEFINITIONS,
  normalizeTargetSupportDeclaration,
  normalizeTargetSupportEvidence
});
