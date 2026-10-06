#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const { buildCorpus, render, canonical, section, OUTPUT, INPUTS, LIMITS } = require('../../../scripts/pulse-context-corpus.cjs');
const root = path.resolve(__dirname, '../../..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-corpus-'));
const write = (file, value) => { const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };

async function main() {
  const corpus = buildCorpus(root);
  const rendered = render(corpus);
  assert.equal(fs.readFileSync(path.join(root, OUTPUT), 'utf8'), rendered, 'checked-in output must be current');
  assert.equal(render(buildCorpus(root)), rendered, 'repeated extraction is byte-identical');
  assert.ok(corpus.records.length <= LIMITS.maxRecords);
  assert.equal(corpus.status, 'candidate');
  assert.equal(new Set(corpus.records.map(record => record.id)).size, corpus.records.length);
  const { corpusHash, ...snapshot } = corpus;
  assert.equal(corpusHash, sha256(JSON.stringify(canonical(snapshot), null, 2)), 'snapshot hash binds all projections and provenance');
  for (const record of corpus.records) {
    assert.equal(record.pulseVersion, corpus.pulseVersion); assert.equal(record.status, corpus.status);
    assert.equal(record.contentSha256, sha256(record.content));
    assert.ok(Buffer.byteLength(record.content) <= LIMITS.maxContentBytes);
    assert.ok(record.applicability.length > 0);
    assert.ok(!record.applicability.some(pair => pair.provider === 'none' && pair.target === 'javascript'));
    const bytes = fs.readFileSync(path.join(root, record.source.path));
    assert.equal(record.source.sha256, sha256(bytes));
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(record.source.url, `https://api.github.com/repos/pulse-compute/pulse/git/blobs/${blob}`);
    if (record.source.startLine) {
      const text = bytes.toString('utf8').split(/\r?\n/).slice(record.source.startLine - 1, record.source.endLine).join('\n').trimEnd() + '\n';
      assert.equal(record.content, text, 'section citations name exactly the emitted source range');
    }
    assert.doesNotMatch(record.source.path, /AGENTS|maintainers|contributing|\.test-results|\.pulse-release|archive|MCP-0\d\.md/);
  }
  assert.ok(corpus.records.some(record => record.id === 'diagnostic/PULSE_SCHEMA_COMPILE_FAILED'));
  assert.ok(corpus.records.some(record => record.id === 'contract/managed-async'));
  assert.ok(!corpus.records.some(record => record.id.startsWith('package/mcp')), 'unreleased adapter is not promoted into the release package set');
  assert.deepEqual(corpus.records.find(record => record.id === 'node/javascript').applicability, [{ provider: 'node', target: 'javascript' }]);
  assert.deepEqual(section('# Root\n```ts\n## Hidden\n```\n## Actual\nhello\n### Child\nchild\n## End\n', 'Actual'),
    { content: '## Actual\nhello\n### Child\nchild\n', startLine: 5, endLine: 8 });
  assert.throws(() => section('## Repeated\nx\n## Repeated\ny\n', 'Repeated'), /exactly once/);

  // A minimal relocated checkout exercises source changes without depending on git history.
  write(INPUTS, fs.readFileSync(path.join(root, INPUTS)));
  for (const source of corpus.sources) write(source.path, fs.readFileSync(path.join(root, source.path)));
  write('wasm/packages/cli/src/documentation.js', fs.readFileSync(path.join(root, 'wasm/packages/cli/src/documentation.js')));
  assert.equal(render(buildCorpus(temp)), rendered, 'absolute paths and checkout identity do not enter the snapshot');
  const document = 'docs/getting-started.md';
  const original = fs.readFileSync(path.join(temp, document));
  write(document, original.toString().replace('## Requirements', '## Renamed requirements'));
  assert.throws(() => buildCorpus(temp), /section must occur exactly once/);
  write(document, original.toString().replace('## Requirements\n', '## Requirements\n' + 'é'.repeat(LIMITS.maxContentBytes) + '\n'));
  assert.throws(() => buildCorpus(temp), /exceeds byte budget/);
  write(document, original.toString().replace('## Requirements\n', '## Requirements\nNew candidate text.\n'));
  assert.notEqual(buildCorpus(temp).corpusHash, corpus.corpusHash, 'changed canonical source invalidates the snapshot');
  write(document, original);
  fs.unlinkSync(path.join(temp, document));
  assert.throws(() => buildCorpus(temp), /Missing corpus source/);
  fs.symlinkSync(path.join(root, document), path.join(temp, document));
  assert.throws(() => buildCorpus(temp), /must not be a symlink/);
  fs.unlinkSync(path.join(temp, document));
  write(document, original);
  const example = 'examples/01-hello-json/.pulse/config.ts';
  const exampleSource = fs.readFileSync(path.join(temp, example));
  write(example, exampleSource.toString().replace("target: 'native'", "target: 'javascript'"));
  assert.throws(() => buildCorpus(temp), /Example applicability mismatch/);
  write(example, exampleSource);
  const packageFile = 'examples/01-hello-json/package.json';
  const packageSource = fs.readFileSync(path.join(temp, packageFile));
  write(packageFile, packageSource.toString().replaceAll(corpus.pulseVersion, '0.0.0'));
  assert.throws(() => buildCorpus(temp), /Example Pulse version mismatch/);
  write(packageFile, packageSource);
  const config = JSON.parse(fs.readFileSync(path.join(temp, INPUTS)));
  const excluded = { path: 'AGENTS.md', category: 'contract', providers: ['node'], targets: ['native'],
    sections: [{ id: 'excluded', heading: 'Instructions' }] };
  write(INPUTS, JSON.stringify({ ...config, documents: [...config.documents, excluded] }));
  assert.throws(() => buildCorpus(temp), /Excluded corpus source/);
  write(INPUTS, JSON.stringify({ ...config, documents: [...config.documents, { ...excluded, path: '../AGENTS.md' }] }));
  assert.throws(() => buildCorpus(temp), /Invalid corpus source/);
  write(INPUTS, JSON.stringify({ ...config, documents: [...config.documents, config.documents[0]] }));
  assert.throws(() => buildCorpus(temp), /Duplicate corpus record IDs/);
  write(INPUTS, JSON.stringify(config));
  const metadataPath = 'wasm/packages/cli/src/diagnostics.js';
  const metadata = fs.readFileSync(path.join(temp, metadataPath));
  write(metadataPath, metadata.toString().replace('An explicitly declared JSON schema could not be compiled.', 'New schema diagnostic explanation.'));
  const updated = buildCorpus(temp);
  assert.ok(updated.records.find(record => record.id === 'diagnostic/PULSE_SCHEMA_COMPILE_FAILED').content.includes('New schema diagnostic explanation.'), 'catalog evaluation cannot use stale require-cache values');
  assert.notEqual(updated.corpusHash, corpus.corpusHash);
  write(metadataPath, metadata);

  // Stale output is a real nonzero CLI result, not a documentation-only claim.
  write('scripts/pulse-context-corpus.cjs', fs.readFileSync(path.join(root, 'scripts/pulse-context-corpus.cjs')));
  write(OUTPUT, rendered + '// stale\n');
  const stale = spawnSync(process.execPath, ['scripts/pulse-context-corpus.cjs', '--check'], { cwd: temp, encoding: 'utf8' });
  assert.equal(stale.status, 1); assert.match(stale.stderr, /Stale context corpus/);
  execFileSync(process.execPath, ['scripts/pulse-context-corpus.cjs', '--write'], { cwd: temp });
  assert.equal(fs.readFileSync(path.join(temp, OUTPUT), 'utf8'), rendered);

  // Only emitted modules travel to the app. No repository, compiler or generator is needed at runtime.
  const app = path.join(temp, 'standalone'); fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
  for (const file of ['context-corpus', 'corpus-version']) {
    const source = file === 'context-corpus' ? rendered : fs.readFileSync(path.join(root, 'packages/mcp/examples/pulse-context/corpus-version.ts'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    fs.writeFileSync(path.join(app, file + '.js'), output);
  }
  for (const entry of fs.readdirSync(temp)) {
    if (entry !== 'standalone') fs.rmSync(path.join(temp, entry), { recursive: true, force: true });
  }
  const { selectContextCorpus } = await import(pathToFileURL(path.join(app, 'corpus-version.js')).href);
  const found = selectContextCorpus(corpus.pulseVersion);
  assert.equal(found.status, 'ok'); assert.equal(found.corpus.corpusHash, corpusHash);
  for (const version of ['latest', '', '0.0.0', 'v' + corpus.pulseVersion]) assert.deepEqual(selectContextCorpus(version),
    { status: 'version-mismatch', requestedVersion: version, availableVersion: corpus.pulseVersion });
  assert.throws(() => { found.corpus.records[0].content = 'mutated'; }, TypeError);
  assert.throws(() => found.corpus.records.push({}), TypeError);
  assert.throws(() => { found.corpus.records[0].source.url = 'mutated'; }, TypeError);
  assert.throws(() => found.corpus.records[0].applicability.push({}), TypeError);
  console.log(`ok - ${corpus.records.length} versioned context records; immutable standalone data, deterministic/stale/missing/excluded source checks`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
