#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validatePreviewWorkflow } = require('../../../scripts/documentation-preview.cjs');
const ROOT = path.resolve(__dirname, '../../..');

function contract() {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/documentation.yml'), 'utf8');
  validatePreviewWorkflow(workflow);
  for (const changed of [
    workflow.replace("if: always() && steps.preview.outcome == 'success'", 'if: always()'),
    workflow.replace('run: node scripts/documentation-preview.cjs', 'run: pnpm run docs:site'),
    workflow.replace('id: preview', 'id: other'),
    workflow + '\n      - run: pnpm run docs:check\n'
  ]) assert.throws(() => validatePreviewWorkflow(changed));
  const script = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const scenario = process.argv[1], calls = [];
    const original = Module._load;
    Module._load = function(request, parent, ...rest) {
      if (parent?.filename.endsWith('/scripts/documentation-preview.cjs')) {
        if (request === 'node:child_process') return { execFileSync(command, args, options) {
          calls.push('generated'); assert.equal(command, process.execPath);
          assert.deepEqual(args, ['wasm/scripts/sync-doc-snippets.cjs', '--check']);
          assert.equal(options.cwd, ${JSON.stringify(ROOT)});
          if (scenario === 'generated-failure') throw new Error('generated drift');
        } };
        if (request === './documentation-release.cjs') return { validateDocumentationSource(options) {
          calls.push('validate');
          if (scenario === 'validation-failure') throw new Error('invalid site');
          if (scenario !== 'missing-site') options.onValidatedSite('/fresh-validated-site');
          if (scenario === 'duplicate-site') options.onValidatedSite('/another-site');
          return { status: scenario === 'bad-status' ? 'failed' : 'ok' };
        } };
        if (request === './documentation-deployment.cjs') return { sealDocumentationCandidate(options) {
          calls.push('seal'); assert.equal(options.siteDir, '/fresh-validated-site');
          assert.equal(options.outDir, '/preview-output');
          if (scenario === 'seal-failure') throw new Error('seal failed');
          return { status: 'ok' };
        } };
      }
      return original.call(this, request, parent, ...rest);
    };
    let result, error;
    try { result = require('./scripts/documentation-preview.cjs').preparePreview({ outDir: '/preview-output' }); }
    catch (caught) { error = caught.message; }
    assert.equal(Boolean(error), scenario !== 'success');
    assert.deepEqual(calls, scenario === 'generated-failure' ? ['generated']
      : ['validation-failure', 'missing-site'].includes(scenario) ? ['generated', 'validate']
      : ['generated', 'validate', 'seal']);
    if (result) assert.equal(result.status, 'ok');
  `;
  for (const scenario of ['success', 'generated-failure', 'validation-failure', 'missing-site', 'duplicate-site', 'bad-status', 'seal-failure']) {
    const child = spawnSync(process.execPath, ['-e', script, scenario], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, `${scenario}: ${child.error || child.stderr}`);
  }
  console.log('ok - preview requires generated/source/site validation and one fresh callback; failures cannot upload stale candidates');
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

function integration() {
  const Module = require('node:module');
  const build = require('../../../scripts/build-docs-site.cjs').buildDocumentationSite;
  const { sealDocumentationCandidate, verifyDocumentationCandidate, sha256 } = require('../../../scripts/documentation-deployment.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-preview-parity-'));
  const original = Module._load;
  let builds = 0;
  try {
    Module._load = function(request, parent, ...rest) {
      const result = original.call(this, request, parent, ...rest);
      if (request.endsWith('/build-docs-site.cjs')) return { ...result,
        buildDocumentationSite(options) { builds++; return build(options); } };
      return result;
    };
    const started = performance.now();
    const fresh = path.join(temp, 'fresh');
    require('../../../scripts/documentation-preview.cjs').preparePreview({ outDir: fresh });
    const previewMs = performance.now() - started;
    assert.equal(builds, 1, 'The production preview path must build the site exactly once');
    Module._load = original;
    // Independent construction using the former docs:site + seal path. This
    // extra build is local qualification only; it is not in the CI preview job.
    const independentSite = path.join(temp, 'independent-site'), independent = path.join(temp, 'independent');
    build({ output: independentSite, clean: true });
    sealDocumentationCandidate({ siteDir: independentSite, outDir: independent });
    for (const file of ['documentation-deployment-manifest.json', 'sha256sums.txt']) {
      assert.deepEqual(fs.readFileSync(path.join(fresh, file)), fs.readFileSync(path.join(independent, file)), `${file}: preview bytes changed`);
    }
    const verified = verifyDocumentationCandidate({ candidateDir: fresh });
    const manifest = fs.readFileSync(path.join(fresh, 'documentation-deployment-manifest.json'));
    const object = verified.manifest.objects[0];
    fs.appendFileSync(path.join(fresh, 'site', object.relativePath), 'changed');
    assert.throws(() => verifyDocumentationCandidate({ candidateDir: fresh }), /differ|checksum/);
    console.log(JSON.stringify({ status: 'passed', siteBuilds: builds, objects: verified.objectCount,
      manifestSha256: sha256(manifest), identicalIndependentManifest: true, previewMs: Math.round(previewMs) }));
  } finally { Module._load = original; fs.rmSync(temp, { recursive: true, force: true }); }
}

contract();
contextDataIntegrity();
if (process.argv.includes('--integration')) integration();
