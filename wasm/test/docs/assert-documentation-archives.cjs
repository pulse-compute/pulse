'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateVersionDirectory } = require('../../../scripts/documentation-archives.cjs');
const { validateRetainedArchiveHistory } = require('../../../scripts/release-pr-check.cjs');
const root = path.resolve(__dirname, '../../..');
assert.equal(fs.existsSync(path.join(root, 'release/documentation-site-archives')), false, 'Current checkout must not require HTML archives');
const entries = require('../../../release/documentation-versions.json').versions.filter(e => e.deliveryOwner === 'legacy-pulse');
for (const entry of entries) {
  const read = name => fs.readFileSync(path.join(root, name));
  validateRetainedArchiveHistory(entry, read);
  assert.throws(() => validateRetainedArchiveHistory(entry, name => Buffer.concat([read(name), Buffer.from(' ')])), /digest/);
  for (const change of [e => e.archiveSource.commit = 'unknown', e => e.archiveSource.path = '../bad',
    e => e.sourceManifest = '../bad', e => e.sourceManifestSha256 = '0'.repeat(64), e => e.segment = 'v0.0.0']) {
    const bad = structuredClone(entry); change(bad); assert.throws(() => validateRetainedArchiveHistory(bad, read));
  }
}
// Representative supplied artifact, not a copy of any published site.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-archive-reader-'));
const entry = { version: '1.2.3', segment: 'v1.2.3' };
const assets = ['tokens.css','syntax-dark.css','site.css','boot.js','redirect.js','site.js','network-field.js','favicon.svg'].map(n => 'assets/' + n);
const write = (file, value) => { const target = path.join(temp,file); fs.mkdirSync(path.dirname(target), { recursive:true }); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); };
try {
  const manifest = { schemaVersion:'pulse.documentation-version-site.v2', releaseVersion:entry.version, versionSegment:entry.segment,
    pages:[{route:'',output:'index.html'}], assets:[], siteAssets:assets, searchEntries:1,
    publicSiteSchema:'pulse.public-site.v1',publicSiteManifest:'public-site-manifest.json',navigation:[] };
  write('index.html','<main data-page-kind="docs" data-nav-drawer class="docs-toc"><h1 id="title">Fixture</h1><a href="#title">Local</a><a href="/v1.2.3/assets/site.css">Asset</a></main>');
  write('release-manifest.json',{releaseVersion:entry.version,documentation:{version:entry.segment,basePath:'/'}});
  write('documentation-versions.json',{});
  write('search-index.json',{releaseVersion:entry.version,entries:[{route:'',section:'start'}]});
  write('public-site-manifest.json',{schemaVersion:'pulse.public-site.v1',releaseVersion:entry.version,navigation:{sections:[]}});
  for (const asset of assets) write(asset,'fixture');
  write('assets/site.css','@import url("./tokens.css"); @import url("./syntax-dark.css");');
  write('assets/site.js','// data-nav-open version-select search-input');
  write('site-version-manifest.json',manifest);
  assert.equal(validateVersionDirectory(temp,entry).pages,1);
  const cli = require('node:child_process').execFileSync(process.execPath, [path.join(root, 'scripts/documentation-archives.cjs'), '--directory', temp, '--version', entry.version], { encoding: 'utf8' });
  assert.equal(JSON.parse(cli).version, entry.version);
  for (const change of [m => m.releaseVersion='0.0.0', m => m.schemaVersion='unknown',
    m => m.pages[0].output='../../outside.html', m => m.siteAssets.pop(), m => m.searchEntries++]) {
    const bad=structuredClone(manifest); change(bad); write('site-version-manifest.json',bad); assert.throws(()=>validateVersionDirectory(temp,entry));
  }
  write('site-version-manifest.json',{...manifest,schemaVersion:'pulse.documentation-version-site.v1',siteAssets:['assets/site.css','assets/site.js']});
  assert.equal(validateVersionDirectory(temp,entry).pages,1);
  write('site-version-manifest.json',manifest);
  fs.appendFileSync(path.join(temp,'index.html'),'<a href="#missing">broken</a>');
  assert.throws(()=>validateVersionDirectory(temp,entry),/missing local anchor/);
  fs.unlinkSync(path.join(temp,'index.html')); assert.throws(()=>validateVersionDirectory(temp,entry),/missing/);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log(`ok - ${entries.length} historical metadata records and supplied v1/v2 artifacts validate; identity, digest, missing-byte and link tampering fails`);
