#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { synchronizeReferenceDocs } = require('./sync-reference-docs.cjs');
const { synchronizeDocumentationMetadata, validateDocumentationMetadata } = require('../../scripts/documentation-ownership.cjs');
const { synchronizeMaintenancePolicy } = require('../../scripts/maintenance-policy.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const START = '<!-- pulse-doc-source:';
const END = '<!-- /pulse-doc-source -->';
const BLOCK_PATTERN = /<!--\s*pulse-doc-source:\s*([^>]+?)\s*-->\r?\n```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```\r?\n<!--\s*\/pulse-doc-source\s*-->/g;

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function normalize(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\s+$/u, '');
}

function languageFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.ts' || extension === '.tsx') return 'ts';
  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') return 'js';
  if (extension === '.json') return 'json';
  if (extension === '.toml') return 'toml';
  if (extension === '.sh') return 'bash';
  return 'text';
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

function markdownFiles() {
  const files = [path.join(repoRoot, 'README.md'), path.join(repoRoot, 'CHANGELOG.md'), path.join(repoRoot, 'API.md')];
  files.push(...filesUnder(path.join(repoRoot, 'docs'), (file) => file.endsWith('.md') && path.basename(file) !== 'AGENTS.md' && !file.includes(`${path.sep}internal${path.sep}`)));
  files.push(...filesUnder(path.join(repoRoot, 'examples'), (file) => path.basename(file) === 'README.md'));
  return [...new Set(files)].sort();
}

function resolveSource(reference, markdownFile) {
  const trimmed = String(reference || '').trim();
  if (!trimmed || trimmed.includes('\0')) throw new Error(`invalid pulse-doc-source reference in ${slash(path.relative(repoRoot, markdownFile))}`);
  const source = path.resolve(repoRoot, trimmed);
  const relative = path.relative(repoRoot, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`pulse-doc-source escapes the repository: ${trimmed}`);
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`pulse-doc-source does not exist: ${trimmed}`);
  }
  return { source, reference: slash(relative) };
}

function synchronizeDocSnippets(options = {}) {
  const write = options.write === true;
  const mismatches = [];
  const references = [];
  let blockCount = 0;
  let changedFiles = 0;

  for (const markdownFile of markdownFiles()) {
    const original = fs.readFileSync(markdownFile, 'utf8');
    let markerCount = 0;
    const updated = original.replace(BLOCK_PATTERN, (whole, rawReference, actualLanguage, actualBody) => {
      markerCount += 1;
      blockCount += 1;
      const resolved = resolveSource(rawReference, markdownFile);
      const expectedLanguage = languageFor(resolved.source);
      const expectedBody = normalize(fs.readFileSync(resolved.source, 'utf8'));
      const actual = normalize(actualBody);
      references.push(Object.freeze({
        markdown: slash(path.relative(repoRoot, markdownFile)),
        source: resolved.reference,
        language: expectedLanguage
      }));
      if (actualLanguage.trim() !== expectedLanguage || actual !== expectedBody) {
        mismatches.push(Object.freeze({
          markdown: slash(path.relative(repoRoot, markdownFile)),
          source: resolved.reference,
          language: Object.freeze({ actual: actualLanguage.trim(), expected: expectedLanguage }),
          bodyMatches: actual === expectedBody
        }));
      }
      return `<!-- pulse-doc-source: ${resolved.reference} -->\n\`\`\`${expectedLanguage}\n${expectedBody}\n\`\`\`\n${END}`;
    });

    const rawStarts = original.split(START).length - 1;
    const rawEnds = original.split(END).length - 1;
    if (rawStarts !== rawEnds || rawStarts !== markerCount) {
      throw new Error(`malformed pulse-doc-source block in ${slash(path.relative(repoRoot, markdownFile))}: starts=${rawStarts}, ends=${rawEnds}, parsed=${markerCount}`);
    }
    if (write && updated !== original) {
      fs.writeFileSync(markdownFile, updated);
      changedFiles += 1;
    }
  }

  if (!write && mismatches.length > 0) {
    const details = mismatches.map((entry) => `${entry.markdown} <- ${entry.source}`).join(', ');
    throw new Error(`documentation source snippets are stale: ${details}. Run node wasm/scripts/sync-doc-snippets.cjs --write`);
  }

  return Object.freeze({
    status: mismatches.length === 0 || write ? 'ok' : 'stale',
    blockCount,
    changedFiles,
    mismatches: Object.freeze(mismatches),
    references: Object.freeze(references)
  });
}

function main() {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => !['--write', '--check', '--json'].includes(arg));
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(', ')}`);
    process.exit(2);
  }
  try {
    const write = args.has('--write');
    const metadata = synchronizeDocumentationMetadata({ repoRoot, write });
    const maintenance = synchronizeMaintenancePolicy({ repoRoot, write });
    const snippets = synchronizeDocSnippets({ write });
    const references = synchronizeReferenceDocs({ write });
    const ownership = validateDocumentationMetadata({ repoRoot, today: '2026-07-16' });
    const result = Object.freeze({ status: 'ok', metadata, maintenance, snippets, references, ownership });
    if (args.has('--json')) console.log(JSON.stringify(result, null, 2));
    else {
      const changed = metadata.changedFiles + maintenance.changedFiles + snippets.changedFiles + references.changedFiles;
      console.log(`ok - ${references.expectedFiles} generated documentation/package file(s), ${maintenance.expectedFiles} maintenance-policy output(s), ${snippets.blockCount} source block(s), and ${metadata.files} owned page(s) are synchronized${changed ? `; updated ${changed} file(s)` : ''}`);
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  repoRoot,
  markdownFiles,
  synchronizeDocSnippets
};
