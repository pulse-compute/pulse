'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DOCUMENTATION, RELEASE_VERSION, RELEASE_MANIFEST } = require('./package-support.cjs');

const VERSIONS_FILE = path.resolve(__dirname, '..', 'release', 'documentation-versions.json');

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_DOCUMENTATION_SYSTEM_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function trimSlashes(value) { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function cleanBasePath(value) {
  const cleaned = `/${trimSlashes(value)}`;
  return cleaned === '/' ? '' : cleaned;
}
function cleanAnchor(value) {
  if (!value) return '';
  return `#${String(value).replace(/^#/, '')}`;
}

function sourceToRoute(sourcePath) {
  const source = slash(sourcePath).replace(/^\.\//, '');
  if (source === 'docs/README.md') return '';
  if (source === 'README.md') return 'project/';
  if (source === 'CHANGELOG.md') return 'changelog/';
  if (source === 'API.md') return 'api/';
  if (source === 'examples/README.md') return 'examples/';
  const example = /^examples\/(.+)\/README\.md$/.exec(source);
  if (example) return `examples/${example[1]}/`;
  if (source.startsWith('docs/')) {
    const relative = source.slice('docs/'.length);
    if (relative.endsWith('/README.md')) return `${relative.slice(0, -'README.md'.length)}`;
    if (relative.endsWith('.md')) return `${relative.slice(0, -3)}/`;
  }
  throw new Error(`No hosted documentation route for ${sourcePath}`);
}


function routeToSource(routeValue, options = {}) {
  const route = trimSlashes(routeValue);
  if (!route) return 'docs/README.md';
  if (route === 'project') return 'README.md';
  if (route === 'changelog') return 'CHANGELOG.md';
  if (route === 'api') return 'API.md';
  if (route === 'examples') return 'examples/README.md';
  if (route.startsWith('examples/')) return `examples/${route.slice('examples/'.length)}/README.md`;
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const fileCandidate = `docs/${route}.md`;
  const indexCandidate = `docs/${route}/README.md`;
  if (fs.existsSync(path.join(repoRoot, fileCandidate))) return fileCandidate;
  if (fs.existsSync(path.join(repoRoot, indexCandidate))) return indexCandidate;
  return fileCandidate;
}

function parseDocumentationUrl(target) {
  let url;
  try { url = new URL(target); }
  catch (_) { return undefined; }
  if (url.protocol !== 'https:' || url.origin !== DOCUMENTATION.origin) return undefined;
  const base = cleanBasePath(DOCUMENTATION.basePath);
  if (!url.pathname.startsWith(`${base}/`)) return undefined;
  const remainder = url.pathname.slice(base.length + 1);
  const slashAt = remainder.indexOf('/');
  const versionSegment = slashAt < 0 ? remainder : remainder.slice(0, slashAt);
  const route = slashAt < 0 ? '' : remainder.slice(slashAt + 1);
  if (!versionSegment) return undefined;
  return Object.freeze({
    versionSegment,
    route: trimSlashes(route),
    sourcePath: routeToSource(route),
    anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ''
  });
}

function documentationBaseUrl(versionSegment = DOCUMENTATION.version) {
  const base = `${DOCUMENTATION.origin}${cleanBasePath(DOCUMENTATION.basePath)}`;
  return `${base}/${trimSlashes(versionSegment)}/`;
}

function documentationUrl(sourcePath = DOCUMENTATION.source, anchor = '', options = {}) {
  const versionSegment = options.versionSegment || DOCUMENTATION.version;
  const route = sourceToRoute(sourcePath);
  return `${documentationBaseUrl(versionSegment)}${route}${cleanAnchor(anchor)}`;
}

function latestDocumentationUrl(sourcePath = DOCUMENTATION.source, anchor = '') {
  return documentationUrl(sourcePath, anchor, { versionSegment: DOCUMENTATION.latestAlias });
}

function loadDocumentationVersions(file = VERSIONS_FILE) {
  if (!fs.existsSync(file)) fail(`documentation versions manifest is missing: ${file}`);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 'pulse.documentation-versions.v1') fail(`unsupported documentation versions schema ${value.schemaVersion}`);
  if (!Array.isArray(value.versions) || value.versions.length === 0) fail('documentation versions manifest must list at least one version');
  const versions = new Set();
  const segments = new Set();
  let currentEntries = 0;
  for (const entry of value.versions) {
    for (const field of ['version', 'segment', 'channel', 'releasedAt', 'status', 'sourceManifest']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) fail(`documentation version entry is missing ${field}`);
    }
    if (versions.has(entry.version)) fail(`duplicate documentation version ${entry.version}`);
    if (segments.has(entry.segment)) fail(`duplicate documentation segment ${entry.segment}`);
    if (entry.segment !== `v${entry.version}`) fail(`documentation segment ${entry.segment} must match version ${entry.version}`);
    if (!['current', 'archived'].includes(entry.status)) fail(`documentation version ${entry.version} uses unsupported status ${entry.status}`);
    if (entry.status === 'current') currentEntries += 1;
    versions.add(entry.version);
    segments.add(entry.segment);
  }
  if (!versions.has(value.latest)) fail(`documentation latest version ${value.latest} is not listed`);
  if (currentEntries !== 1) fail(`documentation versions manifest must contain exactly one current entry; found ${currentEntries}`);
  const current = value.versions.find((entry) => entry.version === RELEASE_VERSION);
  if (!current) fail(`current release ${RELEASE_VERSION} is missing from documentation versions`);
  if (current.segment !== DOCUMENTATION.version) fail(`current documentation segment ${current.segment} does not match release manifest ${DOCUMENTATION.version}`);
  if (current.status !== 'current') fail(`current release ${RELEASE_VERSION} must have documentation status current`);
  if (value.latest !== RELEASE_VERSION) fail(`release ${RELEASE_VERSION} must be the latest documentation version while it is current`);
  return Object.freeze({
    ...value,
    versions: Object.freeze(value.versions.map((entry) => Object.freeze({ ...entry })))
  });
}

function renderInstalledDocumentationModule() {
  const lines = [
    "'use strict';",
    '',
    '// Generated from release/pulse-release-manifest.json by wasm/scripts/sync-reference-docs.cjs.',
    `const DOCUMENTATION_ORIGIN = ${JSON.stringify(DOCUMENTATION.origin)};`,
    `const DOCUMENTATION_BASE_PATH = ${JSON.stringify(cleanBasePath(DOCUMENTATION.basePath))};`,
    `const DOCUMENTATION_VERSION = ${JSON.stringify(DOCUMENTATION.version)};`,
    `const DOCUMENTATION_LATEST_ALIAS = ${JSON.stringify(DOCUMENTATION.latestAlias)};`,
    '',
    "function trimSlashes(value) { return String(value || '').replace(/^\\/+|\\/+$/g, ''); }",
    "function cleanAnchor(value) { return value ? '#' + String(value).replace(/^#/, '') : ''; }",
    'function sourceToRoute(sourcePath) {',
    "  const source = String(sourcePath).replace(/\\\\/g, '/').replace(/^\\.\\//, '');",
    "  if (source === 'docs/README.md') return '';",
    "  if (source === 'README.md') return 'project/';",
    "  if (source === 'API.md') return 'api/';",
    "  if (source === 'examples/README.md') return 'examples/';",
    "  const example = /^examples\\/(.+)\\/README\\.md$/.exec(source);",
    "  if (example) return 'examples/' + example[1] + '/';",
    "  if (source.startsWith('docs/')) {",
    "    const relative = source.slice('docs/'.length);",
    "    if (relative.endsWith('/README.md')) return relative.slice(0, -'README.md'.length);",
    "    if (relative.endsWith('.md')) return relative.slice(0, -3) + '/';",
    '  }',
    "  throw new Error('No hosted documentation route for ' + sourcePath);",
    '}',
    'function documentationBaseUrl(versionSegment = DOCUMENTATION_VERSION) {',
    "  return DOCUMENTATION_ORIGIN + DOCUMENTATION_BASE_PATH + '/' + trimSlashes(versionSegment) + '/';",
    '}',
    "function documentationUrl(sourcePath = 'docs/README.md', anchor = '', options = {}) {",
    '  return documentationBaseUrl(options.versionSegment || DOCUMENTATION_VERSION) + sourceToRoute(sourcePath) + cleanAnchor(anchor);',
    '}',
    "function latestDocumentationUrl(sourcePath = 'docs/README.md', anchor = '') {",
    '  return documentationUrl(sourcePath, anchor, { versionSegment: DOCUMENTATION_LATEST_ALIAS });',
    '}',
    '',
    'module.exports = Object.freeze({',
    '  DOCUMENTATION_ORIGIN,',
    '  DOCUMENTATION_BASE_PATH,',
    '  DOCUMENTATION_VERSION,',
    '  DOCUMENTATION_LATEST_ALIAS,',
    '  sourceToRoute,',
    '  documentationBaseUrl,',
    '  documentationUrl,',
    '  latestDocumentationUrl',
    '});',
    ''
  ];
  return lines.join('\n');
}

const DOCUMENTATION_VERSIONS = loadDocumentationVersions();
const DOCUMENTATION_BASE_URL = `${DOCUMENTATION.origin}${cleanBasePath(DOCUMENTATION.basePath)}`;

module.exports = Object.freeze({
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  DOCUMENTATION,
  DOCUMENTATION_VERSIONS,
  DOCUMENTATION_BASE_URL,
  VERSIONS_FILE,
  cleanBasePath,
  sourceToRoute,
  routeToSource,
  parseDocumentationUrl,
  documentationBaseUrl,
  documentationUrl,
  latestDocumentationUrl,
  loadDocumentationVersions,
  renderInstalledDocumentationModule
});
