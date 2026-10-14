'use strict';

const assert = require('node:assert/strict');
const { parseCapsule, serializeCapsule } = require('../../packages/cli/src/internal/report/capsule');
const { sha256 } = require('../../packages/cli/src/internal/report/data');
const { renderReport } = require('../../packages/cli/src/internal/report/viewer');
const { createReportViewModel } = require('../../packages/cli/src/internal/report/viewer/model');
const { compareCapsules, parseComparison, serializeComparison } = require('../../packages/cli/src/internal/report/comparison');
const { SEMANTIC_COLLECTIONS } = require('../../packages/cli/src/internal/report/comparison-schema');
const { renderComparison } = require('../../packages/cli/src/internal/report/comparison-viewer');

// Exercise the same retained evidence through each passive consumer. A baseline
// may have different physical artifacts; every authored inventory must agree.
module.exports = function assertIntegration(value, baseline = value) {
  const saved = serializeCapsule(value), model = createReportViewModel(value);
  const html = renderReport(value, { snapshot: 'artifact' });
  assert.equal(renderReport(value, { snapshot: 'artifact' }), html);
  const payload = html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(serializeCapsule(parseCapsule(payload)), saved, 'HTML retains the exact validated capsule');
  const reused = value.analytics.handlers.find(h => h.name === 'reused');
  assert.ok(value.analytics.handlers.every(h => h.name), 'retained local/helper/inline names survive every recipe and replay');
  for (const handler of value.analytics.handlers) assert.equal(model.definitionLabel(handler), handler.name);
  assert.equal(model.definitionRegistrations(reused.id).length, 2);
  assert.equal(model.definitionSites(reused.id).filter(s => s.surfaceId === 'ctx.config.get').length, 3);
  const scoped = value.analytics.handlers.find(h => h.name === 'scopedMiddleware');
  const registrations = model.definitionRegistrations(scoped.id);
  assert.equal(registrations.length, 2);
  assert.notDeepEqual(registrations[0].mountPath, registrations[1].mountPath);
  const helper = value.analytics.handlers.find(h => h.kind === 'helper');
  assert.equal(model.helperCallers(helper.id).length, 2);

  const comparison = compareCapsules(baseline, value);
  assert.equal(comparison.matchingVersion, 'pulse.report-matching.v2');
  assert.ok(!comparison.sections.some(s => SEMANTIC_COLLECTIONS.includes(s.collection)),
    'physical capture/recipe changes cannot masquerade as authored changes');
  for (const name of SEMANTIC_COLLECTIONS) {
    const row = comparison.summary.inventories.find(r => r.collection === name);
    assert.equal(row.counts.unchanged, value.analytics[name].length, name);
    for (const side of ['before', 'after']) assert.equal(row.identityCoverage[side].status, 'complete', name);
  }
  const serialized = serializeComparison(comparison);
  assert.equal(serializeComparison(parseComparison(serialized)), serialized);
  const comparisonHtml = renderComparison(comparison);
  assert.equal(renderComparison(comparison), comparisonHtml);
  assert.equal(serializeCapsule(value), saved, 'passive consumers never mutate retained facts');
  return { reportHtmlSha256: sha256(html), comparisonHtmlSha256: sha256(comparisonHtml),
    comparisonHash: comparison.comparisonHash.value };
};
