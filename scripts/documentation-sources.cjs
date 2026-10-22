'use strict';

// Source discovery is shared by validation and rendering. This module only reads
// repository data; it must not load the renderer, presentation or release gates.
const fs = require('node:fs');
const path = require('node:path');
const SOURCE_CONTRACT = require('../release/documentation-sources.json');
const repoRoot = path.resolve(__dirname, '..');
function slash(value) { return String(value).replace(/\\/g, '/'); }
function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
deepFreeze(SOURCE_CONTRACT);

function isPublicDocumentationSource(sourcePath) {
  const source = slash(sourcePath).replace(/^\.\//, '');
  const parts = source.split('/');
  return source.startsWith(SOURCE_CONTRACT.documentationRoot)
    && !SOURCE_CONTRACT.excludedSegments.some((part) => parts.includes(part))
    && !SOURCE_CONTRACT.excludedNames.includes(parts.at(-1))
    && !SOURCE_CONTRACT.excludedPrefixes.some((prefix) => source.startsWith(prefix));
}

function filesUnder(root, predicate, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function publicPageSources(sourceRoot = repoRoot) {
  const pages = [
    ...Object.keys(SOURCE_CONTRACT.rootRoutes)
      .filter((source) => !source.startsWith(SOURCE_CONTRACT.documentationRoot))
      .map((source) => path.join(sourceRoot, source)),
    ...filesUnder(path.join(sourceRoot, SOURCE_CONTRACT.documentationRoot), (file) => file.endsWith('.md')
      && isPublicDocumentationSource(path.relative(sourceRoot, file))),
    ...filesUnder(path.join(sourceRoot, SOURCE_CONTRACT.examplesRoot), (file) => path.basename(file) === 'README.md')
  ];
  return [...new Set(pages)]
    .sort()
    .map((file) => slash(path.relative(sourceRoot, file)))
    .filter((sourcePath) => !Object.hasOwn(SOURCE_CONTRACT.sourceAliases, sourcePath));
}

function publicAssetSources(sourceRoot = repoRoot) {
  return filesUnder(path.join(sourceRoot, SOURCE_CONTRACT.documentationRoot), (file) => !file.endsWith('.md') && isPublicDocumentationSource(path.relative(sourceRoot, file)))
    .sort()
    .map((file) => slash(path.relative(sourceRoot, file)));
}

module.exports = { SOURCE_CONTRACT, isPublicDocumentationSource, publicPageSources, publicAssetSources };
