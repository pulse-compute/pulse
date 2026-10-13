#!/usr/bin/env node
'use strict';

// One fresh site build. Only the release validator's successful callback may
// supply bytes to the existing non-production preview sealer.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

function preparePreview({ outDir = path.join(ROOT, '.pulse-documentation-preview') } = {}) {
  // Preserve the complete generated-file check from docs:check, including
  // snippets, ownership metadata, context corpus and installed references.
  execFileSync(process.execPath, ['wasm/scripts/sync-doc-snippets.cjs', '--check'], { cwd: ROOT, stdio: 'inherit' });
  let preview = null;
  const documentation = require('./documentation-release.cjs').validateDocumentationSource({
    onValidatedSite(siteDir) {
      assert.equal(preview, null, 'Preview must consume exactly one validated site');
      preview = require('./documentation-deployment.cjs').sealDocumentationCandidate({ siteDir, outDir });
    }
  });
  assert.equal(documentation.status, 'ok', 'Documentation validation did not succeed');
  assert(preview, 'Documentation validator did not provide a validated site');
  assert.equal(preview.status, 'ok', 'Preview candidate verification did not succeed');
  return { status: 'ok', documentation, preview };
}

function validatePreviewWorkflow(source) {
  assert(source.includes('      - name: Check preview orchestration contract\n        run: node wasm/test/docs/assert-documentation-preview.cjs'), 'Missing preview contract probes');
  assert(source.includes('      - name: Validate and seal documentation preview\n        id: preview\n        run: node scripts/documentation-preview.cjs'), 'Workflow must seal the freshly validated site');
  assert(source.includes("      - name: Upload generated preview\n        if: always() && steps.preview.outcome == 'success'"), 'Only a successful fresh preview may be uploaded');
  for (const duplicate of ['pnpm run docs:check', 'pnpm run docs:site', 'documentation-deployment.cjs seal', 'run: node scripts/documentation-release.cjs']) {
    assert(!source.includes(duplicate), `Duplicate documentation build/seal path: ${duplicate}`);
  }
}

module.exports = { preparePreview, validatePreviewWorkflow };
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/documentation-preview.cjs');
    console.log(JSON.stringify(preparePreview(), null, 2));
  } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
