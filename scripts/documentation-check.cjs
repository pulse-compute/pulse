#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

function checkDocumentation() {
  execFileSync(process.execPath, ['wasm/scripts/sync-doc-snippets.cjs', '--check'], { cwd: ROOT, stdio: 'inherit' });
  const context = require('./pulse-context-build.cjs').run();
  const documentation = require('./documentation-release.cjs').validatePackageDocumentation();
  assert.equal(documentation.status, 'ok');
  assert.equal(documentation.validationKind, 'package-source');
  assert(!Object.hasOwn(documentation, 'site'), 'Source validation cannot return a rendered site');
  return { status: 'ok', context, documentation };
}

function validateSourceWorkflow(source) {
  assert(source.includes('name: Documentation') && source.includes('\n  build:'), 'Preserve the required Documentation / build check');
  assert(source.includes('run: node wasm/test/docs/assert-documentation-check.cjs'), 'Missing source orchestration probes');
  assert(source.includes('run: node wasm/test/docs/assert-documentation-archives.cjs'), 'Missing historical reader probes');
  assert.equal(source.split('run: node scripts/documentation-check.cjs').length, 2, 'Run source validation exactly once');
  for (const forbidden of ['documentation-preview', 'build-docs-site', 'docs:site', 'documentation-deployment.cjs', 'upload-artifact', 'deploy-pages', 'pages: write']) {
    assert(!source.includes(forbidden), `Documentation CI cannot render, seal or deploy: ${forbidden}`);
  }
}

module.exports = { checkDocumentation, validateSourceWorkflow };
if (require.main === module) {
  try { console.log(JSON.stringify(checkDocumentation(), null, 2)); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
