'use strict';

const path = require('node:path');
const {
  projectJson,
  resolveProject
} = require('../project-config.js');
const { normalizeCommandRequest } = require('./command-request.js');

const INVOCATION_OVERRIDE_KEYS = Object.freeze([
  'directory', 'profile', 'outDir', 'host', 'port', 'watch'
]);
const PROJECT_CONTEXT_DATA = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function commandRequiresProjectContext(value) {
  const request = normalizeCommandRequest(value);
  if (request.kind !== 'command' || request.help || request.command === 'init') return false;
  if (request.command === 'inspect' && request.artifact) return false;
  return true;
}

function selectedProfileDocument(project) {
  const profile = project.selectedProfile || project.profile;
  if (!profile || typeof profile !== 'object') return null;
  return deepFreeze({
    name: String(profile.name),
    source: String(profile.source),
    host: String(profile.host),
    target: String(profile.target),
    reporting: String(profile.reporting),
    reportingLevel: Number(project.reportingLevel)
  });
}

function workspaceDocument(project) {
  if (!project.workspace) return null;
  return deepFreeze({
    version: project.workspace.version,
    kind: project.workspace.kind,
    root: project.workspace.root,
    configFile: project.workspace.configFile,
    source: project.workspace.source,
    boundary: project.workspace.boundary,
    configInsideWorkspace: project.workspace.configInsideWorkspace !== false
  });
}

function projectPlanDocument(project, profile) {
  const plan = project.profilePlan;
  if (!plan) return null;
  // Fragment values can contain development fixtures and resolved local secret
  // values. The command boundary records only ownership keys and symbolic names.
  return deepFreeze({
    version: plan.version,
    projectVersion: plan.projectVersion,
    pulse: {
      entry: plan.pulse.entry,
      schema: plan.pulse.schema,
      tests: plan.pulse.tests,
      defaultProfile: plan.pulse.defaultProfile,
      strict: plan.pulse.strict !== false,
      reporting: plan.pulse.reporting
    },
    profile,
    bindings: {
      config: [...(project.bindings && project.bindings.config || [])],
      secret: [...(project.bindings && project.bindings.secret || [])]
    },
    fragmentKeys: Object.keys(project.fragments || {}).sort()
  });
}

function invocationOverrideDocument(request) {
  const overrides = {};
  for (const key of INVOCATION_OVERRIDE_KEYS) {
    if (request[key] !== undefined) overrides[key] = request[key];
  }
  return deepFreeze(overrides);
}

function createProjectContext(requestValue, project, options = {}) {
  const request = normalizeCommandRequest(requestValue);
  if (request.kind !== 'command') throw new TypeError('ProjectContext requires a command request');
  if (!project || typeof project !== 'object') throw new TypeError('ProjectContext requires a resolved Pulse project');
  const profile = selectedProfileDocument(project);
  const projectDocument = projectJson(project);
  const context = deepFreeze({
    cwd: path.resolve(options.cwd || process.cwd()),
    workspace: projectDocument.workspace || workspaceDocument(project),
    configFile: projectDocument.configFile || null,
    selectedProfile: profile,
    selectionSource: profile ? profile.source : null,
    projectPlan: projectPlanDocument(project, profile),
    projectHash: projectDocument.projectHash || null,
    planHash: projectDocument.planHash || null,
    entryFile: projectDocument.entryFile,
    schemaFile: project.schemaFile || null,
    testsFile: project.testsFile || null,
    target: projectDocument.target || 'native',
    reporting: projectDocument.reporting,
    reportingLevel: projectDocument.reportingLevel,
    provider: projectDocument.provider,
    outDir: projectDocument.outDir,
    invocationOverrides: invocationOverrideDocument(request)
  });
  PROJECT_CONTEXT_DATA.set(context, Object.freeze({ request, project, projectDocument }));
  return context;
}

function resolveProjectContext(requestValue, options = {}) {
  const request = normalizeCommandRequest(requestValue);
  if (!commandRequiresProjectContext(request)) {
    const name = request.kind === 'command' ? request.command : request.invocation;
    throw new TypeError(`Pulse ${name} does not use a project context`);
  }
  const cwd = path.resolve(options.cwd || process.cwd());
  const project = resolveProject({
    cwd,
    directory: request.directory,
    profile: request.profile,
    env: options.environment || options.env || process.env,
    outDir: request.outDir,
    host: request.host,
    port: request.port,
    watch: request.watch
  });
  return createProjectContext(request, project, { cwd });
}

function contextData(context) {
  const data = PROJECT_CONTEXT_DATA.get(context);
  if (!data || !context) {
    throw new TypeError('ProjectContext was not created by the authoritative resolver');
  }
  return data;
}

function isProjectContext(value) {
  return Boolean(value && PROJECT_CONTEXT_DATA.has(value));
}

function resolvedProjectForContext(context) {
  return contextData(context).project;
}

function requestForContext(context) {
  return contextData(context).request;
}

function projectDocumentForContext(context) {
  return contextData(context).projectDocument;
}

function projectContextDocument(context) {
  contextData(context);
  return context;
}

module.exports = deepFreeze({
  INVOCATION_OVERRIDE_KEYS,
  commandRequiresProjectContext,
  createProjectContext,
  resolveProjectContext,
  isProjectContext,
  resolvedProjectForContext,
  requestForContext,
  projectDocumentForContext,
  projectContextDocument
});
