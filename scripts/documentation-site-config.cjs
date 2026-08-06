'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RELEASE_VERSION } = require('./package-support.cjs');

const repoRoot = path.resolve(__dirname, '..');
const PUBLIC_SITE_MANIFEST_FILE = path.join(repoRoot, 'release', 'documentation-site.json');
const PUBLIC_SITE_SCHEMA = 'pulse.public-site.v1';
const HOMEPAGE_SECTION_TYPES = Object.freeze(['example', 'journey', 'contract', 'inspect', 'scope']);

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_PUBLIC_SITE_INVALID';
  throw error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string`);
  return value;
}

function array(value, name) {
  if (!Array.isArray(value) || value.length === 0) fail(`${name} must be a non-empty array`);
  return value;
}

function requireDocument(manifest, id, context) {
  if (!manifest.documents[id]) fail(`${context} references unknown document ${id}`);
}

function validateAction(manifest, action, context) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) fail(`${context} must be an object`);
  nonEmpty(action.label, `${context}.label`);
  requireDocument(manifest, nonEmpty(action.document, `${context}.document`), context);
}

function validatePublicSiteManifest(value, options = {}) {
  const root = path.resolve(options.repoRoot || repoRoot);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('public-site manifest must be an object');
  if (value.schemaVersion !== PUBLIC_SITE_SCHEMA) fail(`unsupported public-site schema ${value.schemaVersion}`);
  if (value.releaseVersion !== RELEASE_VERSION) fail(`public-site release ${value.releaseVersion} does not match ${RELEASE_VERSION}`);

  const product = value.product;
  if (!product || typeof product !== 'object' || Array.isArray(product)) fail('public-site product is required');
  for (const field of ['name', 'eyebrow', 'headline', 'summary', 'description']) nonEmpty(product[field], `product.${field}`);

  if (!value.documents || typeof value.documents !== 'object' || Array.isArray(value.documents)) fail('public-site documents map is required');
  const documentSources = new Set();
  for (const [id, document] of Object.entries(value.documents)) {
    nonEmpty(id, 'document id');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`document id ${id} must be lowercase kebab-case`);
    if (!document || typeof document !== 'object' || Array.isArray(document)) fail(`document ${id} must be an object`);
    const source = nonEmpty(document.source, `documents.${id}.source`).replace(/\\/g, '/');
    nonEmpty(document.label, `documents.${id}.label`);
    if (documentSources.has(source)) fail(`public-site documents contain duplicate source ${source}`);
    documentSources.add(source);
    const file = path.join(root, source);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`document ${id} source is missing: ${source}`);
  }

  if (!value.sourceAliases || typeof value.sourceAliases !== 'object' || Array.isArray(value.sourceAliases)) fail('public-site sourceAliases map is required');
  for (const [source, target] of Object.entries(value.sourceAliases)) {
    nonEmpty(source, 'source alias');
    nonEmpty(target, `sourceAliases.${source}`);
    if (source === target) fail(`source alias ${source} may not target itself`);
    if (!fs.existsSync(path.join(root, source)) || !fs.statSync(path.join(root, source)).isFile()) fail(`source alias is missing: ${source}`);
    if (!documentSources.has(target)) fail(`source alias ${source} must target a named public-site document; found ${target}`);
    if (Object.prototype.hasOwnProperty.call(value.sourceAliases, target)) fail(`source alias ${source} may not target another alias ${target}`);
  }
  if (!value.routeAliases || typeof value.routeAliases !== 'object' || Array.isArray(value.routeAliases)) fail('public-site routeAliases map is required');
  for (const [route, target] of Object.entries(value.routeAliases)) {
    const alias = nonEmpty(route, 'route alias');
    if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(alias)) fail(`route alias ${alias} must be a normalized relative route`);
    requireDocument(value, nonEmpty(target, `routeAliases.${route}`), `route alias ${route}`);
  }

  if (!value.header || typeof value.header !== 'object') fail('public-site header is required');
  for (const [index, link] of array(value.header.navigation, 'header.navigation').entries()) {
    if (!link || typeof link !== 'object') fail(`header.navigation[${index}] must be an object`);
    nonEmpty(link.label, `header.navigation[${index}].label`);
    const modes = Number(Boolean(link.document)) + Number(Boolean(link.repository));
    if (modes !== 1) fail(`header.navigation[${index}] must select exactly one document or repository target`);
    if (link.document) requireDocument(value, link.document, `header.navigation[${index}]`);
    if (link.repository && !['web', 'bugs'].includes(link.repository)) fail(`header.navigation[${index}] uses unsupported repository target ${link.repository}`);
  }

  if (!value.navigation || typeof value.navigation !== 'object') fail('public-site navigation is required');
  const sectionIds = new Set();
  const explicitSources = new Set();
  const sectionOrders = new Set();
  for (const [index, section] of array(value.navigation.sections, 'navigation.sections').entries()) {
    if (!section || typeof section !== 'object') fail(`navigation.sections[${index}] must be an object`);
    const id = nonEmpty(section.id, `navigation.sections[${index}].id`);
    nonEmpty(section.label, `navigation.sections[${index}].label`);
    if (sectionIds.has(id)) fail(`duplicate navigation section ${id}`);
    sectionIds.add(id);
    if (!Number.isFinite(section.order)) fail(`navigation section ${id} order must be numeric`);
    if (sectionOrders.has(section.order)) fail(`duplicate navigation section order ${section.order}`);
    sectionOrders.add(section.order);
    if (section.searchPriority !== undefined && !Number.isFinite(section.searchPriority)) fail(`navigation section ${id} searchPriority must be numeric`);
    if (section.hiddenInNavigation !== undefined && typeof section.hiddenInNavigation !== 'boolean') fail(`navigation section ${id} hiddenInNavigation must be boolean`);
    if (section.hiddenInSearch !== undefined && typeof section.hiddenInSearch !== 'boolean') fail(`navigation section ${id} hiddenInSearch must be boolean`);
    if (section.hiddenInSearch === true && section.hiddenInNavigation !== true) fail(`navigation section ${id} may be hidden in search only when it is hidden in navigation`);
    const sources = Array.isArray(section.sources) ? section.sources : [];
    const prefixes = Array.isArray(section.prefixes) ? section.prefixes : [];
    if (sources.length + prefixes.length === 0) fail(`navigation section ${id} must declare sources or prefixes`);
    for (const source of sources) {
      nonEmpty(source, `navigation section ${id} source`);
      if (explicitSources.has(source)) fail(`navigation source ${source} appears in more than one section`);
      explicitSources.add(source);
      if (!fs.existsSync(path.join(root, source))) fail(`navigation section ${id} references missing source ${source}`);
    }
    for (const prefix of prefixes) nonEmpty(prefix, `navigation section ${id} prefix`);
  }
  if (!value.navigation.overrides || typeof value.navigation.overrides !== 'object' || Array.isArray(value.navigation.overrides)) fail('navigation.overrides must be an object');
  for (const [source, override] of Object.entries(value.navigation.overrides)) {
    if (!fs.existsSync(path.join(root, source))) fail(`navigation override references missing source ${source}`);
    if (!override || typeof override !== 'object' || Array.isArray(override)) fail(`navigation override ${source} must be an object`);
    if (override.title !== undefined) nonEmpty(override.title, `navigation.overrides.${source}.title`);
    if (override.order !== undefined && !Number.isFinite(override.order)) fail(`navigation.overrides.${source}.order must be numeric`);
    if (override.hiddenInNavigation !== undefined && typeof override.hiddenInNavigation !== 'boolean') fail(`navigation.overrides.${source}.hiddenInNavigation must be boolean`);
    if (override.hiddenInSearch !== undefined && typeof override.hiddenInSearch !== 'boolean') fail(`navigation.overrides.${source}.hiddenInSearch must be boolean`);
    if (override.hiddenInSearch === true && override.hiddenInNavigation !== true) fail(`navigation override ${source} may be hidden in search only when it is hidden in navigation`);
    if (override.navigationParent !== undefined) {
      const parent = nonEmpty(override.navigationParent, `navigation.overrides.${source}.navigationParent`);
      if (!fs.existsSync(path.join(root, parent)) || !fs.statSync(path.join(root, parent)).isFile()) fail(`navigation override ${source} references missing parent ${parent}`);
      if (parent === source) fail(`navigation override ${source} may not parent itself`);
      if (override.hiddenInNavigation !== true) fail(`navigation override ${source} may set navigationParent only when hiddenInNavigation is true`);
    }
    if (override.hiddenInNavigation === true && override.navigationParent === undefined) fail(`navigation override ${source} must identify a visible navigationParent`);
  }

  const homepage = value.homepage;
  if (!homepage || typeof homepage !== 'object' || Array.isArray(homepage)) fail('public-site homepage is required');
  const hero = homepage.hero;
  if (!hero || typeof hero !== 'object' || Array.isArray(hero)) fail('homepage.hero is required');
  validateAction(value, hero.primaryAction, 'homepage.hero.primaryAction');
  validateAction(value, hero.secondaryAction, 'homepage.hero.secondaryAction');
  validateAction(value, hero.scopeAction, 'homepage.hero.scopeAction');
  for (const [index, command] of array(hero.terminal, 'homepage.hero.terminal').entries()) nonEmpty(command, `homepage.hero.terminal[${index}]`);

  const sectionIdsSeen = new Set();
  const sectionTypesSeen = new Set();
  for (const [index, section] of array(homepage.sections, 'homepage.sections').entries()) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) fail(`homepage.sections[${index}] must be an object`);
    const id = nonEmpty(section.id, `homepage.sections[${index}].id`);
    const type = nonEmpty(section.type, `homepage.sections[${index}].type`);
    if (sectionIdsSeen.has(id)) fail(`duplicate homepage section ${id}`);
    if (!HOMEPAGE_SECTION_TYPES.includes(type)) fail(`homepage section ${id} uses unsupported type ${type}`);
    if (sectionTypesSeen.has(type)) fail(`homepage section type ${type} may appear only once`);
    sectionIdsSeen.add(id);
    sectionTypesSeen.add(type);
    for (const field of ['eyebrow', 'title', 'body']) nonEmpty(section[field], `homepage section ${id}.${field}`);
    validateAction(value, section.action, `homepage section ${id}.action`);
    if (type === 'example') {
      nonEmpty(section.codeLabel, `homepage section ${id}.codeLabel`);
      nonEmpty(section.language, `homepage section ${id}.language`);
      for (const [lineIndex, line] of array(section.code, `homepage section ${id}.code`).entries()) {
        if (typeof line !== 'string') fail(`homepage section ${id}.code[${lineIndex}] must be a string`);
      }
      for (const [pointIndex, point] of array(section.points, `homepage section ${id}.points`).entries()) {
        nonEmpty(point && point.title, `homepage section ${id}.points[${pointIndex}].title`);
        nonEmpty(point && point.body, `homepage section ${id}.points[${pointIndex}].body`);
      }
    } else if (type === 'journey') {
      for (const [stageIndex, stage] of array(section.stages, `homepage section ${id}.stages`).entries()) {
        nonEmpty(stage && stage.label, `homepage section ${id}.stages[${stageIndex}].label`);
        nonEmpty(stage && stage.detail, `homepage section ${id}.stages[${stageIndex}].detail`);
      }
    } else if (type === 'contract') {
      for (const [constraintIndex, constraint] of array(section.constraints, `homepage section ${id}.constraints`).entries()) {
        nonEmpty(constraint && constraint.title, `homepage section ${id}.constraints[${constraintIndex}].title`);
        nonEmpty(constraint && constraint.body, `homepage section ${id}.constraints[${constraintIndex}].body`);
      }
    } else if (type === 'inspect') {
      nonEmpty(section.command, `homepage section ${id}.command`);
      const fixture = nonEmpty(section.fixture, `homepage section ${id}.fixture`);
      if (!fs.existsSync(path.join(root, fixture))) fail(`homepage section ${id} fixture is missing: ${fixture}`);
    } else if (type === 'scope') {
      for (const field of ['supported', 'excluded']) {
        for (const [itemIndex, item] of array(section[field], `homepage section ${id}.${field}`).entries()) nonEmpty(item, `homepage section ${id}.${field}[${itemIndex}]`);
      }
    }
  }
  for (const type of HOMEPAGE_SECTION_TYPES) if (!sectionTypesSeen.has(type)) fail(`homepage is missing required ${type} section`);

  const footer = homepage.footer;
  if (!footer || typeof footer !== 'object') fail('homepage.footer is required');
  nonEmpty(footer.line, 'homepage.footer.line');
  for (const [index, link] of array(footer.links, 'homepage.footer.links').entries()) validateAction(value, link, `homepage.footer.links[${index}]`);

  return deepFreeze(value);
}

function loadPublicSiteManifest(file = PUBLIC_SITE_MANIFEST_FILE, options = {}) {
  if (!fs.existsSync(file)) fail(`public-site manifest is missing: ${file}`);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`public-site manifest is not valid JSON: ${error.message}`); }
  return validatePublicSiteManifest(value, options);
}

const PUBLIC_SITE_MANIFEST = loadPublicSiteManifest();

function classifyPublicPage(sourcePath, manifest = PUBLIC_SITE_MANIFEST) {
  const source = String(sourcePath).replace(/\\/g, '/');
  for (const section of [...manifest.navigation.sections].sort((left, right) => left.order - right.order)) {
    if ((section.sources || []).includes(source)) return section;
    if ((section.prefixes || []).some((prefix) => source.startsWith(prefix))) return section;
  }
  return undefined;
}

function visibleNavigationSections(manifest = PUBLIC_SITE_MANIFEST) {
  return Object.freeze(manifest.navigation.sections.filter((section) => section.hiddenInNavigation !== true));
}

function documentById(id, manifest = PUBLIC_SITE_MANIFEST) {
  const document = manifest.documents[id];
  if (!document) fail(`unknown public-site document ${id}`);
  return document;
}

function interpolateRelease(value) {
  return String(value).replaceAll('{{releaseVersion}}', RELEASE_VERSION);
}

module.exports = Object.freeze({
  PUBLIC_SITE_SCHEMA,
  PUBLIC_SITE_MANIFEST_FILE,
  PUBLIC_SITE_MANIFEST,
  HOMEPAGE_SECTION_TYPES,
  loadPublicSiteManifest,
  validatePublicSiteManifest,
  classifyPublicPage,
  visibleNavigationSections,
  documentById,
  interpolateRelease
});
