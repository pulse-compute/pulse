'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { instrument, queryRelations, canonicalJson, sha256 } = require('./vis06-derivation.cjs');
const report = path.resolve(__dirname, '../../packages/cli/src/internal/report');
const encoding = require(path.join(report, 'encoding'));
const capsule = require(path.join(report, 'capsule'));
const { validateHandlerTopology } = require(path.join(report, 'handler-topology'));
const { createReportViewModel } = require(path.join(report, 'viewer/model'));

function normalize(value, diagnosticCopy = false) {
  // Observe the actual internal normalizer, without adding a production export.
  const file = path.join(report, 'capsule.js'), loaded = new Module(file, module);
  loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
  if (diagnosticCopy) {
    const original = loaded.require.bind(loaded);
    loaded.require = name => name === './data' ? { ...original(name), copyData: structuredClone } : original(name);
  }
  loaded._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.vis06Normalize = normalize;', file);
  return loaded.exports.vis06Normalize(value);
}
function run(input, mode, send = () => {}) {
  const stages = {}, memory = {}, receipt = { mode, stages, memory, status: 'running' };
  function stage(name, fn) {
    send({ stage: name, state: 'started' });
    const start = performance.now();
    try { return fn(); }
    finally {
      stages[name] = performance.now() - start;
      memory[name] = process.memoryUsage();
      memory[name].highWaterRssKiB = process.resourceUsage().maxRSS;
      send({ stage: name, state: 'finished', elapsedMs: stages[name], memory: memory[name] });
    }
  }
  const bytes = fs.readFileSync(input);
  receipt.inputSha256 = sha256(bytes);
  receipt.node = process.version;
  receipt.pulseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8' }).trim();
  receipt.diagnosticFiles = Object.fromEntries(fs.readdirSync(__dirname).filter(f => f.startsWith('vis06-') && f.endsWith('.cjs'))
    .sort().map(f => [f, sha256(fs.readFileSync(path.join(__dirname, f)))]));
  receipt.lockfileSha256 = sha256(fs.readFileSync(path.resolve(__dirname, '../../../pnpm-lock.yaml')));
  const decoded = stage('inputDecode', () => encoding.decode(JSON.parse(bytes)));
  const isCapsule = decoded.kind === 'pulse.application-report';
  stage('inputValidation', () => {
    if (isCapsule) capsule.validateCapsule(decoded);
    else { assert.equal(decoded.kind, 'pulse.vis06-compiler-fixture'); validateHandlerTopology(decoded); }
  });
  const analytics = decoded.analytics;
  receipt.provenance = decoded.provenance;
  receipt.context = decoded.context || { host: decoded.provenance.host, target: decoded.provenance.target };
  receipt.validation = isCapsule ? 'production capsule validation' : 'compiler fixture plus production topology validation; not an emitted artifact';
  receipt.input = Object.fromEntries(['handlers', 'registrations', 'useSites', 'helperCalls', 'associations']
    .map(key => [key, analytics[key].length]));
  receipt.input.coverage = analytics.coverage;
  receipt.guardrails = { associations: mode === 'limited' ? 10000 : null,
    work: mode === 'limited' ? 250000 : null, pathHops: mode === 'limited' ? 64 : null,
    reader: encoding.LIMITS, viewerDisplayNodes: 300 };
  const probe = instrument({ unrestricted: mode !== 'limited', relationsOnly: mode === 'relations',
    progress: counters => send({ stage: 'derive', counters }) });
  receipt.deriverSha256 = probe.sourceSha256;
  receipt.instrumentedSha256 = probe.instrumentedSha256;
  const result = stage('derive', () => probe.derive(analytics));
  receipt.instrumentation = probe.stats;
  receipt.derivationExhausted = probe.stats.counters.consumersFinished === analytics.registrations.length
    && result.coverage.reason !== 'graph-budget-exhausted';
  receipt.coverage = result.coverage;
  if (mode === 'limited') stage('baselineParity', () => {
    assert.equal(canonicalJson(result.rows), canonicalJson(analytics.associations));
    assert.deepEqual(result.coverage, analytics.coverage.associations);
  });
  if (mode === 'relations') {
    const queries = stage('queryIndex', () => queryRelations(analytics, probe.relations));
    receipt.relations = probe.relations.length;
    receipt.relationsBytes = Buffer.byteLength(JSON.stringify(probe.relations));
    receipt.relationsNormalizedBytes = Buffer.byteLength(JSON.stringify(encoding.encode(probe.relations)));
    const facts = { ...analytics }; delete facts.associations;
    receipt.rawFactsBytes = Buffer.byteLength(JSON.stringify(facts));
    receipt.factsAndRelationsBytes = Buffer.byteLength(JSON.stringify({ facts, relations: probe.relations }));
    receipt.factsAndRelationsNormalizedBytes = Buffer.byteLength(JSON.stringify(encoding.encode({ facts, relations: probe.relations })));
    receipt.focusedTraversals = [];
    for (const consumer of [...new Set([analytics.registrations[0], analytics.registrations.find(r => r.kind === 'route'), analytics.registrations.at(-1)])].filter(Boolean)) {
      const focused = instrument({ unrestricted: true, relationsOnly: true, focus: consumer.id });
      const start = performance.now(); focused.derive(analytics);
      receipt.focusedTraversals.push({ consumer: consumer.id, kind: consumer.kind,
        elapsedMs: performance.now() - start, relations: focused.relations.length, counters: focused.stats.counters });
      assert.deepEqual(queryRelations(analytics, focused.relations).route(consumer.id), queries.route(consumer.id));
    }
    let expandedCount = 0;
    const routeDigests = [], routeMs = [], bindingConsumers = new Map(queries.bindingIds.map(id => [id, new Set()]));
    const siteBindings = new Map(analytics.useSites.map(s => [s.id, s.binding.bindingId]));
    stage('allRouteQueries', () => {
      for (const consumer of analytics.registrations) {
        const start = performance.now(), rows = queries.route(consumer.id); routeMs.push(performance.now() - start);
        expandedCount += rows.length;
        routeDigests.push([consumer.id, sha256(canonicalJson(rows))]);
        for (const row of rows) if (siteBindings.get(row.useSiteId)) bindingConsumers.get(siteBindings.get(row.useSiteId)).add(consumer.id);
      }
    });
    receipt.expandedCount = expandedCount;
    receipt.routeSemanticDigest = sha256(canonicalJson(routeDigests));
    receipt.routeQueryMs = { min: Math.min(...routeMs), max: Math.max(...routeMs),
      total: routeMs.reduce((a, b) => a + b, 0) };
    stage('allBindingQueries', () => {
      for (const id of queries.bindingIds) assert.deepEqual(queries.binding(id), [...bindingConsumers.get(id)].sort());
    });
    receipt.bindingQueries = queries.bindingIds.length;
    receipt.bindingReverseParity = true;
    receipt.coverage = { status: 'diagnostic-relations', reason: 'coverage belongs to projected rows; no persisted format proposed' };
  } else {
    const rows = result.rows, byConsumer = new Map(), pairs = new Set(), used = new Set();
    const paths = new Set(), boundConsumers = new Set();
    const sites = new Map(analytics.useSites.map(s => [s.id, s]));
    for (const row of rows) {
      if (!byConsumer.has(row.consumerRegistrationId)) byConsumer.set(row.consumerRegistrationId, []);
      byConsumer.get(row.consumerRegistrationId).push(row);
      pairs.add(row.consumerRegistrationId + ':' + row.useSiteId); used.add(row.useSiteId);
      paths.add(JSON.stringify(row.via));
      if (sites.get(row.useSiteId).binding.bindingId) boundConsumers.add(row.consumerRegistrationId);
    }
    receipt.counts = { rows: rows.length, consumersWithRows: byConsumer.size,
      consumersWithBindingRows: boundConsumers.size, representedUseSites: used.size,
      consumerSitePairs: pairs.size, distinctPaths: paths.size,
      extraPathRows: rows.length - pairs.size };
    receipt.routeSemanticDigest = sha256(canonicalJson(analytics.registrations
      .map(r => [r.id, sha256(canonicalJson(byConsumer.get(r.id) || []))])));
    send({ stage: 'derivationResult', counts: receipt.counts, coverage: receipt.coverage,
      derivationExhausted: receipt.derivationExhausted, instrumentation: receipt.instrumentation,
      routeSemanticDigest: receipt.routeSemanticDigest });
    const expanded = { ...decoded, analytics: { ...analytics, associations: rows,
      coverage: { ...analytics.coverage, associations: result.coverage } } };
    // These are diagnostic projections, not newly valid/exportable capsules.
    let normalized;
    stage('productionNormalizationAdmission', () => {
      try { normalized = normalize(expanded); receipt.productionNormalizationAdmission = 'accepted'; }
      catch (error) { if (error.code !== 'REPORT_LIMIT') throw error; receipt.productionNormalizationAdmission = 'REPORT_LIMIT'; }
    });
    if (!normalized) normalized = stage('diagnosticNormalization', () => normalize(expanded, true));
    receipt.normalizationScope = 'canonical normalizer; diagnostic structuredClone only after production rejects trusted generated output; reader unchanged';
    const raw = stage('rawEncoding', () => JSON.stringify(normalized));
    receipt.rawBytes = Buffer.byteLength(raw);
    receipt.analyticsBytes = Buffer.byteLength(JSON.stringify(normalized.analytics));
    const wire = stage('normalizedEncoding', () => encoding.encode(normalized));
    receipt.normalizedBytes = stage('normalizedStringify', () => Buffer.byteLength(JSON.stringify(wire)));
    stage('readerAdmission', () => {
      try { encoding.decode(wire); receipt.readerAdmission = 'accepted'; }
      catch (error) { if (error.code !== 'REPORT_LIMIT') throw error; receipt.readerAdmission = 'REPORT_LIMIT'; }
    });
    const viewerInput = isCapsule ? normalized : { ...require('../cli/report-fixtures.cjs').fixture(false),
      analytics: normalized.analytics, bindings: normalized.bindings, entries: normalized.entries };
    stage('viewerProjection', () => createReportViewModel(viewerInput));
    receipt.viewerScope = 'model construction only; no browser/layout qualification';
  }
  receipt.status = 'completed'; receipt.peakRssKiB = process.resourceUsage().maxRSS;
  receipt.sampledHeapPeakBytes = Math.max(probe.stats.sampledHeapBytes, ...Object.values(memory).map(m => m.heapUsed));
  return receipt;
}
module.exports = { run };
if (require.main === module) {
  try { process.send({ result: run(process.argv[2], process.argv[3], message => process.send(message)) }); }
  catch (error) { process.send({ error: { name: error.name, code: error.code || null, message: error.message, stack: error.stack } }); process.exitCode = 1; }
  finally { process.disconnect(); }
}
