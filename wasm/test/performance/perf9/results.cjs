#!/usr/bin/env node
'use strict';
// Fixed PERF9-01B baseline replay. Never launches a benchmark or changes raw evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pin = require('./baseline.json');
const { hash, stats, cells } = require('./measurement-protocol.cjs');
const measurement = require('./measurement-report.cjs');
const qualification = require('./qualify.cjs');
const start = '<!-- perf9-results:start -->';
const end = '<!-- perf9-results:end -->';

function containedFile(root, relative) {
  assert(typeof relative === 'string' && relative.length > 0);
  assert(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Unsafe archive path');
  const file = fs.realpathSync(path.resolve(root, relative));
  assert(file.startsWith(root + path.sep), 'Evidence path escapes root');
  assert(fs.statSync(file).isFile(), 'Expected evidence file');
  return file;
}

function loadEvidence(directory) {
  const root = fs.realpathSync(directory);
  const manifestBytes = fs.readFileSync(containedFile(root, 'manifest.json'));
  assert.equal(hash(manifestBytes), pin.manifestSha256, 'Frozen manifest hash mismatch');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schemaVersion, 'pulse.perf9-01b-evidence-bundle.v1');
  const originals = new Map(), archives = new Map();
  for (const entry of manifest.files) {
    assert(!originals.has(entry.originalPath) && !archives.has(entry.archivePath), 'Duplicate evidence mapping');
    const file = containedFile(root, entry.archivePath), bytes = fs.readFileSync(file);
    assert.equal(bytes.length, entry.bytes, `Evidence size mismatch: ${entry.archivePath}`);
    assert.equal(hash(bytes), entry.sha256, `Evidence hash mismatch: ${entry.archivePath}`);
    originals.set(entry.originalPath, file);
    archives.set(entry.archivePath, file);
  }
  const relocate = original => {
    assert(originals.has(original), `Missing archived artifact: ${original}`);
    return originals.get(original);
  };
  const readPinned = (file, expected) => {
    assert(archives.has(file), `Missing pinned report: ${file}`);
    const bytes = fs.readFileSync(archives.get(file));
    assert.equal(hash(bytes), expected, 'Frozen report hash mismatch');
    return JSON.parse(bytes);
  };
  const r = readPinned(pin.measurement, pin.measurementSha256);
  const q = readPinned(pin.qualification, pin.qualificationSha256);
  measurement.validateStructure(r); // Recomputes every summary and paired bootstrap from raw blocks.
  assert.equal(r.profile, 'standard');
  assert.deepEqual(r.sources, measurement.sources(), 'Measurement source drift');
  assert.equal(r.source.sourceRevision, pin.testedCommit);
  assert.equal(r.source.sourceTree, pin.sourceTree);
  assert.equal(manifest.testedLocalCommit, pin.testedCommit);
  assert.equal(manifest.githubCommit, pin.githubCommit);
  assert.equal(manifest.identicalTree, pin.sourceTree);
  assert.equal(relocate(r.fixtureSource.reportFile), archives.get(pin.qualification));
  assert.equal(r.fixtureSource.reportSha256, pin.qualificationSha256);
  assert.deepEqual(r.fixtureSource.identity, q.source);
  assert.deepEqual(q.source, r.source);
  assert.equal(q.viceroy.sha256, r.viceroy.sha256);

  // Relocate only file references in an in-memory copy. Original report bytes/hashes stay intact.
  const relocated = structuredClone(q);
  for (const cell of relocated.cells) for (const name of ['pulse', 'rust']) cell[name].file = relocate(cell[name].file);
  qualification.validate(relocated); // Existing fixture/oracle identity, ABI, wire and parity assertions.
  for (const name of ['pulse', 'rust']) {
    const actual = r.artifacts[name], expected = q.cells[0][name];
    const bytes = fs.readFileSync(relocate(actual.file));
    assert.equal(hash(bytes), actual.sha256);
    assert.equal(bytes.length, actual.bytes);
    assert.equal(actual.sha256, expected.sha256);
    assert.equal(actual.bytes, expected.bytes);
    assert.equal(actual.guestLinearMemoryBytes, expected.abi.guestMemoryBytes);
    assert.equal(hash(fs.readFileSync(relocate(q.rebuild[name].file))), expected.sha256);
    const config = r.servers[name].args[r.servers[name].args.indexOf('--config') + 1];
    assert.equal(hash(fs.readFileSync(relocate(config))), r.servers[name].manifestSha256);
  }
  return { report: r, qualification: q, manifest };
}

const number = (n, digits = 3) => n.toFixed(digits);
const signed = (n, digits = 3) => (n > 0 ? '+' : '') + number(n, digits);
const interval = (values, digits = 3) => values.map(n => signed(n, digits)).join(' to ');
const mib = n => number(n / 1048576);
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => '| ' + row.join(' | ') + ' |').join('\n');

function render({ report: r, qualification: q }) {
  const ordered = cells('standard').map(spec => ({ ...spec, ...r.cells.find(c => c.id === spec.id) }));
  const label = c => `${c.mode === 'echo' ? '' : c.mode + ' / '}${c.bytes === 1048576 ? '1 MiB' : c.bytes / 1024 + ' KiB'} / c${c.concurrency}`;
  const pair = (c, fn) => ['pulse', 'rust'].map(n => fn(c.summary[n])).join(' / ');
  const rows = r.cells.flatMap(c => c.pairs.flatMap(p => [...p.pulse.requests, ...p.rust.requests]));
  const warmups = r.cells.flatMap(c => c.warmup.flatMap(b => b.requests));
  const lines = [start, '',
    '### Campaign and provenance', '',
    `Measured requests: **${rows.length.toLocaleString('en-US')}**; unexpected errors: **${rows.filter(x => x.outcome !== 'ok').length}**. Excluded warmups: **${warmups.length}**. Separate diagnostics: **${r.diagnostics.length}**, each with a successful recovery request.`, '',
    `Attempt timestamps (UTC, including qualification/setup/diagnostics): ${r.createdAt} through ${r.completedAt}.`, '',
    `Local ${r.environment.os.platform}/${r.environment.os.arch}, kernel ${r.environment.os.release}; ${r.environment.hardware.cpu}. Available parallelism ${r.environment.hardware.availableParallelism}; CPU quota \`${r.environment.hardware.cgroupCpuMax}\`; memory limit ${mib(Number(r.environment.hardware.cgroupMemoryMax))} MiB. Shared-machine activity was not controlled.`, '',
    `Node ${r.environment.node}; Viceroy ${r.viceroy.version}; TypeScript ${q.dependencies.packages.typescript.version}; AssemblyScript ${q.dependencies.packages.assemblyscript.version}; json-as ${q.dependencies.packages['json-as'].version}.`, '',
    '```text', q.rust.rustc, q.rust.cargo, '```', '',
    `Clean tested source: \`${r.source.sourceRevision}\`; tree: \`${r.source.sourceTree}\`. The public upload and merged commits in baseline.json have this same tree; only commit metadata differs.`, '',
    table(['Identity', 'SHA-256'], [
      ['Raw measurements', pin.measurementSha256], ['Parity qualification', pin.qualificationSha256],
      ['Raw archive', pin.archiveSha256], ['Archive manifest', pin.manifestSha256],
      ['Viceroy executable', r.viceroy.sha256], ['Node executable', r.environment.executableSha256],
      ['Rust compiler', q.rust.rustcSha256], ['Cargo', q.rust.cargoSha256],
      ['Rust target libraries (aggregate)', q.rust.targetLibrariesSha256], ['Workspace lockfile', q.dependencies.lockfileSha256]
    ]), '',
    table(['Guest', 'Wasm bytes', 'SHA-256', 'ABI-fixture linear memory bytes', 'Payload scratch bytes'],
      ['pulse', 'rust'].map(name => { const a = r.artifacts[name]; return [name, a.bytes, a.sha256, a.guestLinearMemoryBytes, a.payloadScratchBytes]; })), '',
    `Qualification: ${q.cells.reduce((n, c) => n + c.pulse.abi.cases.length, 0)} ABI cases and ${q.cells[0].pulse.wire.cases.length} local Viceroy wire cases per guest, ${q.cells.reduce((n, c) => n + c.parity.length, 0)} differential cases, plus byte-identical default rebuilds.`, '',
    '### Completion latency', '',
    'Pooled request percentiles, milliseconds, nearest rank. Pulse / Rust in each column. Echo cells have 480 requests per guest; slow cells have 48. These descriptive medians are not the paired comparison estimator.', '',
    table(['Cell', 'p50 ms P / R', 'p95 ms P / R', 'Headers p50 ms P / R'], ordered.map(c => [label(c), pair(c, x => number(x.successfulLatencyMs.p50)), pair(c, x => number(x.successfulLatencyMs.p95)), pair(c, x => number(x.timeToHeadersMs.p50))])), '',
    '### Paired comparison', '',
    'Mean of block-p50s: Pulse minus Rust; positive favors Rust. Percent is the ratio of the two means minus one. Intervals are exploratory 95% paired-block bootstrap intervals, unadjusted for multiple cells. All ten cells are shown; 12-pair slow cases do not meet the predeclared 20-pair inference minimum.', '',
    table(['Cell', 'Pairs', 'Delta ms [95% interval]', 'Delta % [95% interval]', 'Direction'], ordered.map(c => { const s = c.summary.comparison; return [label(c), s.blocks, `${signed(s.absoluteMs)} [${interval(s.absoluteMs95)}]`, `${signed(s.relativePercent, 2)} [${interval(s.relativePercent95, 2)}]`, s.direction]; })), '',
    `The frozen protocol's 1–3% precision label is “inconclusive at this resolution” in ${ordered.filter(c => c.summary.comparison.oneToThreePercent === 'inconclusive at this resolution').length}/${ordered.length} cells. This label does not negate an interval wholly above the hypothesized band.`, '',
    '### Throughput and process CPU', '',
    'Arithmetic means of per-block rates and CPU/attempt. Response MiB/s counts the response direction only. CPU is all Viceroy threads (guest + runtime + host), excluding the Node client/origin; its window includes 20 ms settle. CPU tick resolution is 10 ms before amortization across a block. No CPU significance claim is made.', '',
    table(['Cell', 'Responses/s P / R', 'Response MiB/s P / R', 'Process CPU ms/attempt P / R'], ordered.map(c => [label(c), pair(c, x => number(x.requestsPerSecond.mean, 2)), pair(c, x => mib(x.responseBytesPerSecond.mean)), pair(c, x => number(x.processCpuMsPerAttempt.mean))])), '',
    '### Process memory', '',
    'Maximum observed values over measured blocks in each cell, MiB. RSS is sampled; HWM is the separately read process-lifetime counter, including startup and preceding cells. Both Viceroy processes persist across the shuffled campaign. Neither column is guest allocation or a per-request memory bound.', '',
    table(['Cell', 'Sampled RSS max P / R', 'Reported lifetime HWM max P / R'], ordered.map(c => [label(c), pair(c, x => mib(x.sampledRssBytes.max)), pair(c, x => mib(x.lifetimeHwmBytes.max))])), '',
    '### Observed buffering', '',
    'Maximum bytes per observation; Pulse / Rust. Drain waits are totals across measured blocks. These are external Node client/origin observations, not Viceroy/OS queue bounds. A zero drain count is not proof that no backpressure occurred.', '',
    table(['Cell', 'Client read bytes P / R', 'Client upload bytes P / R', 'Origin write bytes P / R', 'Origin drains P / R'], ordered.map(c => [label(c), pair(c, x => x.clientReadableBytesMax), pair(c, x => x.clientUploadWritableBytesMax), pair(c, x => x.originWritableBytesMax), pair(c, x => x.originDrainWaits)])), '',
    '### Separate failure/recovery probes', '',
    'Three repetitions per row. Deadline means post-header body abort; cancellation means client disconnect after the origin observed an unknown-length chunked upload prefix. Elapsed times describe harness observation, not acknowledged host cleanup.', '',
    table(['Guest', 'Probe', 'Outcome', 'Elapsed min–max ms', 'Healthy recoveries'], ['pulse', 'rust'].flatMap(name => ['deadline', 'cancel'].map(kind => {
      const samples = r.diagnostics.filter(d => d.implementation === name && d.kind === kind);
      const times = stats(samples.map(d => d.result.elapsedMs));
      return [name, kind, [...new Set(samples.map(d => d.result.outcome))].join(', '), `${number(times.min)}–${number(times.max)}`, `${samples.filter(d => d.recovery.outcome === 'ok').length}/${samples.length}`];
    }))), '', end];
  return lines.join('\n');
}

function updateDocument(document, generated) {
  assert.equal(document.split(start).length, 2, 'Expected one generated start marker');
  assert.equal(document.split(end).length, 2, 'Expected one generated end marker');
  const a = document.indexOf(start), b = document.indexOf(end);
  assert(b > a, 'Reversed generated markers');
  return document.slice(0, a) + generated + document.slice(b + end.length);
}

function main(args) {
  assert(args.length === 2 && ['--check', '--write'].includes(args[0]), 'Usage: node results.cjs --check|--write /path/to/extracted-evidence');
  const evidence = loadEvidence(args[1]);
  const file = path.join(__dirname, 'RESULTS.md'), old = fs.readFileSync(file, 'utf8');
  const next = updateDocument(old, render(evidence));
  if (args[0] === '--check') assert.equal(old, next, 'RESULTS.md tables differ from verified raw evidence');
  else fs.writeFileSync(file, next);
  console.log(`ok - PERF9-01C: ${evidence.manifest.files.length} archived files verified; raw summaries, provenance and report tables match`);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { containedFile, loadEvidence, render, updateDocument };
