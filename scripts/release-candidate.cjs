#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  preparePublicationBundle,
  verifyPublicationBundle
} = require('./release-publication.cjs');

function fail(message) { const error = new Error(message); error.code = 'PULSE_NPM_CANDIDATE_CLI_INVALID'; throw error; }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function parseArgs(argv) {
  const out = { command: argv[0] || 'prepare' };
  if (!['prepare', 'verify'].includes(out.command)) fail('Usage: release-candidate.cjs <prepare|verify> [options]');
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => { const next = argv[++index]; if (!next) fail(`${token} requires a value`); return next; };
    if (token === '--repo-root') { out.repoRoot = value(); continue; }
    if (token.startsWith('--repo-root=')) { out.repoRoot = token.slice(12); continue; }
    if (token === '--pack-dir') { out.packDir = value(); continue; }
    if (token.startsWith('--pack-dir=')) { out.packDir = token.slice(11); continue; }
    if (token === '--out' || token === '--bundle-dir') { out.outDir = out.bundleDir = value(); continue; }
    if (token.startsWith('--out=')) { out.outDir = token.slice(6); continue; }
    if (token.startsWith('--bundle-dir=')) { out.bundleDir = token.slice(13); continue; }
    if (token === '--source-commit') { out.sourceCommit = value(); continue; }
    if (token.startsWith('--source-commit=')) { out.sourceCommit = token.slice(16); continue; }
    if (token === '--source-ref') { out.sourceRef = value(); continue; }
    if (token.startsWith('--source-ref=')) { out.sourceRef = token.slice(13); continue; }
    if (token === '--require-release-ref') { out.requireReleaseRef = true; continue; }
    if (token === '--json-out') { out.jsonFile = value(); continue; }
    if (token.startsWith('--json-out=')) { out.jsonFile = token.slice(11); continue; }
    fail(`unknown option ${token}`);
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.command === 'prepare' ? preparePublicationBundle(options) : verifyPublicationBundle(options);
  if (options.jsonFile) {
    const file = path.resolve(options.jsonFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, stableJson(result));
  }
  process.stdout.write(stableJson(result));
}

try { main(); }
catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  if (error && error.details) process.stderr.write(stableJson(error.details));
  process.exitCode = 1;
}
