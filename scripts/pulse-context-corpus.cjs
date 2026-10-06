#!/usr/bin/env node
'use strict';

// Build-time source projection. The application imports only the emitted data module.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const INPUTS = 'scripts/pulse-context-inputs.json';
const OUTPUT = 'packages/mcp/examples/pulse-context/context-corpus.ts';
const SCHEMA_VERSION = 'pulse.context-corpus.v1';
const LIMITS = Object.freeze({ maxRecords: 256, maxContentBytes: 24576, maxSnapshotBytes: 524288 });
const MANIFEST = 'release/pulse-release-manifest.json';
const COMMANDS = 'wasm/packages/cli/src/command-spec.js';
const DIAGNOSTICS = 'wasm/packages/cli/src/diagnostics.js';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, canonical(value[key])]));
  return value;
}
const serialize = value => JSON.stringify(canonical(value), null, 2);

function headings(text) {
  const lines = text.split(/\r?\n/), entries = [];
  let fence;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return;
    }
    if (marker) { fence = marker[1]; return; }
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) entries.push({ title: match[2], level: match[1].length, index });
  });
  return { lines, entries };
}

function section(text, heading) {
  const { lines, entries } = headings(text);
  const matches = entries.filter(entry => entry.title === heading);
  if (matches.length !== 1) throw new Error(`Corpus section must occur exactly once: ${heading}`);
  const start = matches[0];
  const end = entries.find(entry => entry.index > start.index && entry.level <= start.level)?.index ?? lines.length;
  return { content: lines.slice(start.index, end).join('\n').trimEnd() + '\n', startLine: start.index + 1, endLine: end };
}

function buildCorpus(root = ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(root, INPUTS), 'utf8'));
  if (config.schemaVersion !== 'pulse.context-inputs.v1' || !['candidate', 'released'].includes(config.snapshotStatus)) throw new Error('Invalid corpus input contract');
  const sources = new Map(), records = [];
  function read(file) {
    if (path.isAbsolute(file) || file.includes('\\') || file.split('/').includes('..')) throw new Error(`Invalid corpus source: ${file}`);
    const approved = file === MANIFEST || [COMMANDS, DIAGNOSTICS].includes(file)
      || /^docs\/(?:getting-started\.md|(?:concepts|guides|packages|reference)\/[^/]+\.md|architecture\/current-contracts\.md)$/.test(file)
      || /^examples\/(?:01-hello-json|02-request-schema|03-fetch-composition|09-router-lowering)\/(?:README\.md|package\.json|tsconfig\.json|\.pulse\/config\.ts|src\/(?:index|schemas)\.ts|tests\/pulse\.harness\.ts)$/.test(file);
    if (!approved) throw new Error(`Excluded corpus source: ${file}`);
    if (sources.has(file)) return sources.get(file);
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) throw new Error(`Missing corpus source: ${file}`);
    if (fs.realpathSync(absolute) !== path.join(fs.realpathSync(root), file)) throw new Error(`Corpus source must not be a symlink: ${file}`);
    const bytes = fs.readFileSync(absolute);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    const source = { path: file, sha256: digest(bytes), url: `https://api.github.com/repos/pulse-compute/pulse/git/blobs/${blob}` };
    const value = { text, source }; sources.set(file, value); return value;
  }
  const manifest = JSON.parse(read(MANIFEST).text);
  if (manifest.schemaVersion !== 'pulse.release-catalog.v1' || typeof manifest.releaseVersion !== 'string' || !manifest.releaseVersion) throw new Error('Invalid corpus release manifest');
  const providers = manifest.runtimeTargets.map(target => target.id);
  function applicability(value) {
    if (!Array.isArray(value.providers) || !value.providers.length || value.providers.some(provider => !providers.includes(provider))
      || !Array.isArray(value.targets) || !value.targets.length || value.targets.some(target => !['native', 'javascript'].includes(target))) throw new Error('Invalid corpus applicability');
    return { applicability: [...new Set(value.providers)].sort(compare).flatMap(provider =>
      [...new Set(value.targets)].sort(compare).filter(target => target === 'native'
        || manifest.runtimeTargets.find(entry => entry.id === provider).mode !== 'compile')
        .map(target => ({ provider, target }))) };
  }
  const common = { providers, targets: ['native', 'javascript'] };
  function add({ id, title, category, content, file, selection, tags = [], scope = common, range = {} }) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(id) || !title || typeof content !== 'string') throw new Error('Invalid corpus record');
    if (Buffer.byteLength(content) > LIMITS.maxContentBytes) throw new Error(`Corpus content exceeds byte budget: ${id}; select smaller stable sections`);
    records.push({ id, title, category, tags: [...new Set(tags)].sort(compare), ...applicability(scope),
      pulseVersion: manifest.releaseVersion, status: config.snapshotStatus,
      source: { ...read(file).source, selection, ...range }, content, contentSha256: digest(content) });
  }
  for (const document of config.documents) {
    for (const selected of document.sections) {
      const { content, ...range } = section(read(document.path).text, selected.heading);
      add({ ...selected, title: selected.heading, category: document.category, file: document.path,
        selection: `heading:${selected.heading}`, content, range, scope: { ...document,
          providers: selected.providers ?? document.providers, targets: selected.targets ?? document.targets } });
    }
  }
  for (const name of config.packages) {
    const descriptor = manifest.packages.find(entry => entry.name === name);
    if (!descriptor || descriptor.version !== manifest.releaseVersion) throw new Error(`Missing or mismatched corpus package: ${name}`);
    add({ id: `package/${name.replace('@pulse-compute/', '')}`, title: name, category: 'package',
      file: MANIFEST, selection: `packages[name=${name}]`, content: serialize(descriptor), tags: ['package', descriptor.role, descriptor.tier],
      scope: name.includes('/provider-') ? { ...common, providers: [name.split('/provider-')[1]] } : common });
  }
  for (const target of manifest.runtimeTargets) {
    add({ id: `provider/${target.id}`, title: target.label, category: 'target', file: MANIFEST,
      selection: `runtimeTargets[id=${target.id}]`, content: serialize(target), tags: ['provider', target.id],
      scope: { providers: [target.id], targets: target.mode === 'compile' ? ['native'] : ['native', 'javascript'] } });
  }
  // Only these trusted first-party build-time catalogs are evaluated. No app callback is loaded.
  read(COMMANDS); read(DIAGNOSTICS);
  for (const file of [COMMANDS, DIAGNOSTICS]) delete require.cache[require.resolve(path.join(root, file))];
  const commands = require(path.join(root, COMMANDS)).publicCommandSpecDocument({ version: manifest.releaseVersion });
  const diagnostics = require(path.join(root, DIAGNOSTICS));
  for (const command of commands.commands) {
    add({ id: `command/${command.name}`, title: `pulse ${command.name}`, category: 'command', file: COMMANDS,
      selection: `COMMAND_SPECS.${command.name}`, content: serialize({ ...command, globalOptions: commands.globalOptions }), tags: ['cli', command.name],
      scope: command.name === 'compile' ? { ...common, targets: ['native'] } : common });
  }
  for (const [code, descriptor] of Object.entries(diagnostics.DIAGNOSTIC_CATALOG)) {
    if (descriptor.scope !== 'public') continue;
    add({ id: `diagnostic/${code}`, title: descriptor.title, category: 'diagnostic', file: DIAGNOSTICS,
      selection: `DIAGNOSTIC_CATALOG.${code}`, content: serialize({ code, ...descriptor }), tags: ['diagnostic', descriptor.category, code] });
  }
  for (const example of config.examples) {
    const prefix = `examples/${example.id}/`;
    const packageManifest = JSON.parse(read(prefix + 'package.json').text);
    for (const [name, version] of Object.entries({ ...packageManifest.dependencies, ...packageManifest.devDependencies })) {
      if (name.startsWith('@pulse-compute/') && version !== manifest.releaseVersion) throw new Error(`Example Pulse version mismatch: ${example.id}`);
    }
    const configText = read(prefix + '.pulse/config.ts').text;
    const declaredProviders = [...configText.matchAll(/\bhost:\s*['"]([^'"]+)['"]/g)].map(match => match[1]).filter(value => providers.includes(value));
    const declaredTargets = [...configText.matchAll(/\btarget:\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    if (serialize([...new Set(declaredProviders)].sort(compare)) !== serialize([...new Set(example.providers)].sort(compare))
      || serialize([...new Set(declaredTargets)].sort(compare)) !== serialize([...new Set(example.targets)].sort(compare))) throw new Error(`Example applicability mismatch: ${example.id}`);
    for (const file of example.files) {
      const source = `examples/${example.id}/${file}`;
      add({ id: `example/${example.id}/${file}`, title: `${example.id}: ${file}`, category: 'example',
        file: source, selection: 'file', content: read(source).text, tags: ['example', example.id], scope: example });
    }
    const file = `examples/${example.id}/README.md`;
    const { content, ...range } = section(read(file).text, example.readmeSection);
    add({ id: `example/${example.id}/workflow`, title: `${example.id}: workflow`, category: 'example', file,
      selection: `heading:${example.readmeSection}`, content, range, tags: ['example', example.id, 'workflow'], scope: example });
  }
  records.sort((a, b) => compare(a.id, b.id));
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Duplicate corpus record IDs');
  if (records.length > LIMITS.maxRecords) throw new Error('Corpus record budget exceeded');
  const snapshot = canonical({ schemaVersion: SCHEMA_VERSION, pulseVersion: manifest.releaseVersion, status: config.snapshotStatus,
    selectionSha256: digest(serialize(config)), limits: LIMITS,
    catalogVersions: { commands: commands.schemaVersion, diagnostics: diagnostics.CLI_DIAGNOSTICS_VERSION },
    sources: [...sources.values()].map(value => value.source).sort((a, b) => compare(a.path, b.path)), records });
  const corpusHash = digest(serialize(snapshot));
  const corpus = canonical({ ...snapshot, corpusHash });
  if (Buffer.byteLength(serialize(corpus)) > LIMITS.maxSnapshotBytes) throw new Error('Corpus snapshot byte budget exceeded');
  return corpus;
}

function render(corpus) {
  return `// Generated by scripts/pulse-context-corpus.cjs. Edit its allowlist/canonical inputs, not this file.\n`
    + `function freeze<T>(value: T): T {\n  if (value && typeof value === 'object') {\n    for (const child of Object.values(value)) freeze(child);\n    Object.freeze(value);\n  }\n  return value;\n}\n\n`
    + `export const contextCorpus = freeze(${serialize(corpus)} as const);\n`;
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('Usage: node scripts/pulse-context-corpus.cjs --write|--check');
  const corpus = buildCorpus();
  const output = render(corpus), target = path.join(ROOT, OUTPUT);
  if (args[0] === '--write') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, output); }
  else if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) throw new Error('Stale context corpus; run node scripts/pulse-context-corpus.cjs --write');
  console.log(`ok - ${corpus.records.length} context records, ${Buffer.byteLength(output)} module bytes, ${corpus.corpusHash}`);
}
module.exports = { buildCorpus, render, section, canonical, SCHEMA_VERSION, LIMITS, INPUTS, OUTPUT };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
