'use strict';

// Bounded evidence consumer; this is not a production Report contract.
const assert = require('node:assert/strict');
const { family } = require('../../../wasm/test/runtime/compiler-efficiency/o08-wasm-census.cjs');
const prefixes = ['canonical-native.as/', 'fastly-native-platform-capabilities.as/'];
const sum = rows => rows.reduce((total, row) => total + row.bytes, 0);
const status = (mapped, expected, supported = true) => supported && expected > 0 && mapped === expected
  ? 'complete' : mapped > 0 ? 'partial' : 'unavailable';

function analyze(plan, ownershipManifest, capture, expectedArtifactSha256) {
  assert.match(expectedArtifactSha256, /^[a-f0-9]{64}$/, 'expected final artifact hash required');
  assert.equal(capture.artifactSha256, expectedArtifactSha256, 'capture artifact hash mismatch');
  assert.equal(capture.nonCustomSectionsIdentical, true, 'capture section identity not verified');
  assert.equal(capture.restoredSerializationIdentical, true, 'capture changed serialization');
  assert.ok(plan.planHash && ownershipManifest.planHash === plan.planHash, 'ownership plan hash mismatch');
  const byIndex = new Map(), byName = new Map(), owners = new Map();
  for (const fn of capture.functions) {
    assert.ok(Number.isSafeInteger(fn.index) && fn.index >= capture.importedFunctions, 'invalid body index');
    assert.ok(Number.isSafeInteger(fn.bytes) && fn.bytes > 0, 'invalid body byte length');
    assert.ok(!byIndex.has(fn.index), 'duplicate final function index');
    byIndex.set(fn.index, fn);
    if (fn.name !== null) {
      assert.equal(typeof fn.name, 'string');
      assert.ok(!byName.has(fn.name), 'ambiguous final function name');
      byName.set(fn.name, fn);
    }
  }
  for (const body of ownershipManifest.handlerBodies || []) {
    assert.ok(!owners.has(body.id), 'duplicate handler-body owner');
    owners.set(body.id, body);
  }
  const observedPrefixes = prefixes.filter(prefix => [...byName.keys()].some(name => name.startsWith(prefix)));
  const prefix = observedPrefixes.length === 1 ? observedPrefixes[0] : null;
  const bounded = ownershipManifest.dispatcher?.strategy === 'bounded-state-chunks';
  const specialChunks = new Set([...(ownershipManifest.stages || []), ...(ownershipManifest.helperBodies || [])]
    .flatMap(body => body.chunks || []));
  const registrations = new Map(), bodyRoutes = new Map();
  const routes = (plan.routing?.routes || []).map(route => {
    const body = owners.get(route.routerEntryStableId), gaps = [], mapped = [];
    if (body) assert.equal(body.handlerId, route.handlerId, 'route handlerId does not match body owner');
    if (!body) gaps.push('missing-handler-body-owner');
    if (!bounded) gaps.push('unsupported-dispatcher-strategy');
    if (!prefix) gaps.push('missing-or-ambiguous-generator-prefix');
    const chunks = [...new Set(body?.chunks || [])];
    if (body && chunks.length === 0) gaps.push('no-recorded-handler-chunks');
    for (const chunk of chunks) {
      assert.ok(Number.isSafeInteger(chunk) && chunk >= 0, 'invalid generated chunk identity');
      if (specialChunks.has(chunk)) { gaps.push(`unsupported-stage-or-helper-chunk:${chunk}`); continue; }
      const fn = bounded && prefix ? byName.get(`${prefix}__pulse_chunk_${chunk}`) : null;
      if (!fn) { gaps.push(`missing-final-chunk:${chunk}`); continue; }
      mapped.push(fn);
      if (!bodyRoutes.has(fn.index)) bodyRoutes.set(fn.index, new Set());
      bodyRoutes.get(fn.index).add(route.stableId);
    }
    const unique = [...new Map(mapped.map(fn => [fn.index, fn])).values()];
    const disposition = status(mapped.length, chunks.length, gaps.length === 0);
    const row = { routeId: route.stableId, method: route.method, path: route.path,
      handlerId: route.handlerId, routerEntryStableId: route.routerEntryStableId,
      status: disposition, expectedChunks: chunks.length, mappedChunks: mapped.length,
      directBodyBytes: disposition === 'complete' ? sum(unique) : null,
      mappedDirectBodyBytes: sum(unique), functionIndices: unique.map(fn => fn.index), gaps };
    if (!registrations.has(route.handlerId)) registrations.set(route.handlerId, []);
    registrations.get(route.handlerId).push(row);
    return row;
  });
  const uniqueBodies = [...bodyRoutes.keys()].map(index => byIndex.get(index));
  const bodyOverlaps = [...bodyRoutes].filter(([, ids]) => ids.size > 1)
    .map(([index, ids]) => ({ index, bytes: byIndex.get(index).bytes, routeIds: [...ids] }));
  const complete = routes.length > 0 && routes.every(route => route.status === 'complete');
  const categories = new Map();
  for (const fn of byIndex.values()) {
    const category = fn.name === null ? 'optimizer-created or unnamed' : family(fn.name);
    if (!categories.has(category)) categories.set(category, { category, functions: 0, bodyBytes: 0 });
    const item = categories.get(category); item.functions++; item.bodyBytes += fn.bytes;
  }
  return {
    version: 'pulse.prpt00c.attribution.v1', artifactSha256: expectedArtifactSha256,
    planHash: plan.planHash, generatorPrefix: prefix, routes,
    applicationDirectBody: { status: complete ? 'complete' : uniqueBodies.length ? 'partial' : 'unavailable',
      completeRoutes: routes.filter(route => route.status === 'complete').length, expectedRoutes: routes.length,
      uniqueMappedFunctions: uniqueBodies.length, directBodyBytes: complete ? sum(uniqueBodies) : null,
      mappedDirectBodyBytes: sum(uniqueBodies), routeSumBytes: routes.reduce((n, route) => n + route.mappedDirectBodyBytes, 0),
      routeSumIsAdditive: bodyOverlaps.length === 0 },
    authoredHandlerRegistrations: [...registrations].map(([handlerId, rows]) => ({ handlerId,
      registrationCount: rows.length, routeIds: rows.map(row => row.routeId),
      functionIndices: [...new Set(rows.flatMap(row => row.functionIndices))],
      binarySharingInferredFromHandlerId: false })),
    bodyOverlaps,
    bodyCensus: { categoryBasis: 'generated-symbol-name heuristic; not authored ownership or reachability',
      definedFunctions: byIndex.size, bodyBytes: sum([...byIndex.values()]),
      namedFunctions: byName.size, unnamedFunctions: byIndex.size - byName.size,
      categories: [...categories.values()].sort((a, b) => b.bodyBytes - a.bodyBytes) },
    limitations: [
      'Direct handler chunks only; excludes callees, shared dependencies, data and section framing.',
      'Missing chunk identity has unknown bytes; mapped bytes remain available as partial evidence.',
      'Special stage/helper attribution and post-link remapping are unsupported.',
      'Route byte rows may overlap; application totals deduplicate final function indices.',
      'Authored handler reuse does not establish binary body sharing.'
    ]
  };
}

function selfCheck() {
  const sha = 'a'.repeat(64), plan = { planHash: 'p', routing: { routes: [
    { stableId: 'r1', routerEntryStableId: 'e1', handlerId: 'h' },
    { stableId: 'r2', routerEntryStableId: 'e2', handlerId: 'h' }
  ] } };
  const ownership = { planHash: 'p', dispatcher: { strategy: 'bounded-state-chunks' }, handlerBodies: [
    { id: 'e1', handlerId: 'h', chunks: [0] }, { id: 'e2', handlerId: 'h', chunks: [0] }
  ] };
  const capture = { artifactSha256: sha, importedFunctions: 0,
    nonCustomSectionsIdentical: true, restoredSerializationIdentical: true,
    functions: [{ index: 0, name: 'canonical-native.as/__pulse_chunk_0', bytes: 10 }] };
  const result = analyze(plan, ownership, capture, sha);
  assert.equal(result.applicationDirectBody.directBodyBytes, 10);
  assert.equal(result.applicationDirectBody.routeSumBytes, 20);
  assert.equal(result.applicationDirectBody.routeSumIsAdditive, false);
  assert.equal(result.authoredHandlerRegistrations[0].registrationCount, 2);
  assert.equal(result.bodyOverlaps.length, 1);
  const missing = analyze(plan, ownership, { ...capture, functions: [{ index: 0, name: null, bytes: 10 }] }, sha);
  assert.equal(missing.applicationDirectBody.status, 'unavailable');
  assert.equal(missing.routes[0].directBodyBytes, null);
  const partialOwnership = structuredClone(ownership); partialOwnership.handlerBodies[0].chunks.push(1);
  const partial = analyze(plan, partialOwnership, capture, sha);
  assert.equal(partial.routes[0].status, 'partial');
  assert.equal(partial.routes[0].directBodyBytes, null);
  assert.equal(partial.routes[0].mappedDirectBodyBytes, 10);
  assert.throws(() => analyze(plan, ownership, capture, 'b'.repeat(64)), /artifact hash mismatch/);
  const wrong = structuredClone(ownership); wrong.handlerBodies[0].handlerId = 'other';
  assert.throws(() => analyze(plan, wrong, capture, sha), /handlerId/);
  return { status: 'passed', controls: ['missing-name', 'partial-map', 'bad-artifact-hash',
    'shared-body-deduplication', 'multiple-authored-registrations', 'handler-owner-mismatch'] };
}

if (require.main === module) console.log(JSON.stringify(selfCheck()));
module.exports = { analyze, selfCheck };
