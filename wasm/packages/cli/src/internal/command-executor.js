'use strict';

const fs = require('node:fs');
const { PulseProjectError } = require('../project-config.js');
const {
  compileNativeProject,
  buildProject,
  runProjectTests,
  inspectProject,
  doctorProject,
  startDevServer,
  initProject,
  errorSummary
} = require('../project-execution.js');
const { normalizeCommandRequest } = require('./command-request.js');
const { isCommandPlan } = require('./command-plan.js');
const { resolvedProjectForContext, isProjectContext } = require('./project-context.js');

const EXECUTOR_IDS = Object.freeze(['meta', 'init', 'artifact', 'compile', 'build', 'test', 'inspect', 'doctor', 'dev']);

const defaultOperations = Object.freeze({
  compileNativeProject,
  buildProject,
  runProjectTests,
  inspectProject,
  doctorProject,
  startDevServer,
  initProject
});

function selectOperations(overrides) {
  if (!overrides) return defaultOperations;
  const selected = {};
  for (const [name, operation] of Object.entries(defaultOperations)) {
    selected[name] = typeof overrides[name] === 'function' ? overrides[name] : operation;
  }
  return Object.freeze(selected);
}

function inspectArtifact(file) {
  if (!fs.existsSync(file)) {
    throw new PulseProjectError('PULSE_INSPECT_TARGET_MISSING', `Inspect target does not exist: ${file}`, { file });
  }
  return Object.freeze({ status: 'ok', file, value: JSON.parse(fs.readFileSync(file, 'utf8')) });
}

function projectForExecution(plan, projectContext) {
  if (plan.mode !== 'project') return undefined;
  if (!isProjectContext(projectContext)) {
    throw new TypeError(`Pulse ${plan.command} project execution requires the authoritative ProjectContext`);
  }
  return resolvedProjectForContext(projectContext);
}

async function executeDev(project, request, operations, options = {}) {
  let eventCount = 0;
  let lastEvent;
  const onEvent = (event) => {
    eventCount += 1;
    lastEvent = event;
    if (typeof options.onEvent === 'function') options.onEvent(event);
  };
  const running = await operations.startDevServer(project, {
    host: request.host,
    port: request.port,
    watch: request.watch,
    once: request.once,
    onEvent
  });
  const signalSource = options.signalSource || process;
  const close = () => {
    if (!running.server.listening) return;
    running.server.close();
    if (typeof running.server.closeIdleConnections === 'function') running.server.closeIdleConnections();
  };
  signalSource.once('SIGINT', close);
  signalSource.once('SIGTERM', close);
  try {
    await running.closed;
  } finally {
    signalSource.removeListener('SIGINT', close);
    signalSource.removeListener('SIGTERM', close);
  }
  return { status: 0, result: { status: 'closed', ready: running.ready, eventCount, lastEvent } };
}

async function executeCommandPlan(plan, requestValue, options = {}) {
  if (!isCommandPlan(plan)) throw new TypeError('Command execution requires a command plan');
  const request = normalizeCommandRequest(requestValue);
  const operations = selectOperations(options.operations);
  const cliVersion = String(options.cliVersion || require('../../package.json').version);

  if (request.kind === 'meta' || request.help) {
    const invocation = request.kind === 'meta' ? request.invocation : 'help';
    if (invocation === 'help') return { status: 0, help: true };
    if (invocation === 'version') return { status: 0, version: cliVersion };
    return { status: 0, completion: request.shell };
  }
  if (request.command === 'init') {
    return { status: 0, result: operations.initProject(plan.target, { name: request.name, force: request.force }) };
  }
  if (plan.mode === 'artifact') return { status: 0, result: inspectArtifact(plan.artifact) };

  const project = projectForExecution(plan, options.projectContext);
  if (request.command === 'compile') {
    return {
      status: 0,
      result: operations.compileNativeProject(project, {
        clean: request.clean,
        outDir: request.outDir,
        experimentalNativeSize: request.experimentalNativeSize,
        experimentalNativeBoundedSize: request.experimentalNativeBoundedSize,
        emitWat: request.emitWat
      })
    };
  }
  if (request.command === 'build') {
    return {
      status: 0,
      result: operations.buildProject(project, {
        clean: request.clean,
        outDir: request.outDir,
        experimentalNativeSize: request.experimentalNativeSize,
        experimentalNativeBoundedSize: request.experimentalNativeBoundedSize,
        emitWat: request.emitWat
      })
    };
  }
  if (request.command === 'test') {
    const result = await operations.runProjectTests(project, { caseName: request.caseName });
    return { status: result.status === 'passed' ? 0 : 1, result };
  }
  if (request.command === 'inspect') return { status: 0, result: operations.inspectProject(project) };
  if (request.command === 'doctor') {
    const result = operations.doctorProject(project, { strict: request.strict });
    return { status: result.status === 'failed' ? 1 : 0, result };
  }
  if (request.command === 'dev') return executeDev(project, request, operations, options);
  throw new PulseProjectError('PULSE_COMMAND_UNIMPLEMENTED', `Pulse command is not implemented: ${request.command}`, { command: request.command });
}

module.exports = Object.freeze({
  EXECUTOR_IDS,
  executeCommandPlan,
  inspectArtifact,
  summarizeExecutionError: errorSummary
});
