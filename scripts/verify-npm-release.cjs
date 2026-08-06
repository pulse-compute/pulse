#!/usr/bin/env node
'use strict';

const {
  verifyRegistryRelease,
  verifyCatalogRelease,
  smokePublishedCli
} = require('./release-publication.cjs');

function fail(message) { const error = new Error(message); error.code = 'PULSE_NPM_VERIFICATION_CLI_INVALID'; throw error; }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function parseArgs(argv) {
  const out = { smoke: false, catalogOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => { const next = argv[++index]; if (!next) fail(`${token} requires a value`); return next; };
    if (token === '--repo-root') { out.repoRoot = value(); continue; }
    if (token.startsWith('--repo-root=')) { out.repoRoot = token.slice(12); continue; }
    if (token === '--bundle-dir') { out.bundleDir = value(); continue; }
    if (token.startsWith('--bundle-dir=')) { out.bundleDir = token.slice(13); continue; }
    if (token === '--registry-fixture') { out.fixtureFile = value(); continue; }
    if (token.startsWith('--registry-fixture=')) { out.fixtureFile = token.slice(19); continue; }
    if (token === '--json-out') { out.jsonFile = value(); continue; }
    if (token.startsWith('--json-out=')) { out.jsonFile = token.slice(11); continue; }
    if (token === '--catalog-only') { out.catalogOnly = true; continue; }
    if (token === '--require-release-ref') { out.requireReleaseRef = true; continue; }
    if (token === '--smoke') { out.smoke = true; continue; }
    if (token === '--smoke-json-out') { out.smokeJsonFile = value(); continue; }
    if (token.startsWith('--smoke-json-out=')) { out.smokeJsonFile = token.slice(17); continue; }
    if (token === '--temp-dir') { out.tempDir = value(); continue; }
    if (token.startsWith('--temp-dir=')) { out.tempDir = token.slice(11); continue; }
    if (token === '--quiet') { out.inherit = false; continue; }
    fail(`unknown option ${token}`);
  }
  return out;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (Boolean(options.bundleDir) === Boolean(options.catalogOnly)) {
    fail('select exactly one verification mode: --bundle-dir <dir> or --catalog-only');
  }
  if (options.smokeJsonFile && !options.smoke) fail('--smoke-json-out requires --smoke');
  if (options.smoke && options.fixtureFile) fail('--smoke cannot run against a registry fixture');
  const verification = options.catalogOnly ? verifyCatalogRelease(options) : verifyRegistryRelease(options);
  const smoke = options.smoke
    ? smokePublishedCli({ ...options, jsonFile: options.smokeJsonFile })
    : undefined;
  process.stdout.write(stableJson(smoke ? { ...verification, smoke } : verification));
}

try { main(); }
catch (error) {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  if (error && error.details) process.stderr.write(stableJson(error.details));
  process.exitCode = 1;
}
