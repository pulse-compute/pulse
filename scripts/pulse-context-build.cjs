#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCorpus, render, INPUTS, OUTPUT } = require('./pulse-context-corpus.cjs');
const F = require('./pulse-context-format.cjs');
const START = require('./pulse-context-start.cjs');
const ROOT = path.resolve(__dirname, '..');
const CONFIG = 'scripts/pulse-context-build.json';
const PROJECT = 'examples/12-pulse-context-mcp';
const DIRECTORY = `${PROJECT}/context-data`;
const MIRROR = 'wasm/packages/cli/';
const MANIFEST = `${DIRECTORY}/context-manifest.json`;
// Finite executable closure, audited against the CommonJS cache after extraction.
// Generated data and evidence never enter this list.
const PRODUCER_SOURCES = [
  'scripts/pulse-context-build.cjs', 'scripts/pulse-context-format.cjs', 'scripts/pulse-context-corpus.cjs', 'scripts/pulse-context-start.cjs',
  'wasm/packages/cli/src/command-spec.js', 'wasm/packages/cli/src/diagnostics.js', 'wasm/packages/cli/src/documentation.js',
  'wasm/packages/contracts/src/resources/embedded.js', 'wasm/packages/contracts/src/assets/embedded-manifest.js'
].sort();
const COMPATIBILITY_SOURCES = [...new Set([`${PROJECT}/src/schemas.ts`, `${PROJECT}/src/index.ts`, ...START.INPUTS])];
const DATA_NAMES = [...F.FILES, 'context-metadata.ts', 'context-manifest.json', 'resource-manifest.json'].sort();
function safePath(root, relative, missing = false) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid context path');
  let current = fs.realpathSync(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      // existsSync follows links: also reject broken symbolic links.
      try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('Context symlink rejected'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!missing) throw Error(`Missing context input/output: ${relative}`);
    } else if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Context symlink rejected: ${relative}`);
  }
  return current;
}
function read(root, relative) { return fs.readFileSync(safePath(root, relative)); }
function identity(root, file) { const bytes = read(root, file); return { path: file, byteLength: bytes.length, sha256: F.hash(bytes) }; }
function configFor(root) {
  const config = JSON.parse(read(root, CONFIG));
  const limits = config.limits;
  if (F.json(Object.keys(config).sort()) !== F.json(['applicationVersion', 'encoder', 'limits', 'producerNode', 'protocols', 'schemaVersion'])
    || F.json(config.protocols) !== '{"compatibility":"2025-06-18","compatibilityEnabled":false,"default":"2026-07-28"}') throw Error('Unsupported context config/protocol schema');
  if (config.schemaVersion !== 'pulse.context-build-config.v1' || config.producerNode !== JSON.parse(read(root, 'release/pulse-release-manifest.json')).publication.nodeVersion
    || config.applicationVersion !== 'pulse.context-application.v2' || config.encoder.id !== 'pulse.context-sparse-lexical.v1'
    || F.json(config.encoder.fieldPresenceWeights) !== '{"content":1,"id":8,"tags":4,"title":6}'
    || config.encoder.tokenPattern !== '[a-z0-9_]+' || config.encoder.caseFold !== 'ASCII A-Z only'
    || config.encoder.semanticEmbedding !== false || config.encoder.model !== null
    || config.encoder.match !== 'all distinct query tokens' || config.encoder.score !== 'integer dot product; binary query weights'
    || config.encoder.tieBreak !== 'record ID ascending ASCII') throw Error('Unsupported context build config/encoder/producer');
  const fixed = { queryBytes: 256, queryTermsBeforeDeduplication: 8, results: 5, requestBytes: 32768, requestDepth: 32, mcpResponseBytes: 131072, toolReplyBytes: 24576, readRawBytes: 12288, readEscapedBytes: 16384, excerptBytes: 384, deadlineMs: 5000 };
  for (const [key, value] of Object.entries(fixed)) if (limits[key] !== value) throw Error(`Unsupported context runtime limit: ${key}`);
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw Error('Invalid context budget');
  const ceilings = { records: 512, vocabulary: 4096, termsPerRecord: 1024, tokenBytes: 64, contentBytesPerRecord: 24576,
    metadataBytesPerRecord: 4096, canonicalCorpusBytes: 2097152, resourceFileBytes: 5242880,
    resourceTotalBytes: 8388608, resourceSerializedBytes: 16777216, resourceFiles: 3, resourceBindings: 3 };
  for (const [key, max] of Object.entries(ceilings)) if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > max) throw Error(`Unsupported context budget: ${key}`);
  return config;
}
function scalarModule(corpus, config) {
  const values = { contextApplicationVersion: config.applicationVersion, contextEncoder: config.encoder.id,
    contextPulseVersion: corpus.pulseVersion, contextStatus: corpus.status, contextCorpusHash: corpus.corpusHash,
    contextRows: corpus.records.length, contextRecordIdsJson: F.json(corpus.records.map(r => r.id)) };
  for (const category of F.CATEGORIES) values[`contextCategory_${category}`] = corpus.records.map(r => r.category === category ? '1' : '0').join('');
  for (const pair of F.PAIRS) values[`contextPair_${pair.replace('/', '_')}`] = corpus.records.map(r => r.applicability.some(p => `${p.provider}/${p.target}` === pair) ? '1' : '0').join('');
  for (const category of ['example', 'diagnostic', 'command']) values[`contextToolRows_${category}Json`] = F.json(corpus.records.flatMap((r, row) => r.category === category ? [{ id: r.id, row }] : []));
  return Buffer.from('// Generated by scripts/pulse-context-build.cjs; scalar metadata only, no cited text.\n'
    + Object.keys(values).sort().map(k => `export const ${k} = ${JSON.stringify(values[k])};\n`).join(''));
}
function sourceClosure(root) {
  const paths = new Set();
  function walk(file) {
    if (paths.has(file)) return; paths.add(file); read(root, file);
    const module = require.cache[path.join(fs.realpathSync(root), file)];
    if (!module) return;
    for (const child of module.children) {
      const relative = path.relative(fs.realpathSync(root), child.filename).split(path.sep).join('/');
      if (!PRODUCER_SOURCES.includes(relative)) throw Error(`Unlisted context producer dependency: ${relative}`);
      walk(relative);
    }
  }
  for (const file of PRODUCER_SOURCES) walk(file);
  return [...paths].sort().map(file => identity(root, file));
}
function construct(root = ROOT) {
  root = fs.realpathSync(root);
  const config = configFor(root);
  for (const file of PRODUCER_SOURCES) read(root, file);
  const corpus = buildCorpus(root);
  const encoded = F.encode(corpus, config.limits);
  const dimensions = F.validateFiles(encoded.files, corpus, config.limits);
  const outputs = new Map([[OUTPUT, Buffer.from(render(corpus))]]);
  for (const name of F.FILES) outputs.set(`${DIRECTORY}/${name}`, encoded.files[name]);
  outputs.set(`${DIRECTORY}/context-metadata.ts`, scalarModule(corpus, config));
  const resourceManifest = require('../wasm/packages/contracts/src/resources/embedded.js').createResourceManifest(
    F.FILES.map(name => ({ path: `/${name}`, bytes: encoded.files[name] })), dimensions.budgets);
  outputs.set(`${DIRECTORY}/resource-manifest.json`, Buffer.from(F.json(resourceManifest) + '\n'));
  const application = START.generate(corpus, config, encoded.files, resourceManifest, file => read(root, file));
  for (const [file, bytes] of application.outputs) outputs.set(file, bytes);
  const manifest = {
    schemaVersion: 'pulse.context-build-manifest.v1',
    source: { pulseVersion: corpus.pulseVersion, status: corpus.status, schemaVersion: corpus.schemaVersion, corpusHash: corpus.corpusHash,
      selectionSha256: corpus.selectionSha256, sources: corpus.sources },
    algorithm: { ...config.encoder, chunkRule: 'one canonical record per row; no truncation', numericRepresentation: 'unsigned 32-bit little-endian integers',
      formats: { vector: 'PCTXV001', text: 'PCTXT001', metadata: 'PCTXM001' }, rowIds: corpus.records.map(r => r.id), dictionarySha256: dimensions.dictionarySha256 },
    producer: { node: config.producerNode, tools: { 'pulse-context-build': 2 }, packageDependencies: [], sources: sourceClosure(root),
      config: identity(root, CONFIG), allowlist: identity(root, INPUTS), lockfile: identity(root, 'pnpm-lock.yaml') },
    compatibility: { applicationVersion: config.applicationVersion, protocols: config.protocols, catalogVersions: corpus.catalogVersions,
      hostV1Sources: COMPATIBILITY_SOURCES.slice(0, 2).map(file => identity(root, file)),
      applicationSources: START.INPUTS.map(file => identity(root, file)) },
    application: application.metadata,
    limits: config.limits, dimensions,
    outputs: [...outputs].map(([file, bytes]) => ({ path: file.slice(PROJECT.length + 1), byteLength: bytes.length, sha256: F.hash(bytes) })).sort((a, b) => F.compare(a.path, b.path)),
    mirrors: { prefix: MIRROR, byteIdentical: true }
  };
  outputs.set(MANIFEST, Buffer.from(F.json(manifest) + '\n'));
  for (const [file, bytes] of [...outputs]) outputs.set(MIRROR + file, bytes);
  return { outputs, manifest, corpus, config };
}
function inventory(root) {
  for (const dir of [DIRECTORY, MIRROR + DIRECTORY]) {
    const target = safePath(root, dir, true);
    if (!fs.existsSync(target)) continue;
    for (const name of fs.readdirSync(target)) {
      if (!DATA_NAMES.includes(name) || !fs.lstatSync(path.join(target, name)).isFile()) throw Error(`Unexpected context output: ${dir}/${name}`);
    }
  }
}
function run({ root = ROOT, write = false } = {}) {
  root = fs.realpathSync(root);
  const config = configFor(root);
  if (write && process.versions.node !== config.producerNode) throw Error(`Context generation requires Node ${config.producerNode}; running ${process.versions.node}`);
  inventory(root);
  const built = construct(root);
  // Check reconstructs into a fresh unrelated output directory. It never repairs
  // tracked files, even when the candidate is missing or corrupt.
  const scratch = write ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-context-check-'));
  try {
    for (const file of built.outputs.keys()) safePath(root, file, true); // preflight every destination
    let changedFiles = 0;
    for (const [file, bytes] of built.outputs) {
      if (scratch) { const temporary = path.join(scratch, file); fs.mkdirSync(path.dirname(temporary), { recursive: true }); fs.writeFileSync(temporary, bytes); }
      const target = safePath(root, file, true);
      const actual = fs.existsSync(target) ? fs.readFileSync(target) : null;
      if (!actual || !actual.equals(bytes)) {
        if (!write) throw Error(`Stale/missing context output: ${file}; run npm run context:build using Node ${config.producerNode}`);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); changedFiles++;
      }
    }
    return { schemaVersion: 'pulse.context-build-receipt.v1', status: 'ok', mode: write ? 'write' : 'check',
      executionNode: process.versions.node, pinnedProducerNode: config.producerNode,
      manifestSha256: F.hash(built.outputs.get(MANIFEST)), corpusHash: built.corpus.corpusHash,
      dimensions: built.manifest.dimensions, changedFiles, comparedFiles: built.outputs.size };
  } finally { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); }
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw Error('Usage: node scripts/pulse-context-build.cjs --write|--check');
  console.log(JSON.stringify(run({ write: args[0] === '--write' })));
}
module.exports = { construct, run, configFor, scalarModule, safePath, ROOT, CONFIG, PROJECT, DIRECTORY, MIRROR, MANIFEST, PRODUCER_SOURCES, COMPATIBILITY_SOURCES };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
