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
