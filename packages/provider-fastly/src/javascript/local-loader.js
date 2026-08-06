'use strict';

const path = require('node:path');
const vm = require('node:vm');
const {
  bundleFastlyJavascriptApplication
} = require('./source-package.js');
const {
  assertFastlyJavascriptApplication
} = require('./runtime-host.js');

const FASTLY_JAVASCRIPT_LOCAL_LOADER_VERSION = 'pulse.fastly-javascript-local-loader.v1';
const LOCAL_EXTERNALS = Object.freeze({
  '@pulse-compute/runtime': require('@pulse-compute/runtime'),
  '@pulse-compute/runtime/host': require('@pulse-compute/runtime/host'),
  '@pulse-compute/runtime/package': require('@pulse-compute/runtime/package')
});

class PulseFastlyJavascriptLocalLoaderError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PulseFastlyJavascriptLocalLoaderError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function moduleDefault(exports) {
  return exports && Object.prototype.hasOwnProperty.call(exports, 'default')
    ? exports.default
    : exports;
}

function loadFastlyJavascriptLocalApplication(plan, options = {}) {
  if (!plan || plan.provider !== 'fastly' || plan.target !== 'javascript' || plan.loadable !== true) {
    throw new PulseFastlyJavascriptLocalLoaderError(
      'PULSE_FASTLY_JAVASCRIPT_LOCAL_PLAN_UNAVAILABLE',
      'Fastly JavaScript provider emulation requires a loadable Fastly JavaScript application plan.',
      {
        provider: plan && plan.provider,
        target: plan && plan.target,
        blockers: plan && plan.blockers || [],
        automaticFallback: false
      }
    );
  }

  const projectRoot = path.resolve(options.projectRoot || options.workspaceRoot || '.');
  const closure = bundleFastlyJavascriptApplication(
    plan,
    projectRoot,
    options.schemaBundle,
    { format: 'cjs', externalRuntime: true }
  );
  const module = { exports: {} };
  const externalRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(LOCAL_EXTERNALS, request)) {
      return LOCAL_EXTERNALS[request];
    }
    throw new PulseFastlyJavascriptLocalLoaderError(
      'PULSE_FASTLY_JAVASCRIPT_LOCAL_EXTERNAL_UNAVAILABLE',
      `Bundled Fastly JavaScript provider emulation cannot load external module ${String(request)}.`,
      { request: String(request), automaticFallback: false }
    );
  };

  try {
    const wrapper = new vm.Script(
      `(function(module,exports,require,__filename,__dirname){\n${closure.source}\n})`,
      { filename: 'pulse-fastly-javascript-local-application.cjs' }
    ).runInThisContext();
    wrapper(
      module,
      module.exports,
      externalRequire,
      path.join(projectRoot, 'pulse-fastly-javascript-local-application.cjs'),
      projectRoot
    );
  } catch (error) {
    if (error instanceof PulseFastlyJavascriptLocalLoaderError) throw error;
    throw new PulseFastlyJavascriptLocalLoaderError(
      error && error.code || 'PULSE_FASTLY_JAVASCRIPT_LOCAL_BUNDLE_LOAD_FAILED',
      'The bundled Fastly JavaScript application could not be loaded for provider emulation.',
      {
        causeName: error && error.name,
        causeCode: error && error.code,
        planHash: plan.planHash,
        graphHash: plan.graph && plan.graph.graphHash,
        automaticFallback: false
      }
    );
  }

  let application;
  try {
    application = assertFastlyJavascriptApplication(moduleDefault(module.exports));
  } catch (error) {
    throw new PulseFastlyJavascriptLocalLoaderError(
      error && error.code || 'PULSE_FASTLY_JAVASCRIPT_APPLICATION_EXPORT_INVALID',
      error && error.message || 'The bundled Fastly JavaScript application export is invalid.',
      {
        planHash: plan.planHash,
        graphHash: plan.graph && plan.graph.graphHash,
        automaticFallback: false
      }
    );
  }

  return Object.freeze({
    version: FASTLY_JAVASCRIPT_LOCAL_LOADER_VERSION,
    mode: 'provider-emulation',
    provider: 'fastly',
    target: 'javascript',
    providerReality: false,
    realityRunner: 'fastly compute serve',
    automaticFallback: false,
    plan,
    application,
    schemaCodecs: module.exports && module.exports.schemaCodecs || null,
    entry: plan.workspace.entry,
    modulesLoaded: plan.graph.modules.length,
    packagesLoaded: Object.freeze(plan.packages
      .filter((entry) => entry.status !== 'unavailable')
      .map((entry) => entry.packageName)
      .sort()),
    closure: Object.freeze({
      format: closure.format,
      sourceHash: closure.sourceHash,
      inputs: closure.inputs
    })
  });
}

module.exports = Object.freeze({
  FASTLY_JAVASCRIPT_LOCAL_LOADER_VERSION,
  PulseFastlyJavascriptLocalLoaderError,
  loadFastlyJavascriptLocalApplication
});
