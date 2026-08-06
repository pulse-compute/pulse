'use strict';

const workflow = require('./workflow.js');
const projectConfig = require('./project-config.js');
const diagnostics = require('./diagnostics.js');
const projectConfigSchema = require('./project-config-schema.js');

module.exports = Object.freeze({
  cli: require('@pulse-compute/wasm-compiler/cli'),
  workflow,
  projectConfig,
  projectConfigSchema,
  diagnostics,
  runPulseWorkflowCli: workflow.runPulseWorkflowCli
});
