'use strict';

const { compileRoutePath } = require('@pulse-compute/wasm-contracts/path');
const { canonicalJson, sha256 } = require('./data');
const complete = count => ({ status: 'complete', observed: count, expected: count, reason: null });
const unavailable = () => ({ status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' });
const partial = (count, reason) => ({ status: 'partial', observed: count, expected: null, reason });
const associationId = row => 'association:' + sha256(canonicalJson(['association',
  row.consumerRegistrationId, row.useSiteId, row.via, row.lane]));
const LIMITS = Object.freeze({ work: 250000, associations: 10000 });

// Relate two sets of requests using the canonical sealed path grammar. A
// parameter is a segment constraint, never a literal URL or a sample request.
function patternRelation(gate, context) {
  if (gate === null) return 'always';
  const a = compileRoutePath(gate, { allowWildcard: true });
  const b = compileRoutePath(context || '/*', { allowWildcard: true });
  const x = a.segments.filter(s => s.kind !== 'wildcard'), y = b.segments.filter(s => s.kind !== 'wildcard');
  if (!a.wildcard && !b.wildcard && x.length !== y.length
    || !a.wildcard && x.length < y.length || !b.wildcard && y.length < x.length) return 'never';
  let contains = a.wildcard ? y.length >= x.length : !b.wildcard && x.length === y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i].kind === 'literal' && y[i].kind === 'literal' && x[i].value !== y[i].value) return 'never';
    if (x[i].kind === 'literal' && y[i].kind !== 'literal') contains = false;
  }
  return contains ? 'always' : 'sometimes';
}

// Pure bounded derivation: replay/validation uses exactly the retained facts.
// Direct rows describe ownership even for a shadowed registration. Inherited
// rows require a path through canonical admission and continuation links.
function deriveHandlerAssociations(analytics) {
  const registrations = analytics.registrations;
  if (!registrations.some(r => r.control) || ['handlers', 'registrations', 'useSites', 'helperCalls']
    .some(key => analytics.coverage[key].status === 'unavailable')) return { rows: [], coverage: unavailable() };
  const rows = new Map(), sites = new Map(), calls = new Map();
  const budget = Symbol('association-budget');
  let work = 0, reason = null;
  const charge = () => { if (++work > LIMITS.work) throw budget; };
  const upstreamPartial = ['handlers', 'registrations', 'useSites', 'helperCalls']
    .some(key => analytics.coverage[key].status !== 'complete');
  const hop = row => ({ kind: row.kind === 'middleware' ? 'middleware' : row.kind === 'error' ? 'error' : row.kind === 'mount' ? 'mount' : 'direct', id: row.id });
  const ancestry = row => row.mountPath.map(id => ({ kind: 'mount', id }));
  function emit(consumer, owner, via, inherited, uncertainty) {
    function add(site, path) {
      charge();
      if (path.length > 64) throw budget;
      const row = { consumerRegistrationId: consumer.id, useSiteId: site.id, via: path,
        lane: consumer.kind === 'event' ? 'event' : path.some(p => p.kind === 'error') ? 'error' : 'normal',
        conditional: inherited ? uncertainty === 'not-recorded' ? null : true : false,
        coverage: uncertainty ? partial(1, uncertainty) : complete(1),
        evidence: [{ basis: 'derived-association', producer: 'canonical-report-associations' }] };
      row.id = associationId(row);
      if (!rows.has(row.id) && rows.size >= LIMITS.associations) throw budget;
      rows.set(row.id, row);
      if (uncertainty) reason ||= uncertainty;
    }
    for (const site of sites.get(owner.handlerId) || []) add(site, via);
    for (const call of calls.get(owner.id) || []) for (const site of sites.get(call.calleeId) || []) {
      add(site, [...via, { kind: 'helper', id: call.id }]);
    }
  }
  try {
    for (const site of [...analytics.useSites].sort((a, b) => a.id.localeCompare(b.id))) {
      charge(); if (!sites.has(site.ownerId)) sites.set(site.ownerId, []); sites.get(site.ownerId).push(site);
    }
    for (const call of [...analytics.helperCalls].sort((a, b) => a.id.localeCompare(b.id))) for (const id of call.registrationIds) {
      charge(); if (!calls.has(id)) calls.set(id, []); calls.get(id).push(call);
    }
    const http = registrations.filter(r => r.kind !== 'event'), indices = new Map(http.map((r, i) => [r.id, i]));
    for (const consumer of registrations) {
      charge();
      if (!consumer.handlerId) continue;
      emit(consumer, consumer, [...ancestry(consumer), hop(consumer)], false, upstreamPartial ? 'upstream-partial' : null);
      if (consumer.kind === 'event') continue;
      // The two modes mirror canonical explicit next()/next(error) dispatch.
      // Runtime failures and branch-predicate feasibility are not inferred.
      let uncertainty = upstreamPartial ? 'upstream-partial' : null;
      const graph = http.flatMap(row => [0, 1].map(mode => {
        charge();
        const control = row.control?.state === 'available' ? row.control.value : null;
        if (!control) uncertainty = 'not-recorded';
        const expectedMode = row.kind === 'error' ? 1 : 0;
        const node = { row, mode, hit: false, edges: [] };
        function edge(id, lane, executed) {
          if (id !== null && indices.has(id)) node.edges.push({ to: indices.get(id) * 2 + lane, executed });
        }
        if (mode !== expectedMode) { edge(row.flow.next, mode, false); return node; }
        let match = control ? patternRelation(control.pattern, consumer.control?.state === 'available' ? consumer.control.value.pattern : null) : 'sometimes';
        if (row.match.state !== 'available' || consumer.match.state !== 'available') uncertainty = 'not-recorded';
        if (row.kind === 'route' && consumer.kind === 'route' && row.match.state === 'available' && consumer.match.state === 'available'
          && row.match.value.method !== consumer.match.value.method) match = 'never';
        else if (row.kind === 'route' && consumer.kind !== 'route' && match !== 'never') match = 'sometimes';
        if (match === 'sometimes' && uncertainty !== 'not-recorded') uncertainty ||= 'unsupported-mapping';
        if (match !== 'never') {
          if (row.kind === 'mount') edge(row.flow.child, mode, true);
          else if (row.handlerId) {
            node.hit = true;
            if (!control || control.normal) edge(row.flow.next, 0, true);
            if (!control || control.error) edge(row.flow.next, 1, true);
          } else edge(row.flow.next, mode, false);
        }
        if (match !== 'always' || control?.eligibility) edge(row.flow.next, mode, false);
        return node;
      }));
      if (uncertainty) reason ||= uncertainty;
      const target = indices.get(consumer.id) * 2 + (consumer.kind === 'error' ? 1 : 0);
      const reachable = new Set(), queue = graph.length ? [0] : [];
      for (let i = 0; i < queue.length; i++) {
        charge(); const key = queue[i]; if (reachable.has(key)) continue; reachable.add(key);
        for (const e of graph[key].edges) queue.push(e.to);
      }
      if (!reachable.has(target) || !graph[target].hit) continue;
      const reverse = graph.map(() => []);
      graph.forEach((node, key) => node.edges.forEach(e => reverse[e.to].push(key)));
      const before = new Set(), back = [target];
      for (let i = 0; i < back.length; i++) {
        charge(); const key = back[i]; if (before.has(key)) continue; before.add(key); back.push(...reverse[key]);
      }
      for (const key of [...before].sort((a, b) => a - b)) {
        charge(); const node = graph[key], owner = node.row;
        if (key === target || !reachable.has(key) || !node.hit || !node.edges.some(e => e.executed && before.has(e.to))) continue;
        emit(consumer, owner, [...ancestry(owner), hop(owner)], true, uncertainty);
      }
      // Keep a deterministic continuation witness, with skips omitted. The via
      // path explains dependencies; it is not an observed runtime trace.
      const seen = new Set(), after = graph[target].edges.filter(e => e.executed)
        .map(e => ({ key: e.to, via: [...ancestry(consumer), hop(consumer)] }));
      for (let i = 0; i < after.length; i++) {
        charge(); const { key, via } = after[i]; if (via.length > 64) throw budget; if (seen.has(key)) continue; seen.add(key);
        const node = graph[key];
        if (node.hit) emit(consumer, node.row, [...via, hop(node.row)], true, uncertainty);
        for (const edge of node.edges) after.push({ key: edge.to, via: edge.executed ? [...via, hop(node.row)] : via });
      }
    }
  } catch (error) {
    if (error !== budget) throw error;
    reason = 'graph-budget-exhausted';
  }
  const result = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { rows: result, coverage: reason || upstreamPartial ? partial(result.length, reason || 'upstream-partial') : complete(result.length) };
}

module.exports = { deriveHandlerAssociations, associationId, patternRelation, LIMITS };
