'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { prepareTag } = require('../../../scripts/release-tag.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-release-tag-'));
const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const version = '1.0.0-beta.5', previous = '1.0.0-beta.4', tag = `v${version}`;
try {
 for (const history of ['legacy', 'website']) {
 const root = path.join(temp, history), remote = path.join(temp, `${history}.git`);
 const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
 fs.mkdirSync(root); run(temp, ['init', '--bare', remote]); run(root, ['init', '-b', 'main']);
 run(root, ['config', 'user.name', 'Release Test']); run(root, ['config', 'user.email', 'test@example.invalid']);
 run(root, ['remote', 'add', 'origin', remote]);
 const archive = history === 'website' ? `release/documentation-release-history/v${previous}.json`
   : `release/documentation-site-archives/v${previous}/release-manifest.json`;
 const archivedBytes = JSON.stringify({ releaseVersion: previous, documentation: { version: `v${previous}` } }, null, 2) + '\n';
 const archived = { version: previous, status: 'archived', sourceManifest: archive };
 if (history === 'website') {
   write('release/pulse-release-manifest.json', archivedBytes);
   run(root, ['add', '.']); run(root, ['commit', '-m', 'previous release']);
   run(root, ['tag', '-a', `v${previous}`, '-m', 'previous release']);
   Object.assign(archived, { deliveryOwner: 'website', segment: `v${previous}`, sourceTag: `v${previous}`,
     sourceCommit: run(root, ['rev-parse', 'HEAD']), sourceManifestSha256: createHash('sha256').update(archivedBytes).digest('hex') });
 }
 write('release/pulse-release-manifest.json', { releaseVersion: version, documentation: { version: tag }, packages: [{ name: '@pulse-compute/runtime', dir: 'packages/runtime', version }] });
 const versions = { latest: version, versions: [{ version, segment: tag, status: 'current' }, archived] };
 write('release/documentation-versions.json', versions);
 write(archive, archivedBytes);
 write('packages/runtime/package.json', { name: '@pulse-compute/runtime', version });
 write('CHANGELOG.md', `# Changelog\n\n## ${version} — Beta (2026-09-16)\n`);
 run(root, ['add', '.']); run(root, ['commit', '-m', 'fixture']); run(root, ['push', 'origin', 'main']);
 const check = write => prepareTag({ root, version, write });
 assert(check(false).next.at(-1).endsWith('-f operation=publish'), 'tag helper must direct the owner to qualified artifact consumption');
 assert.equal(check(false).mode, 'dry-run'); assert.equal(run(root, ['tag', '--list', tag]), '');
 if (history === 'website') {
   const commit = message => { run(root, ['add', '.']); run(root, ['commit', '-m', message]); run(root, ['push', 'origin', 'main']); };
   // A real one-byte change preserves JSON semantics but must invalidate the digest.
   write(archive, archivedBytes.slice(0, -1)); commit('remove archived final newline');
   assert.throws(() => check(true), /historical release metadata digest differs/);
   assert.equal(run(root, ['tag', '--list', tag]), '', 'invalid history must not create a tag');
   write(archive, archivedBytes); commit('restore exact archived bytes');
   const sourceCommit = archived.sourceCommit;
   archived.sourceCommit = run(root, ['rev-parse', 'HEAD']);
   write('release/documentation-versions.json', versions); commit('mismatch historical source identity');
   assert.throws(() => check(true), /historical metadata differs from its tagged source/);
   assert.equal(run(root, ['tag', '--list', tag]), '');
   archived.sourceCommit = sourceCommit;
   write('release/documentation-versions.json', versions); commit('restore historical source identity');
   assert.equal(check(false).mode, 'dry-run');
 }
 assert.throws(() => prepareTag({ root, version: previous }), /does not match/);
 write('untracked.txt', 'dirty'); assert.throws(() => check(true), /clean checkout/); fs.unlinkSync(path.join(root, 'untracked.txt'));
 assert.equal(check(true).localTagCreated, true); assert.equal(run(root, ['cat-file', '-t', `refs/tags/${tag}`]), 'tag');
 const identity = run(root, ['rev-parse', `refs/tags/${tag}`]); assert.equal(check(true).localTagCreated, false);
 assert.equal(run(root, ['ls-remote', '--tags', 'origin']), '', 'helper must never push');
 run(root, ['push', 'origin', `refs/tags/${tag}`]); assert.equal(check(true).remoteTagExists, true);
 assert.equal(run(root, ['rev-parse', `refs/tags/${tag}`]), identity);
 run(root, ['tag', '-d', tag]); run(root, ['tag', '-a', tag, '-m', 'different object']);
 assert.throws(() => check(true), /different local and remote tag objects/);
 run(root, ['tag', '-d', tag]); run(root, ['tag', tag]); assert.throws(() => check(true), /not annotated/);
 run(root, ['tag', '-d', tag]); run(root, ['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
 write('change.txt', 'later'); run(root, ['add', '.']); run(root, ['commit', '-m', 'unmerged']);
 assert.throws(() => check(true), /remote origin\/main/);
 run(root, ['push', 'origin', 'main']); assert.throws(() => check(true), /already exists remotely/);
 console.log(`ok - ${history} release history preserves exact bytes, reviewed remote main, dry run, tag identity and no implicit push`);
 }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
