'use strict';

const assert = require('node:assert/strict');
const { checkReleasePr, compareVersions, requiresVersionChange } = require('../../../scripts/release-pr-check.cjs');
const { prepareChangelog } = require('../../../scripts/release-prepare.cjs');

const previous = '1.0.0-beta.3', next = '1.0.0-beta.4';
function fixture(version = next) {
  const headManifest = { releaseVersion: version, documentation: { version: `v${version}` }, packages: [{ name: '@pulse-compute/runtime', dir: 'packages/runtime', version }] };
  const files = {
    'packages/runtime/package.json': JSON.stringify({ name: '@pulse-compute/runtime', version }),
    'release/documentation-versions.json': JSON.stringify({ latest: version, versions: [
      { version, segment: `v${version}`, status: 'current' },
      ...(version === previous ? [] : [{ version: previous, status: 'archived', sourceManifest: `release/documentation-site-archives/v${previous}/release-manifest.json` }])
    ] }),
    [`release/documentation-site-archives/v${previous}/release-manifest.json`]: JSON.stringify({ releaseVersion: previous }),
    'CHANGELOG.md': `# Changelog\n\n## ${version} — Beta (2026-09-14)\n\n- Fix.\n`
  };
  return { baseManifest: { releaseVersion: previous }, headManifest, changedFiles: ['packages/runtime/src/index.js'], readHead: (name) => { assert.ok(Object.hasOwn(files, name), name); return files[name]; }, files };
}

assert.equal(checkReleasePr(fixture()).preparedRelease, true);
assert.throws(() => checkReleasePr(fixture(previous)), /version remains/);
assert.throws(() => checkReleasePr(fixture('1.0.0-beta.2')), /backwards/);
const docsOnly = fixture(previous); docsOnly.changedFiles = ['docs/guides/json-schemas.md', 'packages/runtime/README.md', '.github/workflows/validate.yml'];
assert.equal(checkReleasePr(docsOnly).preparedRelease, false);
for (const file of ['pnpm-lock.yaml', 'packages/runtime/package.json', 'wasm/packages/cli/src/project-execution.js']) assert.equal(requiresVersionChange(file), true);
for (const mutate of [
  (f) => { f.headManifest.documentation.version = `v${previous}`; },
  (f) => { f.headManifest.packages[0].version = previous; },
  (f) => { f.files['packages/runtime/package.json'] = JSON.stringify({ name: '@pulse-compute/runtime', version: previous }); },
  (f) => { f.files['release/documentation-versions.json'] = JSON.stringify({ latest: previous, versions: [] }); },
  (f) => { const v = JSON.parse(f.files['release/documentation-versions.json']); v.versions.pop(); f.files['release/documentation-versions.json'] = JSON.stringify(v); },
  (f) => { f.files[`release/documentation-site-archives/v${previous}/release-manifest.json`] = JSON.stringify({ releaseVersion: next }); },
  (f) => { f.files['CHANGELOG.md'] = '# Changelog\n\n## Unreleased\n'; }
]) { const f = fixture(); mutate(f); assert.throws(() => checkReleasePr(f)); }
for (const [a, b, sign] of [
  ['1.0.0-beta.10', '1.0.0-beta.9', 1], ['1.0.0', '1.0.0-rc.1', 1],
  ['1.0.0-alpha', '1.0.0-alpha.1', -1], ['1.0.0-2', '1.0.0-alpha', -1],
  ['2.0.0', '1.9.9', 1], [next, next, 0]
]) assert.equal(compareVersions(a, b), sign);
for (const value of ['--help', '../evil', '1.0.0-beta.01', '01.0.0', '1.0.0;echo bad', '1.0.0+metadata']) assert.throws(() => compareVersions(value, previous));
const history = `\n## ${previous} — Beta (2026-09-14)\n\nPublished ${previous} notes remain exact.\n`;
const source = `# Changelog\n\n## Unreleased\n\n- New encoder.\n${history}`;
const prepared = prepareChangelog(source, next, 'Beta', '2026-09-14');
assert.ok(prepared.endsWith(history));
assert.ok(prepared.includes(`## ${next} — Beta (2026-09-14)\n\n- New encoder.`));
assert.ok(prepared.includes('## Unreleased\n\n##'));
assert.throws(() => prepareChangelog(prepared, next, 'Beta', '2026-09-14'), /already contains/);
assert.throws(() => prepareChangelog('# Changelog\n', next, 'Beta', '2026-09-14'), /Unreleased/);
console.log('ok - release PR rejects unprepared code and version drift; preparation preserves published changelog history');
