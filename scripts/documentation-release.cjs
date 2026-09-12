#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { URL } = require('node:url');
const {
  RELEASE_MANIFEST,
  RELEASE_MANIFEST_FILE,
  PACKAGE_SET,
  RELEASE_VERSION,
  DISPLAY,
  REPOSITORY,
  DOCUMENTATION,
  RUNTIME_TARGETS,
  SUPPORT_TIERS
} = require('./package-support.cjs');
const {
  DOCUMENTATION_VERSIONS,
  VERSIONS_FILE,
  parseDocumentationUrl,
  documentationUrl,
  routeToSource,
  cleanBasePath
} = require('./documentation-system.cjs');
const { validateDocumentationMetadata } = require('./documentation-ownership.cjs');
const { MAINTENANCE_POLICY, synchronizeMaintenancePolicy } = require('./maintenance-policy.cjs');
const { validateMaintainerControlPlane } = require('./validate-maintainer-control-plane.cjs');
const { ENVIRONMENT_VARIABLES } = require('./environment-reference.cjs');
const { buildDocumentationSite, publicPageSources } = require('./build-docs-site.cjs');
const {
  PUBLIC_SITE_SCHEMA,
  PUBLIC_SITE_MANIFEST_FILE,
  PUBLIC_SITE_MANIFEST,
  HOMEPAGE_SECTION_TYPES,
  classifyPublicPage,
  visibleNavigationSections
} = require('./documentation-site-config.cjs');
const { synchronizeReferenceDocs } = require('../wasm/scripts/sync-reference-docs.cjs');
const {
  PUBLIC_COMMAND_ORDER,
  COMMAND_SPECS,
  OPTION_SPECS,
  META_INVOCATIONS,
  publicOptionsForCommand,
  optionDisplay,
  optionDescription,
  publicCommandSpecDocument,
  renderUsage
} = require('../wasm/packages/cli/src/command-spec.js');
const {
  COMPLETION_SHELLS,
  renderCompletion,
  completionFile
} = require('../wasm/packages/cli/src/completion.js');
const {
  DIAGNOSTICS_REFERENCE,
  DIAGNOSTIC_CATALOG,
  describeDiagnostic,
  diagnosticAnchor
} = require('../wasm/packages/cli/src/diagnostics.js');
const {
  PROJECT_CONFIG_SCHEMA_VERSION,
  CONFIG_FIELDS,
  CONFIG_DISCOVERY,
  CONFIG_RUNTIME_RULES,
  projectConfigSchemaDocument,
  validateProjectConfigStructure,
  configDefault,
  validateConfigValue
} = require('../wasm/packages/cli/src/project-config-schema.js');
const {
  FASTLY_CONFIG_SCHEMA,
  fastlyConfigDefault
} = require('../packages/provider-fastly/src/config-schema.js');

const defaultRepoRoot = path.resolve(__dirname, '..');
const STATUS_START = '<!-- pulse-package-status:start -->';
const STATUS_END = '<!-- pulse-package-status:end -->';

const PRODUCT_DOCUMENTS = Object.freeze([
  'docs/reference/README.md',
  'docs/preview-scope.md',
  'docs/guides/project-lifecycle.md',
  'docs/guides/events.md',
  'docs/guides/deploying-node.md',
  'docs/guides/deploying-fastly.md',
  'docs/guides/compatibility-imports.md',
  'docs/reference/compatibility-matrix.md',
  'docs/reference/handler-authoring.md',
  'docs/concepts/compilation-and-lowering.md',
  'docs/concepts/effects-and-continuations.md',
  'docs/concepts/bodies.md',
  'docs/concepts/contracts-and-providers.md',
  'docs/concepts/package-owned-lowering.md',
  'docs/packages/pulse.md',
  'docs/packages/runtime.md',
  'docs/packages/cli.md',
  'docs/packages/provider-fastly.md',
  'docs/packages/grip.md',
  'docs/packages/assets.md',
  'docs/packages/implementation-packages.md',
  'docs/contributing/README.md',
  'docs/contributing/pulse-aware-packages.md',
  'docs/contributing/package-lowerer-contract.md',
  'docs/contributing/adding-first-party-lowerer.md',
  'docs/contributing/adding-core-provider.md',
  'docs/reference/environment.md'
]);

const ARCHITECTURE_DOCUMENTS = Object.freeze([
  'docs/architecture/overview.md',
  'docs/architecture/current-contracts.md',
  'docs/architecture/vision.md',
  'docs/maintainers/documentation-versioning.md',
  'docs/reference/shell-completion.md',
  'docs/maintainers/release-manifest.md',
  'docs/maintainers/plugin-readiness.md',
  'docs/maintainers/documentation-system.md'
]);

const REFERENCE_ARTIFACTS = Object.freeze([
  'docs/reference/cli-spec.json',
  'docs/reference/project-config.schema.json',
  'docs/reference/release-manifest.json',
  'docs/reference/documentation-versions.json',
  'docs/maintainers/plugin-readiness.json'
]);

const SITE_DOCUMENTS = Object.freeze([
  'docs/maintainers/public-site.md'
]);

const CHANGELOG_DOCS = Object.freeze([
  'CHANGELOG.md'
]);

const SITE_SOURCES = Object.freeze([
  'release/documentation-site.json',
  'scripts/documentation-site-config.cjs',
  'scripts/documentation-site/tokens.css',
  'scripts/documentation-site/site.css',
  'scripts/documentation-site/boot.js',
  'scripts/documentation-site/redirect.js',
  'scripts/documentation-site/site.js',
  'scripts/documentation-site/network-field.js',
  'scripts/documentation-site/favicon.svg'
]);

const GOVERNANCE_DOCUMENTS = Object.freeze([
  'docs/maintainers/README.md',
  'docs/maintainers/maintainer-charter.md',
  'docs/maintainers/scope-policy.md',
  'docs/maintainers/codex-maintainer.md',
  'docs/maintainers/repository-setup.md',
  'docs/maintainers/support-and-triage.md',
  'docs/maintainers/maintenance-policy.md'
]);

const GOVERNANCE_ARTIFACTS = Object.freeze([
  'docs/maintainers/maintenance-policy.json'
]);


const MAINTENANCE_SOURCES = Object.freeze([
  'AGENTS.md',
  'docs/AGENTS.md',
  'wasm/AGENTS.md',
  'wasm/packages/compiler/AGENTS.md',
  'wasm/packages/cli/AGENTS.md',
  'packages/AGENTS.md',
  'packages/provider-fastly/AGENTS.md',
  '.github/AGENTS.md',
  'release/AGENTS.md',
  'CONTRIBUTING.md',
  'SUPPORT.md',
  'SECURITY.md',
  'release/maintenance-policy.json',
  'scripts/maintenance-policy.cjs',
  'scripts/maintainer-scope.cjs',
  'scripts/validate-maintainer-control-plane.cjs',
  '.github/CODEOWNERS',
  '.github/labels.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/documentation.yml',
  '.github/ISSUE_TEMPLATE/scope-proposal.yml',
  '.github/ISSUE_TEMPLATE/support.yml',
  '.github/codex/README.md',
  '.github/codex/prompts/pull-request-review.md',
  '.github/codex/schemas/maintainer-review.schema.json',
  '.github/workflows/maintainer-scope.yml',
  '.github/workflows/validate.yml',
  '.github/workflows/codex-maintainer-review.yml',
  '.github/workflows/maintainer-labels.yml'
]);

const DELIVERY_DOCUMENTS = Object.freeze([
  'docs/maintainers/testing.md',
  'docs/maintainers/release-acceptance.md',
  'docs/maintainers/npm-publishing.md',
  'docs/maintainers/documentation-deployment.md'
]);

const ROUTING_DOCUMENTS = Object.freeze([
  'docs/guides/routing.md'
]);

const MIDDLEWARE_DOCUMENTS = Object.freeze([
  'docs/guides/migrating-from-express.md'
]);


const SITE_BUILD_SOURCES = Object.freeze([
  'scripts/highlight-code-blocks.mjs',
  'scripts/preview-docs-site.cjs',
  'scripts/documentation-site/syntax-dark.css'
]);


const DELIVERY_SOURCES = Object.freeze([
  'release/documentation-deployment.json',
  'scripts/release-candidate.cjs',
  'scripts/release-publication.cjs',
  'scripts/publish-release.cjs',
  'scripts/verify-npm-release.cjs',
  'scripts/documentation-deployment.cjs',
  'scripts/validate-publication-workflows.cjs',
  '.github/workflows/npm-publish.yml',
  '.github/workflows/documentation-deploy.yml',
  'infra/fastly/documentation/README.md',
  'infra/fastly/documentation/routing.vcl',
  'infra/fastly/documentation/origin-signing.vcl',
  'infra/fastly/documentation/response-policy.vcl',
  'infra/fastly/documentation/examples/host-routing.vcl',
  'infra/fastly/documentation/examples/path-routing.vcl'
]);

const PUBLIC_FIXTURES = Object.freeze([
  'docs/fixtures/inspect-fetch-composition.selected.json'
]);


const PRESENT_TENSE_READMES = Object.freeze([
  'packages/assets/README.md',
  'packages/assets/as/README.md',
  'wasm/packages/compiler/README.md',
  'packages/provider-node/README.md',
  'wasm/packages/runtime-core-as/README.md',
  'wasm/packages/schema-json/README.md'
]);

const PUBLIC_PLUGIN_REQUIREMENTS = Object.freeze([
  'trustModel',
  'packageDiscovery',
  'versionNegotiation',
  'securityPolicy',
  'compatibilityContract',
  'isolatedPackageLoading'
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_DOCUMENTATION_RELEASE_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function relative(repoRoot, file) { return slash(path.relative(repoRoot, file)); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function isDeepEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function filesUnder(root, predicate = () => true, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function stripCodeFences(markdown) {
  return String(markdown).replace(/```[\s\S]*?```/g, '');
}

function markdownLinks(markdown) {
  const source = stripCodeFences(markdown);
  const links = [];
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    const titleAt = target.search(/\s+["']/);
    if (titleAt >= 0) target = target.slice(0, titleAt);
    links.push(target);
  }
  for (const match of source.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) links.push(match[1]);
  return links;
}

function githubSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const match of String(markdown).matchAll(/<a\s+(?:name|id)=["']([^"']+)["'][^>]*>/gi)) anchors.add(match[1]);
  for (const match of String(markdown).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = githubSlug(match[1]);
    if (!base) continue;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function splitTarget(target) {
  const hashAt = target.indexOf('#');
  return Object.freeze({
    pathname: hashAt < 0 ? target : target.slice(0, hashAt),
    anchor: hashAt < 0 ? '' : decodeURIComponent(target.slice(hashAt + 1))
  });
}

function pulseUnpkgTarget(target) {
  let url;
  try { url = new URL(target); }
  catch (_) { return undefined; }
  if (url.protocol !== 'https:' || url.hostname !== 'unpkg.com') return undefined;
  const match = /^\/@pulse-compute\/([^/@]+)@([^/]+)\/?(.*)$/.exec(url.pathname);
  if (!match) return undefined;
  return Object.freeze({
    packageName: `@pulse-compute/${match[1]}`,
    version: match[2],
    file: decodeURIComponent(match[3] || 'README.md'),
    anchor: url.hash ? decodeURIComponent(url.hash.slice(1)) : ''
  });
}

function validateAnchor(markdown, anchor, context) {
  if (!anchor) return;
  if (!markdownAnchors(markdown).has(anchor)) fail(`${context} points to missing anchor #${anchor}`);
}

function sourceMarkdownFiles(repoRoot) {
  const files = [path.join(repoRoot, 'README.md'), path.join(repoRoot, 'CHANGELOG.md'), path.join(repoRoot, 'API.md')];
  files.push(...filesUnder(path.join(repoRoot, 'docs'), (file) => file.endsWith('.md')
    && path.basename(file) !== 'AGENTS.md'
    && !file.includes(`${path.sep}internal${path.sep}`)
    && !file.includes(`${path.sep}architecture${path.sep}decisions${path.sep}`)));
  files.push(...filesUnder(path.join(repoRoot, 'examples'), (file) => path.basename(file) === 'README.md'));
  for (const entry of PACKAGE_SET) files.push(path.join(repoRoot, entry.dir, 'README.md'));
  return [...new Set(files)].sort();
}

function hostedPulseUrl(target) {
  let url;
  try { url = new URL(target); }
  catch (_) { return false; }
  return url.origin === DOCUMENTATION.origin && url.pathname.startsWith(`${DOCUMENTATION.basePath.replace(/\/$/, '')}/`);
}

function validateHostedDocumentationTarget(repoRoot, target, context) {
  const url = new URL(target);
  const publicRoot = `${DOCUMENTATION.basePath.replace(/\/$/, '')}/`;
  if (url.origin === DOCUMENTATION.origin && url.pathname === publicRoot) {
    if (url.search) fail(`${context} links the public homepage with unsupported query ${url.search}`);
    if (url.hash) {
      const anchor = decodeURIComponent(url.hash.slice(1));
      const homepageAnchors = new Set(PUBLIC_SITE_MANIFEST.homepage.sections.map((entry) => entry.id));
      if (!homepageAnchors.has(anchor)) fail(`${context} points to missing public-homepage anchor #${anchor}`);
    }
    return 'release/documentation-site.json';
  }
  const parsed = parseDocumentationUrl(target);
  if (!parsed) fail(`${context} contains malformed Pulse documentation URL ${target}`);
  if (parsed.versionSegment !== DOCUMENTATION.version) {
    fail(`${context} links documentation segment ${parsed.versionSegment}; expected exact release segment ${DOCUMENTATION.version}`);
  }
  const sourcePath = routeToSource(parsed.route, { repoRoot });
  const linked = path.join(repoRoot, sourcePath);
  if (!fs.existsSync(linked) || !fs.statSync(linked).isFile()) fail(`${context} links missing hosted source ${sourcePath}`);
  if (parsed.anchor && linked.endsWith('.md')) validateAnchor(fs.readFileSync(linked, 'utf8'), parsed.anchor, `${context} -> ${target}`);
  return sourcePath;
}

function validateSourceMarkdownLinks(repoRoot) {
  let checked = 0;
  let hosted = 0;
  for (const file of sourceMarkdownFiles(repoRoot)) {
    const markdown = fs.readFileSync(file, 'utf8');
    const context = relative(repoRoot, file);
    for (const target of markdownLinks(markdown)) {
      if (!target || target.startsWith('mailto:') || target.startsWith('tel:')) continue;
      if (target.startsWith('#')) {
        validateAnchor(markdown, decodeURIComponent(target.slice(1)), context);
        checked += 1;
        continue;
      }
      if (/^https?:/i.test(target)) {
        if (pulseUnpkgTarget(target)) fail(`${context} uses obsolete unpkg documentation link ${target}`);
        if (hostedPulseUrl(target)) {
          validateHostedDocumentationTarget(repoRoot, target, context);
          checked += 1;
          hosted += 1;
        }
        continue;
      }
      const { pathname, anchor } = splitTarget(target);
      const decoded = decodeURIComponent(pathname || '');
      let linked = decoded ? path.resolve(path.dirname(file), decoded) : file;
      if (decoded && fs.existsSync(linked) && fs.statSync(linked).isDirectory()) linked = path.join(linked, 'README.md');
      if (!fs.existsSync(linked)) fail(`${context} links missing path ${target}`);
      if (anchor && fs.statSync(linked).isFile() && linked.endsWith('.md')) validateAnchor(fs.readFileSync(linked, 'utf8'), anchor, `${context} -> ${target}`);
      checked += 1;
    }
  }
  return Object.freeze({ checked, hosted });
}

function validateAdvertisedEntryPoint(manifest, entryPoint) {
  if (entryPoint === 'None for application authors.') return;
  const binary = /^([A-Za-z0-9._-]+) binary$/.exec(entryPoint);
  if (binary) {
    if (!manifest.bin || !Object.prototype.hasOwnProperty.call(manifest.bin, binary[1])) fail(`${manifest.name} advertises missing binary ${binary[1]}`);
    return;
  }
  if (entryPoint !== manifest.name && !entryPoint.startsWith(`${manifest.name}/`)) fail(`${manifest.name} advertises an entry point owned by another package: ${entryPoint}`);
  const exportKey = entryPoint === manifest.name ? '.' : `./${entryPoint.slice(manifest.name.length + 1)}`;
  const exports = manifest.exports;
  const exported = typeof exports === 'string' ? exportKey === '.' : exports && Object.prototype.hasOwnProperty.call(exports, exportKey);
  if (!exported && !(exportKey === '.' && manifest.main)) fail(`${manifest.name} advertises missing export ${entryPoint}`);
}

function validatePackagePolicy(repoRoot) {
  if (PACKAGE_SET.length === 0) fail('release manifest must contain at least one synchronized package');
  const names = new Set();
  for (const entry of PACKAGE_SET) {
    const manifestFile = path.join(repoRoot, entry.dir, 'package.json');
    if (!fs.existsSync(manifestFile)) fail(`release-manifest package directory is missing ${entry.dir}`);
    const manifest = readJson(manifestFile);
    if (manifest.name !== entry.name) fail(`${entry.dir} package name ${manifest.name} does not match release manifest ${entry.name}`);
    if (names.has(manifest.name)) fail(`release manifest contains duplicate package ${manifest.name}`);
    names.add(manifest.name);
    if (!SUPPORT_TIERS[entry.tier]) fail(`${manifest.name} uses unknown support tier ${entry.tier}`);
    if (entry.version !== RELEASE_VERSION || manifest.version !== RELEASE_VERSION) fail(`${manifest.name} version must be ${RELEASE_VERSION}`);
    if (manifest.license !== RELEASE_MANIFEST.license) fail(`${manifest.name} license must be ${RELEASE_MANIFEST.license}`);
    if (!manifest.engines || manifest.engines.node !== RELEASE_MANIFEST.publication.nodeEngines) fail(`${manifest.name} Node engines must be ${RELEASE_MANIFEST.publication.nodeEngines}`);
    if (!manifest.repository || manifest.repository.type !== REPOSITORY.type || manifest.repository.url !== REPOSITORY.url || manifest.repository.directory !== entry.dir) fail(`${manifest.name} repository metadata is not synchronized`);
    if (manifest.homepage !== documentationUrl(entry.documentation)) fail(`${manifest.name} homepage must target its exact-version canonical guide`);
    if (!manifest.bugs || manifest.bugs.url !== REPOSITORY.bugs) fail(`${manifest.name} bugs metadata is not synchronized`);
    if (!entry.entryPoints.length) fail(`${manifest.name} must state supported entry points or an explicit none marker`);
    for (const entryPoint of entry.entryPoints) validateAdvertisedEntryPoint(manifest, entryPoint);
    if (!entry.documentation.startsWith('docs/packages/')) fail(`${manifest.name} must own a canonical package guide`);
    if (!fs.existsSync(path.join(repoRoot, entry.documentation))) fail(`${manifest.name} canonical package guide is missing: ${entry.documentation}`);
    const readme = fs.readFileSync(path.join(repoRoot, entry.dir, 'README.md'), 'utf8');
    if ((readme.match(new RegExp(STATUS_START, 'g')) || []).length !== 1 || (readme.match(new RegExp(STATUS_END, 'g')) || []).length !== 1) fail(`${manifest.name} README must contain exactly one generated status block`);
    const guideUrl = documentationUrl(entry.documentation);
    if (!readme.includes(guideUrl)) fail(`${manifest.name} README status must link its exact-version canonical package guide`);
  }
  return Object.freeze({ packages: names.size, supportTiers: Object.keys(SUPPORT_TIERS).length });
}

function validateReleaseManifest(repoRoot) {
  const sourceManifest = readJson(path.join(repoRoot, 'release/pulse-release-manifest.json'));
  const versions = readJson(path.join(repoRoot, 'release/documentation-versions.json'));
  if (!isDeepEqual(sourceManifest, RELEASE_MANIFEST)) fail('loaded release manifest does not match release/pulse-release-manifest.json');
  if (!isDeepEqual(versions, DOCUMENTATION_VERSIONS)) fail('loaded documentation versions do not match release/documentation-versions.json');
  if (RELEASE_MANIFEST.schemaVersion !== 'pulse.release-catalog.v1') fail(`unsupported release catalog ${RELEASE_MANIFEST.schemaVersion}`);
  if (DOCUMENTATION.version !== `v${RELEASE_VERSION}`) fail('documentation version segment must match the release version');
  if (DOCUMENTATION_VERSIONS.latest !== RELEASE_VERSION) fail('current release must be the latest documentation version');
  const current = DOCUMENTATION_VERSIONS.versions.find((entry) => entry.version === RELEASE_VERSION);
  if (!current || current.status !== 'current' || current.segment !== DOCUMENTATION.version || current.sourceManifest !== relative(repoRoot, RELEASE_MANIFEST_FILE)) fail('documentation version entry is not bound to the current release manifest');
  for (const entry of DOCUMENTATION_VERSIONS.versions) {
    if (entry.version === RELEASE_VERSION) continue;
    const expectedManifest = `release/documentation-site-archives/${entry.segment}/release-manifest.json`;
    if (entry.status !== 'archived' || entry.sourceManifest !== expectedManifest) fail(`historical documentation ${entry.version} must be archived at ${expectedManifest}`);
    if (!fs.existsSync(path.join(repoRoot, expectedManifest))) fail(`historical documentation archive is missing ${expectedManifest}`);
  }
  for (const copy of ['docs/reference/release-manifest.json', 'wasm/packages/cli/release-manifest.json']) {
    if (!isDeepEqual(readJson(path.join(repoRoot, copy)), RELEASE_MANIFEST)) fail(`${copy} is not an exact release-manifest copy`);
  }
  for (const copy of ['docs/reference/documentation-versions.json', 'wasm/packages/cli/documentation-versions.json']) {
    if (!isDeepEqual(readJson(path.join(repoRoot, copy)), DOCUMENTATION_VERSIONS)) fail(`${copy} is not an exact documentation-version copy`);
  }
  const reference = fs.readFileSync(path.join(repoRoot, 'docs/maintainers/release-manifest.md'), 'utf8');
  for (const expected of [
    RELEASE_MANIFEST.license,
    RELEASE_MANIFEST.publication.nodeEngines,
    RELEASE_MANIFEST.publication.nodeMinimumVersion,
    RELEASE_MANIFEST.publication.nodeReleaseRange,
    RELEASE_MANIFEST.publication.nodeVersion,
    RELEASE_MANIFEST.publication.npmVersion
  ]) if (!reference.includes(`\`${expected}\``)) fail(`release-manifest reference is missing ${expected}`);
  for (const entry of PACKAGE_SET) {
    if (!reference.includes(`\`${entry.name}\``)) fail(`release-manifest reference is missing ${entry.name}`);
    if (!reference.includes(SUPPORT_TIERS[entry.tier].label)) fail(`release-manifest reference is missing tier ${entry.tier}`);
  }
  const targetIds = RUNTIME_TARGETS.map((entry) => entry.id);
  if (!isDeepEqual(targetIds, ['node', 'fastly', 'none'])) fail(`runtime target order must be node, fastly, none; found ${targetIds.join(', ')}`);
  for (const entry of RUNTIME_TARGETS) {
    if (!reference.includes(`\`${entry.id}\``) || !reference.includes(entry.label) || !reference.includes(`\`${entry.mode}\``)) fail(`release-manifest reference is missing runtime target ${entry.id}`);
  }
  return Object.freeze({ schemaVersion: RELEASE_MANIFEST.schemaVersion, releaseVersion: RELEASE_VERSION, versions: DOCUMENTATION_VERSIONS.versions.length, runtimeTargets: RUNTIME_TARGETS.length, packages: PACKAGE_SET.length });
}

function validatePublicSiteSystem(repoRoot) {
  const sourceManifest = readJson(path.join(repoRoot, 'release/documentation-site.json'));
  if (!isDeepEqual(sourceManifest, PUBLIC_SITE_MANIFEST)) fail('loaded public-site manifest does not match release/documentation-site.json');
  if (PUBLIC_SITE_MANIFEST.schemaVersion !== PUBLIC_SITE_SCHEMA) fail(`unsupported public-site schema ${PUBLIC_SITE_MANIFEST.schemaVersion}`);
  if (PUBLIC_SITE_MANIFEST.releaseVersion !== RELEASE_VERSION) fail('public-site release version is stale');
  if (path.resolve(repoRoot, 'release/documentation-site.json') !== PUBLIC_SITE_MANIFEST_FILE) fail('public-site validation currently requires the repository containing the loaded manifest');

  const sectionIds = PUBLIC_SITE_MANIFEST.navigation.sections.map((entry) => entry.id);
  if (!isDeepEqual(sectionIds, [
    'start',
    'examples',
    'guides',
    'concepts',
    'packages',
    'reference',
    'authors',
    'maintainers'
  ])) {
    fail(`public navigation section order is stale: ${sectionIds.join(', ')}`);
  }
  const homepageTypes = PUBLIC_SITE_MANIFEST.homepage.sections.map((entry) => entry.type);
  if (!isDeepEqual(homepageTypes, HOMEPAGE_SECTION_TYPES)) fail(`homepage section order is stale: ${homepageTypes.join(', ')}`);
  const example = PUBLIC_SITE_MANIFEST.homepage.sections.find((entry) => entry.type === 'example');
  if (!example || example.code.length < 8 || !example.code.some((line) => line.includes('new Router()')) || !example.code.some((line) => line.includes('return next()'))) fail('homepage Router example is incomplete');
  const journey = PUBLIC_SITE_MANIFEST.homepage.sections.find((entry) => entry.type === 'journey');
  if (!journey || journey.stages.length < 4) fail('homepage progressive-constraining journey is incomplete');
  const inspect = PUBLIC_SITE_MANIFEST.homepage.sections.find((entry) => entry.type === 'inspect');
  if (!inspect || !fs.existsSync(path.join(repoRoot, inspect.fixture))) fail('homepage inspect fixture is missing');
  const fixture = readJson(path.join(repoRoot, inspect.fixture));
  if (!fixture || !fixture.project?.provider || !fixture.compiler?.capabilities || !fixture.compiler?.effects || !fixture.compiler?.continuations || !fixture.compiler?.providerLowering) fail('homepage inspect fixture must expose capabilities, effects, continuations, and provider data');

  const namedSources = new Set(Object.values(PUBLIC_SITE_MANIFEST.documents).map((entry) => entry.source));
  for (const source of namedSources) if (!fs.existsSync(path.join(repoRoot, source))) fail(`public-site named document is missing ${source}`);
  if (PUBLIC_SITE_MANIFEST.documents.reference?.source !== 'docs/reference/README.md') fail('public-site manifest must expose the reference overview as a named document');
  if (PUBLIC_SITE_MANIFEST.documents.maintainers?.source !== 'docs/maintainers/README.md') fail('public-site manifest must expose the maintainer index as a named document');
  const maintainerSection = PUBLIC_SITE_MANIFEST.navigation.sections.find((entry) => entry.id === 'maintainers');
  if (!maintainerSection || maintainerSection.hiddenInNavigation !== true || maintainerSection.hiddenInSearch !== true) fail('maintainer documentation must remain outside primary navigation and general search');
  const referenceOverview = fs.readFileSync(path.join(repoRoot, 'docs/reference/README.md'), 'utf8');
  if (!referenceOverview.includes('[maintainer documentation](../maintainers/)')) fail('reference overview must provide the maintainer discovery gate');
  for (const relativeFile of SITE_SOURCES) {
    const file = path.join(repoRoot, relativeFile);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`public-site source is missing ${relativeFile}`);
  }
  const tokens = fs.readFileSync(path.join(repoRoot, 'scripts/documentation-site/tokens.css'), 'utf8');
  const syntaxCss = fs.readFileSync(path.join(repoRoot, 'scripts/documentation-site/syntax-dark.css'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'scripts/documentation-site/site.css'), 'utf8');
  const javascript = fs.readFileSync(path.join(repoRoot, 'scripts/documentation-site/site.js'), 'utf8');
  const networkField = fs.readFileSync(path.join(repoRoot, 'scripts/documentation-site/network-field.js'), 'utf8');
  for (const token of ['--canvas:', '--accent:', '--docs-width:', '--duration-fast:']) if (!tokens.includes(token)) fail(`site tokens are missing ${token}`);
  for (const marker of ['@import url("./tokens.css")', '@import url("./syntax-dark.css")', '.hero-card', '.hero-network', '.hero-motion-toggle', '.home-example', '.journey-list', '.quick-start', '.docs-shell', '.docs-toc', '@media (prefers-reduced-motion: reduce)', 'body[data-nav-open="true"]']) if (!css.includes(marker)) fail(`shared site CSS is missing ${marker}`);
  for (const marker of ['initNavigation', 'initSearch', 'initVersionSelect', 'drawer.inert', 'focusableElements']) if (!javascript.includes(marker)) fail(`shared site JavaScript is missing ${marker}`);
  for (const marker of ['DOMContentLoaded', 'networkField', 'NetworkField', 'visibilitychange', 'prefers-reduced-motion: reduce', 'data-hero-motion-toggle', 'IntersectionObserver', 'pause()', 'resume()']) if (!networkField.includes(marker)) fail(`network-field.js is missing ${marker}`);
  if (/https?:\/\//.test(tokens) || /https?:\/\//.test(syntaxCss) || /https?:\/\//.test(css) || /https?:\/\//.test(javascript) || /https?:\/\//.test(networkField)) fail('shared site assets must not depend on external runtime resources');
  if (!syntaxCss.includes('--color-prettylights-syntax-keyword') || !syntaxCss.includes('.pl-k')) fail('vendored Starry Night dark theme is incomplete');
  const rootPackage = readJson(path.join(repoRoot, 'package.json'));
  if (rootPackage.devDependencies?.['@wooorm/starry-night'] !== '3.10.0') fail('documentation site must pin @wooorm/starry-night 3.10.0');
  if (RUNTIME_TARGETS.length !== 3) fail(`release catalog requires three release-owned runtime targets; found ${RUNTIME_TARGETS.length}`);
  for (const target of RUNTIME_TARGETS) if (!['execute', 'execute-and-build', 'compile'].includes(target.mode)) fail(`runtime target ${target.id} uses unsupported release mode ${target.mode}`);

  const publicSources = publicPageSources();
  if (publicSources.some((source) => path.basename(source) === 'AGENTS.md')) fail('AGENTS.md files must not be hosted as public documentation');
  if (publicSources.some((source) => source.startsWith('docs/architecture/decisions/'))) fail('obsolete numbered decision chronology must not be hosted as public documentation');
  if (fs.existsSync(path.join(repoRoot, 'docs/architecture/decisions'))) fail('obsolete numbered decision chronology must not remain in the canonical documentation tree');
  const publicSourceSet = new Set(publicSources);
  for (const section of PUBLIC_SITE_MANIFEST.navigation.sections) {
    for (const source of section.sources || []) if (!publicSourceSet.has(source)) fail(`public navigation section ${section.id} references non-hosted source ${source}`);
  }
  for (const source of Object.keys(PUBLIC_SITE_MANIFEST.navigation.overrides)) if (!publicSourceSet.has(source)) fail(`public navigation override references non-hosted source ${source}`);
  for (const [source, target] of Object.entries(PUBLIC_SITE_MANIFEST.sourceAliases)) {
    if (publicSourceSet.has(source)) fail(`public-site source alias ${source} must not also be hosted directly`);
    if (!publicSourceSet.has(target)) fail(`public-site source alias ${source} targets non-hosted source ${target}`);
  }
  if (PUBLIC_SITE_MANIFEST.routeAliases?.['alpha-scope'] !== 'preview-scope') fail('the renamed preview scope must retain the intentional alpha-scope route alias');
  const hiddenSearchSources = Object.entries(PUBLIC_SITE_MANIFEST.navigation.overrides)
    .filter(([, override]) => override.hiddenInSearch === true)
    .map(([source]) => source)
    .sort();
  const expectedHiddenSearchSources = [];
  if (!isDeepEqual(hiddenSearchSources, expectedHiddenSearchSources)) {
    fail('canonical examples must remain discoverable inside the Examples section');
  }
  const classified = new Map();
  for (const source of publicSources) {
    const section = classifyPublicPage(source);
    if (!section) fail(`public documentation page is not classified for hosted navigation: ${source}`);
    classified.set(source, section.id);
  }
  return Object.freeze({
    schemaVersion: PUBLIC_SITE_MANIFEST.schemaVersion,
    namedDocuments: namedSources.size,
    sourceAliases: Object.keys(PUBLIC_SITE_MANIFEST.sourceAliases).length,
    navigationSections: sectionIds.length,
    homepageSections: homepageTypes.length,
    quickStartCommands: PUBLIC_SITE_MANIFEST.homepage.hero.terminal.length,
    runtimeTargets: RUNTIME_TARGETS.length,
    publicPages: classified.size,
    sharedAssets: SITE_SOURCES.length - 2 + SITE_BUILD_SOURCES.filter((entry) => entry.startsWith('scripts/documentation-site/')).length
  });
}

function validateDiagnostics(repoRoot) {
  const codes = Object.keys(DIAGNOSTIC_CATALOG);
  if (codes.length === 0) fail('public diagnostic catalog must not be empty');
  const doc = fs.readFileSync(path.join(repoRoot, 'docs/reference/diagnostics.md'), 'utf8');
  if (/PULSEWASM_[A-Z0-9_]+/.test(doc)) fail('public diagnostic reference must not publish internal PULSEWASM_* proof codes');
  if (DIAGNOSTICS_REFERENCE !== documentationUrl('docs/reference/diagnostics.md')) fail('diagnostic reference must use the exact hosted release route');
  for (const code of codes) {
    const raw = DIAGNOSTIC_CATALOG[code];
    const descriptor = describeDiagnostic(code);
    if (!raw.summary || !raw.title || !raw.remediation.length || raw.stability !== 'preview-stable' || raw.scope !== 'public') fail(`${code} catalog entry is incomplete`);
    if (descriptor.docs !== `${DIAGNOSTICS_REFERENCE}#${diagnosticAnchor(code)}`) fail(`${code} docs URL is not canonical`);
    const anchor = `<a id="${diagnosticAnchor(code)}"></a>`;
    if ((doc.split(anchor).length - 1) !== 1) fail(`${code} must have exactly one generated documentation anchor`);
    if (!doc.includes(descriptor.summary)) fail(`${code} summary is missing from the generated reference`);
  }
  const fallback = describeDiagnostic('PULSEWASM_FORWARD_COMPATIBLE_INTERNAL');
  if (fallback.docs !== DIAGNOSTICS_REFERENCE || fallback.scope !== 'fallback') fail('uncatalogued diagnostics must link to the reference root without a fake anchor');
  return codes.length;
}

function validateCliParity(repoRoot) {
  const reference = fs.readFileSync(path.join(repoRoot, 'docs/reference/cli.md'), 'utf8');
  const help = renderUsage({ version: RELEASE_VERSION, configFiles: CONFIG_DISCOVERY });
  for (const invocation of META_INVOCATIONS) {
    if (!help.includes(invocation.syntax)) fail(`installed help is missing meta invocation ${invocation.syntax}`);
    if (!reference.includes(invocation.syntax)) fail(`CLI reference is missing meta invocation ${invocation.syntax}`);
  }
  for (const command of PUBLIC_COMMAND_ORDER) {
    const commandSpec = COMMAND_SPECS[command];
    for (const usage of commandSpec.usage) {
      if (!help.includes(usage)) fail(`installed help is missing ${usage}`);
      if (!reference.includes(usage)) fail(`CLI reference is missing ${usage}`);
    }
    for (const example of commandSpec.examples) if (!reference.includes(example)) fail(`CLI reference is missing ${command} example ${example}`);
    for (const code of commandSpec.diagnostics) {
      if (!DIAGNOSTIC_CATALOG[code]) fail(`${command} references uncatalogued public diagnostic ${code}`);
      if (!reference.includes(`diagnostics.md#${diagnosticAnchor(code)}`)) fail(`CLI reference is missing ${command} diagnostic ${code}`);
    }
    for (const option of publicOptionsForCommand(command)) {
      if (['help', 'json', 'dry-run'].includes(option.id)) continue;
      if (!reference.includes(optionDisplay(option, command))) fail(`CLI reference is missing ${command} option ${optionDisplay(option, command)}`);
      if (!reference.includes(optionDescription(option, command))) fail(`CLI reference is missing ${command} option behavior for ${option.id}`);
    }
  }
  for (const option of OPTION_SPECS) {
    for (const flag of option.flags) {
      if (option.visibility === 'public') {
        if (!help.includes(flag.name)) fail(`installed help is missing public flag ${flag.name}`);
        if (!reference.includes(flag.name)) fail(`CLI reference is missing public flag ${flag.name}`);
      } else {
        if (help.includes(flag.name)) fail(`installed help exposes maintainer-only flag ${flag.name}`);
        if (reference.includes(flag.name)) fail(`public CLI reference exposes maintainer-only flag ${flag.name}`);
      }
    }
  }

  const expectedSpec = publicCommandSpecDocument({ version: RELEASE_VERSION, completionShells: COMPLETION_SHELLS });
  for (const file of ['docs/reference/cli-spec.json', 'wasm/packages/cli/docs/reference/cli-spec.json', 'wasm/packages/cli/cli-spec.json']) {
    if (!isDeepEqual(readJson(path.join(repoRoot, file)), expectedSpec)) fail(`${file} does not match the public command specification`);
  }
  for (const shell of COMPLETION_SHELLS) {
    const file = path.join(repoRoot, 'wasm/packages/cli/completions', completionFile(shell));
    const actual = fs.readFileSync(file, 'utf8');
    const expected = renderCompletion(shell);
    if (actual !== expected) fail(`${relative(repoRoot, file)} is not generated from the public command specification`);
    for (const command of PUBLIC_COMMAND_ORDER) if (!actual.includes(command)) fail(`${shell} completion is missing command ${command}`);
    for (const option of OPTION_SPECS.filter((entry) => entry.visibility === 'public')) {
      for (const flag of option.flags) if (!actual.includes(flag.name.replace(/^--?/, '')) && !actual.includes(flag.name)) fail(`${shell} completion is missing public flag ${flag.name}`);
    }
    for (const option of OPTION_SPECS.filter((entry) => entry.visibility !== 'public')) {
      for (const flag of option.flags) if (actual.includes(flag.name)) fail(`${shell} completion exposes maintainer-only flag ${flag.name}`);
    }
  }
  const bashCheck = spawnSync('bash', ['-n', path.join(repoRoot, 'wasm/packages/cli/completions/pulse.bash')], { encoding: 'utf8' });
  if (bashCheck.error || bashCheck.status !== 0) fail(`generated Bash completion is invalid: ${bashCheck.stderr || bashCheck.error.message}`);
  const workflow = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/workflow.js'), 'utf8');
  const requestNormalizer = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/internal/command-request.js'), 'utf8');
  const planner = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/internal/command-plan.js'), 'utf8');
  const executor = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/internal/command-executor.js'), 'utf8');
  const reporter = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/internal/command-reporter.js'), 'utf8');
  for (const required of ["require('./command-spec.js')", 'parseCommandRequest', 'renderUsage({ version: CLI_VERSION', "require('./internal/command-plan.js')", "require('./internal/command-executor.js')", "require('./internal/command-reporter.js')"]) {
    if (!workflow.includes(required)) fail(`CLI workflow is not consuming shared command-boundary sources: missing ${required}`);
  }
  for (const required of ["require('../command-spec.js')", 'optionForToken(token)', 'optionAllowed(option, command)']) {
    if (!requestNormalizer.includes(required)) fail(`CLI request normalizer is not consuming the shared command specification: missing ${required}`);
  }
  for (const required of ['createCommandPlan', 'projectDocumentForContext(projectContext)']) {
    if (!planner.includes(required)) fail(`CLI planner is missing its pure plan authority: ${required}`);
  }
  for (const required of ["require('../project-execution.js')", 'resolvedProjectForContext(projectContext)', 'executeCommandPlan']) {
    if (!executor.includes(required)) fail(`CLI executor is missing its command-operation authority: ${required}`);
  }
  for (const required of ["require('../completion.js')", 'renderCompletion(request.shell)', 'reportExecution', 'reportDiagnostic']) {
    if (!reporter.includes(required)) fail(`CLI reporter is missing its presentation authority: ${required}`);
  }
  for (const removed of ['compatibility-adapters', 'cli-cleanup-lane', 'legacyParsedArgsFromRequest', 'runInternalSuite', 'CLI_PROTOCOL_VERSION']) {
    if (workflow.includes(removed) || requestNormalizer.includes(removed) || planner.includes(removed) || executor.includes(removed) || reporter.includes(removed)) {
      fail(`CLI retains removed historical surface ${removed}`);
    }
  }
  return Object.freeze({
    commands: PUBLIC_COMMAND_ORDER.length,
    publicOptions: OPTION_SPECS.filter((entry) => entry.visibility === 'public').length,
    maintainerOptions: OPTION_SPECS.filter((entry) => entry.visibility !== 'public').length,
    completionShells: COMPLETION_SHELLS.length,
    metaInvocations: META_INVOCATIONS.length
  });
}

function interfaceFields(source, interfaceName) {
  const header = new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{`, 'm').exec(source);
  if (!header) fail(`missing exported interface ${interfaceName}`);
  const open = source.indexOf('{', header.index);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) { end = index; break; }
    }
  }
  if (end < 0) fail(`unterminated exported interface ${interfaceName}`);
  const body = source.slice(open + 1, end);
  const fields = new Map();
  depth = 0;
  let statement = '';
  for (const char of body) {
    if (char === '{' || char === '(' || char === '[' || char === '<') depth += 1;
    if (char === '}' || char === ')' || char === ']' || char === '>') depth = Math.max(0, depth - 1);
    statement += char;
    if (char === ';' && depth === 0) {
      const match = /readonly\s+([A-Za-z_$][\w$]*)(\?)?\s*:/.exec(statement);
      if (match) fields.set(match[1], Object.freeze({ required: !match[2] }));
      statement = '';
    }
  }
  return fields;
}

function expectedConfigInterfaces() {
  const out = new Map();
  const add = (owner, name, field) => {
    if (!out.has(owner)) out.set(owner, new Map());
    const existing = out.get(owner).get(name);
    if (existing && existing.required !== field.required) fail(`config reference has conflicting requiredness for ${owner}.${name}`);
    out.get(owner).set(name, Object.freeze({ required: field.required }));
  };
  for (const field of CONFIG_FIELDS) {
    const value = field.path;
    if (/^(entry|provider|outDir|schemas|dev|test)$/.test(value)) add('PulseProjectConfig', value, field);
    else if (/^schemas\.[^.\[]+$/.test(value)) add('PulseSchemaConfig', value.slice('schemas.'.length), field);
    else if (/^schemas\.json\[\]\.[^.]+$/.test(value)) add('PulseJsonSchemaDeclaration', value.split('.').at(-1), field);
    else if (/^dev\.[^.]+$/.test(value)) add('PulseProjectDevConfig', value.slice('dev.'.length), field);
    else if (/^fastly\.[^.]+$/.test(value)) add('PulseFastlyProviderOptions', value.slice('fastly.'.length), field);
    else if (/^fastly\.grip\.[^.]+$/.test(value)) add('PulseFastlyGripOptions', value.split('.').at(-1), field);
    else if (/^fastly\.local\.[^.]+$/.test(value)) add('PulseFastlyLocalOptions', value.split('.').at(-1), field);
  }
  return out;
}

function validateConfigParity(repoRoot) {
  const cliTypes = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/index.d.ts'), 'utf8');
  const fastlyTypes = fs.readFileSync(path.join(repoRoot, 'packages/provider-fastly/src/index.ts'), 'utf8');
  const expectedInterfaces = expectedConfigInterfaces();
  let fieldCount = 0;
  for (const [owner, fields] of expectedInterfaces) {
    const source = owner.startsWith('PulseFastly') ? fastlyTypes : cliTypes;
    const actual = interfaceFields(source, owner);
    const expectedNames = [...fields.keys()].sort();
    const actualNames = [...actual.keys()].sort();
    if (!isDeepEqual(actualNames, expectedNames)) fail(`${owner} config-reference parity mismatch: type=[${actualNames.join(', ')}], schema=[${expectedNames.join(', ')}]`);
    for (const [name, descriptor] of fields) {
      if (actual.get(name).required !== descriptor.required) fail(`${owner}.${name} schema requiredness does not match TypeScript optionality`);
      fieldCount += 1;
    }
  }
  const reference = fs.readFileSync(path.join(repoRoot, 'docs/reference/project-config.md'), 'utf8');
  for (const field of CONFIG_FIELDS) if (!reference.includes(`### \`${field.path}\``)) fail(`project-config reference is missing ${field.path}`);

  const expectedBundle = Object.freeze({
    schemaVersion: 'pulse.project-config-schema-bundle.v1',
    releaseVersion: RELEASE_VERSION,
    project: projectConfigSchemaDocument(),
    providers: Object.freeze({ fastly: FASTLY_CONFIG_SCHEMA })
  });
  for (const file of ['docs/reference/project-config.schema.json', 'wasm/packages/cli/docs/reference/project-config.schema.json', 'wasm/packages/cli/project-config.schema.json']) {
    if (!isDeepEqual(readJson(path.join(repoRoot, file)), expectedBundle)) fail(`${file} does not match runtime configuration schemas`);
  }
  if (PROJECT_CONFIG_SCHEMA_VERSION !== 'pulse.project-config-schema.v1') fail(`unexpected project config schema version ${PROJECT_CONFIG_SCHEMA_VERSION}`);
  if (Object.keys(CONFIG_RUNTIME_RULES).length < 11) fail('project config runtime rule catalog is incomplete');
  if (validateProjectConfigStructure({ provider: 'node', dev: { watch: true } }).length) fail('shared project config structural validator rejects a valid project');
  const unknownIssues = validateProjectConfigStructure({ unknownPass87Field: true });
  if (!unknownIssues.some((issue) => issue.path === 'unknownPass87Field')) fail('shared project config structural validator does not reject unknown fields');
  if (
    configDefault('provider') !== 'node'
    || !validateConfigValue('provider', 'fastly')
    || !validateConfigValue('provider', '@example/pulse-provider-esp32')
    || validateConfigValue('provider', '')
  ) fail('shared project config runtime rules are not active');
  if (fastlyConfigDefault('fastly.name') !== 'pulse-app' || fastlyConfigDefault('fastly.local.networkFetch') !== false) fail('Fastly config schema defaults are not active');
  const fastlyApi = require('../packages/provider-fastly/src/config-api.js');
  const defaultFastlyConfig = fastlyApi.fastly();
  if (Object.prototype.hasOwnProperty.call(defaultFastlyConfig.bindings, 'grip')) fail('Fastly config schema/runtime must omit optional GRIP bindings until configured');
  if (!isDeepEqual(fastlyApi.fastly({ grip: {} }).bindings.grip, { directHold: true })) fail('Fastly config schema/runtime must apply the GRIP directHold default when GRIP is configured');

  const projectRuntime = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/project-config.js'), 'utf8');
  for (const required of ["require('./project-config-schema.js')", 'validateProjectConfigStructure(raw)', "configDefault('provider')", "validateConfigValue('dev.port'"]) {
    if (!projectRuntime.includes(required)) fail(`project-config runtime is not consuming its shared schema: missing ${required}`);
  }
  const fastlyRuntime = [
    fs.readFileSync(path.join(repoRoot, 'packages/provider-fastly/src/config-api.js'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'packages/provider-fastly/src/index.ts'), 'utf8')
  ].join('\n');
  if (!fastlyRuntime.includes("require('./config-schema.js')") || !fastlyRuntime.includes('fastlyConfigDefault')) fail('Fastly runtime/config API is not consuming its shared schema defaults');
  if (!fastlyTypes.includes("from './config-schema.json'")) fail('Fastly TypeScript entry must import the emitted JSON schema rather than a source-only JavaScript helper');
  if (!fastlyTypes.includes('readonly grip?:') || !fastlyTypes.includes('...(normalizedGrip ? { grip: normalizedGrip } : {})')) fail('Fastly TypeScript entry must match the CommonJS optional GRIP binding shape');
  const fastlyTsconfig = readJson(path.join(repoRoot, 'packages/provider-fastly/tsconfig.json'));
  if (!Array.isArray(fastlyTsconfig.include) || !fastlyTsconfig.include.includes('src/config-schema.json')) fail('Fastly composite build must include config-schema.json so the compiled entry remains loadable');
  return Object.freeze({ fields: fieldCount, runtimeRules: Object.keys(CONFIG_RUNTIME_RULES).length, fastlyFields: Object.keys(FASTLY_CONFIG_SCHEMA.fields).length, schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION });
}

function environmentReads(repoRoot) {
  const names = new Set();
  const codeFiles = filesUnder(repoRoot, (file) => {
    if (!/\.(?:js|cjs|mjs|ts|tsx)$/.test(file)) return false;
    const rel = relative(repoRoot, file);
    return !rel.startsWith('node_modules/') && !rel.includes('/dist/') && !rel.startsWith('.git/');
  });
  const patterns = [
    /process\.env(?:\?\.)?\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
    /\benv(?:\?\.)?\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\)\.([A-Z][A-Z0-9_]*)/g
  ];
  for (const file of codeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const name = match[1];
        const suffix = source.slice(match.index + match[0].length);
        const prefix = source.slice(Math.max(0, match.index - 8), match.index);
        if (match[0].startsWith('env') && /process\.$/.test(prefix)) continue;
        if (/^\s*=(?!=)/.test(suffix) || /\bdelete\s*$/.test(prefix)) continue;
        if (/^PULSE(?:WASM)?_/.test(name) || ['FANOUT_GRIP_URL', 'PUSHPIN_GRIP_URL', 'GRIP_URL'].includes(name)) names.add(name);
      }
    }
  }
  return names;
}

function validateEnvironmentReference(repoRoot) {
  const catalogNames = new Set();
  const reference = fs.readFileSync(path.join(repoRoot, 'docs/reference/environment.md'), 'utf8');
  for (const entry of ENVIRONMENT_VARIABLES) {
    if (catalogNames.has(entry.name)) fail(`environment catalog contains duplicate ${entry.name}`);
    catalogNames.add(entry.name);
    for (const field of ['category', 'value', 'default', 'precedence', 'consumer', 'secretSafety', 'stability', 'description']) if (!entry[field] || !String(entry[field]).trim()) fail(`${entry.name} environment catalog is missing ${field}`);
    if (!entry.sourceFiles.length) fail(`${entry.name} environment catalog must name source owners`);
    for (const sourceFile of entry.sourceFiles) {
      const file = path.join(repoRoot, sourceFile);
      if (!fs.existsSync(file)) fail(`${entry.name} source owner is missing: ${sourceFile}`);
      if (!fs.readFileSync(file, 'utf8').includes(entry.name)) fail(`${entry.name} is not present in declared source owner ${sourceFile}`);
    }
    if (!reference.includes(`### \`${entry.name}\``)) fail(`environment reference is missing ${entry.name}`);
  }
  const discovered = environmentReads(repoRoot);
  const undocumented = [...discovered].filter((name) => !catalogNames.has(name)).sort();
  const stale = [...catalogNames].filter((name) => !discovered.has(name)).sort();
  if (undocumented.length) fail(`Pulse-specific environment reads are undocumented: ${undocumented.join(', ')}`);
  if (stale.length) fail(`environment catalog entries are no longer read from code: ${stale.join(', ')}`);
  return Object.freeze({ catalog: catalogNames.size, discovered: discovered.size });
}

function validatePluginReadiness(repoRoot) {
  const file = path.join(repoRoot, 'release/plugin-readiness.json');
  const readiness = readJson(file);
  if (readiness.schemaVersion !== 'pulse.plugin-readiness.v1' || readiness.releaseVersion !== RELEASE_VERSION) fail('plugin-readiness manifest is not bound to this release');
  if (readiness.publicPluginApi !== false || readiness.decision !== 'deferred') fail('The current release must defer the public plugin API');
  const keys = Object.keys(readiness.requirements || {}).sort();
  if (!isDeepEqual(keys, [...PUBLIC_PLUGIN_REQUIREMENTS].sort())) fail(`plugin-readiness requirements must be exactly ${PUBLIC_PLUGIN_REQUIREMENTS.join(', ')}`);
  for (const key of PUBLIC_PLUGIN_REQUIREMENTS) if (readiness.requirements[key] !== false) fail(`public plugin design must remain deferred until ${key} is implemented and release-gated`);
  for (const copy of ['docs/maintainers/plugin-readiness.json', 'wasm/packages/cli/docs/maintainers/plugin-readiness.json']) {
    if (!isDeepEqual(readJson(path.join(repoRoot, copy)), readiness)) fail(`${copy} is not an exact plugin-readiness copy`);
  }
  const generated = fs.readFileSync(path.join(repoRoot, 'docs/maintainers/plugin-readiness.md'), 'utf8').toLowerCase();
  if (!generated.includes('deferred') || !generated.includes('public plugin api') || !generated.includes('first-party')) fail('plugin readiness documentation must explicitly defer the public API and state the first-party boundary');
  const manifestContract = fs.readFileSync(path.join(repoRoot, 'wasm/packages/contracts/src/library/manifest.js'), 'utf8');
  const compilerContracts = fs.readFileSync(path.join(repoRoot, 'wasm/packages/library-kit/src/compiler/handler-library-contracts.js'), 'utf8');
  if (!manifestContract.includes("compiler.trust !== 'first-party'") || !compilerContracts.includes("compiler.trust !== 'first-party'") || !compilerContracts.includes('publicPluginApi: false')) fail('first-party lowerer trust enforcement is missing');
  const providers = fs.readFileSync(path.join(repoRoot, 'wasm/packages/compiler/src/provider-toolchain.js'), 'utf8');
  for (const required of ['PROVIDER_PACKAGE_SCOPE', 'PROVIDER_PACKAGE_PREFIX', 'BUILTIN_PROVIDER_IDS', '`${packageName}/toolchain`', 'resolveProviderToolchain']) {
    if (!providers.includes(required)) fail(`deterministic provider package bootstrap is missing ${required}`);
  }
  if (providers.includes('OFFICIAL_PROVIDER_PACKAGES')) fail('deterministic provider package bootstrap must not retain a concrete alias table');
  if (providers.includes("require('@pulse-compute/provider-fastly") || providers.includes("require('@pulse-compute/provider-node")) {
    fail('compiler provider bootstrap must not import a concrete host provider');
  }
  const cliProviders = fs.readFileSync(path.join(repoRoot, 'wasm/packages/cli/src/provider-drivers.js'), 'utf8');
  if (cliProviders.includes('@pulse-compute/provider-fastly') || cliProviders.includes('@pulse-compute/provider-node')) fail('CLI provider facade must not import a concrete host provider');
  if (
    CONFIG_RUNTIME_RULES.provider.kind !== 'provider-package'
    || !isDeepEqual(CONFIG_RUNTIME_RULES.provider.builtinValues, ['node', 'fastly', 'none'])
  ) fail('project schema provider rule must expose built-in host ids and exact scoped package selection');
  const publicText = sourceMarkdownFiles(repoRoot).map((name) => fs.readFileSync(name, 'utf8')).join('\n').toLowerCase();
  for (const claim of ['supports third-party plugins', 'install a provider plugin', 'publish your lowerer plugin', 'automatic plugin discovery']) {
    if (publicText.includes(claim)) fail(`public documentation makes unsupported plugin claim: ${claim}`);
  }
  return Object.freeze({ publicPluginApi: false, decision: readiness.decision, requirements: PUBLIC_PLUGIN_REQUIREMENTS.length, satisfied: 0, providers: 3 });
}

function validateDocumentationLayers(repoRoot) {
  const required = [...PRODUCT_DOCUMENTS, ...ARCHITECTURE_DOCUMENTS, ...SITE_DOCUMENTS, ...GOVERNANCE_DOCUMENTS, ...DELIVERY_DOCUMENTS, ...ROUTING_DOCUMENTS, ...MIDDLEWARE_DOCUMENTS, ...REFERENCE_ARTIFACTS, ...GOVERNANCE_ARTIFACTS, ...PUBLIC_FIXTURES, ...CHANGELOG_DOCS, ...SITE_SOURCES, ...SITE_BUILD_SOURCES, ...MAINTENANCE_SOURCES, ...DELIVERY_SOURCES];
  for (const relativeFile of required) {
    const file = path.join(repoRoot, relativeFile);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`public documentation payload is missing ${relativeFile}`);
  }
  for (const relativeFile of PRESENT_TENSE_READMES) {
    const source = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
    if (/\b(?:Pass|Phase)\s+\d+[A-Za-z0-9.-]*\b/i.test(source)) fail(`current package README still contains pass/phase narrative: ${relativeFile}`);
  }
  const packageScripts = new Set(Object.keys(readJson(path.join(repoRoot, 'package.json')).scripts || {}));
  const pnpmBuiltins = new Set(['add', 'approve-builds', 'audit', 'config', 'create', 'deploy', 'dlx', 'exec', 'fetch', 'import', 'init', 'install', 'link', 'list', 'outdated', 'pack', 'patch', 'prune', 'publish', 'rebuild', 'remove', 'run', 'setup', 'store', 'unlink', 'update', 'why']);
  for (const relativeFile of [...PRODUCT_DOCUMENTS, ...ARCHITECTURE_DOCUMENTS, ...SITE_DOCUMENTS, ...GOVERNANCE_DOCUMENTS, ...DELIVERY_DOCUMENTS, ...ROUTING_DOCUMENTS, ...MIDDLEWARE_DOCUMENTS]) {
    const source = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
    for (const match of source.matchAll(/^pnpm\s+([A-Za-z0-9:_-]+)(?:\s|$)/gm)) {
      const command = match[1];
      if (!pnpmBuiltins.has(command) && !packageScripts.has(command)) fail(`${relativeFile} documents unknown root pnpm script: ${command}`);
    }
  }
  const docsIndex = fs.readFileSync(path.join(repoRoot, 'docs/README.md'), 'utf8');
  const indexRequired = [...PRODUCT_DOCUMENTS, ...ARCHITECTURE_DOCUMENTS, ...SITE_DOCUMENTS, ...GOVERNANCE_DOCUMENTS, ...DELIVERY_DOCUMENTS, ...ROUTING_DOCUMENTS, ...MIDDLEWARE_DOCUMENTS]
    .filter((relativeFile) => classifyPublicPage(relativeFile)?.hiddenInNavigation !== true);
  for (const relativeFile of indexRequired) {
    if (relativeFile.endsWith('/README.md')) continue;
    const target = `./${relativeFile.slice('docs/'.length)}`;
    if (!docsIndex.includes(target)) fail(`documentation index does not link public page ${target}`);
  }
  const contributingIndex = fs.readFileSync(path.join(repoRoot, 'docs/contributing/README.md'), 'utf8');
  if (!contributingIndex.includes('../reference/README.md') || !contributingIndex.includes('../architecture/overview.md') || !contributingIndex.includes('../architecture/current-contracts.md')) fail('contributor index must link the reference overview and current architecture contracts');
  const maintainerIndex = fs.readFileSync(path.join(repoRoot, 'docs/maintainers/README.md'), 'utf8');
  for (const source of publicPageSources().filter((entry) => entry.startsWith('docs/maintainers/') && !entry.endsWith('/README.md'))) {
    const target = `./${path.basename(source)}`;
    if (!maintainerIndex.includes(target)) fail(`maintainer index does not link ${target}`);
  }
  const architecture = fs.readFileSync(path.join(repoRoot, 'docs/architecture/overview.md'), 'utf8');
  if (!architecture.includes('./current-contracts.md')) fail('architecture overview must link current architecture contracts');
  if (!architecture.includes('../maintainers/plugin-readiness.md')) fail('architecture overview must link plugin readiness');
  const archivePolicy = path.join(repoRoot, 'release/documentation-site-archives/README.md');
  if (!fs.existsSync(archivePolicy)) fail('immutable documentation archive policy is missing');
  const rootScripts = readJson(path.join(repoRoot, 'package.json')).scripts || {};
  if (rootScripts['docs:site'] !== 'node scripts/build-docs-site.cjs --out .pulse-docs-site') fail('documentation site command is missing or stale');
  if (rootScripts['docs:preview'] !== 'node scripts/preview-docs-site.cjs') fail('documentation preview command is missing or stale');
  const versioningReference = fs.readFileSync(path.join(repoRoot, 'docs/maintainers/documentation-versioning.md'), 'utf8');
  if (!versioningReference.includes('pnpm docs:site -- --snapshot') || !versioningReference.includes('documentation-site-archives') || !versioningReference.includes('Public product homepage') || !versioningReference.includes('release/documentation-site.json')) fail('documentation versioning reference must explain the generated homepage and immutable release snapshots');
  const workflow = path.join(repoRoot, '.github/workflows/documentation.yml');
  if (!fs.existsSync(workflow)) fail('versioned documentation validation workflow is missing');
  const workflowText = fs.readFileSync(workflow, 'utf8');
  const workflowAction = (name) => {
    const pin = MAINTENANCE_POLICY.github.actionPins[name];
    if (!pin) fail(`maintenance policy is missing documentation workflow action pin ${name}`);
    return `${name}@${pin.sha} # ${pin.version}`;
  };
  const workflowRequirements = [
    'workflow_dispatch:',
    'pull_request:',
    'branches: [main]',
    workflowAction('actions/checkout'),
    workflowAction('actions/setup-node'),
    workflowAction('actions/upload-artifact'),
    'documentation-deployment.cjs seal',
    'docs:site',
    'include-hidden-files: true'
  ];
  for (const requiredText of workflowRequirements) if (!workflowText.includes(requiredText)) fail(`documentation workflow is missing ${requiredText}`);
  for (const forbidden of ['configure-pages', 'upload-pages-artifact', 'deploy-pages', 'pages: write', 'github-pages']) if (workflowText.includes(forbidden)) fail(`documentation validation workflow must not deploy through ${forbidden}`);
  const npmWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/npm-publish.yml'), 'utf8');
  for (const requiredText of ['workflow_dispatch:', 'environment: npm-publish', 'id-token: write', 'publish-release.cjs publish', 'verify-npm-release.cjs']) if (!npmWorkflow.includes(requiredText)) fail(`npm publication workflow is missing ${requiredText}`);
  const deploymentWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/documentation-deploy.yml'), 'utf8');
  for (const requiredText of ['workflow_dispatch:', 'environment: documentation-production', '--phase immutable', '--phase promote', '--npm-verification npm-release-availability.json', 'documentation-deployment.cjs verify-public']) if (!deploymentWorkflow.includes(requiredText)) fail(`documentation deployment workflow is missing ${requiredText}`);
  const conceptText = PRODUCT_DOCUMENTS.filter((name) => name.startsWith('docs/concepts/')).map((name) => fs.readFileSync(path.join(repoRoot, name), 'utf8')).join('\n');
  const sourceBindings = (conceptText.match(/<!-- pulse-doc-source:/g) || []).length;
  const runBindings = (conceptText.match(/<!-- pulse-doc-run /g) || []).length;
  if (sourceBindings < 5) fail(`concept layer must contain at least five source-bound examples; found ${sourceBindings}`);
  if (runBindings < 2) fail(`concept layer must contain at least two executable inspect bindings; found ${runBindings}`);
  const lowerer = fs.readFileSync(path.join(repoRoot, 'docs/contributing/adding-first-party-lowerer.md'), 'utf8').slice(0, 1000).toLowerCase();
  if (!lowerer.includes('first-party') || !lowerer.includes('not an external plugin')) fail('first-party lowerer guide must state its trust boundary on the first screen');
  const provider = fs.readFileSync(path.join(repoRoot, 'docs/contributing/adding-core-provider.md'), 'utf8').slice(0, 1000).toLowerCase();
  if (!provider.includes('@pulse-compute/provider-<id>') || !provider.includes('scoped package') || !provider.includes('no dependency scanning')) {
    fail('provider-toolchain guide must state the explicit package bootstrap boundary on the first screen');
  }
  const compatibilityMatrix = fs.readFileSync(path.join(repoRoot, 'docs/reference/compatibility-matrix.md'), 'utf8');
  for (const requiredText of [
    '| Source form | Node JS | Fastly JS | Node Native | Fastly Native | Notes |',
    '| Capability | Node JS | Fastly JS | Node Native | Fastly Native | Notes |',
    'Ordinary target-compatible JavaScript package API',
    'ctx.parallel',
    'Arbitrary Promise construction or library await',
    'Ambient `fetch`, timers, environment/process access, filesystem, sockets, or provider SDK',
    'automatic JavaScript fallback',
    'wasm/packages/contracts/src/handler/surface-contract.js',
    'wasm/test/support/four-mode-conformance.cjs',
    'release/pulse-release-manifest.json'
  ]) {
    if (!compatibilityMatrix.includes(requiredText)) fail(`compatibility matrix is missing ${requiredText}`);
  }
  const matrixHeader = '| Source form | Node JS | Fastly JS | Node Native | Fastly Native | Notes |';
  const matrixOwners = filesUnder(path.join(repoRoot, 'docs'), (file) => file.endsWith('.md'))
    .map((file) => path.relative(repoRoot, file).replace(/\\/g, '/'))
    .filter((relativeFile) => fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8').includes(matrixHeader));
  if (!isDeepEqual(matrixOwners, ['docs/reference/compatibility-matrix.md'])) {
    fail(`source-form compatibility matrix must have one canonical owner; found ${matrixOwners.join(', ') || 'none'}`);
  }
  const handlerReference = fs.readFileSync(path.join(repoRoot, 'docs/reference/handler-authoring.md'), 'utf8');
  for (const requiredText of [
    '# Managed handler TypeScript and JavaScript',
    './compatibility-matrix.md',
    '## One source model',
    '## Native language boundary',
    'ctx.parallel',
    'Arbitrary library awaits and Promise construction',
    'ambient authority',
    'automatic JavaScript fallback'
  ]) {
    if (!handlerReference.includes(requiredText)) fail(`handler authoring reference is missing ${requiredText}`);
  }
  const handlerLinkOwners = Object.freeze({
    'API.md': './docs/reference/handler-authoring.md',
    'docs/packages/runtime.md': '../reference/handler-authoring.md',
    'docs/guides/routing.md': '../reference/handler-authoring.md',
    'docs/guides/troubleshooting.md': '../reference/handler-authoring.md',
    'docs/reference/diagnostics.md': 'handler-authoring.md'
  });
  for (const [relativeFile, expectedLink] of Object.entries(handlerLinkOwners)) {
    const content = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
    if (!content.includes(expectedLink)) fail(`${relativeFile} must link the canonical handler authoring reference`);
  }
  const matrixLinkOwners = Object.freeze({
    'API.md': './docs/reference/compatibility-matrix.md',
    'docs/preview-scope.md': './reference/compatibility-matrix.md',
    'docs/packages/runtime.md': '../reference/compatibility-matrix.md',
    'docs/guides/routing.md': '../reference/compatibility-matrix.md',
    'docs/guides/troubleshooting.md': '../reference/compatibility-matrix.md',
    'docs/reference/handler-authoring.md': './compatibility-matrix.md'
  });
  for (const [relativeFile, expectedLink] of Object.entries(matrixLinkOwners)) {
    const content = fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
    if (!content.includes(expectedLink)) fail(`${relativeFile} must link the canonical compatibility matrix`);
  }
  const expressMigration = fs.readFileSync(path.join(repoRoot, 'docs/guides/migrating-from-express.md'), 'utf8');
  for (const requiredText of [
    '# Migrate an Express service',
    'not an Express-compatible runtime or a drop-in replacement',
    '`return next()` permanently finishes this middleware',
    '`put`, `patch`, `delete`, `mount`, and `error`',
    'does not support `options`, `trace`, `connect`',
    'Pulse never changes targets or falls back automatically',
    '../reference/handler-authoring.md',
    '../reference/compatibility-matrix.md',
    '../concepts/bodies.md'
  ]) {
    if (!expressMigration.includes(requiredText)) fail(`Express migration guide is missing ${requiredText}`);
  }
  const schemaGuide = fs.readFileSync(path.join(repoRoot, 'docs/guides/json-schemas.md'), 'utf8');
  for (const requiredText of [
    'The compiler does not execute the registry module',
    '## Add semantic response cases',
    '## Bind every JSON boundary',
    "ctx.req.json<T>('app.Input')",
    "ctx.fetch(url).json<T>('app.Output')",
    "ctx.fetch(url, { json: value, schema: 'app.Input' })",
    "ctx.json(value, { schema: 'app.Output' })",
    "ctx.json(user, 'user.created')",
    '`pulse.strict` defaults to `true`',
    '`schemas.contentTypePolicy`',
    '`schemas.maxBytes`',
    'Optional fields'
  ]) {
    if (!schemaGuide.includes(requiredText)) fail(`JSON schema guide is missing ${requiredText}`);
  }
  const bodies = fs.readFileSync(path.join(repoRoot, 'docs/concepts/bodies.md'), 'utf8');
  for (const requiredText of [
    '## Ownership transitions',
    'Request host owns body bytes',
    'Current request owns the bounded structured value',
    'Provider retains ownership through terminal pass-through',
    'cannot be converted into a structured body',
    "ctx.fetch(url, { json: value, schema: 'namespace.Type' })"
  ]) {
    if (!bodies.includes(requiredText)) fail(`body ownership concept is missing ${requiredText}`);
  }
  const lowererContract = fs.readFileSync(path.join(repoRoot, 'docs/contributing/package-lowerer-contract.md'), 'utf8');
  for (const requiredText of [
    '## Application promise versus internal protocol',
    '## Canonical owner map',
    '## Contract pipeline',
    'wasm/packages/contracts/src/library/manifest.js',
    'wasm/packages/library-kit/src/compiler/handler-library-contracts.js',
    'wasm/packages/compiler/src/project/package-reachability.js',
    'wasm/packages/compiler/src/spine/package-operation-seam.js',
    'release/pulse-release-manifest.json'
  ]) {
    if (!lowererContract.includes(requiredText)) fail(`package lowerer contract reference is missing ${requiredText}`);
  }
  const lowererTutorial = fs.readFileSync(path.join(repoRoot, 'docs/contributing/adding-first-party-lowerer.md'), 'utf8');
  if (!lowererTutorial.includes('This is not entry-source substring discovery')) {
    fail('first-party lowerer tutorial must describe reachable-graph selection rather than entry-source scanning');
  }
  if (lowererTutorial.includes('selects those whose import subpath appears in the entry source')) {
    fail('first-party lowerer tutorial retains the obsolete entry-source scan description');
  }
  const lifecycle = fs.readFileSync(path.join(repoRoot, 'docs/guides/project-lifecycle.md'), 'utf8');
  for (const requiredText of ['pulse init', 'pulse doctor', 'pulse test', 'pulse dev', 'pulse build', 'not a required lifecycle stage', 'not a prerequisite']) {
    if (!lifecycle.includes(requiredText)) fail(`project lifecycle guide is missing ${requiredText}`);
  }
  const nodeDeployment = fs.readFileSync(path.join(repoRoot, 'docs/guides/deploying-node.md'), 'utf8');
  for (const requiredText of ['Node Native candidate', 'Node JavaScript candidate', 'automatic fallback', 'Deployment-owner boundary']) {
    if (!nodeDeployment.includes(requiredText)) fail(`Node deployment guide is missing ${requiredText}`);
  }
  const fastlyDeployment = fs.readFileSync(path.join(repoRoot, 'docs/guides/deploying-fastly.md'), 'utf8');
  for (const requiredText of ['Build Fastly Native', 'Build Fastly JavaScript', 'Provider reality is a separate gate', 'Remote deployment and activation']) {
    if (!fastlyDeployment.includes(requiredText)) fail(`Fastly deployment guide is missing ${requiredText}`);
  }
  const pulseAwarePackages = fs.readFileSync(path.join(repoRoot, 'docs/contributing/pulse-aware-packages.md'), 'utf8');
  for (const requiredText of ['ordinary JavaScript package', "compiler.trust: 'first-party'", 'exact scoped provider package', 'not a public third-party plugin API']) {
    if (!pulseAwarePackages.includes(requiredText)) fail(`Pulse-aware package guide is missing ${requiredText}`);
  }
  return Object.freeze({
    productDocuments: PRODUCT_DOCUMENTS.length,
    architectureDocuments: ARCHITECTURE_DOCUMENTS.length,
    siteDocuments: SITE_DOCUMENTS.length,
    routingDocuments: ROUTING_DOCUMENTS.length,
    middlewareDocuments: MIDDLEWARE_DOCUMENTS.length,
    governanceDocuments: GOVERNANCE_DOCUMENTS.length,
    deliveryDocuments: DELIVERY_DOCUMENTS.length,
    changelogDocuments: CHANGELOG_DOCS.length,
    siteSources: SITE_SOURCES.length,
    siteBuildSources: SITE_BUILD_SOURCES.length,
    maintenanceSources: MAINTENANCE_SOURCES.length,
    deliverySources: DELIVERY_SOURCES.length,
    machineArtifacts: REFERENCE_ARTIFACTS.length + GOVERNANCE_ARTIFACTS.length,
    publicFixtures: PUBLIC_FIXTURES.length,
    sourceBindings,
    executableBindings: runBindings
  });
}

function validateDocumentationSiteBuild(repoRoot) {
  if (repoRoot !== defaultRepoRoot) fail('documentation site validation currently requires the repository containing this release script');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-docsite-validation-'));
  try {
    const result = buildDocumentationSite({ output, clean: true });
    const sources = publicPageSources();
    const expectedPages = sources.length;
    const expectedHiddenSearchPages = sources.filter((source) => {
      const section = classifyPublicPage(source);
      const override = PUBLIC_SITE_MANIFEST.navigation.overrides[source] || {};
      return section?.hiddenInSearch === true || override.hiddenInSearch === true;
    }).length;
    if (result.pages !== expectedPages || result.searchEntries !== result.pages - expectedHiddenSearchPages) fail('generated public site does not match the active documentation source model');
    const expectedHiddenNavigationPages = sources.filter((source) => {
      const section = classifyPublicPage(source);
      const override = PUBLIC_SITE_MANIFEST.navigation.overrides[source] || {};
      return section?.hiddenInNavigation === true || override.hiddenInNavigation === true;
    }).length;
    if (result.homepage !== 1 || result.heroCanvas !== true || result.navigationSections !== visibleNavigationSections().length || result.siteAssets !== 8 || result.tocEntries === 0 || result.syntaxHighlightedBlocks === 0 || result.hiddenNavigationPages !== expectedHiddenNavigationPages || result.hiddenSearchPages !== expectedHiddenSearchPages || result.routeAliases !== Object.keys(PUBLIC_SITE_MANIFEST.routeAliases).length) fail('generated homepage or documentation shell is incomplete');
    if (result.versions !== DOCUMENTATION_VERSIONS.versions.length || result.archivedVersions !== DOCUMENTATION_VERSIONS.versions.length - 1) fail('versioned documentation site did not include every declared release');

    const exactAssets = [
      'assets/tokens.css',
      'assets/syntax-dark.css',
      'assets/site.css',
      'assets/boot.js',
      'assets/redirect.js',
      'assets/site.js',
      'assets/network-field.js',
      'assets/favicon.svg',
      'public-site-manifest.json',
      'site-version-manifest.json'
    ];
    for (const asset of exactAssets) if (!fs.existsSync(path.join(output, DOCUMENTATION.version, asset))) fail(`exact documentation subtree is missing ${asset}`);
    for (const mutable of ['tokens.css', 'syntax-dark.css', 'site.css', 'boot.js', 'redirect.js', 'site.js', 'network-field.js', 'favicon.svg']) if (fs.existsSync(path.join(output, 'assets', mutable))) fail(`exact release pages must not depend on mutable root asset assets/${mutable}`);

    const homepageFile = path.join(output, 'index.html');
    const homepage = fs.readFileSync(homepageFile, 'utf8');
    for (const marker of [
      'data-page-kind="home"',
      'class="hero-card"',
      'id="networkField"',
      'class="home-example"',
      'class="quick-start"',
      'data-hero-motion-toggle',
      'Show compiler details',
      'id="site-navigation-drawer"',
      'aria-hidden="true" inert',
      PUBLIC_SITE_MANIFEST.product.eyebrow,
      PUBLIC_SITE_MANIFEST.product.headline,
      PUBLIC_SITE_MANIFEST.homepage.sections.find((entry) => entry.type === 'example').title,
      PUBLIC_SITE_MANIFEST.homepage.sections.find((entry) => entry.type === 'inspect').title,
      DISPLAY.candidateName,
      `${cleanBasePath(DOCUMENTATION.basePath)}/${DOCUMENTATION.version}/assets/tokens.css`,
      `${cleanBasePath(DOCUMENTATION.basePath)}/${DOCUMENTATION.version}/assets/site.js`,
      `${cleanBasePath(DOCUMENTATION.basePath)}/${DOCUMENTATION.version}/assets/network-field.js`
    ]) if (!homepage.includes(marker)) fail(`public product homepage is missing ${marker}`);
    if (/http-equiv="refresh"/i.test(homepage)) fail('public product homepage must not be a redirect');
    for (const staleClaim of ['small runtime for realtime flows', 'falls back to TS/JS', 'Pulse-aware plugins can provide']) if (homepage.includes(staleClaim)) fail(`public product homepage contains obsolete claim ${staleClaim}`);
    for (const marker of ['@pulse-compute/runtime', 'Router example', '/users/:id', DISPLAY.candidateLabel]) if (!homepage.includes(marker)) fail(`public product homepage is missing ${marker}`);

    const docsPage = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'getting-started', 'index.html'), 'utf8');
    for (const marker of ['id="search-input"', 'id="version-select"', 'id="documentation-drawer"', 'aria-hidden="true" inert', 'data-nav-drawer', 'class="breadcrumbs"', 'class="docs-toc"', 'class="docs-pagination"', 'class="mobile-nav-fallback"']) {
      if (!docsPage.includes(marker)) fail(`documentation shell is missing ${marker}`);
    }
    if (docsPage.indexOf('<article class="docs-article">') > docsPage.indexOf('class="mobile-nav-fallback"')) fail('no-JavaScript mobile navigation must follow the document body');
    if (!docsPage.includes('href="#content"') || !docsPage.includes('class="skip-link"')) fail('documentation shell is missing its keyboard skip link');

    const tokens = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'assets', 'tokens.css'), 'utf8');
    const css = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'assets', 'site.css'), 'utf8');
    const syntaxTheme = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'assets', 'syntax-dark.css'), 'utf8');
    const javascript = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'assets', 'site.js'), 'utf8');
    const networkField = fs.readFileSync(path.join(output, DOCUMENTATION.version, 'assets', 'network-field.js'), 'utf8');
    if (!tokens.includes('--accent:') || !syntaxTheme.includes('--color-prettylights-syntax-keyword') || !css.includes('@media (prefers-reduced-motion: reduce)') || !networkField.includes('networkField') || !networkField.includes('visibilitychange') || !javascript.includes('drawer.inert') || !javascript.includes('focusableElements')) fail('generated site assets are missing shared design, syntax, motion, or navigation contracts');
    const publicSiteCopy = readJson(path.join(output, 'public-site-manifest.json'));
    if (!isDeepEqual(publicSiteCopy, PUBLIC_SITE_MANIFEST)) fail('generated root public-site manifest is stale');

    return Object.freeze({
      pages: result.pages,
      assets: result.assets,
      siteAssets: result.siteAssets,
      searchEntries: result.searchEntries,
      tocEntries: result.tocEntries,
      localLinks: result.localLinks,
      generatedFiles: result.generatedFiles,
      versionSegment: result.versionSegment,
      versions: result.versions,
      archivedVersions: result.archivedVersions,
      homepage: result.homepage,
      heroCanvas: result.heroCanvas,
      navigationSections: result.navigationSections
    });
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

function validateDocumentationSource(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  synchronizeMaintenancePolicy({ repoRoot, write: false });
  synchronizeReferenceDocs({ write: false });
  const maintenance = validateMaintainerControlPlane();
  const packagePolicy = validatePackagePolicy(repoRoot);
  const releaseManifest = validateReleaseManifest(repoRoot);
  const publicSite = validatePublicSiteSystem(repoRoot);
  const links = validateSourceMarkdownLinks(repoRoot);
  const diagnostics = validateDiagnostics(repoRoot);
  const cli = validateCliParity(repoRoot);
  const config = validateConfigParity(repoRoot);
  const environment = validateEnvironmentReference(repoRoot);
  const pluginReadiness = validatePluginReadiness(repoRoot);
  const metadata = validateDocumentationMetadata({ repoRoot, today: options.today });
  const layers = validateDocumentationLayers(repoRoot);
  const site = options.site === false ? undefined : validateDocumentationSiteBuild(repoRoot);
  return Object.freeze({ status: 'ok', releaseVersion: RELEASE_VERSION, maintenance, packagePolicy, releaseManifest, publicSite, links, diagnostics, cli, config, environment, pluginReadiness, metadata, layers, site });
}

function packedFile(entries, name) {
  const exact = entries.get(`package/${name}`);
  if (exact) return exact;
  if (!name || name.endsWith('/')) return entries.get(`package/${name}README.md`);
  return undefined;
}

function packedTargetExists(entries, name) {
  if (packedFile(entries, name)) return true;
  const prefix = `package/${String(name).replace(/\/$/, '')}/`;
  return [...entries.keys()].some((entry) => entry.startsWith(prefix));
}

function resolvePackedRelative(currentEntry, target) {
  const current = path.posix.dirname(currentEntry.replace(/^package\//, ''));
  const resolved = path.posix.normalize(path.posix.join(current, target));
  if (resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) fail(`${currentEntry} contains a relative link that escapes its npm tarball: ${target}`);
  return resolved;
}

function archiveForHostedSource(archives, sourcePath) {
  for (const archive of archives) if (packedFile(archive.entries, sourcePath)) return archive;
  return undefined;
}

function validatePackedDocumentationSet(archives) {
  const byName = new Map(archives.map((archive) => [archive.name, archive]));
  if (byName.size !== PACKAGE_SET.length) fail(`expected ${PACKAGE_SET.length} packed release packages, found ${byName.size}`);
  let markdownFiles = 0;
  let links = 0;
  let hostedLinks = 0;
  for (const archive of archives) {
    for (const [entryName, bytes] of archive.entries) {
      if (!entryName.endsWith('.md')) continue;
      markdownFiles += 1;
      const markdown = bytes.toString('utf8');
      for (const target of markdownLinks(markdown)) {
        if (!target || target.startsWith('mailto:') || target.startsWith('tel:')) continue;
        if (target.startsWith('#')) {
          validateAnchor(markdown, decodeURIComponent(target.slice(1)), `${archive.name}:${entryName}`);
          links += 1;
          continue;
        }
        if (/^https?:/i.test(target)) {
          if (pulseUnpkgTarget(target)) fail(`${archive.name}:${entryName} uses obsolete unpkg documentation link ${target}`);
          if (hostedPulseUrl(target)) {
            const parsed = parseDocumentationUrl(target);
            if (!parsed || parsed.versionSegment !== DOCUMENTATION.version) fail(`${archive.name}:${entryName} links a non-current documentation route ${target}`);
            const targetArchive = archiveForHostedSource(archives, parsed.sourcePath);
            if (!targetArchive) fail(`${archive.name}:${entryName} links hosted source absent from all release tarballs: ${parsed.sourcePath}`);
            const linked = packedFile(targetArchive.entries, parsed.sourcePath);
            if (parsed.anchor && parsed.sourcePath.endsWith('.md')) validateAnchor(linked.toString('utf8'), parsed.anchor, `${archive.name}:${entryName} -> ${target}`);
            hostedLinks += 1;
            links += 1;
          }
          continue;
        }
        const split = splitTarget(target);
        const resolved = resolvePackedRelative(entryName, decodeURIComponent(split.pathname || ''));
        if (!packedTargetExists(archive.entries, resolved)) fail(`${archive.name}:${entryName} links missing packed path ${target}`);
        if (split.anchor) {
          const linked = packedFile(archive.entries, resolved);
          if (linked) validateAnchor(linked.toString('utf8'), split.anchor, `${archive.name}:${entryName} -> ${target}`);
        }
        links += 1;
      }
    }
  }

  const cli = byName.get('@pulse-compute/cli');
  const api = byName.get('@pulse-compute/runtime');
  const fastly = byName.get('@pulse-compute/provider-fastly');
  const publicDocFiles = [
    'docs/README.md',
    'docs/reference/cli.md',
    'docs/reference/project-config.md',
    'docs/reference/diagnostics.md',
    'docs/packages/README.md',
    'API.md',
    'examples/README.md',
    ...PRODUCT_DOCUMENTS,
    ...ARCHITECTURE_DOCUMENTS,
    ...SITE_DOCUMENTS,
    ...GOVERNANCE_DOCUMENTS,
    ...DELIVERY_DOCUMENTS,
    ...ROUTING_DOCUMENTS,
    ...MIDDLEWARE_DOCUMENTS,
    ...REFERENCE_ARTIFACTS,
    ...GOVERNANCE_ARTIFACTS,
    ...PUBLIC_FIXTURES
  ];
  for (const required of publicDocFiles) if (!cli || !packedFile(cli.entries, required)) fail(`CLI tarball is missing installed documentation ${required}`);
  if (cli && packedFile(cli.entries, 'docs/AGENTS.md')) fail('CLI tarball must not publish repository-local AGENTS.md instructions');
  for (const required of ['completions/pulse.bash', 'completions/_pulse', 'completions/pulse.fish', 'cli-spec.json', 'project-config.schema.json', 'release-manifest.json', 'documentation-versions.json', 'documentation-site.json', 'src/project-config-schema.js', 'src/project-config-schema.d.ts', 'src/documentation.js']) {
    if (!cli || !packedFile(cli.entries, required)) fail(`CLI tarball is missing machine-readable payload ${required}`);
  }
  for (const required of ['docs/API.md', 'docs/preview-scope.md']) if (!api || !packedFile(api.entries, required)) fail(`API tarball is missing installed documentation ${required}`);
  for (const required of ['src/config-schema.json', 'src/config-schema.js', 'src/config-schema.d.ts']) if (!fastly || !packedFile(fastly.entries, required)) fail(`Fastly tarball is missing shared config schema ${required}`);

  const diagnosticsDoc = packedFile(cli.entries, 'docs/reference/diagnostics.md').toString('utf8');
  for (const code of Object.keys(DIAGNOSTIC_CATALOG)) validateAnchor(diagnosticsDoc, diagnosticAnchor(code), `packed CLI diagnostics for ${code}`);
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'cli-spec.json').toString('utf8')), publicCommandSpecDocument({ version: RELEASE_VERSION, completionShells: COMPLETION_SHELLS }))) fail('packed CLI command specification is stale');
  const expectedConfigBundle = readJson(path.join(defaultRepoRoot, 'docs/reference/project-config.schema.json'));
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'project-config.schema.json').toString('utf8')), expectedConfigBundle)) fail('packed project config schema bundle is stale');
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'release-manifest.json').toString('utf8')), RELEASE_MANIFEST)) fail('packed release manifest is stale');
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'documentation-versions.json').toString('utf8')), DOCUMENTATION_VERSIONS)) fail('packed documentation versions are stale');
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'documentation-site.json').toString('utf8')), PUBLIC_SITE_MANIFEST)) fail('packed documentation site manifest is stale');
  if (!isDeepEqual(JSON.parse(packedFile(cli.entries, 'docs/maintainers/maintenance-policy.json').toString('utf8')), MAINTENANCE_POLICY)) fail('packed maintenance policy is stale');
  if (!isDeepEqual(JSON.parse(packedFile(fastly.entries, 'src/config-schema.json').toString('utf8')), FASTLY_CONFIG_SCHEMA)) fail('packed Fastly config schema is stale');
  for (const shell of COMPLETION_SHELLS) {
    const content = packedFile(cli.entries, `completions/${completionFile(shell)}`).toString('utf8');
    if (content !== renderCompletion(shell)) fail(`packed ${shell} completion is stale`);
  }
  return Object.freeze({ status: 'ok', archives: archives.length, markdownFiles, links, hostedLinks });
}

function main() {
  try {
    const result = validateDocumentationSource();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  markdownLinks,
  markdownAnchors,
  pulseUnpkgTarget,
  validateDocumentationSource,
  validatePackedDocumentationSet,
  validateConfigParity,
  validateCliParity,
  validateDiagnostics,
  validateEnvironmentReference,
  validateDocumentationLayers,
  validatePluginReadiness,
  validateReleaseManifest,
  validatePublicSiteSystem,
  PRODUCT_DOCUMENTS,
  ARCHITECTURE_DOCUMENTS,
  SITE_DOCUMENTS,
  GOVERNANCE_DOCUMENTS,
  DELIVERY_DOCUMENTS,
  ROUTING_DOCUMENTS,
  MIDDLEWARE_DOCUMENTS,
  CHANGELOG_DOCS,
  SITE_SOURCES,
  SITE_BUILD_SOURCES,
  MAINTENANCE_SOURCES,
  DELIVERY_SOURCES,
  REFERENCE_ARTIFACTS,
  GOVERNANCE_ARTIFACTS,
  PUBLIC_FIXTURES
});

if (require.main === module) main();
