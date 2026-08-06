#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  RELEASE_MANIFEST,
  RELEASE_VERSION,
  DISPLAY,
  REPOSITORY,
  DOCUMENTATION
} = require('./package-support.cjs');
const {
  DOCUMENTATION_VERSIONS,
  cleanBasePath,
  sourceToRoute,
  documentationUrl
} = require('./documentation-system.cjs');

const repoRoot = path.resolve(__dirname, '..');
const defaultOutput = path.join(repoRoot, '.pulse-docs-site');
const defaultArchiveRoot = path.join(repoRoot, 'release', 'documentation-site-archives');
const { OWNERS, parseMetadata } = require('./documentation-ownership.cjs');
const {
  PUBLIC_SITE_MANIFEST,
  PUBLIC_SITE_MANIFEST_FILE,
  classifyPublicPage,
  visibleNavigationSections,
  documentById,
  interpolateRelease
} = require('./documentation-site-config.cjs');
const siteAssetRoot = path.join(repoRoot, 'scripts', 'documentation-site');
const SITE_ASSET_FILES = Object.freeze(['tokens.css', 'syntax-dark.css', 'site.css', 'boot.js', 'redirect.js', 'site.js', 'network-field.js', 'favicon.svg']);
const HOSTED_SOURCE_ALIASES = Object.freeze(new Map(Object.entries(PUBLIC_SITE_MANIFEST.sourceAliases)));

const syntaxHighlightScript = path.join(repoRoot, 'scripts', 'highlight-code-blocks.mjs');
const HIGHLIGHT_SCHEMA_VERSION = 'pulse.documentation-highlights.v1';
const STARRY_NIGHT_VERSION = readJson(path.join(repoRoot, 'package.json')).devDependencies?.['@wooorm/starry-night'];
if (typeof STARRY_NIGHT_VERSION !== 'string' || !STARRY_NIGHT_VERSION) fail('root package must pin @wooorm/starry-night for documentation generation');

function codeBlockKey(language, value) {
  return `${String(language || '').trim().toLowerCase()}\u0000${String(value)}`;
}

function fencedCodeBlocks(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const fence = /^\s{0,3}```\s*([^\s]*)\s*$/.exec(lines[index]);
    if (!fence) { index += 1; continue; }
    const body = [];
    index += 1;
    while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) body.push(lines[index++]);
    if (index < lines.length) index += 1;
    blocks.push(Object.freeze({ language: fence[1] || '', value: body.join('\n') }));
  }
  return Object.freeze(blocks);
}

function highlightMarkdownCode(markdownEntries) {
  if (!fs.existsSync(syntaxHighlightScript)) fail('documentation syntax-highlighting helper is missing');
  const unique = new Map();
  const occurrences = [];
  for (const entry of markdownEntries) {
    for (const block of fencedCodeBlocks(entry.markdown)) {
      const key = codeBlockKey(block.language, block.value);
      occurrences.push(Object.freeze({ key, language: block.language, sourcePath: entry.sourcePath }));
      if (!unique.has(key)) unique.set(key, Object.freeze({ key, ...block }));
    }
  }
  const highlighted = new Map();
  if (unique.size) {
    const result = spawnSync(process.execPath, [syntaxHighlightScript], {
      cwd: repoRoot,
      input: JSON.stringify({ schemaVersion: HIGHLIGHT_SCHEMA_VERSION, blocks: [...unique.values()] }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' }
    });
    if (result.error) fail(`Starry Night highlighting failed: ${result.error.message}`);
    if (result.status !== 0) fail(`Starry Night highlighting failed: ${(result.stderr || result.stdout || '').trim()}`);
    let parsed;
    try { parsed = JSON.parse(result.stdout); }
    catch (error) { fail(`Starry Night highlighting returned invalid JSON: ${error.message}`); }
    if (parsed.schemaVersion !== HIGHLIGHT_SCHEMA_VERSION || !Array.isArray(parsed.blocks)) fail('Starry Night highlighting returned an unsupported result');
    const byKey = new Map(parsed.blocks.map((block) => [block.key, block]));
    for (const [key, block] of unique) {
      const value = byKey.get(block.key);
      if (!value) fail(`Starry Night highlighting omitted ${block.key}`);
      highlighted.set(key, Object.freeze(value));
    }
  }
  const highlightedOccurrences = occurrences.filter((entry) => highlighted.get(entry.key)?.highlighted).length;
  const languages = [...new Set(occurrences.filter((entry) => highlighted.get(entry.key)?.highlighted).map((entry) => highlighted.get(entry.key).language))].sort();
  Object.defineProperty(highlighted, 'summary', {
    enumerable: false,
    value: Object.freeze({
      engine: '@wooorm/starry-night',
      version: STARRY_NIGHT_VERSION,
      grammarSet: 'common',
      theme: 'dark',
      buildTime: true,
      totalBlocks: occurrences.length,
      labelledBlocks: occurrences.filter((entry) => entry.language).length,
      highlightedBlocks: highlightedOccurrences,
      plainBlocks: occurrences.length - highlightedOccurrences,
      languages: Object.freeze(languages)
    })
  });
  return highlighted;
}

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_DOCUMENTATION_SITE_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function stable(value) { return `${String(value).replace(/\r\n/g, '\n').replace(/\s+$/u, '')}\n`; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function trimSlashes(value) { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function filesUnder(root, predicate = () => true, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function publicPageSources() {
  const pages = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'CHANGELOG.md'),
    path.join(repoRoot, 'API.md'),
    ...filesUnder(path.join(repoRoot, 'docs'), (file) => file.endsWith('.md')
      && path.basename(file) !== 'AGENTS.md'
      && !file.includes(`${path.sep}internal${path.sep}`)
      && !file.includes(`${path.sep}architecture${path.sep}decisions${path.sep}`)),
    ...filesUnder(path.join(repoRoot, 'examples'), (file) => path.basename(file) === 'README.md')
  ];
  return [...new Set(pages)]
    .sort()
    .map((file) => slash(path.relative(repoRoot, file)))
    .filter((sourcePath) => !HOSTED_SOURCE_ALIASES.has(sourcePath));
}

function publicAssetSources() {
  return filesUnder(path.join(repoRoot, 'docs'), (file) => !file.endsWith('.md') && path.basename(file) !== 'AGENTS.md' && !file.includes(`${path.sep}internal${path.sep}`))
    .sort()
    .map((file) => slash(path.relative(repoRoot, file)));
}

function sourceAssetRoute(sourcePath) {
  const source = slash(sourcePath);
  if (source.startsWith('docs/')) return source.slice('docs/'.length);
  if (source.startsWith('examples/')) return source;
  return source;
}

function routeOutput(root, versionSegment, route) {
  const clean = trimSlashes(route);
  return path.join(root, versionSegment, clean, 'index.html');
}

function assetOutput(root, versionSegment, sourcePath) {
  return path.join(root, versionSegment, sourceAssetRoute(sourcePath));
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

function titleFromMarkdown(markdown, sourcePath) {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  if (match) return match[1].replace(/[`*_~]/g, '').trim();
  return path.basename(sourcePath, path.extname(sourcePath));
}

function stripMarkdown(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_~>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataFor(sourcePath, markdown) {
  const parsed = parseMetadata(markdown);
  const value = parsed || Object.freeze({
    owner: 'docs-platform',
    status: 'active',
    lastReviewed: RELEASE_MANIFEST.releasedAt,
    reviewBy: '2027-01-12'
  });
  const owner = OWNERS[value.owner];
  if (!owner) fail(`${sourcePath} names unknown documentation owner ${value.owner}`);
  return Object.freeze({
    ownerId: value.owner,
    owner,
    status: value.status,
    reviewedAt: value.lastReviewed,
    reviewBy: value.reviewBy,
    reviewPolicy: value.reviewBy ? `review by ${value.reviewBy}` : 'review on contract change'
  });
}

function splitLink(target) {
  const hashAt = target.indexOf('#');
  const beforeHash = hashAt < 0 ? target : target.slice(0, hashAt);
  const anchor = hashAt < 0 ? '' : target.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  return Object.freeze({
    pathname: queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt),
    query: queryAt < 0 ? '' : beforeHash.slice(queryAt),
    anchor
  });
}

function siteHref(target, sourcePath, context) {
  const raw = String(target || '').trim();
  if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/i.test(raw)) return raw;
  const split = splitLink(raw);
  if (!split.pathname) return `${split.query}${split.anchor}`;
  const sourceFile = path.join(repoRoot, sourcePath);
  let resolved = path.resolve(path.dirname(sourceFile), decodeURIComponent(split.pathname));
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) resolved = path.join(resolved, 'README.md');
  if (!within(repoRoot, resolved)) return raw;
  const relative = slash(path.relative(repoRoot, resolved));
  const hostedSource = HOSTED_SOURCE_ALIASES.get(relative) || relative;
  if (context.pageSet.has(hostedSource)) {
    const route = sourceToRoute(hostedSource);
    return `${context.basePath}/${context.versionSegment}/${route}${split.query}${split.anchor}`;
  }
  if (context.assetSet.has(relative)) {
    return `${context.basePath}/${context.versionSegment}/${sourceAssetRoute(relative)}${split.query}${split.anchor}`;
  }
  const tag = `v${RELEASE_VERSION}`;
  return `${REPOSITORY.web}/blob/${tag}/${relative}${split.anchor}`;
}

function renderInline(value, sourcePath, context) {
  const tokens = [];
  const token = (html) => {
    const id = `\u0000PULSE${tokens.length}\u0000`;
    tokens.push(html);
    return id;
  };
  let source = String(value);
  source = source.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
    const target = siteHref(href.trim(), sourcePath, context);
    return token(`<img src="${escapeHtml(target)}" alt="${escapeHtml(alt)}" loading="lazy">`);
  });
  source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = siteHref(href.trim().replace(/^<|>$/g, ''), sourcePath, context);
    const external = /^https?:/i.test(target) ? ' rel="noopener"' : '';
    return token(`<a href="${escapeHtml(target)}"${external}>${escapeHtml(label)}</a>`);
  });
  source = escapeHtml(source)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    source = source.split(`\u0000PULSE${index}\u0000`).join(tokens[index]);
  }
  return source;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

function markdownToHtml(markdown, sourcePath, context) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const headings = [];
  const slugCounts = new Map();
  const usedIds = new Set();
  let pendingHeadingAnchor;
  let index = 0;
  const isSpecial = (line, next) => !line.trim()
    || /^\s{0,3}```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*(?:[-*+] |\d+\. )/.test(line)
    || /^>\s?/.test(line)
    || /^<a\s+(?:id|name)=/.test(line)
    || (line.includes('|') && next !== undefined && isTableSeparator(next));

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = /^\s{0,3}```\s*([^\s]*)\s*$/.exec(line);
    if (fence) {
      const rawLanguage = String(fence[1] || '').trim();
      const languageClass = rawLanguage && /^[A-Za-z0-9_+-]+$/.test(rawLanguage) ? ` language-${escapeHtml(rawLanguage.toLowerCase())}` : '';
      const body = [];
      index += 1;
      while (index < lines.length && !/^\s{0,3}```\s*$/.test(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      const value = body.join('\n');
      const highlighted = context.highlights?.get(codeBlockKey(rawLanguage, value));
      const mode = highlighted?.highlighted ? 'starry-night' : 'plain';
      const code = highlighted?.highlighted ? highlighted.html : escapeHtml(value);
      const scope = highlighted?.scope ? ` data-scope="${escapeHtml(highlighted.scope)}"` : '';
      html.push(`<pre class="code-block"><code class="code-block__content${languageClass}" data-highlighted="${mode}"${scope}>${code}</code></pre>`);
      continue;
    }
    if (/^<!--/.test(line.trim())) {
      while (index < lines.length && !/-->/.test(lines[index])) index += 1;
      index += 1;
      continue;
    }
    const anchor = /^\s*<a\s+(?:id|name)=["']([^"']+)["'][^>]*><\/a>\s*$/.exec(line);
    if (anchor) {
      const id = anchor[1];
      if (usedIds.has(id) || pendingHeadingAnchor === id) fail(`${sourcePath} declares duplicate anchor ${id}`);
      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      if (next < lines.length && /^(#{1,6})\s+/.test(lines[next])) {
        pendingHeadingAnchor = id;
      } else {
        usedIds.add(id);
        html.push(`<a id="${escapeHtml(id)}"></a>`);
      }
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const plain = stripMarkdown(text);
      const base = githubSlug(plain) || 'section';
      let id = pendingHeadingAnchor;
      pendingHeadingAnchor = undefined;
      if (!id) {
        let count = slugCounts.get(base) || 0;
        id = count === 0 ? base : `${base}-${count}`;
        while (usedIds.has(id)) {
          count += 1;
          id = `${base}-${count}`;
        }
        slugCounts.set(base, count + 1);
      }
      if (usedIds.has(id)) fail(`${sourcePath} declares duplicate heading id ${id}`);
      usedIds.add(id);
      headings.push(Object.freeze({ level, text: plain, id }));
      html.push(`<h${level} id="${escapeHtml(id)}">${renderInline(text, sourcePath, context)}<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></h${level}>`);
      index += 1;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]));
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInline(cell, sourcePath, context)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, sourcePath, context)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) body.push(lines[index++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${body.map((entry) => `<p>${renderInline(entry, sourcePath, context)}</p>`).join('')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''));
      html.push(`<ul>${items.map((entry) => `<li>${renderInline(entry, sourcePath, context)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ''));
      html.push(`<ol>${items.map((entry) => `<li>${renderInline(entry, sourcePath, context)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { html.push('<hr>'); index += 1; continue; }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !isSpecial(lines[index], lines[index + 1])) paragraph.push(lines[index++].trim());
    html.push(`<p>${renderInline(paragraph.join(' '), sourcePath, context)}</p>`);
  }
  return Object.freeze({ html: html.join('\n'), headings: Object.freeze(headings) });
}

function rooted(basePath, value = '') {
  return `${basePath || ''}/${String(value).replace(/^\/+/, '')}`;
}

function pulseMark() {
  return '<svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h4l2.1-5.5 3.3 11L14 12h8"></path></svg>';
}

function arrowIcon() {
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11"></path><path d="m11 6 4 4-4 4"></path></svg>';
}

function documentHref(id, context, versionSegment = context.versionSegment) {
  const document = documentById(id);
  return rooted(context.basePath, `${versionSegment}/${sourceToRoute(document.source)}`);
}

function navigationSectionFor(sourcePath) {
  const sections = PUBLIC_SITE_MANIFEST.navigation.sections;
  const explicit = sections.filter((section) => (section.sources || []).includes(sourcePath));
  if (explicit.length > 1) fail(`${sourcePath} is explicitly assigned to multiple navigation sections`);
  if (explicit.length === 1) return explicit[0];
  const prefixed = sections.filter((section) => (section.prefixes || []).some((prefix) => sourcePath.startsWith(prefix)));
  if (prefixed.length !== 1) fail(`${sourcePath} must match exactly one navigation prefix; found ${prefixed.length}`);
  const classified = classifyPublicPage(sourcePath);
  if (!classified || classified.id !== prefixed[0].id) fail(`${sourcePath} navigation classification is inconsistent`);
  return prefixed[0];
}

function navigationModel(pages) {
  const groups = [...visibleNavigationSections()]
    .sort((left, right) => left.order - right.order)
    .map((section) => Object.freeze({
      ...section,
      pages: Object.freeze(pages
        .filter((page) => page.section.id === section.id && !page.hiddenInNavigation)
        .sort((left, right) => left.navigationOrder - right.navigationOrder || left.navigationTitle.localeCompare(right.navigationTitle)))
    }));
  for (const group of groups) if (group.pages.length === 0) fail(`navigation section ${group.id} contains no pages`);
  return Object.freeze(groups);
}

function flattenNavigation(groups) {
  return Object.freeze(groups.flatMap((group) => group.pages));
}

function renderNavigation(groups, activeSource, context) {
  return groups.map((group) => {
    const active = group.pages.some((page) => page.sourcePath === activeSource);
    const open = group.defaultOpen || active ? ' open' : '';
    const links = group.pages.map((page) => {
      const href = rooted(context.basePath, `${context.versionSegment}/${page.route}`);
      const current = page.sourcePath === activeSource ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(href)}"${current}>${escapeHtml(page.navigationTitle)}</a></li>`;
    }).join('');
    return `<details class="nav-section" data-nav-section="${escapeHtml(group.id)}"${open}><summary>${escapeHtml(group.label)}</summary><ul>${links}</ul></details>`;
  }).join('');
}

function renderHeaderNavigation(context, options = {}) {
  const versionSegment = options.versionSegment || context.versionSegment;
  return PUBLIC_SITE_MANIFEST.header.navigation.map((link) => {
    let href;
    let external = '';
    if (link.document) href = documentHref(link.document, context, versionSegment);
    else {
      href = REPOSITORY[link.repository];
      external = ' rel="noopener"';
    }
    const current = options.activeDocument && link.document === options.activeDocument ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(href)}"${current}${external}>${escapeHtml(link.label)}</a>`;
  }).join('');
}

function renderVersionOptions(context) {
  return DOCUMENTATION_VERSIONS.versions.map((entry) => {
    const selected = entry.segment === context.versionSegment ? ' selected' : '';
    const label = entry.segment === DOCUMENTATION.version ? DISPLAY.candidateLabel : entry.channel;
    return `<option value="${escapeHtml(entry.segment)}"${selected}>${escapeHtml(entry.version)} · ${escapeHtml(label)}</option>`;
  }).join('');
}

function renderSiteHeader(context, options = {}) {
  const docs = options.kind === 'docs';
  const navVersion = docs ? context.versionSegment : DOCUMENTATION.latestAlias;
  const controls = docs ? `<div class="docs-controls">
      <label class="version-control"><span>Version</span><select id="version-select" aria-label="Documentation version">${renderVersionOptions(context)}</select></label>
      <div class="search"><label class="sr-only" for="search-input">Search this release</label><input id="search-input" type="search" placeholder="Search ${escapeHtml(RELEASE_VERSION)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false"><div id="search-results" class="search-results" role="listbox" hidden></div></div>
    </div>` : `<div class="header-actions"><a class="release-pill" href="${escapeHtml(documentHref('preview-scope', context, DOCUMENTATION.latestAlias))}">${escapeHtml(DISPLAY.candidateLabel)} · ${escapeHtml(RELEASE_VERSION)}</a></div>`;
  const drawerId = docs ? 'documentation-drawer' : 'site-navigation-drawer';
  const menuLabel = docs ? 'Open documentation navigation' : 'Open site navigation';
  const menu = `<button class="icon-button icon-button--menu" type="button" data-nav-open aria-label="${menuLabel}" aria-controls="${drawerId}" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"></path></svg></button>`;
  return `<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="${escapeHtml(rooted(context.basePath))}" aria-label="Pulse home">${pulseMark()}<span>${escapeHtml(PUBLIC_SITE_MANIFEST.product.name)}</span>${docs ? '<span class="brand__separator" aria-hidden="true"></span><span class="brand__context">Documentation</span>' : ''}</a>
    ${menu}
    <nav class="primary-nav" aria-label="Primary">${renderHeaderNavigation(context, { versionSegment: navVersion, activeDocument: docs ? 'documentation' : undefined })}</nav>
    ${controls}
  </div>
</header>`;
}

function renderBreadcrumbs(page, context) {
  const home = rooted(context.basePath);
  const docs = documentHref('documentation', context);
  if (page.sourcePath === documentById('documentation').source) {
    return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${escapeHtml(home)}">Home</a><span aria-hidden="true">/</span><span aria-current="page">Documentation</span></nav>`;
  }
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="${escapeHtml(home)}">Home</a><span aria-hidden="true">/</span><a href="${escapeHtml(docs)}">Documentation</a><span aria-hidden="true">/</span><span>${escapeHtml(page.section.label)}</span><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(page.navigationTitle)}</span></nav>`;
}

function renderTableOfContents(page) {
  const headings = page.headings.filter((entry) => entry.level === 2 || entry.level === 3);
  if (!headings.length) return '<aside class="docs-toc" aria-label="On this page"><h2>On this page</h2><p class="docs-toc__empty">No subsections.</p></aside>';
  const items = headings.map((entry) => `<li class="toc-level-${entry.level}"><a data-toc-link href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`).join('');
  return `<aside class="docs-toc" aria-label="On this page"><h2>On this page</h2><ol>${items}</ol></aside>`;
}

function renderPagination(page, orderedPages, context) {
  const index = orderedPages.findIndex((entry) => entry.sourcePath === page.sourcePath);
  const previous = index > 0 ? orderedPages[index - 1] : undefined;
  const next = index >= 0 && index < orderedPages.length - 1 ? orderedPages[index + 1] : undefined;
  if (!previous && !next) return '';
  const link = (entry, direction) => entry ? `<a href="${escapeHtml(rooted(context.basePath, `${context.versionSegment}/${entry.route}`))}"><small>${direction}</small><strong>${escapeHtml(entry.navigationTitle)}</strong></a>` : '<span></span>';
  return `<nav class="docs-pagination" aria-label="Previous and next documentation">${link(previous, 'Previous')}${link(next, 'Next')}</nav>`;
}

function renderPage(page, groups, orderedPages, metadata, context) {
  const canonical = documentationUrl(page.sourcePath);
  const review = metadata.reviewBy ? `Review by ${metadata.reviewBy}` : metadata.reviewPolicy;
  const navigation = renderNavigation(groups, page.sourcePath, context);
  const assetRoot = rooted(context.basePath, `${context.versionSegment}/assets/`);
  return stable(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(page.summary)}">
  <meta name="theme-color" content="#0b0908">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="${escapeHtml(`${assetRoot}favicon.svg`)}" type="image/svg+xml">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}tokens.css`)}">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}site.css`)}">
  <script src="${escapeHtml(`${assetRoot}boot.js`)}"></script>
  <title>${escapeHtml(page.title)} · Pulse ${escapeHtml(RELEASE_VERSION)}</title>
</head>
<body class="docs-body" data-page-kind="docs" data-search-index="${escapeHtml(rooted(context.basePath, `${context.versionSegment}/search-index.json`))}" data-base-path="${escapeHtml(context.basePath)}" data-current-route="${escapeHtml(page.route)}" data-current-version="${escapeHtml(context.versionSegment)}">
  <a class="skip-link" href="#content">Skip to content</a>
  ${renderSiteHeader(context, { kind: 'docs' })}
  <div class="release-banner"><strong>Pulse ${escapeHtml(RELEASE_VERSION)} ${escapeHtml(RELEASE_MANIFEST.channel)}</strong><span>Exact, immutable release documentation.</span><a href="${escapeHtml(rooted(context.basePath, `${DOCUMENTATION.latestAlias}/${page.route}`))}">Browse latest</a></div>
  <div class="docs-shell">
    <aside class="docs-sidebar" aria-label="Documentation navigation"><p class="docs-sidebar__label">Documentation</p>${navigation}</aside>
    <main id="content" class="docs-main">
      ${renderBreadcrumbs(page, context)}
      <div class="page-meta"><span>${escapeHtml(metadata.owner.label)}</span><span>${escapeHtml(metadata.status)}</span><span>Reviewed ${escapeHtml(metadata.reviewedAt)}</span><span>${escapeHtml(review)}</span></div>
      <article class="docs-article">${page.rendered}</article>
      <details class="mobile-nav-fallback"><summary>Browse other documentation</summary><div class="mobile-nav-fallback__body">${navigation}</div></details>
      ${renderPagination(page, orderedPages, context)}
      <footer class="docs-source"><p>Source: <code>${escapeHtml(page.sourcePath)}</code> · <a href="${escapeHtml(REPOSITORY.web)}/blob/v${escapeHtml(RELEASE_VERSION)}/${escapeHtml(page.sourcePath)}">View release source</a></p></footer>
    </main>
    ${renderTableOfContents(page)}
  </div>
  <aside id="documentation-drawer" class="nav-drawer" data-nav-drawer aria-label="Documentation navigation" aria-hidden="true" inert><div class="nav-drawer__head"><strong>Documentation</strong><button class="icon-button" type="button" data-nav-close aria-label="Close documentation navigation"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"></path></svg></button></div>${navigation}</aside>
  <button class="nav-overlay" type="button" data-nav-overlay aria-label="Close documentation navigation" tabindex="-1"></button>
  <script src="${escapeHtml(`${assetRoot}site.js`)}" defer></script>
</body>
</html>`);
}

function renderAction(action, context, className = 'text-link') {
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(documentHref(action.document, context, DOCUMENTATION.latestAlias))}">${escapeHtml(action.label)}${className.includes('button') ? arrowIcon() : ''}</a>`;
}


function compactInspectFixture(sourcePath) {
  const fixture = readJson(path.join(repoRoot, sourcePath));
  const compiler = fixture.compiler || {};
  return Object.freeze({
    provider: fixture.project?.provider,
    capabilities: compiler.capabilities || [],
    effects: (compiler.effects || []).map((entry) => Object.freeze({ id: entry.id, kind: entry.kind, operation: entry.operation })),
    continuations: (compiler.continuations || []).map((entry) => Object.freeze({ id: entry.id, kind: entry.kind, effectIds: entry.effectIds })),
    providerLowering: Object.freeze({
      provider: compiler.providerLowering?.provider,
      requirements: compiler.providerLowering?.requirements || [],
      operations: (compiler.providerLowering?.operations || []).map((entry) => Object.freeze({ id: entry.id, lowering: entry.lowering, binding: entry.binding }))
    })
  });
}

function renderHomeSection(section, context) {
  const intro = `<div class="section-intro"><p class="eyebrow">${escapeHtml(section.eyebrow)}</p><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p>${renderAction(section.action, context)}</div>`;
  let content;
  if (section.type === 'example') {
    const code = section.code.join('\n');
    const highlighted = context.highlights?.get(codeBlockKey(section.language, code));
    const mode = highlighted?.highlighted ? 'starry-night' : 'plain';
    const renderedCode = highlighted?.highlighted ? highlighted.html : escapeHtml(code);
    const scope = highlighted?.scope ? ` data-scope="${escapeHtml(highlighted.scope)}"` : '';
    const points = section.points.map((point) => `<article class="example-point"><h3>${escapeHtml(point.title)}</h3><p>${escapeHtml(point.body)}</p></article>`).join('');
    content = `<div class="home-example"><div class="home-code-card"><div class="home-code-card__bar"><span>${escapeHtml(section.codeLabel)}</span><span>Router example</span></div><pre><code class="language-${escapeHtml(section.language)}" data-highlighted="${mode}"${scope}>${renderedCode}</code></pre></div><div class="example-points">${points}</div></div>`;
  } else if (section.type === 'journey') {
    const stages = section.stages.map((stage) => `<div class="journey-stage"><div><strong>${escapeHtml(stage.label)}</strong><span>${escapeHtml(stage.detail)}</span></div></div>`).join('');
    content = `<div class="journey-list">${stages}</div>`;
  } else if (section.type === 'contract') {
    content = `<div class="constraint-grid">${section.constraints.map((constraint, index) => `<article class="constraint-card"><span class="constraint-card__index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(constraint.title)}</h3><p>${escapeHtml(constraint.body)}</p></article>`).join('')}</div>`;
  } else if (section.type === 'inspect') {
    const output = compactInspectFixture(section.fixture);
    content = `<details class="inspect-console inspect-console--compact" open><summary><span class="inspect-console__command">${escapeHtml(section.command)}</span><span class="inspect-console__toggle">Show compiler details</span></summary><div class="inspect-summary"><div class="inspect-stat"><strong>${output.capabilities.length}</strong><span>Capabilities</span></div><div class="inspect-stat"><strong>${output.effects.length}</strong><span>Effects</span></div><div class="inspect-stat"><strong>${output.continuations.length}</strong><span>Continuations</span></div></div><pre><code>${escapeHtml(JSON.stringify(output, null, 2))}</code></pre></details>`;
  } else if (section.type === 'scope') {
    const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    content = `<div class="scope-columns"><section class="scope-column scope-column--supported"><h3>Supported</h3>${list(section.supported)}</section><section class="scope-column scope-column--excluded"><h3>Outside the Beta contract</h3>${list(section.excluded)}</section></div>`;
  } else fail(`unsupported homepage section ${section.type}`);
  return `<section id="${escapeHtml(section.id)}" class="home-section"><div class="home-container section-grid">${intro}${content}</div></section>`;
}

function renderHomepage(context) {
  const site = PUBLIC_SITE_MANIFEST;
  const hero = site.homepage.hero;
  const assetRoot = rooted(context.basePath, `${context.versionSegment}/assets/`);
  const terminal = hero.terminal.map((command) => `<span class="terminal-prompt">$</span> ${escapeHtml(interpolateRelease(command))}`).join('\n');
  const primarySection = site.homepage.sections.find((section) => section.type === 'example');
  const secondarySections = site.homepage.sections.filter((section) => section !== primarySection).map((section) => renderHomeSection(section, context)).join('\n');
  const primarySectionHtml = primarySection ? renderHomeSection(primarySection, context) : '';
  const footerLinks = site.homepage.footer.links.map((link) => `<a href="${escapeHtml(documentHref(link.document, context, DOCUMENTATION.latestAlias))}">${escapeHtml(link.label)}</a>`).join('');
  const canonical = `${DOCUMENTATION.origin}${context.basePath}/`;
  return stable(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(site.product.summary)}">
  <meta name="theme-color" content="#0b0908">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="${escapeHtml(`${assetRoot}favicon.svg`)}" type="image/svg+xml">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}tokens.css`)}">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}site.css`)}">
  <script src="${escapeHtml(`${assetRoot}boot.js`)}"></script>
  <title>${escapeHtml(site.product.name)} — ${escapeHtml(site.product.headline)}</title>
</head>
<body class="home-body" data-page-kind="home" data-base-path="${escapeHtml(context.basePath)}" data-current-version="${escapeHtml(context.versionSegment)}">
  <a class="skip-link" href="#content">Skip to content</a>
  ${renderSiteHeader(context, { kind: 'home' })}
  <main id="content" class="home-main">
    <div class="home-container hero-wrap">
      <section class="hero-card" aria-labelledby="pulse-home-title">
        <canvas class="hero-network" id="networkField" aria-hidden="true"></canvas>
        <button class="hero-motion-toggle" type="button" data-hero-motion-toggle aria-controls="networkField" aria-pressed="false" aria-label="Pause hero animation" hidden><span data-hero-motion-label>Pause motion</span></button>
        <div class="hero-content">
          <div class="hero-copy">
            <p class="eyebrow">${escapeHtml(site.product.eyebrow)}</p>
            <h1 id="pulse-home-title" class="hero-wordmark">${escapeHtml(site.product.name)}</h1>
            <h2 class="hero-headline">${escapeHtml(site.product.headline)}</h2>
            <p class="hero-summary">${escapeHtml(site.product.summary)}</p>
            <div class="action-row">${renderAction(hero.primaryAction, context, 'button button--primary')}${renderAction(hero.secondaryAction, context, 'button button--secondary')}</div>
            <a class="hero-scope-link" href="${escapeHtml(documentHref(hero.scopeAction.document, context, DOCUMENTATION.latestAlias))}">${escapeHtml(hero.scopeAction.label)} →</a>
            <div class="hero-release"><strong>${escapeHtml(DISPLAY.candidateName)}</strong><span>Explicit Native and JavaScript targets</span><span>Activation: ${escapeHtml(DISPLAY.activationStage)}</span></div>
          </div>
        </div>
      </section>
    </div>
    ${primarySectionHtml}
    <div class="home-container quick-start-wrap">
      <section class="quick-start" aria-labelledby="quick-start-title">
        <div class="quick-start__copy"><p class="eyebrow">Try it locally</p><h2 id="quick-start-title">Get a project running without learning the compiler first.</h2><p>The CLI keeps setup, checks, local development, and builds in one place. The deeper compiler view is there when it becomes useful.</p></div>
        <div class="terminal-card" aria-label="Quick start commands"><div class="terminal-card__bar"><span class="terminal-card__dot"></span><span class="terminal-card__dot"></span><span class="terminal-card__dot"></span><span class="terminal-card__label">quick start</span></div><pre data-no-copy><code>${terminal}</code></pre></div>
      </section>
    </div>
    ${secondarySections}
  </main>
  <footer class="home-footer"><div class="home-container home-footer__inner">${pulseMark()}<p class="home-footer__line">${escapeHtml(site.homepage.footer.line)}</p><nav aria-label="Footer">${footerLinks}</nav></div></footer>
  <aside id="site-navigation-drawer" class="nav-drawer" data-nav-drawer aria-label="Site navigation" aria-hidden="true" inert><div class="nav-drawer__head"><strong>${escapeHtml(site.product.name)}</strong><button class="icon-button" type="button" data-nav-close aria-label="Close site navigation"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"></path></svg></button></div><nav class="mobile-site-nav" aria-label="Mobile primary">${renderHeaderNavigation(context, { versionSegment: DOCUMENTATION.latestAlias })}<a class="release-pill" href="${escapeHtml(documentHref('preview-scope', context, DOCUMENTATION.latestAlias))}">${escapeHtml(DISPLAY.candidateLabel)} · ${escapeHtml(RELEASE_VERSION)}</a></nav></aside>
  <button class="nav-overlay" type="button" data-nav-overlay aria-label="Close site navigation" tabindex="-1"></button>
  <script src="${escapeHtml(`${assetRoot}site.js`)}" defer></script>
  <script src="${escapeHtml(`${assetRoot}network-field.js`)}" defer></script>
</body>
</html>`);
}

function redirectHtml(target, redirectScript) {
  const safe = escapeHtml(target);
  const script = escapeHtml(redirectScript);
  return stable(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${safe}"><link rel="canonical" href="${safe}"><title>Redirecting to Pulse documentation</title></head><body><p>Redirecting to <a href="${safe}">${safe}</a>.</p><script src="${script}" defer></script></body></html>`);
}

function notFoundHtml(context) {
  const assetRoot = rooted(context.basePath, `${context.versionSegment}/assets/`);
  const home = rooted(context.basePath);
  const documentation = documentHref('documentation', context, DOCUMENTATION.latestAlias);
  return stable(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="The requested Pulse documentation page was not found.">
  <meta name="theme-color" content="#0b0908">
  <link rel="icon" href="${escapeHtml(`${assetRoot}favicon.svg`)}" type="image/svg+xml">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}tokens.css`)}">
  <link rel="stylesheet" href="${escapeHtml(`${assetRoot}site.css`)}">
  <script src="${escapeHtml(`${assetRoot}boot.js`)}"></script>
  <title>Not found · Pulse</title>
</head>
<body class="home-body" data-page-kind="not-found">
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="site-header"><div class="site-header__inner"><a class="brand" href="${escapeHtml(home)}" aria-label="Pulse home">${pulseMark()}<span>${escapeHtml(PUBLIC_SITE_MANIFEST.product.name)}</span></a><a class="release-pill" href="${escapeHtml(documentation)}">Documentation</a></div></header>
  <main id="content" class="not-found-page"><section class="not-found-card"><p class="eyebrow">404 · Outside the published surface</p><h1>Not found</h1><p>The requested page is not part of this Pulse documentation release.</p><div class="action-row"><a class="button button--primary" href="${escapeHtml(home)}">Pulse home</a><a class="button button--secondary" href="${escapeHtml(documentation)}">Documentation</a></div></section></main>
</body>
</html>`);
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) fail(`documentation archive directory is missing: ${source}`);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceFile = path.join(source, entry.name);
    const destinationFile = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) fail(`documentation archives may not contain symbolic links: ${sourceFile}`);
    if (entry.isDirectory()) copyDirectory(sourceFile, destinationFile);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
      fs.copyFileSync(sourceFile, destinationFile);
    }
  }
}

function archivePathFor(entry, archiveRoot = defaultArchiveRoot) {
  return path.join(archiveRoot, entry.segment);
}

function routeManifestOutput(route) {
  const clean = trimSlashes(route);
  return clean ? `${clean}/index.html` : 'index.html';
}

function routeAliasRecords(pages) {
  const pageBySource = new Map(pages.map((page) => [page.sourcePath, page]));
  const pageRoutes = new Set(pages.map((page) => page.route));
  return Object.freeze(Object.entries(PUBLIC_SITE_MANIFEST.routeAliases).map(([route, documentId]) => {
    const targetDocument = documentById(documentId);
    const targetPage = pageBySource.get(targetDocument.source);
    if (!targetPage) fail(`route alias ${route} targets non-hosted document ${documentId}`);
    if (pageRoutes.has(route)) fail(`route alias ${route} collides with a hosted page`);
    return Object.freeze({
      route,
      targetDocument: documentId,
      targetSource: targetPage.sourcePath,
      targetRoute: targetPage.route,
      output: routeManifestOutput(route)
    });
  }));
}

function versionSiteManifest(pages, assets, groups, highlights, routeAliases) {
  const ordered = flattenNavigation(groups);
  const relationships = new Map(ordered.map((page, index) => [page.sourcePath, Object.freeze({
    previous: index > 0 ? ordered[index - 1].sourcePath : null,
    next: index < ordered.length - 1 ? ordered[index + 1].sourcePath : null
  })]));
  return Object.freeze({
    schemaVersion: 'pulse.documentation-version-site.v2',
    releaseVersion: RELEASE_VERSION,
    versionSegment: DOCUMENTATION.version,
    channel: RELEASE_MANIFEST.channel,
    releasedAt: RELEASE_MANIFEST.releasedAt,
    publicSiteSchema: PUBLIC_SITE_MANIFEST.schemaVersion,
    publicSiteManifest: 'public-site-manifest.json',
    pages: pages.map((page) => {
      const relationship = relationships.get(page.sourcePath) || { previous: null, next: null };
      return Object.freeze({
        source: page.sourcePath,
        route: page.route,
        output: routeManifestOutput(page.route),
        section: page.section.id,
        navigationTitle: page.navigationTitle,
        previous: relationship.previous,
        next: relationship.next,
        hiddenInNavigation: page.hiddenInNavigation,
        hiddenInSearch: page.hiddenInSearch,
        navigationParent: page.navigationParent || null,
        tocEntries: page.headings.filter((entry) => entry.level === 2 || entry.level === 3).length
      });
    }),
    routeAliases,
    navigation: groups.map((group) => Object.freeze({ id: group.id, label: group.label, pages: Object.freeze(group.pages.map((page) => page.sourcePath)) })),
    assets: assets.map((source) => Object.freeze({ source, output: sourceAssetRoute(source) })),
    siteAssets: Object.freeze(SITE_ASSET_FILES.map((file) => `assets/${file}`)),
    syntaxHighlighting: highlights.summary,
    searchEntries: pages.filter((page) => !page.hiddenInSearch).length,
    tocEntries: pages.reduce((count, page) => count + page.headings.filter((entry) => entry.level === 2 || entry.level === 3).length, 0)
  });
}

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

function targetFileForSitePath(output, basePath, targetPath, currentFile) {
  if (!targetPath) return currentFile;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(targetPath)) return undefined;
  let candidate;
  if (targetPath.startsWith('/')) {
    const base = basePath || '';
    if (targetPath !== `${base}/` && !targetPath.startsWith(`${base}/`)) fail(`${slash(path.relative(output, currentFile))} uses root path outside configured base ${targetPath}`);
    const relative = targetPath.slice(base.length).replace(/^\/+/, '');
    candidate = path.join(output, relative);
  } else {
    candidate = path.resolve(path.dirname(currentFile), decodeURIComponent(targetPath));
    if (!within(output, candidate)) fail(`${slash(path.relative(output, currentFile))} contains escaping site path ${targetPath}`);
  }
  if (targetPath.endsWith('/') || (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory())) candidate = path.join(candidate, 'index.html');
  return candidate;
}

function validateHtmlReferences(output, file, basePath) {
  const html = fs.readFileSync(file, 'utf8');
  const context = slash(path.relative(output, file));
  const ids = htmlIdSet(html, context);
  let checked = 0;
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const reference = splitHtmlReference(match[1]);
    const target = targetFileForSitePath(output, basePath, reference.path, file);
    if (!target) continue;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`${context} links missing site path ${match[1]}`);
    if (reference.hash) {
      const targetIds = target === file ? ids : htmlIdSet(fs.readFileSync(target, 'utf8'), slash(path.relative(output, target)));
      if (!targetIds.has(reference.hash)) fail(`${context} links missing anchor #${reference.hash} in ${slash(path.relative(output, target))}`);
    }
    checked += 1;
  }
  return checked;
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
    if (!Array.isArray(manifest.navigation) || manifest.navigation.length !== visibleNavigationSections().length) fail(`documentation version ${expected.segment} has incomplete generated navigation`);
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

function buildDocumentationSite(options = {}) {
  const output = path.resolve(options.output || defaultOutput);
  const archiveRoot = path.resolve(options.archiveRoot || defaultArchiveRoot);
  if (options.clean !== false) fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  for (const file of SITE_ASSET_FILES) if (!fs.existsSync(path.join(siteAssetRoot, file))) fail(`shared site asset is missing: scripts/documentation-site/${file}`);

  const archivedVersions = [];
  for (const entry of DOCUMENTATION_VERSIONS.versions) {
    if (entry.segment === DOCUMENTATION.version) continue;
    const source = archivePathFor(entry, archiveRoot);
    validateVersionDirectory(source, entry);
    copyDirectory(source, path.join(output, entry.segment));
    archivedVersions.push(Object.freeze({ version: entry.version, segment: entry.segment, source: slash(path.relative(repoRoot, source)) }));
  }

  const sources = publicPageSources();
  const assets = publicAssetSources();
  const markdownEntries = sources.map((sourcePath) => Object.freeze({ sourcePath, markdown: fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8') }));
  const homepageExample = PUBLIC_SITE_MANIFEST.homepage.sections.find((section) => section.type === 'example');
  const homepageHighlightEntry = homepageExample
    ? Object.freeze({ sourcePath: 'release/documentation-site.json#homepage-example', markdown: `\`\`\`${homepageExample.language}\n${homepageExample.code.join('\n')}\n\`\`\`` })
    : null;
  const highlights = highlightMarkdownCode(homepageHighlightEntry ? [...markdownEntries, homepageHighlightEntry] : markdownEntries);
  const pageSet = new Set(sources);
  const assetSet = new Set(assets);
  const basePath = cleanBasePath(DOCUMENTATION.basePath);
  const context = Object.freeze({ basePath, versionSegment: DOCUMENTATION.version, pageSet, assetSet, highlights });
  const redirectScript = rooted(basePath, `${DOCUMENTATION.version}/assets/redirect.js`);

  const documentSources = new Set(Object.values(PUBLIC_SITE_MANIFEST.documents).map((entry) => entry.source));
  for (const source of documentSources) if (!pageSet.has(source)) fail(`public-site document source is not hosted: ${source}`);

  const pages = markdownEntries.map(({ sourcePath, markdown }) => {
    const rendered = markdownToHtml(markdown, sourcePath, context);
    const title = titleFromMarkdown(markdown, sourcePath);
    const text = stripMarkdown(markdown);
    const section = navigationSectionFor(sourcePath);
    const override = PUBLIC_SITE_MANIFEST.navigation.overrides[sourcePath] || {};
    return Object.freeze({
      sourcePath,
      route: sourceToRoute(sourcePath),
      title,
      navigationTitle: override.title || title,
      navigationOrder: override.order === undefined ? 1000 : override.order,
      hiddenInNavigation: section.hiddenInNavigation === true || override.hiddenInNavigation === true,
      hiddenInSearch: section.hiddenInSearch === true || override.hiddenInSearch === true,
      navigationParent: override.navigationParent || null,
      section,
      summary: text.slice(0, 220),
      text,
      rendered: rendered.html,
      headings: rendered.headings,
      metadata: metadataFor(sourcePath, markdown)
    });
  }).sort((left, right) => left.route.localeCompare(right.route));

  const routeOwners = new Map();
  for (const page of pages) {
    const previous = routeOwners.get(page.route);
    if (previous) fail(`hosted documentation route ${page.route} is owned by both ${previous} and ${page.sourcePath}`);
    routeOwners.set(page.route, page.sourcePath);
  }
  const routeAliases = routeAliasRecords(pages);
  for (const alias of routeAliases) {
    if (routeOwners.has(alias.route)) fail(`route alias ${alias.route} collides with ${routeOwners.get(alias.route)}`);
    routeOwners.set(alias.route, `alias:${alias.targetDocument}`);
  }

  const groups = navigationModel(pages);
  const orderedPages = flattenNavigation(groups);
  const visiblePages = pages.filter((page) => !page.hiddenInNavigation);
  if (orderedPages.length !== visiblePages.length || new Set(orderedPages.map((page) => page.sourcePath)).size !== visiblePages.length) fail('generated navigation must contain every visible hosted page exactly once');
  const pageBySource = new Map(pages.map((page) => [page.sourcePath, page]));
  for (const hidden of pages.filter((page) => page.hiddenInNavigation)) {
    if (hidden.section.hiddenInNavigation === true) {
      if (hidden.navigationParent) fail(`hidden navigation section page ${hidden.sourcePath} may not set navigationParent`);
      continue;
    }
    const parent = pageBySource.get(hidden.navigationParent);
    if (!parent) fail(`hidden navigation page ${hidden.sourcePath} references missing visible parent ${hidden.navigationParent}`);
    if (parent.hiddenInNavigation) fail(`hidden navigation page ${hidden.sourcePath} may not use hidden parent ${hidden.navigationParent}`);
    if (parent.section.id !== hidden.section.id) fail(`hidden navigation page ${hidden.sourcePath} must share a section with ${hidden.navigationParent}`);
    const href = rooted(basePath, `${DOCUMENTATION.version}/${hidden.route}`);
    if (!parent.rendered.includes(`href="${href}"`)) fail(`visible navigation parent ${hidden.navigationParent} must link to hidden page ${hidden.sourcePath}`);
  }

  for (const page of pages) {
    const html = renderPage(page, groups, orderedPages, page.metadata, context);
    writeFile(routeOutput(output, DOCUMENTATION.version, page.route), html);
    const exact = rooted(basePath, `${DOCUMENTATION.version}/${page.route}`);
    writeFile(routeOutput(output, DOCUMENTATION.latestAlias, page.route), redirectHtml(exact, redirectScript));
  }
  for (const alias of routeAliases) {
    const exactTarget = rooted(basePath, `${DOCUMENTATION.version}/${alias.targetRoute}`);
    writeFile(routeOutput(output, DOCUMENTATION.version, alias.route), redirectHtml(exactTarget, redirectScript));
    writeFile(routeOutput(output, DOCUMENTATION.latestAlias, alias.route), redirectHtml(exactTarget, redirectScript));
  }

  for (const sourcePath of assets) {
    const target = assetOutput(output, DOCUMENTATION.version, sourcePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, sourcePath), target);
  }
  for (const file of SITE_ASSET_FILES) {
    const target = path.join(output, DOCUMENTATION.version, 'assets', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(siteAssetRoot, file), target);
  }

  const searchEntries = pages.filter((page) => !page.hiddenInSearch).map((page) => Object.freeze({
    title: page.title,
    navigationTitle: page.navigationTitle,
    url: rooted(basePath, `${DOCUMENTATION.version}/${page.route}`),
    route: page.route,
    source: page.sourcePath,
    section: page.section.label,
    priority: page.section.searchPriority || 0,
    summary: page.summary,
    headings: Object.freeze(page.headings.map((entry) => entry.text)),
    text: page.text,
    owner: page.metadata.owner.label,
    status: page.metadata.status,
    reviewedAt: page.metadata.reviewedAt
  }));
  const search = Object.freeze({ schemaVersion: 'pulse.documentation-search.v2', releaseVersion: RELEASE_VERSION, entries: Object.freeze(searchEntries) });
  const exactRoot = path.join(output, DOCUMENTATION.version);
  writeFile(path.join(exactRoot, 'search-index.json'), stable(JSON.stringify(search, null, 2)));
  writeFile(path.join(exactRoot, 'release-manifest.json'), stable(JSON.stringify(RELEASE_MANIFEST, null, 2)));
  writeFile(path.join(exactRoot, 'documentation-versions.json'), stable(JSON.stringify(DOCUMENTATION_VERSIONS, null, 2)));
  writeFile(path.join(exactRoot, 'public-site-manifest.json'), stable(JSON.stringify(PUBLIC_SITE_MANIFEST, null, 2)));
  writeFile(path.join(exactRoot, 'site-version-manifest.json'), stable(JSON.stringify(versionSiteManifest(pages, assets, groups, highlights, routeAliases), null, 2)));
  writeFile(path.join(output, 'versions.json'), stable(JSON.stringify(DOCUMENTATION_VERSIONS, null, 2)));
  writeFile(path.join(output, 'public-site-manifest.json'), stable(JSON.stringify(PUBLIC_SITE_MANIFEST, null, 2)));
  writeFile(path.join(output, 'index.html'), renderHomepage(context));
  writeFile(path.join(output, '404.html'), notFoundHtml(context));
  writeFile(path.join(output, '.nojekyll'), '');

  const manifest = Object.freeze({
    schemaVersion: 'pulse.documentation-site.v3',
    releaseVersion: RELEASE_VERSION,
    versionSegment: DOCUMENTATION.version,
    latestAlias: DOCUMENTATION.latestAlias,
    basePath,
    publicSite: Object.freeze({
      source: slash(path.relative(repoRoot, PUBLIC_SITE_MANIFEST_FILE)),
      schemaVersion: PUBLIC_SITE_MANIFEST.schemaVersion,
      output: 'index.html',
      manifestOutput: 'public-site-manifest.json',
      canonical: `${DOCUMENTATION.origin}${basePath}/`,
      heroCanvas: true,
      heroStyle: 'minimal-pulse-field',
      heroMotionControl: true,
      homepageEmphasis: 'router-first',
      quickStartPlacement: 'after-router-example'
    }),
    versions: DOCUMENTATION_VERSIONS.versions.map((entry) => Object.freeze({ version: entry.version, segment: entry.segment, current: entry.segment === DOCUMENTATION.version })),
    archivedVersions: Object.freeze(archivedVersions),
    pages: pages.map((page) => Object.freeze({ source: page.sourcePath, route: page.route, section: page.section.id, hiddenInNavigation: page.hiddenInNavigation, hiddenInSearch: page.hiddenInSearch, navigationParent: page.navigationParent || null, output: slash(path.relative(output, routeOutput(output, DOCUMENTATION.version, page.route))) })),
    routeAliases: routeAliases.map((alias) => Object.freeze({ ...alias, output: slash(path.relative(output, routeOutput(output, DOCUMENTATION.version, alias.route))) })),
    navigation: groups.map((group) => Object.freeze({ id: group.id, label: group.label, pages: group.pages.length })),
    assets: assets.map((source) => Object.freeze({ source, output: slash(path.relative(output, assetOutput(output, DOCUMENTATION.version, source))) })),
    siteAssets: SITE_ASSET_FILES.map((file) => slash(path.relative(output, path.join(output, DOCUMENTATION.version, 'assets', file)))),
    syntaxHighlighting: highlights.summary,
    hiddenNavigationPages: pages.filter((page) => page.hiddenInNavigation).length,
    hiddenSearchPages: pages.filter((page) => page.hiddenInSearch).length,
    searchEntries: searchEntries.length,
    tocEntries: pages.reduce((count, page) => count + page.headings.filter((entry) => entry.level === 2 || entry.level === 3).length, 0)
  });
  writeFile(path.join(output, 'site-manifest.json'), stable(JSON.stringify(manifest, null, 2)));
  const validation = validateDocumentationSite(output, manifest);
  return Object.freeze({ ...validation, output, generatedFiles: filesUnder(output).length });
}

function validateDocumentationSite(output, manifest = readJson(path.join(output, 'site-manifest.json'))) {
  if (manifest.schemaVersion !== 'pulse.documentation-site.v3') fail(`hosted site uses unsupported manifest ${manifest.schemaVersion}`);
  if (manifest.releaseVersion !== RELEASE_VERSION || manifest.versionSegment !== DOCUMENTATION.version) fail('hosted site manifest does not match the current release');
  let localLinks = 0;
  const homepage = path.join(output, manifest.publicSite.output);
  if (!fs.existsSync(homepage)) fail('public product homepage is missing');
  const homeHtml = fs.readFileSync(homepage, 'utf8');
  for (const marker of ['data-page-kind="home"', 'class="hero-card"', 'id="networkField"', 'data-hero-motion-toggle', 'class="home-example"', 'class="quick-start"', 'Show compiler details', PUBLIC_SITE_MANIFEST.product.headline, DISPLAY.candidateName]) {
    if (!homeHtml.includes(marker)) fail(`public product homepage is missing ${marker}`);
  }
  if (/http-equiv="refresh"/i.test(homeHtml)) fail('public product homepage must not be a redirect');
  const notFoundHtmlOutput = fs.readFileSync(path.join(output, '404.html'), 'utf8');
  if (!notFoundHtmlOutput.includes('<h1>Not found</h1>') || /http-equiv="refresh"/i.test(notFoundHtmlOutput)) fail('public 404 must be a stable branded error page rather than a redirect');
  localLinks += validateHtmlReferences(output, homepage, manifest.basePath);

  for (const page of manifest.pages) {
    const exactFile = path.join(output, page.output);
    if (!fs.existsSync(exactFile)) fail(`hosted documentation page is missing ${page.output}`);
    const html = fs.readFileSync(exactFile, 'utf8');
    for (const marker of [`Pulse ${RELEASE_VERSION}`, 'id="search-input"', 'id="version-select"', 'data-nav-drawer', 'class="docs-toc"']) {
      if (!html.includes(marker)) fail(`${page.output} is missing generated documentation UI ${marker}`);
    }
    if (html.includes('\u0000')) fail(`${page.output} contains an unresolved inline-rendering token`);
    if (html.includes(`${manifest.basePath}/${manifest.versionSegment}/internal/`)) fail(`${page.output} exposes an internal hosted documentation route`);
    localLinks += validateHtmlReferences(output, exactFile, manifest.basePath);
    const latest = routeOutput(output, manifest.latestAlias, page.route);
    if (!fs.existsSync(latest)) fail(`latest alias is missing ${page.route}`);
    const latestHtml = fs.readFileSync(latest, 'utf8');
    const exact = rooted(manifest.basePath, `${manifest.versionSegment}/${page.route}`);
    if (!latestHtml.includes(exact)) fail(`latest alias for ${page.route} does not redirect to ${exact}`);
  }

  if (!manifest.syntaxHighlighting || manifest.syntaxHighlighting.engine !== '@wooorm/starry-night' || manifest.syntaxHighlighting.version !== STARRY_NIGHT_VERSION || manifest.syntaxHighlighting.buildTime !== true) fail('hosted site syntax-highlighting metadata is missing or stale');
  if (manifest.syntaxHighlighting.highlightedBlocks < 1 || !manifest.syntaxHighlighting.languages.includes('ts')) fail('hosted site did not produce expected Starry Night markup');
  const currentPages = manifest.pages.map((page) => fs.readFileSync(path.join(output, page.output), 'utf8'));
  if (!currentPages.some((html) => html.includes('data-highlighted="starry-night"') && /class="[^"]*pl-[^"]*"/.test(html))) fail('hosted site contains no static Starry Night token markup');
  if (!currentPages.some((html) => html.includes('data-highlighted="plain"'))) fail('hosted site must preserve safe plain-code fallback output');
  for (const page of manifest.pages.filter((entry) => entry.hiddenInNavigation)) {
    const section = classifyPublicPage(page.source);
    if (section?.hiddenInNavigation === true) {
      if (page.navigationParent) fail(`hidden navigation section page ${page.source} may not set a navigation parent`);
      continue;
    }
    if (!page.navigationParent) fail(`hidden navigation page ${page.source} is missing its visible parent`);
    const parent = manifest.pages.find((entry) => entry.source === page.navigationParent);
    if (!parent || parent.hiddenInNavigation) fail(`hidden navigation page ${page.source} has an invalid parent ${page.navigationParent}`);
    const parentHtml = fs.readFileSync(path.join(output, parent.output), 'utf8');
    const expectedHref = rooted(manifest.basePath, `${manifest.versionSegment}/${page.route}`);
    if (!parentHtml.includes(`href="${expectedHref}"`)) fail(`hidden navigation page ${page.source} is not linked from ${page.navigationParent}`);
  }
  for (const alias of manifest.routeAliases || []) {
    const exactFile = path.join(output, alias.output);
    const latestFile = routeOutput(output, manifest.latestAlias, alias.route);
    const target = rooted(manifest.basePath, `${manifest.versionSegment}/${alias.targetRoute}`);
    if (!fs.existsSync(exactFile) || !fs.readFileSync(exactFile, 'utf8').includes(target)) fail(`exact route alias ${alias.route} does not redirect to ${target}`);
    if (!fs.existsSync(latestFile) || !fs.readFileSync(latestFile, 'utf8').includes(target)) fail(`latest route alias ${alias.route} does not redirect to ${target}`);
  }

  const search = readJson(path.join(output, manifest.versionSegment, 'search-index.json'));
  const searchablePages = manifest.pages.filter((page) => page.hiddenInSearch !== true);
  if (search.schemaVersion !== 'pulse.documentation-search.v2' || search.entries.length !== searchablePages.length || search.entries.length !== manifest.searchEntries) fail('search index does not contain exactly the searchable section-aware hosted pages');
  if (new Set(search.entries.map((entry) => entry.source)).size !== searchablePages.length) fail('search index contains duplicate sources');
  const searchSources = new Set(search.entries.map((entry) => entry.source));
  for (const page of searchablePages) if (!searchSources.has(page.source)) fail(`search index is missing ${page.source}`);
  for (const page of manifest.pages.filter((entry) => entry.hiddenInSearch)) if (searchSources.has(page.source)) fail(`search index contains hidden compatibility page ${page.source}`);
  for (const required of ['index.html', '404.html', 'versions.json', 'site-manifest.json', 'public-site-manifest.json']) if (!fs.existsSync(path.join(output, required))) fail(`hosted documentation artifact is missing ${required}`);
  for (const relative of manifest.siteAssets) if (!fs.existsSync(path.join(output, relative))) fail(`hosted site is missing shared asset ${relative}`);
  const sourceManifest = readJson(path.join(output, 'public-site-manifest.json'));
  if (JSON.stringify(sourceManifest) !== JSON.stringify(PUBLIC_SITE_MANIFEST)) fail('hosted public-site manifest is stale');
  for (const htmlFile of filesUnder(output).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) {
      fail(`${slash(path.relative(output, htmlFile))} contains an inline script; the production CSP permits external same-origin scripts only`);
    }
  }
  const versionResults = DOCUMENTATION_VERSIONS.versions.map((entry) => validateVersionDirectory(path.join(output, entry.segment), entry));
  return Object.freeze({
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    versionSegment: manifest.versionSegment,
    versions: versionResults.length,
    archivedVersions: versionResults.length - 1,
    homepage: 1,
    heroCanvas: true,
    syntaxHighlightedBlocks: manifest.syntaxHighlighting.highlightedBlocks,
    hiddenNavigationPages: manifest.hiddenNavigationPages,
    hiddenSearchPages: manifest.hiddenSearchPages,
    routeAliases: (manifest.routeAliases || []).length,
    navigationSections: manifest.navigation.length,
    pages: manifest.pages.length,
    assets: manifest.assets.length,
    siteAssets: manifest.siteAssets.length,
    searchEntries: search.entries.length,
    tocEntries: manifest.tocEntries,
    localLinks
  });
}

function parseArgs(argv) {
  const out = { output: defaultOutput, clean: true, json: false, archiveRoot: defaultArchiveRoot };
  const input = [...argv];
  while (input.length) {
    const token = input.shift();
    if (token === '--out') {
      if (!input.length) fail('--out requires a directory');
      out.output = path.resolve(input.shift());
    } else if (token.startsWith('--out=')) out.output = path.resolve(token.slice('--out='.length));
    else if (token === '--archives') {
      if (!input.length) fail('--archives requires a directory');
      out.archiveRoot = path.resolve(input.shift());
    } else if (token.startsWith('--archives=')) out.archiveRoot = path.resolve(token.slice('--archives='.length));
    else if (token === '--snapshot') out.snapshot = path.join(defaultArchiveRoot, DOCUMENTATION.version);
    else if (token.startsWith('--snapshot=')) out.snapshot = path.resolve(token.slice('--snapshot='.length));
    else if (token === '--force') out.force = true;
    else if (token === '--no-clean') out.clean = false;
    else if (token === '--json') out.json = true;
    else if (token === '--check') out.check = true;
    else fail(`unknown documentation-site option ${token}`);
  }
  return out;
}

function main() {
  let temporary;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.snapshot) {
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-docs-snapshot-'));
      const result = buildDocumentationSite({ ...options, output: temporary, clean: true });
      const destination = path.resolve(options.snapshot);
      if (fs.existsSync(destination) && !options.force) fail(`documentation archive already exists: ${destination}; pass --force to replace it intentionally`);
      if (options.force) fs.rmSync(destination, { recursive: true, force: true });
      copyDirectory(path.join(temporary, DOCUMENTATION.version), destination);
      const current = DOCUMENTATION_VERSIONS.versions.find((entry) => entry.segment === DOCUMENTATION.version);
      const snapshot = validateVersionDirectory(destination, current);
      const output = Object.freeze({ ...result, snapshot: Object.freeze({ ...snapshot, output: destination }) });
      if (options.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      else process.stdout.write(`ok - archived ${snapshot.pages} documentation page(s) for ${snapshot.segment} at ${destination}\n`);
    } else {
      if (options.check && options.output === defaultOutput) {
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-docs-site-'));
        options.output = temporary;
      }
      const result = buildDocumentationSite(options);
      if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`ok - built ${result.pages} versioned documentation page(s) across ${result.versions} release(s), ${result.searchEntries} current search entries, and ${result.localLinks} checked local link(s)\n`);
    }
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({
  publicPageSources,
  publicAssetSources,
  markdownToHtml,
  highlightMarkdownCode,
  buildDocumentationSite,
  validateDocumentationSite,
  validateVersionDirectory,
  archivePathFor
});

if (require.main === module) main();
