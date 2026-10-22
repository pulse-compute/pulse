'use strict';

const path = require('node:path');
const { PulseProjectError } = require('./project-error.js');
const { normalizeCommandRequest } = require('./command-request.js');
const { isProjectContext, projectDocumentForContext } = require('./project-context.js');

const { selectedNativeOptimization, hasNativeOptimization } = require('./native-optimization');

function optimizationPlan(mode) {
  const recipe = require('@pulse-compute/wasm-build-support/native-optimization').resolveNativeOptimization(mode);
  return Object.freeze({ mode: recipe.mode, experimental: recipe.experimental, goal: recipe.goal, owner: 'native-compiler' });
}

function createCommandPlan(requestValue, options = {}) {
  const request = normalizeCommandRequest(requestValue);
  const cwd = path.resolve(options.cwd || process.cwd());
  const version = String(options.version || require('../../package.json').version);

  if (request.kind === 'meta') {
    if (request.invocation === 'help') return Object.freeze({ ok: true, command: 'help' });
    if (request.invocation === 'version') return Object.freeze({ ok: true, command: 'version', version });
    return Object.freeze({ ok: true, command: 'completion', shell: request.shell, generatedFrom: 'pulse.command-spec' });
  }
  if (request.command === 'docs') return Object.freeze({ ok: true, command: 'docs', mode: 'installed-documentation', backgroundWork: false });
  if (request.command === 'report') return require('./report/command.js').planReport(request, { cwd });
  if (request.command === 'init') {
    return Object.freeze({ ok: true, command: 'init', target: path.resolve(cwd, request.target || '.'), backgroundWork: false });
  }

  if (request.command === 'inspect' && request.artifact) {
    return Object.freeze({ ok: true, command: 'inspect', mode: 'artifact', artifact: path.resolve(cwd, request.artifact), backgroundWork: false });
  }

  const projectContext = options.projectContext;
  if (!isProjectContext(projectContext)) {
    throw new TypeError(`Pulse ${request.command} planning requires the authoritative ProjectContext`);
  }
  const project = projectDocumentForContext(projectContext);
  if (request.elideJsonCacheArena === true && request.command === 'build' && projectContext.target !== 'native') {
    throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', 'The --elide-json-cache-arena flag requires Native compilation.', { target: projectContext.target });
  }
  if (request.emitWat === true && request.command === 'build' && projectContext.target !== 'native') {
    throw new PulseProjectError('PULSE_NATIVE_TEXT_UNSUPPORTED', 'The --emit-wat flag requires Native compilation.', { target: projectContext.target });
  }
  if (hasNativeOptimization(request) && request.command === 'build' && projectContext.target !== 'native') {
    throw new PulseProjectError(
      'PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED',
      'Native optimization flags are available only for Native compilation.',
      {
        target: projectContext.target,
        required: Object.freeze({ target: 'native' })
      }
    );
  }
  return Object.freeze({
    ok: true,
    command: request.command,
    mode: 'project',
    project,
    provider: request.command === 'compile' ? null : projectContext.provider,
    configuredProvider: request.command === 'compile' ? projectContext.provider : undefined,
    buildMode: request.command === 'compile'
      ? 'portable-native-wasm'
      : (request.command === 'build'
          ? ((projectContext.target || project.target || 'native') === 'javascript' ? 'javascript-source-package' : 'native-provider')
          : undefined),
    ...(request.command === 'compile' || request.command === 'build' ? { textArtifacts: { wat: request.emitWat === true }, elideJsonCacheArena: request.elideJsonCacheArena === true } : {}),
    optimization: request.command === 'compile' || (request.command === 'build' && projectContext.target === 'native')
      ? optimizationPlan(selectedNativeOptimization(request, project))
      : undefined,
    backgroundWork: false,
    foregroundServer: request.command === 'dev'
  });
}

function isCommandPlan(value) {
  return Boolean(value && value.ok === true && typeof value.command === 'string');
}

module.exports = Object.freeze({
  createCommandPlan,
  isCommandPlan
});
