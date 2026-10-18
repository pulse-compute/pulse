'use strict';

// Read-only compatibility validator for retained v1/v2 HTML archives. No renderer.
const fs = require('node:fs');
const path = require('node:path');
const SITE_ASSET_FILES = ['tokens.css', 'syntax-dark.css', 'site.css', 'boot.js', 'redirect.js', 'site.js', 'network-field.js', 'favicon.svg'];
function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function trimSlashes(value) { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function cleanBasePath(value) { const clean = trimSlashes(value); return clean ? '/' + clean : ''; }

function htmlIdSet(html, context) {
  const ids = new Set();
  for (const match of String(html).matchAll(/\sid="([^"]+)"/g)) {
    const id = match[1];
    if (ids.has(id)) fail(`${context} contains duplicate id ${id}`);
    ids.add(id);
  }
  return ids;
}

function splitHtmlReference(raw) {
  const decoded = String(raw).replace(/&amp;/g, '&');
  const hashAt = decoded.indexOf('#');
  const beforeHash = hashAt < 0 ? decoded : decoded.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : decodeURIComponent(decoded.slice(hashAt + 1));
  const queryAt = beforeHash.indexOf('?');
  return Object.freeze({
    path: queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt),
    hash
  });
}

function validateVersionDirectory(versionRoot, expected) {
  const requiredBase = ['index.html', 'search-index.json', 'release-manifest.json', 'documentation-versions.json', 'site-version-manifest.json', 'assets/site.css', 'assets/site.js'];
  for (const relative of requiredBase) if (!fs.existsSync(path.join(versionRoot, relative))) fail(`documentation version ${expected.segment} is missing ${relative}`);
  const manifest = readJson(path.join(versionRoot, 'site-version-manifest.json'));
  const routes = manifest.pages.map((page) => page.route);
  if (new Set(routes).size !== routes.length) fail(`documentation version ${expected.segment} contains duplicate hosted routes`);
  const modern = manifest.schemaVersion === 'pulse.documentation-version-site.v2';
  if (!modern && manifest.schemaVersion !== 'pulse.documentation-version-site.v1') fail(`documentation version ${expected.segment} uses unsupported site manifest ${manifest.schemaVersion}`);
  if (manifest.releaseVersion !== expected.version || manifest.versionSegment !== expected.segment) fail(`documentation version archive ${expected.segment} does not match its versions-manifest entry`);
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) fail(`documentation version ${expected.segment} has an incomplete page manifest`);
  const expectedSearchEntries = modern ? manifest.pages.filter((page) => page.hiddenInSearch !== true).length : manifest.pages.length;
  if (manifest.searchEntries !== expectedSearchEntries) fail(`documentation version ${expected.segment} has an incomplete search manifest`);
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.siteAssets)) fail(`documentation version ${expected.segment} has an incomplete asset manifest`);
  if (modern) {
    for (const asset of SITE_ASSET_FILES.map((file) => `assets/${file}`)) if (!manifest.siteAssets.includes(asset)) fail(`documentation version ${expected.segment} is missing shared site asset ${asset}`);
    if (manifest.publicSiteSchema !== 'pulse.public-site.v1' || manifest.publicSiteManifest !== 'public-site-manifest.json') fail(`documentation version ${expected.segment} has an invalid public-site manifest binding`);
    const publicSite = readJson(path.join(versionRoot, manifest.publicSiteManifest));
    if (publicSite.schemaVersion !== manifest.publicSiteSchema || publicSite.releaseVersion !== expected.version) fail(`documentation version ${expected.segment} has a stale public-site manifest`);
    if (!Array.isArray(manifest.navigation) || manifest.navigation.length !== publicSite.navigation.sections.filter(section => section.hiddenInNavigation !== true).length) fail(`documentation version ${expected.segment} has incomplete generated navigation`);
  } else if (manifest.siteAssets.length !== 2) fail(`legacy documentation version ${expected.segment} has an incomplete asset manifest`);

  const release = readJson(path.join(versionRoot, 'release-manifest.json'));
  if (release.releaseVersion !== expected.version || release.documentation?.version !== expected.segment) fail(`documentation version ${expected.segment} has a mismatched release manifest`);
  const search = readJson(path.join(versionRoot, 'search-index.json'));
  if (search.releaseVersion !== expected.version || !Array.isArray(search.entries) || search.entries.length !== manifest.searchEntries) fail(`documentation version ${expected.segment} has a mismatched search index`);
  if (modern && search.entries.some((entry) => typeof entry.section !== 'string' || !entry.section)) fail(`documentation version ${expected.segment} search entries are missing generated sections`);
  const basePath = cleanBasePath(release.documentation.basePath);
  let localLinks = 0;
  const listed = [
    ...manifest.pages.map((entry) => entry.output),
    ...manifest.assets.map((entry) => entry.output),
    ...manifest.siteAssets,
    ...(manifest.routeAliases || []).map((entry) => entry.output),
    ...(modern ? [manifest.publicSiteManifest] : [])
  ];
  for (const relative of listed) {
    const normalized = path.posix.normalize(String(relative));
    if (!normalized || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) fail(`documentation version ${expected.segment} contains unsafe output ${relative}`);
    if (!fs.existsSync(path.join(versionRoot, normalized))) fail(`documentation version ${expected.segment} is missing listed output ${relative}`);
  }
  const exactPrefix = `${basePath}/${expected.segment}/`;
  for (const page of manifest.pages) {
    const file = path.join(versionRoot, page.output);
    const html = fs.readFileSync(file, 'utf8');
    if (html.includes('\u0000')) fail(`documentation version ${expected.segment} page ${page.output} contains an unresolved inline-rendering token`);
    if (/<p>``<code\b/.test(html) || /<\/code>``<\/p>/.test(html)) fail(`documentation version ${expected.segment} page ${page.output} contains an unresolved fenced code block`);
    htmlIdSet(html, `${expected.segment}/${page.output}`);
    if (modern && (!html.includes('data-page-kind="docs"') || !html.includes('data-nav-drawer') || !html.includes('class="docs-toc"'))) fail(`documentation version ${expected.segment} page ${page.output} is missing the generated documentation shell`);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = splitHtmlReference(match[1]);
      if (!reference.path && reference.hash) {
        if (!htmlIdSet(html, `${expected.segment}/${page.output}`).has(reference.hash)) fail(`${expected.segment}/${page.output} links missing local anchor #${reference.hash}`);
        localLinks += 1;
        continue;
      }
      if (!reference.path.startsWith(exactPrefix)) continue;
      const relative = reference.path.slice(exactPrefix.length);
      const candidate = relative.endsWith('/') ? path.join(versionRoot, relative, 'index.html') : path.join(versionRoot, relative);
      if (!fs.existsSync(candidate)) fail(`documentation version ${expected.segment} page ${page.output} links missing exact-version path ${reference.path}`);
      if (reference.hash && candidate.endsWith('.html')) {
        const targetIds = htmlIdSet(fs.readFileSync(candidate, 'utf8'), `${expected.segment}/${relative}`);
        if (!targetIds.has(reference.hash)) fail(`documentation version ${expected.segment} page ${page.output} links missing #${reference.hash} in ${relative}`);
      }
      localLinks += 1;
    }
  }
  for (const alias of manifest.routeAliases || []) {
    const file = path.join(versionRoot, alias.output);
    const target = `${exactPrefix}${trimSlashes(alias.targetRoute)}/`;
    if (!fs.readFileSync(file, 'utf8').includes(target)) fail(`documentation version ${expected.segment} route alias ${alias.route} does not redirect to ${target}`);
  }
  if (modern) {
    const css = fs.readFileSync(path.join(versionRoot, 'assets/site.css'), 'utf8');
    if (!css.includes('@import url("./tokens.css")') || !css.includes('@import url("./syntax-dark.css")')) fail(`documentation version ${expected.segment} site.css is not consuming the shared token and syntax-theme files`);
    const script = fs.readFileSync(path.join(versionRoot, 'assets/site.js'), 'utf8');
    for (const marker of ['data-nav-open', 'version-select', 'search-input']) if (!script.includes(marker)) fail(`documentation version ${expected.segment} site.js is missing ${marker} behavior`);
  }
  return Object.freeze({
    version: expected.version,
    segment: expected.segment,
    pages: manifest.pages.length,
    searchEntries: manifest.searchEntries,
    localLinks,
    siteAssets: manifest.siteAssets.length,
    navigationSections: modern ? manifest.navigation.length : undefined,
    tocEntries: modern ? manifest.tocEntries : undefined
  });
}

module.exports = { validateVersionDirectory };
