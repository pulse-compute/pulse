#!/usr/bin/env node
'use strict';
// Opt-in retained-evidence reconciliation. No application builds or report
// mutation; private inputs and resulting summaries stay outside the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const [historicalFile, manifestFile, outputFile] = process.argv.slice(2).map(value => path.resolve(value));
assert.equal(process.argv.length, 5, 'Usage: replay.cjs HISTORICAL_CAPSULE MATCHING_BUILD_MANIFEST OUTPUT_JSON');
assert(!fs.existsSync(outputFile), 'Use a fresh output path');
const root = path.resolve(__dirname, '../../..');
assert(!outputFile.startsWith(root + path.sep), 'Consumer receipts belong outside this repository');
assert(!outputFile.startsWith(path.dirname(manifestFile) + path.sep), 'Output must be outside retained build inputs');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  assert(!/(?:wasm-compiler|provider-|binaryen|typescript|project-execution|project-config|child_process|^(?:node:)?(?:net|tls|http|https|dns)$)/.test(request),
    'Passive replay imported forbidden dependency: ' + request);
  return originalLoad.call(this, request, parent, isMain);
};
const reportRoot = path.join(root, 'wasm/packages/cli/src/internal/report');
const { parseCapsule, serializeCapsule } = require(path.join(reportRoot, 'capsule'));
const { collectArtifactReport } = require(path.join(reportRoot, 'retained'));
const { createReportViewModel } = require(path.join(reportRoot, 'viewer/model'));
const { renderReport } = require(path.join(reportRoot, 'viewer'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const original = fs.readFileSync(historicalFile, 'utf8'), before = parseCapsule(original);
const canonical = serializeCapsule(before);
assert.equal(canonical, original, 'Historical capsule must be canonical');
assert.equal(serializeCapsule(collectArtifactReport(historicalFile).capsule), original);
const after = collectArtifactReport(manifestFile).capsule;
assert.deepEqual(after.artifacts, before.artifacts, 'Compare the same physical artifacts and ledger');
assert.deepEqual(after.measurements, before.measurements, 'New presentation cannot silently revise retained measurements');
assert.deepEqual(after.routes, before.routes, 'Retained routes are unchanged');
assert.deepEqual(after.schemas, before.schemas, 'New reporter cannot invent missing schema evidence');
for (const capsule of [before, after]) {
  const saved = serializeCapsule(capsule), html = renderReport(capsule);
  const payload = html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(serializeCapsule(parseCapsule(payload)), saved);
  assert.equal(renderReport(capsule), html, 'Offline HTML is repeatable');
}
assert.equal(fs.readFileSync(historicalFile, 'utf8'), original);
assert.equal(serializeCapsule(collectArtifactReport(manifestFile).capsule), serializeCapsule(after));
function summary(capsule) {
  const view = createReportViewModel(capsule);
  const countBy = values => values.reduce((counts, value) => { counts[value] = (counts[value] || 0) + 1; return counts; }, {});
  return {
    capsuleSha256: hash(serializeCapsule(capsule)), routes: capsule.routes.length, schemas: capsule.schemas.length,
    physicalBytes: view.A.bytes, physicalCodeBytes: view.A.ledger.codeBodyBytes,
    routeMetrics: Object.fromEntries(['handler-body', 'reachable', 'own', 'shared'].map(metric => [metric,
      countBy(capsule.routes.map(route => { const fact = view.measurement(route, metric)?.fact;
        return fact ? [fact.state, fact.coverage, fact.reason].filter(Boolean).join(':') : 'not-recorded'; }))])),
    helpers: { state: view.helperState, rows: view.helpers.length, distinctMappedBytes: view.helperSize(view.helpers).bytes,
      distinctBodies: view.helperSize(view.helpers).bodyIds.length, origins: countBy(view.helpers.map(row => row.origin)) },
    routesWithDispatcherAssociations: capsule.implementations
      ? capsule.routes.filter(route => view.routeDispatchers(route).records.length).length : null,
    schemaUsage: countBy(capsule.schemas.map(schema => view.schemaUsage(schema).label)),
    externalSchemaReferences: capsule.references ? capsule.references.filter(row => row.externalPackages?.length).length : null,
    resources: countBy(capsule.resources.map(row => row.kind)),
    textResponseCoverage: capsule.resourceProducers?.find(row => row.scope === 'canonical-text-responses')?.coverage || null,
    graphDiagnostics: capsule.observations.filter(row => row.graphDiagnostic).map(row => row.graphDiagnostic)
  };
}
const receipt = { status: 'passed', mode: 'retained-replay-only', freshApplicationBuild: false,
  historicalBytesUnchanged: true, retainedMeasurementsUnchanged: true, htmlPayloadsUnchanged: true,
  before: summary(before), after: summary(after) };
fs.writeFileSync(outputFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, mode: receipt.mode, routes: after.routes.length, schemas: after.schemas.length }));
