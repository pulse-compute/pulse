'use strict';

// Repository-only instrumentation. Compile the canonical source in a private
// module; never edit its file, cache entry, production defaults or reader limits.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const file = path.resolve(__dirname, '../../packages/cli/src/internal/report/handler-associations.js');
const { canonicalJson, sha256 } = require('../../packages/cli/src/internal/report/data');

function instrument({ unrestricted = false, relationsOnly = false, focus = null, progress = () => {} } = {}) {
  const original = fs.readFileSync(file, 'utf8');
  let source = original;
  const replace = (from, to, count = 1) => {
    assert.equal(source.split(from).length - 1, count, `VIS06 instrumentation drift: ${from}`);
    source = source.split(from).join(to);
  };
  const stats = { stages: {}, counters: { work: 0, consumersStarted: 0, consumersFinished: 0,
    graphs: 0, graphNodes: 0, graphEdges: 0, emissionAttempts: 0, duplicates: 0,
    maxPathHops: 0, relations: 0 }, sampledHeapBytes: 0, sampledRssBytes: 0 };
  const active = [];
  const probe = {
    enter(name) { active.push({ name, at: performance.now(), children: 0 }); },
    leave() {
      const { name, at, children } = active.pop(), elapsed = performance.now() - at;
      const stage = stats.stages[name] ||= { inclusiveMs: 0, selfMs: 0 };
      stage.inclusiveMs += elapsed; stage.selfMs += elapsed - children;
      if (active.length) active.at(-1).children += elapsed;
    },
    sample() {
      const m = process.memoryUsage();
      stats.sampledHeapBytes = Math.max(stats.sampledHeapBytes, m.heapUsed);
      stats.sampledRssBytes = Math.max(stats.sampledRssBytes, m.rss);
    },
    startConsumer(id) { stats.counters.consumersStarted++; stats.currentConsumer = id; probe.sample(); },
    finishConsumer() {
      stats.counters.consumersFinished++; probe.sample();
      progress({ ...stats.counters, sampledHeapBytes: stats.sampledHeapBytes });
    },
    relation(consumer, owner, via, inherited, uncertainty) {
      relations.push({ consumer: consumer.id, owner: owner.id, via, inherited, uncertainty });
      stats.counters.relations++;
    },
    stats, relationsOnly, focus
  };
  const relations = [];
  replace("const LIMITS = Object.freeze({ work: 250000, associations: 10000 });",
    unrestricted ? 'const LIMITS = { work: Infinity, associations: Infinity };' : 'const LIMITS = { work: 250000, associations: 10000 };');
  if (unrestricted) {
    replace('if (path.length > 64) throw budget;', '/* diagnostic: no association path policy ceiling */');
    replace('if (via.length > 64) throw budget;', '/* diagnostic: no continuation path policy ceiling */');
  }
  replace('if (++work > LIMITS.work)', 'if ((probe.stats.counters.work = ++work) > LIMITS.work)');
  replace('function emit(consumer, owner, via, inherited, uncertainty) {',
    `function emit(consumer, owner, via, inherited, uncertainty) {
      if (probe.relationsOnly) { probe.relation(consumer, owner, via, inherited, uncertainty); return; }
      probe.enter('expansionInclusive'); try {`);
  replace('function add(site, path) {', `function add(site, path) {
      probe.stats.counters.emissionAttempts++;
      probe.stats.counters.maxPathHops = Math.max(probe.stats.counters.maxPathHops, path.length);`);
  replace('row.id = associationId(row);', "probe.enter('identityAndDedup'); row.id = associationId(row);");
  replace('rows.set(row.id, row);', `if (rows.has(row.id)) probe.stats.counters.duplicates++;
      rows.set(row.id, row); probe.leave();`);
  replace('  }\n  try {', "    } finally { probe.leave(); }\n  }\n  try {\n    probe.enter('indexing');");
  replace('    const http =', "    probe.leave();\n    const http =");
  replace('for (const consumer of registrations) {', `for (const consumer of registrations) {
      if (probe.focus && consumer.id !== probe.focus) continue;
      probe.startConsumer(consumer.id); try {`);
  replace('      const graph =', "      probe.enter('routingGraph');\n      const graph =");
  replace('      }));\n      if (uncertainty) reason ||= uncertainty;', `      }));
      probe.stats.counters.graphs++;
      probe.stats.counters.graphNodes += graph.length;
      probe.stats.counters.graphEdges += graph.reduce((n, x) => n + x.edges.length, 0);
      probe.leave(); probe.enter('traversalInclusive');
      if (uncertainty) reason ||= uncertainty;`);
  // Explicitly close traversal on the early unreachable branch.
  replace('if (!reachable.has(target) || !graph[target].hit) continue;',
    'if (!reachable.has(target) || !graph[target].hit) { probe.leave(); continue; }');
  replace('    }\n  } catch (error)', `      probe.leave();
      } finally { probe.finishConsumer(); }
    }
  } catch (error)`);
  replace('  const result =', "  while (probeStack.length) probe.leave();\n  probe.enter('sorting');\n  const result =");
  replace('  return { rows: result,', '  probe.leave(); probe.sample();\n  return { rows: result,');
  // Catching a budget during nested instrumentation leaves frames to unwind;
  // diagnostics label inclusive times, never add them as independent totals.
  const loaded = new Module(file, module);
  loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.probe = probe; loaded.probeStack = active;
  loaded._compile('const probe = module.probe, probeStack = module.probeStack;\n' + source, file);
  return { derive: loaded.exports.deriveHandlerAssociations, stats, relations,
    sourceSha256: sha256(original), instrumentedSha256: sha256(source) };
}

// Prototype queries factor use-site expansion out of owner reachability. This
// intentionally shares the canonical admission algorithm, not an independent
// semantic oracle or a proposed persisted production format.
function queryRelations(analytics, relations) {
  const registrations = new Map(analytics.registrations.map(r => [r.id, r]));
  const sites = new Map(), calls = new Map(), consumers = new Map();
  for (const site of analytics.useSites) {
    if (!sites.has(site.ownerId)) sites.set(site.ownerId, []);
    sites.get(site.ownerId).push(site);
  }
  for (const call of analytics.helperCalls) for (const id of call.registrationIds) {
    if (!calls.has(id)) calls.set(id, []); calls.get(id).push(call);
  }
  for (const r of relations) {
    if (!consumers.has(r.consumer)) consumers.set(r.consumer, []); consumers.get(r.consumer).push(r);
  }
  const { associationId } = require(file);
  function *expand(relation) {
    const consumer = registrations.get(relation.consumer), owner = registrations.get(relation.owner);
    const paths = [[owner.handlerId, relation.via], ...(calls.get(owner.id) || [])
      .map(c => [c.calleeId, [...relation.via, { kind: 'helper', id: c.id }]])];
    for (const [handler, via] of paths) for (const site of sites.get(handler) || []) {
      const row = { consumerRegistrationId: consumer.id, useSiteId: site.id, via,
        lane: consumer.kind === 'event' ? 'event' : via.some(p => p.kind === 'error') ? 'error' : 'normal',
        conditional: relation.inherited ? relation.uncertainty === 'not-recorded' ? null : true : false,
        coverage: { status: relation.uncertainty ? 'partial' : 'complete', observed: 1,
          expected: relation.uncertainty ? null : 1, reason: relation.uncertainty },
        evidence: [{ basis: 'derived-association', producer: 'canonical-report-associations' }] };
      row.id = associationId(row); yield row;
    }
  }
  function route(id) {
    const result = new Map();
    for (const relation of consumers.get(id) || []) for (const row of expand(relation)) result.set(row.id, row);
    return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  // Reverse indexes are owner-level, not consumer × authored-site rows.
  const byOwner = new Map();
  for (const relation of relations) {
    const owner = registrations.get(relation.owner);
    for (const id of new Set([owner.handlerId, ...(calls.get(owner.id) || []).map(c => c.calleeId)])) {
      if (!byOwner.has(id)) byOwner.set(id, []); byOwner.get(id).push(relation);
    }
  }
  const bindingOwners = new Map();
  for (const site of analytics.useSites) if (site.binding.bindingId) {
    if (!bindingOwners.has(site.binding.bindingId)) bindingOwners.set(site.binding.bindingId, new Set());
    bindingOwners.get(site.binding.bindingId).add(site.ownerId);
  }
  function binding(id) {
    const candidates = new Set();
    for (const owner of bindingOwners.get(id) || []) for (const r of byOwner.get(owner) || []) candidates.add(r.consumer);
    return [...candidates].sort();
  }
  return { route, binding, bindingIds: [...bindingOwners.keys()].sort() };
}
module.exports = { instrument, queryRelations, canonicalJson, sha256 };
