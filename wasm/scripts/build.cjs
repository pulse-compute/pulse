#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const wasmRoot = path.resolve(__dirname, '..');
const compilerDir = path.join(wasmRoot, 'packages', 'compiler');
const artifactsDir = path.join(wasmRoot, 'artifacts');
const args = [
  './bin/pulsewasm-extract.js',
  'build',
  '--config', './examples/pulse.config.js',
  '--profile', 'edge',
  '--env', 'ASSET_ENDPOINT=https://assets.example.test',
  '--env', 'ASSET_BUCKET=pulse-assets',
  '--env', 'USERS_API_BASE_URL=https://users.example.test',
  '--out', '../../artifacts',
  '--emit-ast'
];

const result = spawnSync(process.execPath, args, {
  cwd: compilerDir,
  stdio: 'inherit',
  env: { ...process.env, PULSEWASM_ARTIFACTS_DIR: artifactsDir }
});

process.exit(result.status || 0);
