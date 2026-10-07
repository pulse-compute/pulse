'use strict';
// Frontend-only projection checks. Synthetic artifact identities here do not
// claim these fixture projects were built; the retained-evidence task does that.
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { compileProject } = require('../../packages/cli/src/project-execution');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { collectInventory } = require('../../packages/cli/src/internal/report/inventory');
const f = require('./report-fixtures.cjs');
module.exports = function inventoryCases() {
  const root = path.resolve(__dirname, '../../..'), cases = [];
  for (const relative of ['examples/11-events', 'wasm/test/fixtures/projects/canonical-integration',
    'wasm/test/fixtures/projects/catalog-router-methods', 'wasm/test/fixtures/projects/canonical-workspace']) {
    const project = resolveProject({ cwd: path.join(root, relative), metadataOnly: true });
    const compiled = compileProject(project), plan = buildCanonicalNativePlan(compiled);
    const seed = collectInventory(project, { compiled, plan, native: { version: 'synthetic', manifest: {} } },
      [{ id: f.aid, sha256: f.hash, bytes: f.wasm.length, stage: 'final', target: 'portable-native-wasm' }], f.aid, 'default');
    assert.deepEqual(seed.routes.map(row => [row.method, row.path]), (plan.routing?.routes || []).map(row => [row.method, row.path]));
    assert.equal(seed.entries.length, compiled.metadata.applicationEntries?.length || plan.routing?.entries.length || 1);
    assert.equal(seed.coverage.resources.status, 'partial');
    if (relative.endsWith('11-events')) {
      const events = seed.entries.filter(row => row.kind === 'event');
      assert.equal(seed.entries[0].flow.nextEntryId, null, 'HTTP termination must not fall through to event ingress');
      assert.equal(events.length, 2); assert.ok(events[0].schemaIds.length);
      assert.ok(events.every(row => row.source.column === 1));
      assert.ok(seed.schemas.some(row => row.entryIds.length && row.routeIds.length === 0));
    } else if (relative.endsWith('canonical-integration')) {
      assert.equal(seed.routes[0].path, '/api/health');
      assert.ok(seed.routes[0].composition.length >= 3);
      assert.ok(seed.entries.some(row => row.flow?.childEntryId));
    } else if (relative.endsWith('catalog-router-methods')) {
      assert.ok(seed.routes.some(row => row.method === 'PATCH'));
      assert.ok(seed.entries.some(row => row.kind === 'error'));
      assert.equal(seed.declarations.some(row => /authorization|permission/.test(row.kind)), false);
    } else assert.equal(seed.entries[0].kind, 'export');
    cases.push({ fixture: relative, routes: seed.routes.length, entries: seed.entries.length, schemas: seed.schemas.length });
  }
  return cases;
};
