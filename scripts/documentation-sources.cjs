'use strict';

// Product-owned source data. No renderer, presentation ordering or release build.
const fs = require('node:fs');
const path = require('node:path');
const SOURCE_CONTRACT_FILE = path.resolve(__dirname, '../release/documentation-sources.json');
const SOURCE_CONTRACT = Object.freeze(JSON.parse(fs.readFileSync(SOURCE_CONTRACT_FILE, 'utf8')));
if (SOURCE_CONTRACT.schemaVersion !== 'pulse.documentation-sources.v1') throw new Error('Unsupported documentation source contract');
const slash = (value) => String(value).replace(/\\/g, '/').replace(/^\.\//, '');

function isPublicDocumentationSource(sourcePath) {
  const source = slash(sourcePath);
  const parts = source.split('/');
  return source.startsWith(SOURCE_CONTRACT.documentationRoot)
    && !SOURCE_CONTRACT.excludedSegments.some((segment) => parts.includes(segment))
    && !SOURCE_CONTRACT.excludedNames.includes(parts.at(-1))
    && !SOURCE_CONTRACT.excludedPrefixes.some((prefix) => source.startsWith(prefix));
}

function sourceToRoute(sourcePath) {
  const source = slash(sourcePath);
  if (Object.hasOwn(SOURCE_CONTRACT.rootRoutes, source)) return SOURCE_CONTRACT.rootRoutes[source];
  const examples = SOURCE_CONTRACT.examplesRoot;
  if (source === examples + 'README.md') return examples;
  if (source.startsWith(examples) && source.endsWith('/README.md')) return source.slice(0, -'README.md'.length);
  if (source.startsWith(SOURCE_CONTRACT.documentationRoot)) {
    const relative = source.slice(SOURCE_CONTRACT.documentationRoot.length);
    if (relative.endsWith('/README.md')) return relative.slice(0, -'README.md'.length);
    if (relative.endsWith('.md')) return relative.slice(0, -3) + '/';
  }
  throw new Error(`No hosted documentation route for ${sourcePath}`);
}

function collectDocumentationSources(sourceRoot) {
  const files = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push(slash(path.relative(sourceRoot, file)));
    }
  }
  walk(path.join(sourceRoot, SOURCE_CONTRACT.documentationRoot));
  walk(path.join(sourceRoot, SOURCE_CONTRACT.examplesRoot));
  const pages = new Set(Object.keys(SOURCE_CONTRACT.rootRoutes).filter((source) => !source.startsWith(SOURCE_CONTRACT.documentationRoot)));
  const assets = [];
  for (const source of files) {
    if (isPublicDocumentationSource(source)) {
      if (source.endsWith('.md')) pages.add(source);
      else assets.push(source);
    } else if (source.startsWith(SOURCE_CONTRACT.examplesRoot) && source.endsWith('/README.md')) pages.add(source);
  }
  return {
    pages: [...pages].filter((source) => !Object.hasOwn(SOURCE_CONTRACT.sourceAliases, source)).sort(),
    assets: assets.sort(),
  };
}

module.exports = { SOURCE_CONTRACT_FILE, SOURCE_CONTRACT, isPublicDocumentationSource, sourceToRoute, collectDocumentationSources };
