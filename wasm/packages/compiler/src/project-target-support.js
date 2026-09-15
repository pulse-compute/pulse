'use strict';

const {
  normalizeTargetSupportEvidence
} = require('@pulse-compute/wasm-contracts/project/target-support-evidence');
const { sha256Hex, stableStringify } = require('@pulse-compute/wasm-contracts/stable-id');
const { requirementsFromMetadata } = require('@pulse-compute/wasm-contracts/provider/canonical-provider');

const EVENT_TARGET_SUPPORT_VERSION = 'pulse.event-target-support.v1';

function decision(id, status, reasonId, owner, required = true) {
  return Object.freeze({ id, status, required, reasonId, owner });
}

function sourceRecords(values) {
  const unique = new Map();
  for (const source of values || []) {
    if (!source || !source.file) continue;
    const normalized = Object.freeze({
      file: String(source.file),
      line: Number.isInteger(source.line) && source.line > 0 ? source.line : 1,
      column: Number.isInteger(source.column) && source.column > 0 ? source.column : 1
    });
    unique.set(`${normalized.file}:${normalized.line}:${normalized.column}`, normalized);
  }
  return Object.freeze([...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column));
}

function sourcesForPackage(reachable, planned) {
  return sourceRecords([
    ...((planned && planned.sources) || []),
    ...((reachable && reachable.importSources) || []),
    ...((reachable && reachable.reExportSources) || [])
  ]);
}

function pendingPackageOwner(product) {
  if (product && product.contractId === 'pulse.assets') return 'assets';
  if (product && product.contractId === 'pulse.grip') return 'grip';
  return 'compiler';
}

function productContext(compiled) {
  const product = compiled.packageProduct || {};
  const contracts = product.contracts || [];
  const byName = new Map(contracts.map((entry) => [entry.packageName, entry]));
  const byId = new Map(contracts.map((entry) => [entry.contractId, entry]));
  const selected = new Set([
    ...((compiled.packageReachability && compiled.packageReachability.selectedContracts) || []),
    ...(product.selectedContracts || []),
    ...(product.composedContracts || [])
  ]);
  const configured = new Set((product.fragments || [])
    .filter((entry) => entry.present && entry.contractId)
    .map((entry) => entry.contractId));
  return Object.freeze({ product, byName, byId, selected, configured });
}

function packageCommon(reachable, planned, product, context) {
  const reachableRecord = Boolean(reachable || planned);
  const runtime = Boolean(reachable && reachable.runtime === true) || Boolean(planned);
  const contractId = reachable && reachable.contractId || planned && planned.contractId || product && product.contractId || null;
  const selected = Boolean(contractId && context.selected.has(contractId));
  const configured = Boolean(contractId && context.configured.has(contractId));
  return {
    moduleId: reachable && reachable.moduleId || planned && planned.moduleId || `contract:${contractId || product && product.packageName || 'unknown'}`,
    packageName: reachable && reachable.packageName || planned && planned.packageName || product && product.packageName,
    packageSubpath: reachable && reachable.packageSubpath || planned && planned.packageSubpath || '.',
    contractId,
    reachable: reachableRecord,
    runtime,
    selected,
    configured,
    required: runtime || selected || configured,
    reasonCode: planned && planned.reasonCode || product && product.javascriptTarget && product.javascriptTarget.reasonCode || null,
    realization: planned && planned.status || product && product.javascriptTarget && product.javascriptTarget.realization || null,
    targetStatus: product && product.javascriptTarget && product.javascriptTarget.status || null,
    runtimeEntry: planned && planned.runtimeEntry || product && product.javascriptTarget && product.javascriptTarget.entry || null,
    sources: sourcesForPackage(reachable, planned)
  };
}

function classifyPackage(reachable, planned, product, context, options = {}) {
  const common = packageCommon(reachable, planned, product, context);
  if (!common.required) {
    return Object.freeze({
      ...common,
      status: 'irrelevant',
      reasonId: common.reachable ? 'type-only-or-nonparticipating-package' : 'package-contract-not-selected',
      owner: common.reachable ? 'reachable-graph' : 'package-product'
    });
  }

  const targetStatus = product && product.javascriptTarget && product.javascriptTarget.status;
  if (targetStatus === 'not-realized'
    || (targetStatus === 'provider-dependent' && (!planned || planned.status !== 'package-runtime'))) {
    return Object.freeze({ ...common, status: 'pending', reasonId: 'package-javascript-realization-pending', owner: pendingPackageOwner(product) });
  }
  if (targetStatus === 'unsupported') {
    return Object.freeze({ ...common, status: 'blocked', reasonId: 'package-javascript-target-unsupported', owner: product.contractId });
  }

  if (!planned) {
    if (common.runtime) {
      return Object.freeze({ ...common, status: 'blocked', reasonId: 'runtime-package-missing-from-javascript-plan', owner: 'compiler' });
    }
    if (product && targetStatus === 'supported') {
      return Object.freeze({ ...common, status: 'eligible', reasonId: 'selected-package-javascript-target-supported', owner: product.contractId });
    }
    return Object.freeze({ ...common, status: 'blocked', reasonId: 'selected-package-realization-unclassified', owner: product && product.contractId || 'compiler' });
  }
  if (planned.status === 'supplied-core') {
    return Object.freeze({
      ...common,
      status: 'eligible',
      reasonId: 'core-javascript-package-supplied',
      owner: options.suppliedCoreOwner || 'provider-node'
    });
  }
  if (planned.status === 'node-require') {
    return Object.freeze({
      ...common,
      status: 'eligible',
      reasonId: options.packageResolutionReasonId || 'node-package-resolution-planned',
      owner: product && product.contractId || options.packageResolutionOwner || 'provider-node'
    });
  }
  if (planned.status === 'package-runtime') {
    if (!planned.runtimeEntry) {
      return Object.freeze({ ...common, status: 'blocked', reasonId: 'package-javascript-runtime-entry-missing', owner: product && product.contractId || 'compiler' });
    }
    return Object.freeze({
      ...common,
      status: 'eligible',
      reasonId: 'package-javascript-runtime-planned',
      owner: product && product.contractId || options.packageRuntimeOwner || 'provider-node'
    });
  }
  if (planned.status === 'unavailable') {
    return Object.freeze({ ...common, status: 'blocked', reasonId: 'package-javascript-realization-unclassified', owner: product && product.contractId || 'compiler' });
  }
  return Object.freeze({ ...common, status: 'blocked', reasonId: 'package-javascript-plan-status-unknown', owner: 'compiler' });
}

function packageEligibility(compiled, javascriptApplication, options = {}) {
  const context = productContext(compiled);
  const reachablePackages = compiled.packageReachability && compiled.packageReachability.packages || [];
  const plannedPackages = javascriptApplication.plan.packages || [];
  const plannedByModule = new Map(plannedPackages.map((entry) => [entry.moduleId, entry]));
  const coveredModules = new Set();
  const coveredContracts = new Set();
  const records = [];

  for (const reachable of reachablePackages) {
    const planned = plannedByModule.get(reachable.moduleId) || null;
    const product = context.byName.get(reachable.packageName) || (reachable.contractId && context.byId.get(reachable.contractId)) || null;
    records.push(classifyPackage(reachable, planned, product, context, options));
    coveredModules.add(reachable.moduleId);
    if (product) coveredContracts.add(product.contractId);
  }

  for (const planned of plannedPackages) {
    if (coveredModules.has(planned.moduleId)) continue;
    const product = context.byName.get(planned.packageName) || (planned.contractId && context.byId.get(planned.contractId)) || null;
    records.push(classifyPackage(null, planned, product, context, options));
    if (product) coveredContracts.add(product.contractId);
  }

  for (const product of context.product.contracts || []) {
    if (coveredContracts.has(product.contractId)) continue;
    records.push(classifyPackage(null, null, product, context, options));
  }

  return Object.freeze(records.sort((a, b) => a.packageName.localeCompare(b.packageName) || a.packageSubpath.localeCompare(b.packageSubpath) || a.moduleId.localeCompare(b.moduleId)));
}

function applicationPlanDecision(javascriptApplication, packages) {
  const requiredPackages = packages.filter((entry) => entry.required);
  if (javascriptApplication.plan.loadable === true) {
    return decision('application.plan', 'eligible', 'javascript-application-plan-loadable', 'compiler');
  }
  const blockers = javascriptApplication.plan.blockers || [];
  const packageOnlyBlockers = blockers.length > 0 && blockers.every((entry) => entry.kind === 'javascript-package-realization-unavailable');
  if (packageOnlyBlockers) {
    if (requiredPackages.some((entry) => entry.status === 'blocked')) {
      return decision('application.plan', 'blocked', 'javascript-application-package-blocked', 'compiler');
    }
    if (requiredPackages.some((entry) => entry.status === 'pending')) {
      return decision('application.plan', 'pending', 'javascript-application-packages-pending', 'compiler');
    }
  }
  return decision('application.plan', 'blocked', 'javascript-application-plan-blocked', 'project');
}

function entrySafetyDecision(javascriptApplication) {
  const entrySafety = javascriptApplication.plan.entrySafety;
  return entrySafety && entrySafety.importSafe === false
    ? decision('application.entry-safety', 'blocked', 'application-entry-lifecycle-side-effect', 'project')
    : decision('application.entry-safety', 'eligible', 'application-entry-import-safe', 'reachable-graph');
}

function expectedProjectStatus(application, capabilities, providerRequirements, packages) {
  const required = [
    ...application.filter((entry) => entry.required),
    ...capabilities.filter((entry) => entry.required),
    ...providerRequirements.filter((entry) => entry.required),
    ...packages.filter((entry) => entry.required)
  ];
  if (required.some((entry) => entry.status === 'blocked')) return 'blocked';
  if (required.some((entry) => entry.status === 'pending')) return 'pending';
  return 'eligible';
}

function reasonIdsFor(application, capabilities, providerRequirements, packages) {
  return Object.freeze([...new Set([
    ...application.filter((entry) => entry.required && entry.status !== 'eligible'),
    ...capabilities.filter((entry) => entry.required && entry.status !== 'eligible'),
    ...providerRequirements.filter((entry) => entry.required && entry.status !== 'eligible'),
    ...packages.filter((entry) => entry.required && entry.status !== 'eligible')
  ].map((entry) => entry.reasonId))].sort());
}

function assertDescriptorTruth(descriptor, declaration) {
  if (descriptor.targetId !== declaration.targetId || descriptor.provider !== declaration.provider || descriptor.target !== declaration.target) {
    throw new TypeError('JavaScript target descriptor and support declaration identify different targets.');
  }
  for (const command of declaration.commands) {
    const implemented = Boolean(descriptor.commands && descriptor.commands[command.id]);
    if (implemented !== command.implemented) throw new TypeError(`JavaScript command truth diverged for ${command.id}.`);
  }
}

function decisionSortKey(entry) {
  return entry.id || `package:${entry.packageName}:${entry.packageSubpath}:${entry.moduleId}`;
}

function firstDecisionAtStatus(status, application, capabilities, providerRequirements, packages) {
  return [...application, ...capabilities, ...providerRequirements, ...packages]
    .filter((entry) => entry.required && entry.status === status)
    .sort((a, b) => decisionSortKey(a).localeCompare(decisionSortKey(b)))[0] || null;
}

function projectCommands(declaration, status, nativeEligibility, application, capabilities, providerRequirements, packages, options = {}) {
  const projectDecision = firstDecisionAtStatus(status, application, capabilities, providerRequirements, packages);
  return Object.freeze(declaration.commands.map((command) => {
    if (command.status !== 'eligible') return command;
    if (command.id === 'test' || command.id === 'dev') {
      return Object.freeze({
        id: command.id,
        implemented: true,
        status,
        reasonId: status === 'eligible' ? command.reasonId : projectDecision.reasonId,
        owner: status === 'eligible' ? command.owner : projectDecision.owner
      });
    }
    if (command.id === 'build' && options.projectScopedBuild === true && status !== 'eligible') {
      return Object.freeze({
        id: command.id,
        implemented: true,
        status,
        reasonId: projectDecision.reasonId,
        owner: projectDecision.owner
      });
    }
    if (command.id === 'compile' && nativeEligibility.eligible !== true) {
      return Object.freeze({
        id: command.id,
        implemented: true,
        status: 'blocked',
        reasonId: 'native-eligibility-blocked',
        owner: 'native-eligibility'
      });
    }
    return command;
  }));
}

function loaderObservation(javascriptApplication) {
  if (javascriptApplication.loaded) {
    return Object.freeze({
      version: javascriptApplication.loaded.version,
      attempted: true,
      loaded: true,
      modulesLoaded: javascriptApplication.loaded.modulesLoaded,
      packagesLoaded: javascriptApplication.loaded.packagesLoaded,
      errorCode: null,
      skippedReason: null
    });
  }
  return Object.freeze({
    version: null,
    attempted: javascriptApplication.loadAttempted === true,
    loaded: false,
    modulesLoaded: 0,
    packagesLoaded: [],
    errorCode: javascriptApplication.loadError && javascriptApplication.loadError.code
      || (javascriptApplication.loadAttempted === true ? 'PULSE_JAVASCRIPT_APPLICATION_LOAD_FAILED' : null),
    skippedReason: javascriptApplication.loadAttempted === true
      ? null
      : javascriptApplication.loadSkippedReason || 'application-load-not-requested'
  });
}

function buildJavascriptTargetSupportEvidence(project, options = {}, policy = {}) {
  const compiled = options.compiled;
  const javascriptApplication = options.javascriptApplication;
  const descriptor = options.descriptor || javascriptApplication && javascriptApplication.descriptor;
  const declaration = options.declaration || policy.declaration;
  const providerId = policy.providerId || declaration && declaration.provider;
  const label = providerId ? `${providerId} JavaScript` : 'JavaScript';
  if (!compiled || !compiled.metadata) throw new TypeError(`${label} target support evidence requires compiled project metadata.`);
  if (!compiled.nativeEligibility) throw new TypeError(`${label} target support evidence requires the native eligibility projection.`);
  if (!javascriptApplication || !javascriptApplication.plan) throw new TypeError(`${label} target support evidence requires a JavaScript application plan.`);
  if (!descriptor) throw new TypeError(`${label} target support evidence requires the selected target descriptor.`);
  if (!declaration) throw new TypeError(`${label} target support evidence requires a support declaration.`);
  if (typeof policy.classifyCapability !== 'function' || typeof policy.classifyProviderRequirement !== 'function') {
    throw new TypeError(`${label} target support evidence requires provider-owned classification policy.`);
  }
  if (project.provider !== providerId || (project.target || 'native') !== 'javascript') {
    throw new TypeError(`${label} target support evidence requires a ${providerId}/javascript project selection.`);
  }

  assertDescriptorTruth(descriptor, declaration);
  const context = typeof policy.context === 'function'
    ? policy.context(compiled, project, declaration)
    : Object.freeze({});
  const compilerCapabilities = Object.freeze([...(compiled.metadata.capabilities || [])].map(String).sort());
  let packages = packageEligibility(compiled, javascriptApplication, policy.packageOptions || {});
  if (typeof policy.adjustPackages === 'function') {
    packages = Object.freeze(policy.adjustPackages(packages, context, compiled, project));
  }
  const application = Object.freeze([
    entrySafetyDecision(javascriptApplication),
    applicationPlanDecision(javascriptApplication, packages)
  ].sort((a, b) => a.id.localeCompare(b.id)));
  const capabilities = Object.freeze(compilerCapabilities
    .map((id) => policy.classifyCapability(id, context))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const requiredContracts = new Set(packages.filter((entry) => entry.required).map((entry) => entry.contractId));
  const packageRequirements = (compiled.packageProduct && compiled.packageProduct.contracts || [])
    .filter((entry) => requiredContracts.has(entry.contractId) && entry.javascriptTarget
      && entry.javascriptTarget.status === 'provider-dependent')
    .flatMap((entry) => entry.javascriptTarget.providerRequirements || []);
  const providerRequirements = Object.freeze([...new Set([
    ...requirementsFromMetadata(compiled.metadata), ...packageRequirements
  ])]
    .map((id) => policy.classifyProviderRequirement(id, compilerCapabilities, context))
    .sort((a, b) => a.id.localeCompare(b.id)));
  const status = expectedProjectStatus(application, capabilities, providerRequirements, packages);
  const reasonIds = reasonIdsFor(application, capabilities, providerRequirements, packages);
  const commands = projectCommands(
    declaration,
    status,
    compiled.nativeEligibility,
    application,
    capabilities,
    providerRequirements,
    packages,
    policy.commandOptions || {}
  );

  return normalizeTargetSupportEvidence({
    declaration,
    descriptor: {
      version: descriptor.version || 'pulse.javascript-target-descriptor.v2',
      status: descriptor.status,
      commands: descriptor.commands,
      descriptorHash: sha256Hex(stableStringify(descriptor))
    },
    project: {
      status,
      reasonIds,
      projectHash: project.projectHash || null,
      configPlanHash: project.planHash || null,
      sourceHash: compiled.metadata.sourceHash,
      graphHash: javascriptApplication.plan.graph.graphHash,
      applicationPlanHash: javascriptApplication.plan.planHash,
      packageProjectionHash: compiled.packageReachability && compiled.packageReachability.projectionHash || null,
      packageProductHash: compiled.packageProduct && compiled.packageProduct.projectionHash || null,
      nativeEligibility: compiled.nativeEligibility,
      commands,
      application,
      capabilities,
      providerRequirements,
      packages
    },
    loader: loaderObservation(javascriptApplication)
  });
}

function eventRequirements(compiled) {
  const requirements = new Set();
  const catalog = compiled && (compiled.eventCatalog || compiled.metadata && compiled.metadata.events && compiled.metadata.events.catalog);
  for (const event of catalog && Array.isArray(catalog.events) ? catalog.events : []) {
    for (const requirement of event.hostRequirements || []) requirements.add(String(requirement));
  }
  const outbound = compiled && compiled.eventOutboundRequirements;
  for (const requirement of outbound && outbound.hostRequirements || []) requirements.add(String(requirement));
  for (const capability of compiled && compiled.metadata && compiled.metadata.capabilities || []) {
    if (capability === 'event.emit') requirements.add('event.emit');
  }
  const order = new Map([['event.ingress', 0], ['event.emit', 1]]);
  return Object.freeze([...requirements].sort((left, right) => (order.get(left) ?? 99) - (order.get(right) ?? 99) || left.localeCompare(right)));
}

function descriptorEventCapabilities(descriptor) {
  const supported = new Set();
  const capabilities = descriptor && descriptor.capabilities;
  if (Array.isArray(capabilities)) {
    for (const capability of capabilities) {
      if (capability === 'event.ingress' || capability === 'event.emit') supported.add(capability);
    }
  } else if (capabilities && typeof capabilities === 'object') {
    if (capabilities.events && capabilities.events.ingress === true) supported.add('event.ingress');
    if (capabilities.events && capabilities.events.emit === true) supported.add('event.emit');
    if (capabilities.core && capabilities.core.eventIngress === true) supported.add('event.ingress');
    if (capabilities.effects && capabilities.effects.eventEmit === true) supported.add('event.emit');
  }
  return Object.freeze([...supported].sort());
}

function eventRequirementDecision(provider, requirement, supported, inspectionOnly) {
  const operation = requirement === 'event.ingress' ? 'ingress' : 'emit';
  if (inspectionOnly) {
    return Object.freeze({
      id: requirement,
      status: 'inspection-only',
      reasonId: 'compile-only-event-inspection',
      owner: 'compiler'
    });
  }
  if (supported) {
    return Object.freeze({
      id: requirement,
      status: 'eligible',
      reasonId: `${provider}-event-${operation}-supported`,
      owner: `provider-${provider}`
    });
  }
  return Object.freeze({
    id: requirement,
    status: 'blocked',
    reasonId: `${provider}-event-${operation}-unavailable`,
    owner: `provider-${provider}`
  });
}

function eventDiagnosticCode(provider, blocked) {
  if (!blocked) return null;
  if (provider === 'fastly' && blocked.id === 'event.ingress') return 'PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED';
  if (provider === 'fastly' && blocked.id === 'event.emit') return 'PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED';
  return 'PULSE_EVENT_TARGET_UNSUPPORTED';
}

function eventCommand(id, status, reasonId, owner) {
  return Object.freeze({ id, status, reasonId, owner });
}

function buildEventTargetSupportEvidence(compiled, options = {}) {
  const requirements = eventRequirements(compiled);
  const reachable = Boolean(compiled && (compiled.eventTopology || compiled.metadata && compiled.metadata.events));
  if (!reachable) return null;
  const provider = String(options.provider || 'none');
  const target = String(options.target || 'native');
  const descriptor = options.descriptor || {};
  const targetId = String(descriptor.targetId || descriptor.id || `${provider}-${target}`);
  const inspectionOnly = provider === 'none';
  const supportedCapabilities = descriptorEventCapabilities(descriptor);
  const supported = new Set(supportedCapabilities);
  const decisions = Object.freeze(requirements.map((requirement) => (
    eventRequirementDecision(provider, requirement, supported.has(requirement), inspectionOnly)
  )));
  const blocked = decisions.find((entry) => entry.status === 'blocked') || null;
  const status = inspectionOnly ? 'inspection-only' : (blocked ? 'blocked' : 'eligible');
  const eventTestTargets = new Set(options.eventTestTargets || []);
  const commands = Object.freeze([
    eventCommand('build', status === 'eligible' && descriptor.commands && descriptor.commands.build === true ? 'eligible' : 'blocked', status === 'eligible' ? 'event-build-supported' : (blocked && blocked.reasonId || 'compile-only-event-inspection'), status === 'eligible' ? `provider-${provider}` : (blocked && blocked.owner || 'compiler')),
    eventCommand('compile', 'eligible', 'provider-neutral-event-inspection', 'compiler'),
    eventCommand('dev', descriptor.commands && descriptor.commands.dev === true ? 'http-only' : 'blocked', 'event-dev-ingress-unavailable', `provider-${provider}`),
    eventCommand('doctor', 'eligible', 'event-eligibility-inspection', 'cli'),
    eventCommand('inspect', 'eligible', 'event-catalog-inspection', 'cli'),
    eventCommand('test', status === 'eligible' && descriptor.commands && descriptor.commands.test === true && eventTestTargets.has(target) ? 'eligible' : 'blocked', status === 'eligible' && eventTestTargets.has(target) ? 'event-test-harness-supported' : (blocked && blocked.reasonId || 'event-test-harness-unavailable'), status === 'eligible' && eventTestTargets.has(target) ? `provider-${provider}` : (blocked && blocked.owner || `provider-${provider}`))
  ].sort((left, right) => left.id.localeCompare(right.id)));
  const document = Object.freeze({
    version: EVENT_TARGET_SUPPORT_VERSION,
    provider,
    target,
    targetId,
    status,
    eligible: status === 'eligible',
    inspectionOnly,
    automaticFallback: false,
    requirements: decisions,
    supportedCapabilities,
    reasonIds: Object.freeze([...new Set(decisions
      .filter((entry) => entry.status !== 'eligible')
      .map((entry) => entry.reasonId))].sort()),
    diagnosticCode: eventDiagnosticCode(provider, blocked),
    commands
  });
  return Object.freeze({ ...document, evidenceHash: sha256Hex(stableStringify(document)) });
}

module.exports = Object.freeze({
  EVENT_TARGET_SUPPORT_VERSION,
  buildJavascriptTargetSupportEvidence,
  buildEventTargetSupportEvidence
});
