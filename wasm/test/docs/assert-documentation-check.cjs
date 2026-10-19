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

{
  const { MARKER, renderExampleTemplate } = require('../../../scripts/documentation-examples.cjs');
  const { resolveProject } = require('../../packages/cli/src/project-config.js');
  const explanation = `Opt in with \`${MARKER}\`.`;
  assert.equal(renderExampleTemplate(explanation, () => { throw Error('inline documentation'); }), explanation);
  const { markdownFiles } = require('../../scripts/sync-doc-snippets.cjs');
  const exampleReadmes = markdownFiles().filter(file => file.includes('/examples/') && fs.existsSync(path.join(path.dirname(file), '.pulse/config.ts')));
  assert.equal(exampleReadmes.length, 11);
  for (const file of exampleReadmes)
    assert(fs.readFileSync(file, 'utf8').split('\n').includes(MARKER), `missing shared template: ${file}`);
  for (const id of exampleReadmes.map(file => path.relative(path.join(ROOT, 'examples'), path.dirname(file)))) {
    const source = fs.readFileSync(path.join(ROOT, 'examples', id, 'README.md'), 'utf8');
    const project = resolveProject({ cwd: path.join(ROOT, 'examples', id) });
    const input = source.includes(MARKER) ? source : source.replace('\n', `\n\n${MARKER}\n`);
    const rendered = renderExampleTemplate(input, () => project.tests);
    assert.equal(renderExampleTemplate(rendered, () => project.tests), rendered, 'template must be idempotent');
    for (const heading of ['Project config', 'Test harness', 'Wasm size']) assert(rendered.includes(` ${heading}\n`));
    assert(rendered.indexOf('## Request and response') < rendered.indexOf('## Code'));
    assert(rendered.indexOf('## Code') < rendered.indexOf('## Test harness'));
    for (const heading of ['Inspect', 'Doctor']) assert(rendered.includes(`## ${heading}\n`));
    assert.equal(rendered.includes('## Report\n'), id !== '12-pulse-context-mcp');
    const blocks = text => [...text.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)].map(match => match[1]).sort();
    assert.deepEqual(blocks(rendered), blocks(input), 'all source and output fences must survive composition');
    for (const item of project.tests) assert(rendered.includes(item.kind === 'event' ? item.event.type : item.request.path));
    if (id === '02-request-schema') {
      assert(rendered.includes('PULSE_SCHEMA_DECODE'));
      const unselected = source.replace(MARKER, '');
      assert.equal(renderExampleTemplate(unselected, () => { throw Error('unselected'); }), unselected);
    }
  }
  const fixture = `${MARKER}\n\n## Handler\n\n\`\`\`md\n## Inside code\n\`\`\`\n\n## Extra limitation\n\nKeep this.\n`;
  const cases = [{kind:'http',request:{method:'GET',path:'/a|<b>'},expect:{error:{code:'X'}}}];
  const rendered = renderExampleTemplate(fixture, () => cases);
  assert(rendered.includes('## Inside code')); assert(rendered.includes('## Extra limitation\n\nKeep this.'));
  assert(rendered.includes('&#124;&lt;b&gt;')); assert(!rendered.includes('"status":200'));
  assert.throws(() => renderExampleTemplate(`${MARKER}\n\n## Report\n`, () => cases), /Empty example section/);
  console.log('ok - shared example template preserves fences/anchors, handles all eleven harnesses, HTTP/event cases and unavailable Report views');
}
