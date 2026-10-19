#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateSourceWorkflow } = require('../../../scripts/documentation-check.cjs');
const ROOT = path.resolve(__dirname, '../../..');

function contract() {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/documentation.yml'), 'utf8');
  validateSourceWorkflow(workflow);
  for (const changed of [workflow.replace('  build:', '  other:'),
    workflow.replace('run: node scripts/documentation-check.cjs', 'run: node scripts/build-docs-site.cjs'),
    workflow + '\n      - run: node scripts/documentation-check.cjs\n',
    workflow + '\n      - run: node scripts/documentation-deployment.cjs seal\n']) assert.throws(() => validateSourceWorkflow(changed));
  const script = `
    const assert = require('node:assert/strict'), Module = require('node:module');
    const scenario = process.argv[1], calls = [], original = Module._load;
    Module._load = function(request, parent, ...rest) {
      assert(!/build-docs-site|highlight-code-blocks|documentation-deployment/.test(request), 'Source checks must not render or seal');
      if (parent?.filename.endsWith('/scripts/documentation-check.cjs')) {
        if (request === 'node:child_process') return { execFileSync(command, args, options) {
          calls.push('generated'); assert.equal(command, process.execPath);
          assert.deepEqual(args, ['wasm/scripts/sync-doc-snippets.cjs', '--check']);
          if (scenario === 'generated-failure') throw new Error('drift');
        } };
        if (request === './documentation-release.cjs') return { validatePackageDocumentation() {
          calls.push('validate');
          if (scenario === 'validation-failure') throw new Error('source failure');
          return { status: scenario === 'bad-status' ? 'failed' : 'ok',
            validationKind: scenario === 'wrong-kind' ? 'site' : 'package-source',
            ...(scenario === 'site-output' ? { site: {} } : {}) };
        } };
      }
      return original.call(this, request, parent, ...rest);
    };
    let error;
    try { require('./scripts/documentation-check.cjs').checkDocumentation(); } catch (caught) { error = caught; }
    assert.equal(Boolean(error), scenario !== 'success');
    assert.deepEqual(calls, scenario === 'generated-failure' ? ['generated'] : ['generated', 'validate']);
  `;
  for (const scenario of ['success', 'generated-failure', 'validation-failure', 'bad-status', 'wrong-kind', 'site-output']) {
    const child = spawnSync(process.execPath, ['-e', script, scenario], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  }
  console.log('ok - documentation CI checks generated and source integrity without rendering or sealing');
}

function contextDataIntegrity() {
  const contextSource = 'examples/12-pulse-context-mcp/context-corpus.ts';
  const contextMirror = `wasm/packages/cli/${contextSource}`;
  const contextDocument = 'docs/architecture/current-contracts.md';
  // Selection is not a provenance receipt. Exercise the actual check-mode owners
  // with changed read bytes, without editing this checkout or running examples.
  // This preview test runs after dependency installation, unlike fast selection.
  const fs = require('node:fs');
  const root = path.resolve(__dirname, '../../..');
  const { buildCorpus, render, synchronizeContextCorpus } = require('../../../scripts/pulse-context-corpus.cjs');
  const { buildExpectedFiles, synchronizeReferenceDocs } = require('../../scripts/sync-reference-docs.cjs');
  const originalRead = fs.readFileSync;
  const originalDocument = originalRead(path.join(root, contextDocument), 'utf8');
  const originalCorpus = originalRead(path.join(root, contextSource), 'utf8');
  const changedReads = new Map();
  try {
    fs.readFileSync = function(file, options) {
      if (!changedReads.has(file)) return originalRead.apply(this, arguments);
      const override = changedReads.get(file);
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? Buffer.from(override).toString(encoding) : Buffer.from(override);
    };
    const change = (file, content) => changedReads.set(path.join(root, file), content);
    change(contextDocument, originalDocument + '\nContext routing regression fixture.\n');
    const installedDocument = `wasm/packages/cli/${contextDocument}`;
    change(installedDocument, buildExpectedFiles().get(installedDocument));
    assert.throws(() => synchronizeContextCorpus(), /Stale context corpus/, 'canonical changes require regeneration');
    const regenerated = render(buildCorpus());
    assert.notEqual(regenerated, originalCorpus, 'whole-source provenance changes even outside selected sections');
    change(contextSource, regenerated);
    assert.equal(synchronizeContextCorpus().status, 'ok');
    assert.throws(() => synchronizeReferenceDocs(), /context-corpus\.ts/, 'stale installed mirror cannot pass');
    change(contextMirror, regenerated);
    assert.equal(synchronizeReferenceDocs().status, 'ok', 'legitimate synchronized source/corpus/mirror passes');
    changedReads.clear();
    change(contextMirror, originalCorpus + '\nthrow new Error("manual mirror edit");\n');
    assert.throws(() => synchronizeReferenceDocs(), /context-corpus\.ts/, 'manual mirror code cannot pass');
    change(contextSource, changedReads.get(path.join(root, contextMirror)));
    assert.throws(() => synchronizeContextCorpus(), /Stale context corpus/, 'editing both copies cannot forge generated data');
  } finally { fs.readFileSync = originalRead; }
  console.log('ok - context data requires canonical regeneration and an exact installed mirror');
}

contract();
contextDataIntegrity();

// Compact indexes must derive facts from the same catalogs as full contracts.
{
  const { renderEnvironmentReference, renderDiagnosticsReference } = require('../../scripts/sync-reference-docs.cjs');
  const { ENVIRONMENT_VARIABLES } = require('../../../scripts/environment-reference.cjs');
  const { DIAGNOSTIC_CATALOG, describeDiagnostic, diagnosticAnchor } = require('../../packages/cli/src/diagnostics.js');
  const env = renderEnvironmentReference(), diagnostics = renderDiagnosticsReference();
  assert(env.indexOf('### `PULSE_PROFILE`') < env.indexOf('## Fastly and Viceroy tooling'));
  assert(env.indexOf('### `PULSE_VICEROY_BIN`') < env.indexOf('## Contributor and test-only configuration'));
  for (const entry of ENVIRONMENT_VARIABLES) {
    assert(env.includes(`| Default | ${entry.default} |`));
    assert(env.includes(entry.description));
    assert.equal(env.split(`### \`${entry.name}\``).length, 2);
  }
  for (const code of Object.keys(DIAGNOSTIC_CATALOG)) {
    const descriptor = describeDiagnostic(code);
    assert(diagnostics.includes(`| [\`${code}\`](#${diagnosticAnchor(code)}) |`));
    assert(diagnostics.includes(descriptor.summary));
    for (const action of descriptor.remediation) assert(diagnostics.includes(action));
    assert.equal(diagnostics.split(`<a id="${diagnosticAnchor(code)}"></a>`).length, 2);
  }
  console.log('ok - compact reference indexes retain catalog facts, remedies and unique stable anchors');
}

{
  const { renderPackagePolicy } = require('../../scripts/sync-reference-docs.cjs');
  const { PACKAGE_SET } = require('../../../scripts/package-support.cjs');
  const document = renderPackagePolicy();
  const core = document.slice(document.indexOf('## Core packages'), document.indexOf('## Capability packages'));
  assert.deepEqual([...core.matchAll(/\| \[`([^`]+)`\]/g)].map(match => match[1]),
    ['pulse', 'runtime', 'cli']);
  assert(document.indexOf('## Implementation packages') > document.indexOf('## Capability packages'));
  for (const entry of PACKAGE_SET) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, entry.dir, 'package.json')));
    assert(document.includes(manifest.description.replace(/\|/g, '&#124;').replace(/\n/g, ' ')));
    assert(document.includes(entry.audience));
    assert(document.includes(entry.directInstall));
    assert(document.includes(entry.stability));
    assert(document.includes(`https://www.npmjs.com/package/${entry.name}`));
  }
  console.log('ok - package index leads with core packages and retains every catalog support contract');
}
