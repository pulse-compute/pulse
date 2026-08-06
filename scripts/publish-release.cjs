#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  preparePublicationBundle,
  verifyPublicationBundle,
  auditPackageNames,
  publicationPlan,
  publishBundle
} = require('./release-publication.cjs');

function fail(message) { const error = new Error(message); error.code = 'PULSE_NPM_PUBLICATION_CLI_INVALID'; throw error; }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function parseArgs(argv) {
  const out = { command: argv[0] || 'plan' };
  if (!['prepare', 'verify', 'audit', 'plan', 'publish'].includes(out.command)) {
    fail('Usage: publish-release.cjs <prepare|verify|audit|plan|publish> [options]');
  }
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => { const next = argv[++index]; if (!next) fail(`${token} requires a value`); return next; };
    if (token === '--repo-root') { out.repoRoot = value(); continue; }
    if (token.startsWith('--repo-root=')) { out.repoRoot = token.slice(12); continue; }
    if (token === '--pack-dir') { out.packDir = value(); continue; }
    if (token.startsWith('--pack-dir=')) { out.packDir = token.slice(11); continue; }
    if (token === '--out-dir') { out.outDir = value(); continue; }
    if (token.startsWith('--out-dir=')) { out.outDir = token.slice(10); continue; }
    if (token === '--bundle-dir') { out.bundleDir = value(); continue; }
    if (token.startsWith('--bundle-dir=')) { out.bundleDir = token.slice(13); continue; }
    if (token === '--source-commit') { out.sourceCommit = value(); continue; }
    if (token.startsWith('--source-commit=')) { out.sourceCommit = token.slice(16); continue; }
    if (token === '--source-ref') { out.sourceRef = value(); continue; }
    if (token.startsWith('--source-ref=')) { out.sourceRef = token.slice(13); continue; }
    if (token === '--registry-fixture') { out.fixtureFile = value(); continue; }
    if (token.startsWith('--registry-fixture=')) { out.fixtureFile = token.slice(19); continue; }
    if (token === '--json-out') { out.jsonFile = value(); continue; }
    if (token.startsWith('--json-out=')) { out.jsonFile = token.slice(11); continue; }
    if (token === '--allow-missing') { out.allowMissing = true; continue; }
    if (token === '--report-only') { out.check = false; continue; }
    if (token === '--require-release-ref') { out.requireReleaseRef = true; continue; }
    if (token === '--quiet') { out.inherit = false; continue; }
    fail(`unknown option ${token}`);
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let result;
  if (options.command === 'prepare') result = preparePublicationBundle(options);
  else if (options.command === 'verify') result = verifyPublicationBundle(options);
  else if (options.command === 'audit') result = auditPackageNames(options);
  else if (options.command === 'plan') result = publicationPlan(options);
  else result = publishBundle(options);
  if (options.jsonFile && ['prepare', 'verify'].includes(options.command)) {
    const target = path.resolve(options.jsonFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stableJson(result));
  }
  process.stdout.write(stableJson(result));
}

try { main(); }
catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  if (error && error.details) process.stderr.write(stableJson(error.details));
  process.exitCode = 1;
}
