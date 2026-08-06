'use strict';

const path = require('node:path');
const {
  CONFIG_FILE_NAMES,
  PulseProjectError
} = require('./project-config.js');
const { exitCodeForDiagnostic } = require('./diagnostics.js');
const { COMMANDS, renderUsage } = require('./command-spec.js');
const { parseCommandRequest, normalizeCommandRequest } = require('./internal/command-request.js');
const { commandRequiresProjectContext, resolveProjectContext } = require('./internal/project-context.js');
const { createCommandPlan } = require('./internal/command-plan.js');
const {
  executeCommandPlan,
  summarizeExecutionError
} = require('./internal/command-executor.js');
const { createCommandReporter } = require('./internal/command-reporter.js');

const CLI_VERSION = require('../package.json').version;

function usage() {
  return renderUsage({ version: CLI_VERSION, configFiles: CONFIG_FILE_NAMES });
}

function planningOptions(request, cwd, projectContext) {
  return {
    cwd,
    version: CLI_VERSION,
    projectContext
  };
}

async function runPulseWorkflowCli(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const cwd = path.resolve(io.cwd || process.cwd());
  const environment = io.env || process.env;
  const reporter = createCommandReporter({
    stdout,
    stderr,
    cliVersion: CLI_VERSION,
    usageText: usage()
  });
  let request;
  try {
    request = parseCommandRequest(argv);
    if (request.kind === 'command' && request.help) request = normalizeCommandRequest({ help: true });
    const projectContext = commandRequiresProjectContext(request)
      ? resolveProjectContext(request, { cwd, environment })
      : undefined;
    const plan = createCommandPlan(request, planningOptions(request, cwd, projectContext));
    if (request.kind === 'command' && request.dryRun) {
      reporter.reportPlan(request, plan);
      return { status: 0, plan };
    }
    const execution = await executeCommandPlan(plan, request, {
      projectContext,
      environment,
      cliVersion: CLI_VERSION,
      onEvent: (event) => reporter.reportEvent(request, event)
    });
    return reporter.reportExecution(request, plan, execution);
  } catch (error) {
    const summary = summarizeExecutionError(error);
    reporter.reportDiagnostic(summary, { request, argv });
    return {
      status: exitCodeForDiagnostic(summary.code, error instanceof PulseProjectError ? 2 : 1),
      error: summary
    };
  }
}

module.exports = {
  CLI_VERSION,
  COMMANDS,
  runPulseWorkflowCli,
  usage
};
