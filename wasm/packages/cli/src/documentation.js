'use strict';

// Generated from release/pulse-release-manifest.json by wasm/scripts/sync-reference-docs.cjs.
const DOCUMENTATION_ORIGIN = "https://pulsecompute.io";
const DOCUMENTATION_BASE_PATH = "";
const DOCUMENTATION_VERSION = "v1.0.0-beta.3";
const DOCUMENTATION_LATEST_ALIAS = "latest";

function trimSlashes(value) { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function cleanAnchor(value) { return value ? '#' + String(value).replace(/^#/, '') : ''; }
function sourceToRoute(sourcePath) {
  const source = String(sourcePath).replace(/\\/g, '/').replace(/^\.\//, '');
  if (source === 'docs/README.md') return '';
  if (source === 'README.md') return 'project/';
  if (source === 'API.md') return 'api/';
  if (source === 'examples/README.md') return 'examples/';
  const example = /^examples\/(.+)\/README\.md$/.exec(source);
  if (example) return 'examples/' + example[1] + '/';
  if (source.startsWith('docs/')) {
    const relative = source.slice('docs/'.length);
    if (relative.endsWith('/README.md')) return relative.slice(0, -'README.md'.length);
    if (relative.endsWith('.md')) return relative.slice(0, -3) + '/';
  }
  throw new Error('No hosted documentation route for ' + sourcePath);
}
function documentationBaseUrl(versionSegment = DOCUMENTATION_VERSION) {
  return DOCUMENTATION_ORIGIN + DOCUMENTATION_BASE_PATH + '/' + trimSlashes(versionSegment) + '/';
}
function documentationUrl(sourcePath = 'docs/README.md', anchor = '', options = {}) {
  return documentationBaseUrl(options.versionSegment || DOCUMENTATION_VERSION) + sourceToRoute(sourcePath) + cleanAnchor(anchor);
}
function latestDocumentationUrl(sourcePath = 'docs/README.md', anchor = '') {
  return documentationUrl(sourcePath, anchor, { versionSegment: DOCUMENTATION_LATEST_ALIAS });
}

module.exports = Object.freeze({
  DOCUMENTATION_ORIGIN,
  DOCUMENTATION_BASE_PATH,
  DOCUMENTATION_VERSION,
  DOCUMENTATION_LATEST_ALIAS,
  sourceToRoute,
  documentationBaseUrl,
  documentationUrl,
  latestDocumentationUrl
});
