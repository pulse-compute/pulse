'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deriveHandlerAssociations, patternRelation, LIMITS } = require('../../packages/cli/src/internal/report/handler-associations');
const { projectHandlerTopology } = require('../../packages/cli/src/internal/report/handler-topology');
const { collectCanonicalReportReferences, buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileProject } = require('../../packages/cli/src/project-execution');
const { resolveProject } = require('../../packages/cli/src/project-config');
const { setup } = require('../support/report-analytics-fixture.cjs');
const root = path.resolve(__dirname, '../../..');

function associations(a, registration) { return a.associations.filter(row => row.consumerRegistrationId === registration.id); }
function ownedBy(a, rows, name) {
  const owner = a.handlers.find(h => h.name === name);
  assert.ok(owner, name);
  return rows.filter(row => a.useSites.find(s => s.id === row.useSiteId).ownerId === owner.id);
}
function assertFixture(a, { event, error }) {
  assert.ok(a.associations.length > 0);
  assert.equal(a.coverage.associations.observed, a.associations.length);
  const route = pathname => a.registrations.find(r => r.kind === 'route' && r.match.value.path === pathname);
  const plain = associations(a, route('/api/plain')), scoped = associations(a, route('/api/scoped'));
  assert.equal(ownedBy(a, plain, 'scopedMiddleware').length, 0, 'plain child excludes scoped middleware');
  assert.ok(ownedBy(a, plain, 'rootMiddleware').length > 0);
  assert.ok(ownedBy(a, scoped, 'scopedMiddleware').length > 0);
  assert.ok(ownedBy(a, scoped, 'scopedMiddleware').every(r => r.conditional === true));
  const rootMiddleware = a.registrations.find(r => r.handlerId === a.handlers.find(h => h.name === 'rootMiddleware').id);
  assert.equal(rootMiddleware.control.value.normal, true);
  assert.equal(rootMiddleware.control.value.terminal, true, 'early response and continuation both remain possible');
  const first = ownedBy(a, scoped, 'scopedMiddleware'), second = ownedBy(a, associations(a, route('/v2/scoped')), 'scopedMiddleware');
  assert.notDeepEqual(first[0].via, second[0].via, 'mount instances retain distinct explanation paths');
  for (const name of ['/helper-a', '/helper-b']) {
    const helper = ownedBy(a, associations(a, route(name)), 'sharedLookup');
    assert.ok(helper.length > 0 && helper.every(r => r.via.at(-1).kind === 'helper'));
  }
  for (const name of ['/direct-a', '/direct-b']) {
    const reads = ownedBy(a, associations(a, route(name)), 'reused').filter(r => a.useSites.find(s => s.id === r.useSiteId).surfaceId === 'ctx.config.get');
    assert.equal(reads.length, 3, 'association retains repeated authored operations');
    assert.ok(reads.every(r => r.conditional === false && r.lane === 'normal'));
  }
  if (error) {
    const recovery = a.registrations.find(r => r.kind === 'error');
    assert.ok(associations(a, route('/error')).some(r => r.lane === 'error' && r.via.some(v => v.kind === 'error' && v.id === recovery.id)));
    assert.ok(!associations(a, route('/direct-a')).some(r => r.lane === 'error'), 'terminal HTTP return does not invent explicit error transfer');
  }
  if (event) {
    const entry = a.registrations.find(r => r.kind === 'event'), rows = associations(a, entry);
    assert.ok(rows.length > 0 && rows.every(r => r.lane === 'event' && r.via.length === 1 && r.via[0].id === entry.id));
    assert.equal(ownedBy(a, rows, 'rootMiddleware').length, 0, 'events have no HTTP middleware context');
  }
}

function main() {
  assert.equal(patternRelation('/api/*', '/api/users/:id'), 'always');
  assert.equal(patternRelation('/api/:group/*', '/api/users/:id'), 'always');
  assert.equal(patternRelation('/api/users/*', '/api/:group/:id'), 'sometimes');
  assert.equal(patternRelation('/api/*', '/apix'), 'never');
  assert.equal(patternRelation('/a', '/a/*'), 'sometimes');
  assert.equal(patternRelation('/a/:id', '/a'), 'never');
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/an9-03-'));
  try {
    setup(directory, 'http', true);
    const source = path.join(directory, 'src/index.ts');
    const capture = text => {
      fs.writeFileSync(source, `import { Pulse } from '@pulse-compute/pulse';\nimport { Router } from '@pulse-compute/runtime';\nconst app = new Pulse({ auto: true });\n${text}\nexport default app;\n`);
      const project = resolveProject({ cwd: directory, metadataOnly: true });
      const compiled = compileProject(project), plan = buildCanonicalNativePlan(compiled);
      return require('../support/report-legacy-analytics.cjs')(projectHandlerTopology(collectCanonicalReportReferences(compiled, plan).topology));
    };
    const a = capture(`
const before = async (ctx, next) => { const value = await ctx.config.get('BEFORE'); return next(); };
const first = async (ctx, next) => { const value = await ctx.config.get('FIRST'); return next({ code: 'RECOVER', message: 'recover' }); };
const recovery = async (error, ctx, next) => { const value = await ctx.config.get('RECOVERY'); return next(); };
const second = async ctx => { const value = await ctx.config.get('SECOND'); return ctx.text(value); };
const shadowed = async ctx => { const value = await ctx.config.get('SHADOWED'); return ctx.text(value); };
const postOnly = async ctx => ctx.text('post');
app.use(before); app.get('/flow', first); app.error(recovery); app.get('/flow', second); app.get('/flow', shadowed); app.post('/flow', postOnly);
`);
    const registration = name => a.registrations.find(r => r.handlerId === a.handlers.find(h => h.name === name).id);
    const firstRows = associations(a, registration('first'));
    assert.ok(ownedBy(a, firstRows, 'second').some(r => r.lane === 'error' && r.via.map(v => v.kind).join(',') === 'direct,error,direct'), 'error recovery may resume the normal lane');
    assert.equal(ownedBy(a, firstRows, 'shadowed').length, 0, 'terminal route stops later matching routes');
    assert.equal(ownedBy(a, firstRows, 'postOnly').length, 0, 'method constraints remain distinct');
    assert.equal(ownedBy(a, associations(a, registration('shadowed')), 'before').length, 0, 'shadowed entry retains ownership without invented reachability');

    const b = capture(`
const child = new Router();
const scoped = async (ctx, next) => { const value = await ctx.config.get('SCOPED'); return next(); };
const leaf = async ctx => ctx.text('leaf');
child.use('/users/:id', scoped); child.get('/users/:id', leaf); child.get('/plain', leaf);
app.mount('/api', child, { state: 'selection', equals: 'PRIVATE_ELIGIBILITY_CANARY' });
app.mount('/v2', child);
app.get('/api/*', leaf);
`);
    assert.ok(b.registrations.find(r => r.kind === 'mount').control.value.eligibility);
    assert.ok(!JSON.stringify(b).includes('PRIVATE_ELIGIBILITY_CANARY'), 'only eligibility presence is retained');
    const broad = b.registrations.find(r => r.kind === 'route' && r.match.value.path === '/api/*');
    assert.ok(associations(b, broad).some(r => r.coverage.status === 'partial' && r.coverage.reason === 'unsupported-mapping'));
    const plain = b.registrations.find(r => r.kind === 'route' && r.match.value.path === '/api/plain');
    assert.equal(ownedBy(b, associations(b, plain), 'scoped').length, 0);

    const missing = structuredClone(a);
    missing.registrations[0].control = { state: 'unavailable', value: null, reason: 'not-recorded' };
    const partial = deriveHandlerAssociations(missing);
    assert.equal(partial.coverage.status, 'partial');
    assert.ok(partial.rows.some(r => r.conditional === null && r.coverage.reason === 'not-recorded'));
    const old = structuredClone(a); old.registrations.forEach(r => delete r.control);
    assert.equal(deriveHandlerAssociations(old).coverage.status, 'unavailable');
    const reordered = structuredClone(a); reordered.useSites.reverse(); reordered.helperCalls.reverse();
    assert.deepEqual(deriveHandlerAssociations(reordered).rows, a.associations);

    const large = structuredClone(a), site = large.useSites.find(s => s.ownerId === large.registrations[0].handlerId);
    large.useSites = Array.from({ length: LIMITS.associations + 1 }, (_, i) => ({ ...site, id: `use-budget-${i}` }));
    large.coverage.useSites = { status: 'complete', observed: large.useSites.length, expected: large.useSites.length, reason: null };
    const bounded = deriveHandlerAssociations(large);
    assert.equal(bounded.coverage.status, 'partial');
    assert.equal(bounded.coverage.reason, 'graph-budget-exhausted');
    assert.equal(bounded.rows.length, LIMITS.associations);
    console.log(JSON.stringify({ status: 'passed', scopeAndMethods: true, explicitErrorRecovery: true,
      terminalShadowing: true, partialPatterns: true, missingControl: true, deterministicBudget: true }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { assertFixture };
if (require.main === module) main();
