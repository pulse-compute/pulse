#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli.js');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const providerProofs = require('./provider-proof-composition.js');

runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  defaultOutDir: getDefaultArtifactsDir(process.cwd()),
  providerProofs,
  exitOnComplete: true
}).then(() => {
  process.exit(process.exitCode || 0);
}).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
