#!/usr/bin/env node
'use strict';

const { runPulseWorkflowCli } = require('../packages/cli/src/workflow.js');

runPulseWorkflowCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
}).then((result) => {
  process.exitCode = result.status || 0;
}).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
