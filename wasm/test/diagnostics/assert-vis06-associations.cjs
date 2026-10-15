'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { instrument, queryRelations, canonicalJson, sha256 } = require('./vis06-derivation.cjs');
const { capture } = require('./vis06-inputs.cjs');
const { supervise } = require('./vis06-run.cjs');
const { qualify } = require('./vis06-qualification.cjs');
const production = require('../../packages/cli/src/internal/report/handler-associations');
const { validateHandlerTopology } = require('../../packages/cli/src/internal/report/handler-topology');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-vis06-'));
  let assertions = 0;
  try {
    const fixture = capture(path.join(dir, 'mixed')), a = fixture.analytics;
    function parity(value) {
      const limited = instrument().derive(value), original = production.deriveHandlerAssociations(value);
      assert.deepEqual(limited, original); assertions++;
      const oracle = instrument({ unrestricted: true }).derive(value);
      const factor = instrument({ unrestricted: true, relationsOnly: true }); factor.derive(value);
      const queries = queryRelations(value, factor.relations);
      for (const r of value.registrations) {
        assert.deepEqual(queries.route(r.id), oracle.rows.filter(row => row.consumerRegistrationId === r.id)); assertions++;
      }
      const sites = new Map(value.useSites.map(s => [s.id, s]));
      for (const b of queries.bindingIds) {
        assert.deepEqual(queries.binding(b), [...new Set(oracle.rows.filter(row => sites.get(row.useSiteId).binding.bindingId === b)
          .map(row => row.consumerRegistrationId))].sort()); assertions++;
      }
      const qualified = qualify(value, queries, [...queries.bindingIds, 'unused-binding']);
      assert.equal(qualified.counts.rows, oracle.rows.length);
      assert.equal(qualified.counts.rawAssociationArrayBytes, Buffer.byteLength(JSON.stringify(oracle.rows)));
      assert.deepEqual(qualified.coverage, oracle.coverage);
      assert.equal(qualified.routeSemanticDigest, sha256(canonicalJson(value.registrations.map(r =>
        [r.id, sha256(canonicalJson(oracle.rows.filter(row => row.consumerRegistrationId === r.id)))]))));
      assert.equal(qualified.bindingComparisons.find(b => b.binding === 'unused-binding').consumers, 0);
      assertions += 5;
      return { oracle, factor };
    }
    const { oracle, factor } = parity(a);
    require('../cli/assert-report-handler-associations.cjs').assertFixture(a, { event: true, error: true });
    assert.equal(oracle.rows.length, 160); assertions++;
    const broken = queryRelations(a, factor.relations);
    assert.throws(() => qualify(a, { ...broken, route(id) {
      const rows = broken.route(id); if (rows.length) rows[0].conditional = 'incorrect'; return rows;
    } }, broken.bindingIds), /Whole-row parity/);
    assert.throws(() => qualify(a, { ...broken, binding: () => [] }, broken.bindingIds), /Binding reverse parity/);
    assertions += 2;
    const missing = structuredClone(a); missing.registrations[0].control = { state: 'unavailable', value: null, reason: 'not-recorded' };
    const unknown = parity(missing).oracle;
    assert.ok(unknown.rows.some(r => r.conditional === null)); assertions++;
    const old = structuredClone(a); old.registrations.forEach(r => delete r.control);
    assert.equal(parity(old).oracle.coverage.status, 'unavailable'); assertions++;
    const cyclic = structuredClone(fixture); cyclic.analytics.registrations[0].flow.next = cyclic.analytics.registrations[0].id;
    assert.throws(() => validateHandlerTopology(cyclic)); assertions++;
    // Cycle-safety at the pure algorithm boundary is preserved, even though
    // production validation rejects this malformed graph before derivation.
    parity(cyclic.analytics);
    const reordered = structuredClone(a); reordered.useSites.reverse(); reordered.helperCalls.reverse();
    assert.equal(sha256(canonicalJson(parity(reordered).oracle.rows)), sha256(canonicalJson(oracle.rows))); assertions++;
    assert.ok(factor.relations.some(r => !a.useSites.some(s => s.binding.bindingId && s.ownerId === a.registrations.find(x => x.id === r.owner).handlerId)));
    assertions++;
    const noSites = structuredClone(a), root = noSites.registrations[0];
    noSites.useSites = noSites.useSites.filter(s => s.ownerId !== root.handlerId);
    noSites.coverage.useSites.observed = noSites.coverage.useSites.expected = noSites.useSites.length;
    assert.ok(parity(noSites).factor.relations.some(r => r.owner === root.id && r.inherited)); assertions++;
    const small = capture(path.join(dir, 'small'), true).analytics;
    const many = structuredClone(small);
    many.useSites = Array.from({ length: 10001 }, (_, i) => ({ ...small.useSites[0], id: `site-${i}` }));
    many.coverage.useSites = { status: 'complete', observed: 10001, expected: 10001, reason: null };
    assert.equal(production.deriveHandlerAssociations(many).rows.length, 10000);
    assert.equal(instrument({ unrestricted: true }).derive(many).rows.length, 10001); assertions += 2;
    // Deep finite continuation witnesses and >250k work without >10k rows.
    const deep = structuredClone(small), base = deep.registrations[0];
    deep.registrations = Array.from({ length: 260 }, (_, i) => ({ ...base, id: `entry-${i}`, kind: 'middleware',
      control: { state: 'available', value: { pattern: null, normal: true, error: false, terminal: false, eligibility: false }, reason: null },
      handlerId: i === 259 ? base.handlerId : `unused-${i}`, mountPath: [],
      flow: { next: i === 259 ? null : `entry-${i + 1}`, child: null, parentContinue: null } }));
    const policy = instrument(), unbounded = instrument({ unrestricted: true });
    assert.equal(policy.derive(deep).coverage.reason, 'graph-budget-exhausted');
    const full = unbounded.derive(deep);
    assert.equal(full.rows.length, 520); assert.ok(unbounded.stats.counters.work > 250000);
    assert.ok(unbounded.stats.counters.maxPathHops > 64); assertions += 4;
    const workOnly = structuredClone(deep);
    workOnly.registrations = Array.from({ length: 400 }, (_, i) => ({ ...structuredClone(deep.registrations[0]),
      id: `work-${i}`, flow: { next: i === 399 ? null : `work-${i + 1}`, child: null, parentContinue: null } }));
    workOnly.registrations.forEach((r, i) => {
      r.kind = 'route'; r.handlerId = base.handlerId;
      r.match = { state: 'available', value: { method: 'GET', path: `/work/${i}`, eventType: null }, reason: null };
      r.control.value = { pattern: `/work/${i}`, normal: false, error: false, terminal: true, eligibility: false };
    });
    const workProbe = instrument();
    assert.equal(workProbe.derive(workOnly).coverage.reason, 'graph-budget-exhausted');
    assert.equal(workProbe.stats.counters.work, 250001);
    assert.equal(workProbe.stats.counters.maxPathHops, 1); assertions += 3;
    const input = path.join(dir, 'input.json'); fs.writeFileSync(input, '{}');
    const worker = path.join(dir, 'worker.cjs');
    async function failure(name, source, options, expected) {
      fs.writeFileSync(worker, source);
      const output = path.join(dir, name + '.json');
      const r = await supervise({ input, mode: 'unrestricted', output, worker, timeoutMs: 5000, ...options });
      assert.equal(r.status, 'incomplete'); assert.equal(r.failure, expected);
      assert.equal(JSON.parse(fs.readFileSync(output)).status, 'incomplete'); assertions += 3;
      assert.throws(() => supervise({ input, mode: 'unrestricted', output, worker }), /overwrite/); assertions++;
    }
    await failure('timeout', 'while(true) {}', { timeoutMs: 100 }, 'timeout');
    await failure('rss', 'setInterval(()=>{},1000)', { rssMiB: 1 }, 'rss-watchdog');
    await failure('exception', "throw new Error('controlled algorithmic defect')", {}, 'worker-exit-without-completion');
    await failure('false-success', "process.send({result:{status:'completed'}});process.exit(2)", {}, 'worker-exit-without-completion');
    await failure('oom', 'const a=[];while(true)a.push(new Array(100000).fill(1));', { heapMiB: 16 }, 'heap-oom');
    fs.writeFileSync(input, '{"kind":1,"kind":2}');
    const invalid = await supervise({ input, mode: 'limited', output: path.join(dir, 'duplicate.json') });
    assert.equal(invalid.status, 'incomplete'); assert.equal(invalid.error.code, 'REPORT_DUPLICATE_KEY'); assertions += 2;
    assert.deepEqual(production.LIMITS, { work: 250000, associations: 10000 }); assertions++;
    assert.deepEqual(production.deriveHandlerAssociations(a), { rows: a.associations, coverage: a.coverage.associations }); assertions++;
    console.log(JSON.stringify({ status: 'passed', assertions, baselineParity: true, prototypeParity: true,
      policyCeilingsRemovedOnlyInDiagnostic: true, watchdogFailuresRetained: true }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
