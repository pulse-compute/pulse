'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateVersionDirectory } = require('../../../scripts/documentation-archives.cjs');
const root = path.resolve(__dirname, '../../..');
const entries = require('../../../release/documentation-versions.json').versions
  .filter(entry => entry.status === 'archived' && entry.deliveryOwner !== 'website');
for (const entry of entries) validateVersionDirectory(path.join(root, 'release/documentation-site-archives', entry.segment), entry);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-archive-reader-'));
try {
  const entry = entries[0];
  fs.cpSync(path.join(root, 'release/documentation-site-archives', entry.segment), temp, { recursive: true });
  const manifestFile = path.join(temp, 'site-version-manifest.json');
  const original = fs.readFileSync(manifestFile);
  for (const mutate of [m => { m.releaseVersion = '0.0.0'; }, m => { m.schemaVersion = 'unknown'; },
    m => { m.pages[0].output = '../../outside.html'; }, m => { m.siteAssets.pop(); },
    m => { m.searchEntries++; }]) {
    const manifest = JSON.parse(original); mutate(manifest);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => validateVersionDirectory(temp, entry));
  }
  // Supported v1 archives had only two presentation assets and all pages in search.
  const legacy = JSON.parse(original);
  legacy.schemaVersion = 'pulse.documentation-version-site.v1';
  legacy.siteAssets = ['assets/site.css', 'assets/site.js'];
  legacy.searchEntries = legacy.pages.length;
  const searchFile = path.join(temp, 'search-index.json'), searchBytes = fs.readFileSync(searchFile);
  const search = JSON.parse(searchBytes);
  search.entries = legacy.pages.map(page => ({ route: page.route }));
  fs.writeFileSync(manifestFile, JSON.stringify(legacy));
  fs.writeFileSync(searchFile, JSON.stringify(search));
  assert.equal(validateVersionDirectory(temp, entry).pages, legacy.pages.length);
  fs.writeFileSync(searchFile, searchBytes);
  fs.writeFileSync(manifestFile, original);
  const page = path.join(temp, JSON.parse(original).pages[0].output);
  const html = fs.readFileSync(page);
  fs.appendFileSync(page, '<a href="#missing-reader-fixture">broken</a>');
  assert.throws(() => validateVersionDirectory(temp, entry), /missing local anchor/);
  fs.writeFileSync(page, html);
  fs.rmSync(page);
  assert.throws(() => validateVersionDirectory(temp, entry), /missing/);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`ok - ${entries.length} retained archives validate without rendering; missing, malformed and broken-link inputs fail`);
