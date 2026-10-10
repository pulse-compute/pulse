#!/usr/bin/env node
'use strict';

// One-off migration inventory. Reads trusted Pulse source using its existing
// renderer; this is not the website content importer or a release gate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const args = process.argv.slice(2);
const sourceAt = args.indexOf('--source');
const outAt = args.indexOf('--out');
assert(sourceAt >= 0 && args[sourceAt + 1] && outAt >= 0 && args[outAt + 1],
  'Usage: capture-baseline.cjs --source <trusted-checkout> --out <json> [--check]');
const root = path.resolve(args[sourceAt + 1]);
const output = path.resolve(args[outAt + 1]);
const git = (...values) => execFileSync('git', values, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(root, relative));
const json = relative => JSON.parse(read(relative));
const slash = value => value.split(path.sep).join('/');
function files(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${relative}`);
    return entry.isDirectory() ? files(path.join(directory, entry.name), relative + '/') : [relative];
  }).sort();
}
const builder = require(path.join(root, 'scripts/build-docs-site.cjs'));
const system = require(path.join(root, 'scripts/documentation-system.cjs'));
const release = json('release/pulse-release-manifest.json');
const editorial = json('release/documentation-site.json');
const sources = builder.publicPageSources();
const assetSources = builder.publicAssetSources();
const ownerFiles = ['scripts/build-docs-site.cjs', 'scripts/documentation-system.cjs',
  'scripts/documentation-site-config.cjs', 'scripts/documentation-ownership.cjs',
  'scripts/package-support.cjs', 'release/pulse-release-manifest.json',
  'release/documentation-site.json', 'release/documentation-versions.json', 'package.json'];
git('diff', '--exit-code', 'HEAD', '--', ...ownerFiles, ...sources, ...assetSources,
  'scripts/documentation-site', 'release/documentation-site-archives');
const context = { basePath: system.cleanBasePath(release.documentation.basePath),
  versionSegment: release.documentation.version, pageSet: new Set(sources), assetSet: new Set(assetSources) };
const decode = value => value.replaceAll('&quot;', '"').replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const pages = sources.map(source => {
  const bytes = read(source);
  const rendered = builder.markdownToHtml(bytes.toString('utf8'), source, context);
  const explicit = editorial.navigation.sections.find(section => (section.sources || []).includes(source));
  const section = explicit || editorial.navigation.sections.find(section =>
    (section.prefixes || []).some(prefix => source.startsWith(prefix)));
  assert(section, `No navigation section: ${source}`);
  const override = editorial.navigation.overrides[source] || {};
  return { source, route: system.sourceToRoute(source), sha256: hash(bytes),
    section: section.id, hiddenInNavigation: section.hiddenInNavigation === true || override.hiddenInNavigation === true,
    hiddenInSearch: section.hiddenInSearch === true || override.hiddenInSearch === true,
    anchors: [...new Set([...rendered.html.matchAll(/\bid="([^"]+)"/g)].map(match => decode(match[1])))] };
}).sort((a, b) => a.route < b.route ? -1 : a.route > b.route ? 1 : 0);
const aliases = Object.entries(editorial.routeAliases).map(([route, id]) => ({
  route: route + '/', target: system.sourceToRoute(editorial.documents[id].source)
})).sort((a, b) => a.route < b.route ? -1 : 1);
const archiveRoot = 'release/documentation-site-archives';
const archives = system.DOCUMENTATION_VERSIONS.versions.filter(entry => entry.status === 'archived').map(entry => {
  const relative = `${archiveRoot}/${entry.segment}`;
  const directory = path.join(root, relative);
  const inventory = files(directory).map(file => {
    const bytes = fs.readFileSync(path.join(directory, file));
    return { path: file, bytes: bytes.length, sha256: hash(bytes) };
  });
  const manifest = json(`${relative}/site-version-manifest.json`);
  const verified = builder.validateVersionDirectory(directory, entry);
  return { segment: entry.segment, source: relative, fileCount: inventory.length,
    bytes: inventory.reduce((n, file) => n + file.bytes, 0),
    treeSha256: hash(inventory.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')),
    pages: verified.pages, localLinksValidated: verified.localLinks,
    siteAssets: manifest.siteAssets, sourceAssets: manifest.assets,
    productionStorageVerified: false };
});
const snapshot = { schemaVersion: 'pulse.website-migration-baseline.v1',
  repository: 'pulse-compute/pulse', sourceCommit: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  releaseVersion: release.releaseVersion, documentation: release.documentation,
  evidence: 'tracked source and local archive inspection; not production storage verification',
  currentLatestBehavior: 'redirects to exact-version pages',
  ownerHashes: Object.fromEntries(ownerFiles.map(file => [file, hash(read(file))])),
  counts: { pages: pages.length, anchors: pages.reduce((n, page) => n + page.anchors.length, 0),
    sourceAssets: assetSources.length, aliases: aliases.length, archives: archives.length },
  pages, sourceAliases: editorial.sourceAliases, routeAliases: aliases,
  sourceAssets: assetSources.map(source => ({ source, route: source.slice('docs/'.length), sha256: hash(read(source)) })),
  siteAssets: files(path.join(root, 'scripts/documentation-site')).map(file => ({
    source: `scripts/documentation-site/${slash(file)}`, sha256: hash(read(`scripts/documentation-site/${file}`)) })),
  archives,
  unpublishedDocumentationReleases: release.readiness.versionPreparation.unpublishedDocumentationReleases };
// One JSON line per page keeps the retained route contract compact and reviewable.
const pageMarker = '__WEB00_PAGES__';
let content = JSON.stringify({ ...snapshot, pages: pageMarker }, null, 2);
content = content.replace(JSON.stringify(pageMarker), '[\n' + pages.map(page => '    ' + JSON.stringify(page)).join(',\n') + '\n  ]') + '\n';
if (args.includes('--check')) assert.equal(fs.readFileSync(output, 'utf8'), content, 'Baseline differs from source');
else { assert(!fs.existsSync(output), `Baseline already exists: ${output}`); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content); }
console.log(JSON.stringify({ status: 'passed', commit: snapshot.sourceCommit, ...snapshot.counts }));
