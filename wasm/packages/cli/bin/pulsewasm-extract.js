#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { runCli } = require('@pulse-compute/wasm-compiler/cli');
const { getDefaultArtifactsDir } = require('@pulse-compute/wasm-build-support/artifacts-dir');
const compilerRoot = path.resolve(require.resolve('@pulse-compute/wasm-compiler'), '..', '..');
const providerProofs = require(path.join(compilerRoot, 'bin', 'provider-proof-composition.js'));

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
