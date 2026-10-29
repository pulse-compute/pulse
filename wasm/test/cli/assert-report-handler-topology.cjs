'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'wasm/packages/cli/src');
const failureEvidence = require('../support/report-identity-failure.cjs')(__filename, cli);
const compiler = path.join(root, 'wasm/packages/compiler/src');
const execution = require(path.join(cli, 'project-execution'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const { buildCanonicalNativePlan, collectCanonicalReportReferences } = require(path.join(compiler, 'canonical-native-plan'));
const { collectHandlerTopology } = require(path.join(compiler, 'report-handler-topology'));
const { projectHandlerTopology } = require(path.join(cli, 'internal/report/handler-topology'));
const { collectInventory } = require(path.join(cli, 'internal/report/inventory'));
const capsule = require(path.join(cli, 'internal/report/capsule'));
const { sha256 } = require(path.join(cli, 'internal/report/data'));
const retained = require(path.join(cli, 'internal/report/retained'));
const nativeHost = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host'));
const events = require(path.join(root, 'wasm/packages/contracts/src/events/contracts'));
const { createNodeProviderAdapter } = require(path.join(root, 'packages/provider-node/src/runtime/canonical-api-runtime'));
const { setup } = require(path.join(root, 'wasm/test/support/report-analytics-fixture.cjs'));
const f = require('./report-fixtures.cjs');
const assertIntegration = require('./report-analytics-integration.cjs');
function withoutProjection() {
  // Disable the complete report-reference observation at the existing seam.
  const file = path.join(cli, 'project-execution.js'), control = new Module(file, module);
  control.filename = file; control.paths = Module._nodeModulePaths(path.dirname(file));
  const original = control.require.bind(control);
  control.require = name => {
    const value = original(name);
    return name === '@pulse-compute/wasm-compiler/canonical-native-plan'
      ? { ...value, collectCanonicalReportReferences: () => undefined } : value;
  };
  control._compile(fs.readFileSync(file, 'utf8'), file);
  return control.exports;
}
function report(project, prepared, optimization = 'native-shrink0') {
  const artifact = { id: capsule.artifactId(prepared.native.manifest.wasm.sha256), ...prepared.native.manifest.wasm,
    stage: 'final', target: 'portable-native-wasm' };
  return collectInventory(project, prepared, [artifact], artifact.id, optimization);
}
function assertTopology(value, { event = false, error = false } = {}) {
  const a = value.analytics, registrations = a.registrations;
  assert.equal(a.version, 'pulse.report-analytics.v2');
  assert.equal(Object.hasOwn(a, 'associations'), false);
  assert.equal(a.coverage.handlers.status, 'complete');
  assert.equal(a.coverage.registrations.expected, value.entries.length);
  require('./assert-report-handler-associations.cjs').assertFixture(require('../support/report-legacy-analytics.cjs')(a), { event, error });
  assert.equal(a.coverage.useSites.status, 'complete');
  assert.equal(a.coverage.helperCalls.status, 'complete');
  const helper = a.handlers.find(h => h.kind === 'helper');
  const helperSites = a.useSites.filter(u => u.ownerId === helper.id);
  const secret = helperSites.find(u => u.capability.value === 'secret.get');
  assert.equal(secret.binding.state, 'resolved');
  assert.equal(value.bindings.find(b => b.id === secret.binding.bindingId).name, 'HELPER_TOKEN');
  const calls = a.helperCalls.filter(c => c.calleeId === helper.id);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.flatMap(c => c.registrationIds).map(id => registrations.find(r => r.id === id).match.value.path).sort(), ['/helper-a', '/helper-b']);
  assert.ok(calls.every(c => c.source.value.file === 'src/index.ts' && c.callerId !== c.calleeId));
  const sync = a.useSites.filter(u => u.surfaceId === 'ctx.req.header');
  assert.ok(sync.length >= 2);
  assert.ok(sync.every(u => u.capability.value === 'req.header' && u.binding.state === 'not-applicable'));
  const dynamic = a.useSites.find(u => u.binding.state === 'dynamic');
  assert.equal(dynamic.binding.bindingId, null); assert.equal(dynamic.binding.referenceId, null);
  assert.equal(dynamic.binding.reason, 'dynamic-reference');
  const reused = a.handlers.find(h => h.name === 'reused');
  const reads = a.useSites.filter(u => u.ownerId === reused.id && u.surfaceId === 'ctx.config.get');
  assert.equal(reads.length, 3);
  assert.equal(new Set(reads.map(u => u.id)).size, 3);
  assert.equal(new Set(reads.map(u => u.binding.bindingId)).size, 2);
  assert.equal(new Set(reads.map(u => u.source.value.start.offset)).size, 3);
  const uses = registrations.filter(r => r.handlerId === reused.id);
  assert.equal(uses.length, 2); assert.notEqual(uses[0].id, uses[1].id);
  assert.deepEqual(uses.map(r => r.match.value.path), ['/direct-a', '/direct-b']);
  assert.ok(uses.every(r => r.source.value.start.offset !== reused.source.value.start.offset));
  const mounts = registrations.filter(r => r.kind === 'mount');
  assert.equal(mounts.length, 2); assert.notEqual(mounts[0].id, mounts[1].id);
  assert.ok(mounts.every(m => m.handlerId === null && m.authored && m.source.state === 'available'));
  const scoped = a.handlers.find(h => h.name === 'scopedMiddleware');
  const scopedUses = registrations.filter(r => r.handlerId === scoped.id);
  assert.deepEqual(scopedUses.map(r => r.mountPath), mounts.map(m => [m.id]));
  assert.deepEqual(scopedUses[0].routerPath, scopedUses[1].routerPath, 'definition path alone cannot identify mount instance');
  assert.deepEqual(scopedUses[0].source, scopedUses[1].source, 'same authored registration, distinct instantiated entries');
  assert.equal(a.handlers.filter(h => h.kind === 'helper').length, 1);
  assert.equal(registrations.some(r => r.handlerId === a.handlers.find(h => h.kind === 'helper').id), false);
  assert.ok(a.handlers.every(h => !['stage', 'dispatcher'].includes(h.kind)));
  const eventRow = registrations.find(r => r.kind === 'event');
  assert.equal(Boolean(eventRow), event);
  assert.equal(registrations.some(r => r.kind === 'error'), error);
  if (eventRow) {
    assert.equal(eventRow.match.value.eventType, 'analytics.tick');
    assert.deepEqual(eventRow.mountPath, []);
    assert.deepEqual(eventRow.flow, { next: null, child: null, parentContinue: null });
    assert.equal(registrations.filter(r => r.kind !== 'event').at(-1).flow.next, null, 'HTTP end is not the following event entry');
  }
  assert.equal(registrations.some(r => r.kind === 'fallback'), false, 'implicit 404 is not an invented authored handler');
  assert.ok(Object.isFrozen(a.handlers[0].source));
}
function negativeCases(value) {
  value = capsule.createCapsule({...value, analytics:require('../support/report-legacy-analytics.cjs')(value.analytics)});
  let cases = 0;
  const reject = edit => { const copy = structuredClone(value); edit(copy); assert.throws(() => capsule.createCapsule(copy)); cases++; };
  reject(v => v.analytics.handlers.push(v.analytics.handlers[0]));
  reject(v => v.analytics.registrations.push(v.analytics.registrations[0]));
  reject(v => v.analytics.handlers[0].id = 'wrong');
  reject(v => v.analytics.handlers[0].canonicalId = 'wrong');
  reject(v => v.analytics.registrations[0].handlerId = 'missing');
  reject(v => v.analytics.registrations[0].handlerId = v.analytics.handlers.find(h => h.kind === 'helper').id);
  reject(v => v.analytics.registrations[0].flow.next = 'missing');
  reject(v => v.analytics.registrations[0].flow.next = v.analytics.registrations[0].id);
  reject(v => v.analytics.registrations.reverse());
  reject(v => v.analytics.registrations.find(r => r.kind === 'mount').handlerId = v.analytics.handlers[0].id);
  reject(v => v.analytics.registrations[0].authored = false);
  reject(v => v.analytics.registrations.find(r => r.mountPath.length).mountPath = []);
  reject(v => {
    const mounts = v.analytics.registrations.filter(r => r.kind === 'mount');
    v.analytics.registrations.find(r => r.mountPath[0] === mounts[0].id).mountPath = [mounts[1].id];
  });
  reject(v => v.analytics.handlers[0].source.value.file = '../outside');
  reject(v => v.analytics.handlers[0].source.value.end.offset = 0);
  reject(v => v.analytics.handlers[0].source.value.end.line = 0);
  reject(v => v.analytics.registrations[0].source.value.sha256 = '0'.repeat(64));
  reject(v => v.analytics.handlers[0].source.state = 'unavailable');
  reject(v => v.analytics.handlers[0].evidence[0].producer = 'arbitrary-provider');
  reject(v => v.analytics.registrations[0].match.value.path = '/forged');
  reject(v => v.analytics.coverage.handlers.expected++);
  reject(v => v.analytics.coverage.registrations.observed--);
  reject(v => { v.analytics.registrations.pop(); v.analytics.coverage.registrations.observed--; v.analytics.coverage.registrations.expected--; });
  reject(v => v.analytics.associations.push(v.analytics.associations[0]));
  reject(v => v.analytics.associations[0].useSiteId = 'missing');
  reject(v => v.analytics.associations[0].consumerRegistrationId = 'missing');
  reject(v => v.analytics.associations[0].via[0].id = 'missing');
  reject(v => v.analytics.associations[0].evidence[0].producer = 'canonical-router-handler-validation');
  reject(v => v.analytics.associations[0].coverage.status = 'unavailable');
  reject(v => { v.analytics.associations.pop(); v.analytics.coverage.associations.observed--; });
  reject(v => v.analytics.registrations.find(r => r.kind === 'mount').control.value.pattern = '/forged/*');
  reject(v => { const r = v.analytics.associations.find(r => r.conditional === true); r.conditional = false; });
  reject(v => { const r = v.analytics.associations.find(r => r.lane === 'error'); r.lane = 'normal';
    r.id = require('../../packages/cli/src/internal/report/handler-associations').associationId(r); });
  reject(v => {
    const a = v.analytics, scoped = a.handlers.find(h => h.name === 'scopedMiddleware');
    const site = a.useSites.find(s => s.ownerId === scoped.id);
    const row = a.associations.find(r => r.useSiteId === site.id && r.conditional === true);
    const forged = { ...row, consumerRegistrationId: a.registrations.find(r => r.kind === 'route' && r.match.value.path === '/api/plain').id };
    forged.id = require('../../packages/cli/src/internal/report/handler-associations').associationId(forged);
    a.associations.push(forged); a.coverage.associations.observed++;
  });
  reject(v => v.analytics.useSites.push({}));
  reject(v => v.analytics.useSites.push(v.analytics.useSites[0]));
  reject(v => v.analytics.helperCalls.push(v.analytics.helperCalls[0]));
  reject(v => v.analytics.useSites[0].ownerId = 'missing');
  reject(v => v.analytics.useSites[0].surfaceId = 'forged');
  reject(v => v.analytics.useSites[0].source.value.start.offset++);
  reject(v => v.analytics.useSites[0].evidence[0].producer = 'canonical-router-handler-validation');
  reject(v => v.analytics.useSites.find(u => u.binding.state === 'resolved').binding.bindingId = 'missing');
  reject(v => v.analytics.useSites.find(u => u.binding.state === 'resolved').binding.kind = 'forged');
  reject(v => v.analytics.useSites.find(u => u.binding.state === 'dynamic').binding.bindingId = v.bindings[0].id);
  reject(v => v.analytics.useSites.find(u => u.binding.state === 'not-applicable').binding.reason = 'unresolved-reference');
  reject(v => v.analytics.helperCalls[0].calleeId = v.analytics.helperCalls[0].callerId);
  reject(v => v.analytics.helperCalls[0].canonicalId = 'invented');
  reject(v => v.analytics.helperCalls[0].registrationIds = [v.analytics.registrations[0].id]);
  reject(v => v.analytics.helperCalls[0].registrationIds = []);
  reject(v => v.analytics.helperCalls[0].evidence[0].basis = 'authored-recognition');
  reject(v => v.analytics.coverage.useSites = { status: 'complete', observed: 0, expected: 0, reason: null });
  const hostile = structuredClone(value);
  hostile.analytics.handlers[0].credentials = 'PRIVATE_ANALYTICS_CANARY';
  hostile.analytics.handlers[0].source.value.expression = 'PRIVATE_SOURCE_CANARY';
  hostile.analytics.useSites[0].expression = 'PRIVATE_EXPRESSION_CANARY';
  hostile.analytics.useSites[0].binding.value = 'PRIVATE_BINDING_CANARY';
  hostile.analytics.helperCalls[0].arguments = ['PRIVATE_ARGUMENT_CANARY'];
  hostile.analytics.associations[0].condition = 'PRIVATE_PREDICATE_CANARY';
  assert.throws(() => capsule.validateCapsule(hostile));
  assert.equal(capsule.serializeCapsule(capsule.createCapsule(hostile)), capsule.serializeCapsule(value), 'projection strips non-allowlisted metadata');
  const unknown = structuredClone(value);
  unknown.analytics.handlers[0].source = { state: 'unavailable', value: null, reason: 'not-recorded' };
  assert.equal(capsule.createCapsule(unknown).analytics.handlers[0].source.state, 'unavailable');
  const reordered = structuredClone(value); reordered.analytics.handlers.reverse(); reordered.analytics.useSites.reverse(); reordered.analytics.helperCalls.reverse(); reordered.analytics.associations.reverse();
  assert.equal(capsule.serializeCapsule(capsule.createCapsule(reordered)), capsule.serializeCapsule(value));
  const tampered = structuredClone(value); tampered.analytics.handlers[0].name = 'changed';
  assert.throws(() => capsule.validateCapsule(tampered), e => e.code === 'REPORT_HASH');
  return cases + 3;
}
async function execute(native, variant) {
  const calls = [];
  const adapter = createNodeProviderAdapter({ config: { ROOT: 'root', SCOPED: 'scoped', REGION: 'r', OTHER: 'o',
    PACKAGE: 'package', RECOVERY: 'recovery', EVENT: 'event' }, secrets: { HELPER_TOKEN: 'token' } });
  const dispatch = adapter.dispatchEffect.bind(adapter);
  const providerAdapter = { ...adapter, dispatchEffect: async (...args) => { calls.push(args[0]); return dispatch(...args); } };
  let count = 0;
  const cases = [
    ['/api/scoped', 'scoped', ['ROOT', 'SCOPED']], ['/api/plain', 'plain', ['ROOT']],
    ['/v2/scoped', 'scoped', ['ROOT', 'SCOPED']], ['/v2/plain', 'plain', ['ROOT']],
    ['/direct-a', 'rro', ['ROOT', 'REGION', 'REGION', 'OTHER']], ['/direct-b', 'rro', ['ROOT', 'REGION', 'REGION', 'OTHER']],
    ['/helper-a', 'tokena', ['ROOT', 'HELPER_TOKEN']], ['/helper-b', 'tokenb', ['ROOT', 'HELPER_TOKEN']],
    ['/package', 'package', ['ROOT', 'PACKAGE']], ['/dynamic', 'r', ['ROOT', 'REGION']],
    ['/dynamic', 'o', ['ROOT', 'OTHER'], 200, [['x-config', 'OTHER']]],
    ['/helper-a', 'stopped', ['ROOT'], 403, [['x-stop', 'yes']]],
    ['/missing', 'Not Found', ['ROOT'], 404]
  ];
  if (variant !== 'event') cases.push(['/error', 'AN9:recovery', ['ROOT', 'RECOVERY'], 418]);
  for (const [url, body, effects, status = 200, headers = []] of cases) {
    calls.length = 0;
    const result = await nativeHost.executeCanonicalNativeModule(native, { request: { path: url, headers }, providerAdapter });
    assert.equal(result.response.status, status, url); assert.equal(result.response.body, body, url);
    assert.deepEqual(calls.map(e => e.name), effects, url); count++;
  }
  if (variant !== 'http') {
    calls.length = 0;
    const result = await nativeHost.executeCanonicalNativeEvent(native, {
      version: events.EVENT_FRAME_VERSION, type: 'analytics.tick', schemaId: null
    }, { providerAdapter });
    assert.equal(result.status, events.EVENT_EXECUTION_STATUS.COMPLETED);
    assert.deepEqual(calls.map(e => e.name), ['EVENT'], 'event does not inherit HTTP middleware'); count++;
  }
  if (variant === 'full') {
    const failingAdapter = { ...providerAdapter, dispatchEffect: async (...args) => {
      if (args[0].name === 'EVENT') {
        calls.push(args[0]);
        throw Object.assign(new Error('fixture effect failed'), { code: 'AN9_EFFECT' });
      }
      return providerAdapter.dispatchEffect(...args);
    } };
    calls.length = 0;
    const failed = await nativeHost.executeCanonicalNativeEvent(native, {
      version: events.EVENT_FRAME_VERSION, type: 'analytics.tick', schemaId: null
    }, { providerAdapter: failingAdapter });
    assert.equal(failed.status, events.EVENT_EXECUTION_STATUS.FAILED);
    assert.equal(failed.error.category, 'handler-failed');
    assert.equal(failed.error.code, 'AN9_EFFECT');
    assert.deepEqual(calls.map(e => e.name), ['EVENT'], 'event failure cannot enter HTTP middleware or error handlers'); count++;
  }
  return count;
}
async function main() {
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(root, 'wasm/.test-results/report-analytics-'));
  const directory = path.join(fixtureRoot, 'planning');
  fs.mkdirSync(directory);
  const cells = [];
  try {
    require('./report-handler-name-cases.cjs')(directory);
    // Planning, generation and execution cover imported declarations and both lanes.
    setup(directory);
    let project = resolveProject({ cwd: directory, metadataOnly: true });
    const compiled = execution.compileProject(project), plan = buildCanonicalNativePlan(compiled);
    const projection = collectCanonicalReportReferences(compiled, plan);
    assert.equal(collectHandlerTopology({ ...compiled, router: { ...compiled.router } }), undefined,
      'deserialized/foreign compiler objects cannot acquire source evidence');
    const projected = projectHandlerTopology(projection.topology);
    assert.ok(projected.handlers.every(h => h.name), 'fixture local, imported, helper and inline names are retained');
    assert.equal(projected.handlers.length, 13); assert.equal(projected.registrations.length, 18);
    const imported = projected.handlers.find(h => h.name === 'packageHandler');
    assert.equal(imported.package.value.name, '@fixture/analytics');
    assert.equal(imported.package.value.sourceIdentity, imported.source.value.file);
    assert.equal(imported.source.value.start.line, 6);
    assert.equal(imported.source.value.sha256, sha256(fs.readFileSync(path.join(directory, 'node_modules/@fixture/analytics/index.ts'))));
    const importedUse = projected.registrations.find(r => r.handlerId === imported.id);
    assert.equal(importedUse.source.value.file, 'src/index.ts', 'registration and definition have separate source owners');
    assert.equal(importedUse.source.value.start.line, 42);
    const authored = fs.readFileSync(path.join(directory, 'src/index.ts'), 'utf8');
    const repeated = projected.useSites.filter(u => u.ownerId === projected.handlers.find(h => h.name === 'reused').id && u.surfaceId === 'ctx.config.get');
    assert.deepEqual(repeated.map(u => authored.slice(u.source.value.start.offset, u.source.value.end.offset)),
      ["ctx.config.get('REGION')", "ctx.config.get('REGION')", "ctx.config.get('OTHER')"]);
    assert.ok(repeated.every(u => u.binding.state === 'unknown' && u.binding.bindingId === null), 'missing reference evidence cannot resolve a binding');
    assert.equal(projected.registrations.filter(r => r.kind !== 'event').at(-1).flow.next, null);
    for (const file of ['minimal.json', 'shared-routes.json']) {
      const saved = fs.readFileSync(path.join(__dirname, '../fixtures/report', file), 'utf8');
      assert.equal(capsule.serializeCapsule(capsule.parseCapsule(saved)), saved, 'legacy bytes/hash unchanged');
      assert.equal(capsule.parseCapsule(saved).analytics, undefined);
    }
    assert.equal(projected.useSites.find(u => u.ownerId === imported.id && u.surfaceId === 'ctx.config.get').source.value.file, imported.source.value.file);
    const missing = capsule.createCapsule({ ...f.fixture(false), analytics: projectHandlerTopology() });
    assert.equal(missing.analytics.coverage.handlers.status, 'unavailable');
    const controlOwner = withoutProjection();
    let negative = 0;
    for (const variant of ['http', 'event', 'full']) {
      let defaultReport;
      for (const optimization of ['native-shrink0', 'experimental-native-bounded-size']) {
        failureEvidence.phase(`${variant}/${optimization}/parity`);
        // Each recipe owns its source/output paths; prior cells are never rewritten.
        const directory = path.join(fixtureRoot, variant, optimization);
        setup(directory, variant);
        project = resolveProject({ cwd: directory, metadataOnly: true });
        const options = { emitWat: false, nativeOptimization: optimization };
        console.log(`[analytics parity] ${variant}/${optimization}: control and observed compilation`);
        const control = controlOwner.compileNativeProjectInMemory(project, options);
        const prepared = execution.compileNativeProjectInMemory(project, options);
        assert.equal(control.reportReferences, undefined);
        assert.deepEqual(prepared.plan, control.plan);
        assert.equal(prepared.native.source, control.native.source);
        assert.deepEqual(prepared.native.wasm, control.native.wasm);
        assert.deepEqual(prepared.native.manifest.optimization, control.native.manifest.optimization);
        const value = report(project, prepared, optimization);
        assertTopology(value, { event: variant !== 'http', error: variant !== 'event' });
        if (variant === 'full' && optimization === 'native-shrink0') {
          const unprotected = structuredClone(prepared.plan);
          const errorIndex = unprotected.routing.entries.find(entry => entry.kind === 'error').index;
          const cursor = unprotected.locals.find(local => local.name === '__pulse_router_cursor').id;
          const guard = unprotected.entry.body.find(statement => statement.kind === 'if'
            && statement.test.left?.id === cursor && statement.test.right?.value === errorIndex);
          assert.ok(guard, 'fixture has a compiler-owned HTTP error entry boundary');
          guard.test.operator = '!==';
          assert.throws(() => require('../../packages/runtime-core-as/src/compiler/canonical-native')
            .generateCanonicalNativeAssemblyScript(unprotected), error =>
            error.code === 'PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED'
            && /explicit compiler-owned entry boundaries/.test(error.message),
          'event coexistence must not waive missing HTTP error boundaries');
        }
        assert.equal(report(project, control, optimization).analytics, undefined, 'disabled observation cannot invent analytics');
        assertIntegration(value, defaultReport || value);
        if (optimization === 'native-shrink0') defaultReport = value;
        else {
          assert.deepEqual(value.analytics, defaultReport.analytics, 'authored analytics do not depend on Native recipe');
          assert.notEqual(value.artifacts[0].sha256, defaultReport.artifacts[0].sha256, 'recipe changes physical bytes');
        }
        if (!negative) {
          negative = negativeCases(value);
          const old = structuredClone(value);
          old.analytics = require('../support/report-legacy-analytics.cjs')(old.analytics);
          for (const row of old.analytics.registrations) delete row.control;
          old.analytics.associations = []; old.analytics.coverage.associations = { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' };
          const an902 = capsule.serializeCapsule(capsule.createCapsule(old));
          assert.equal(capsule.serializeCapsule(capsule.parseCapsule(an902)), an902, 'AN9-02 unavailable associations remain valid');
          for (const key of ['useSites', 'helperCalls']) { old.analytics[key] = []; old.analytics.coverage[key] = { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' }; }
          const saved = capsule.serializeCapsule(capsule.createCapsule(old));
          assert.equal(capsule.serializeCapsule(capsule.parseCapsule(saved)), saved, 'AN9-01 unavailable tables remain valid');
        }
        const executions = await execute(prepared.native, variant) + await execute(control.native, variant);
        failureEvidence.phase(`${variant}/${optimization}/publication`);
        const built = execution.compileNativeProject(project, options);
        assert.ok(built.manifest.reportCompletion, JSON.stringify(built.manifest.reportEvidence));
        const replay = retained.collectArtifactReport(built.files.manifest).capsule;
        assert.deepEqual(replay.analytics, value.analytics);
        assertIntegration(replay, value);
        const rendered = assertIntegration(replay);
        // Historical display/comparison must work after project/package removal.
        for (const folder of ['src', 'node_modules', '.pulse']) fs.rmSync(path.join(directory, folder), { recursive: true, force: true });
        const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|typescript|project-config|project-execution|child_process|^(node:)?(http|https|net|tls|dns|dgram)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};const fs=require('node:fs');for(const key of ['writeFileSync','appendFileSync','mkdirSync','renameSync','rmSync','unlinkSync'])fs[key]=()=>{throw Error('Unexpected write: '+key);};const value=require(${JSON.stringify(path.join(cli, 'internal/report/retained'))}).collectArtifactReport(process.argv[1]).capsule;process.stdout.write(JSON.stringify({analytics:value.analytics,rendered:require(${JSON.stringify(path.join(__dirname, 'report-analytics-integration.cjs'))})(value)}));`;
        const passive = JSON.parse(execFileSync(process.execPath, ['-e', script, built.files.manifest], { encoding: 'utf8' }));
        assert.deepEqual(passive.analytics, value.analytics);
        assert.deepEqual(passive.rendered, rendered, 'offline HTML/comparison is repeatable without source or toolchain execution');
        cells.push({ variant, optimization, executions, unchangedPlanSourceWasm: true, effectOrder: true,
          importedPassiveReplay: true, reportHtml: true, semanticComparison: true, sourcesRemoved: true });
      }
    }
    failureEvidence.phase('nested-topology');
    // Nested mounts use ordered instance paths, not sorted sets of definitions.
    setup(directory, 'http', true);
    const source = path.join(directory, 'src/index.ts');
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace("app.use(rootMiddleware);", "const grand = new Router();\ngrand.get('/leaf', async ctx => { const value = await sharedLookup(ctx, 'leaf'); return ctx.text(value); });\nchild.mount('/nested', grand);\napp.use(rootMiddleware);"));
    project = resolveProject({ cwd: directory, metadataOnly: true });
    const nested = execution.compileNativeProjectInMemory(project, { emitWat: false });
    const nestedReport = report(project, nested);
    const leaves = nestedReport.analytics.registrations.filter(r => r.match.value.path?.endsWith('/leaf'));
    assert.equal(leaves.length, 2); assert.ok(leaves.every(r => r.mountPath.length === 2));
    assert.notDeepEqual(leaves[0].mountPath, leaves[1].mountPath);
    assert.equal(leaves[0].handlerId, leaves[1].handlerId);
    const leafCall = nestedReport.analytics.helperCalls.filter(c => c.callerId === leaves[0].handlerId);
    assert.equal(leafCall.length, 1, 'one authored call survives mount expansion');
    assert.deepEqual(leafCall[0].registrationIds, leaves.map(r => r.id).sort());
    for (const leaf of leaves) {
      const helperRows = [...require('../../packages/cli/src/internal/report/relationship-queries').create(nestedReport.analytics).route(leaf.id).rows].filter(r => r.via.at(-1).id === leafCall[0].id);
      assert.ok(helperRows.length > 0);
      assert.ok(helperRows.every(r => JSON.stringify(r.via) === JSON.stringify([
        ...leaf.mountPath.map(id => ({ kind: 'mount', id })), { kind: 'direct', id: leaf.id }, { kind: 'helper', id: leafCall[0].id }
      ])), 'nested helper explanation retains both mount instances in order');
    }
    const badCall = structuredClone(nestedReport); badCall.analytics.helperCalls.find(c => c.id === leafCall[0].id).registrationIds.pop();
    assert.throws(() => capsule.createCapsule(badCall), e => e.code === 'REPORT_COVERAGE');
    // Recognition recurses into awaited argument expressions and retains UTF-16
    // positions without introducing a site for await or the KV namespace.
    fs.writeFileSync(path.join(directory, 'src/pure.ts'), 'export function identity(value: string): string { return value; }');
    fs.writeFileSync(source, `import { Pulse } from '@pulse-compute/pulse';
import { identity } from './pure';
const app = new Pulse({ auto: true });
// Authored astral character: 🌊
app.get('/nested', async ctx => {
  const store = ctx.kv('CACHE');
  const value = await store.get(ctx.req.header('x-key') || 'key');
  const config = await ctx.config.get(ctx.req.header('x-name') || 'REGION');
  return ctx.text(value || config || identity('empty'));
});
export default app;
`);
    project = resolveProject({ cwd: directory, metadataOnly: true });
    const nestedCompiled = execution.compileProject(project);
    const nestedPlan = buildCanonicalNativePlan(nestedCompiled);
    const nestedTopology = collectCanonicalReportReferences(nestedCompiled, nestedPlan).topology;
    const nestedSites = nestedTopology.useSites;
    const pureHelper = nestedTopology.handlers.find(h => h.name === 'identity');
    assert.equal(nestedTopology.helperCalls.filter(c => c.calleeId === pureHelper.id).length, 1, 'pure helper calls also retain validation evidence');
    assert.equal(nestedSites.filter(u => u.surfaceId === 'ctx.req.header').length, 2);
    assert.equal(nestedSites.filter(u => u.surfaceId === 'ctx.kv.get').length, 1);
    assert.equal(nestedSites.find(u => u.surfaceId === 'ctx.kv.get').binding.canonicalId, 'CACHE');
    for (const site of nestedSites) {
      const text = fs.readFileSync(source, 'utf8');
      assert.ok(!text.slice(site.source.value.start.offset, site.source.value.end.offset).startsWith('await '));
      assert.equal(site.source.value.sha256, sha256(text));
    }
    fs.writeFileSync(source, "export default async ctx => ctx.text('standalone');\n");
    project = resolveProject({ cwd: directory, metadataOnly: true });
    const standalone = report(project, execution.compileNativeProjectInMemory(project, { emitWat: false }));
    assert.equal(standalone.analytics.coverage.handlers.status, 'unavailable', 'no router producer is not a known-empty handler universe');
    console.log(JSON.stringify({ status: 'passed', cells, negativeCases: negative, importedSpans: true,
      nestedMounts: true, oldCapsulesUnchanged: true, authoredUseSites: true, validatedHelperCalls: true, contextualAssociations: true, importedSourceReplay: true, handlerNames: true }));
  } finally { fs.rmSync(fixtureRoot, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); failureEvidence(error); process.exitCode = 1; });
