'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'wasm/packages/cli/src');
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
const { setup } = require(path.join(root, 'docs/internal/an9-00/fixture.cjs'));
const f = require('./report-fixtures.cjs');
function withoutTopology() {
  // Disable the producer itself through the existing observational seam.
  const file = path.join(compiler, 'report-reference-provenance.js'), owner = new Module(file, module);
  owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
  const original = owner.require.bind(owner);
  owner.require = name => name === './report-handler-topology' ? { collectHandlerTopology: () => undefined } : original(name);
  owner._compile(fs.readFileSync(file, 'utf8'), file);
  const executionFile = path.join(cli, 'project-execution.js'), control = new Module(executionFile, module);
  control.filename = executionFile; control.paths = Module._nodeModulePaths(path.dirname(executionFile));
  const requireControl = control.require.bind(control);
  control.require = name => {
    const value = requireControl(name);
    return name === '@pulse-compute/wasm-compiler/canonical-native-plan' ? { ...value, ...owner.exports } : value;
  };
  control._compile(fs.readFileSync(executionFile, 'utf8'), executionFile);
  return control.exports;
}
function report(project, prepared, optimization = 'default') {
  const artifact = { id: capsule.artifactId(prepared.native.manifest.wasm.sha256), ...prepared.native.manifest.wasm,
    stage: 'final', target: 'portable-native-wasm' };
  return collectInventory(project, prepared, [artifact], artifact.id, optimization);
}
function assertTopology(value, { event = false, error = false } = {}) {
  const a = value.analytics, registrations = a.registrations;
  assert.equal(a.version, 'pulse.report-analytics.v1');
  assert.equal(a.coverage.handlers.status, 'complete');
  assert.equal(a.coverage.registrations.expected, value.entries.length);
  for (const key of ['useSites', 'helperCalls', 'associations']) {
    assert.deepEqual(a[key], []);
    assert.deepEqual(a.coverage[key], { status: 'unavailable', observed: 0, expected: null, reason: 'not-recorded' });
  }
  const reused = a.handlers.find(h => h.name === 'reused');
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
  reject(v => v.analytics.useSites.push({}));
  reject(v => v.analytics.coverage.useSites = { status: 'complete', observed: 0, expected: 0, reason: null });
  const hostile = structuredClone(value);
  hostile.analytics.handlers[0].credentials = 'PRIVATE_ANALYTICS_CANARY';
  hostile.analytics.handlers[0].source.value.expression = 'PRIVATE_SOURCE_CANARY';
  assert.throws(() => capsule.validateCapsule(hostile));
  assert.equal(capsule.serializeCapsule(capsule.createCapsule(hostile)), capsule.serializeCapsule(value), 'projection strips non-allowlisted metadata');
  const unknown = structuredClone(value);
  unknown.analytics.handlers[0].source = { state: 'unavailable', value: null, reason: 'not-recorded' };
  assert.equal(capsule.createCapsule(unknown).analytics.handlers[0].source.state, 'unavailable');
  const reordered = structuredClone(value); reordered.analytics.handlers.reverse();
  assert.equal(capsule.serializeCapsule(capsule.createCapsule(reordered)), capsule.serializeCapsule(value));
  const tampered = structuredClone(value); tampered.analytics.handlers[0].name = 'changed';
  assert.throws(() => capsule.validateCapsule(tampered), e => e.code === 'REPORT_HASH');
  return cases + 3;
}
async function execute(native, event) {
  const providerAdapter = createNodeProviderAdapter({ config: { ROOT: 'root', SCOPED: 'scoped', REGION: 'r', OTHER: 'o', RECOVERY: 'recovery', EVENT: 'event' }, secrets: { HELPER_TOKEN: 'token' } });
  let executions = 0;
  const cases = [['/direct-a', 'rro', 200], ['/api/scoped', 'scoped', 200], ['/v2/plain', 'plain', 200],
    ['/helper-a', 'tokena', 200], ['/missing', 'Not Found', 404], ['/helper-a', 'stopped', 403, [['x-stop','yes']]]];
  if (!event) cases.push(['/error','AN9:recovery',418]);
  for (const [url, body, status, headers = []] of cases) {
    const result = await nativeHost.executeCanonicalNativeModule(native, { request: { path: url, headers }, providerAdapter });
    assert.equal(result.response.status, status); assert.equal(result.response.body, body); executions++;
  }
  if (event) {
    const result = await nativeHost.executeCanonicalNativeEvent(native, { version: events.EVENT_FRAME_VERSION, type: 'analytics.tick', schemaId: null }, { providerAdapter });
    assert.equal(result.status, events.EVENT_EXECUTION_STATUS.COMPLETED); executions++;
  }
  return executions;
}
async function main() {
  fs.mkdirSync(path.join(root, 'wasm/.test-results'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/an9-01-'));
  const cells = [];
  try {
    // Planning/observation covers imported declarations plus both entry lanes;
    // the AN9-00 combined error/event codegen limitation remains separate.
    setup(directory);
    let project = resolveProject({ cwd: directory, metadataOnly: true });
    const compiled = execution.compileProject(project), plan = buildCanonicalNativePlan(compiled);
    const projection = collectCanonicalReportReferences(compiled, plan);
    assert.equal(collectHandlerTopology({ ...compiled, router: { ...compiled.router } }), undefined,
      'deserialized/foreign compiler objects cannot acquire source evidence');
    const projected = projectHandlerTopology(projection.topology);
    assert.equal(projected.handlers.length, 13); assert.equal(projected.registrations.length, 18);
    const imported = projected.handlers.find(h => h.name === 'packageHandler');
    assert.equal(imported.package.value.name, '@fixture/analytics');
    assert.equal(imported.package.value.sourceIdentity, imported.source.value.file);
    assert.equal(imported.source.value.start.line, 6);
    assert.equal(imported.source.value.sha256, sha256(fs.readFileSync(path.join(directory, 'node_modules/@fixture/analytics/index.ts'))));
    const importedUse = projected.registrations.find(r => r.handlerId === imported.id);
    assert.equal(importedUse.source.value.file, 'src/index.ts', 'registration and definition have separate source owners');
    assert.equal(importedUse.source.value.start.line, 42);
    assert.equal(projected.registrations.filter(r => r.kind !== 'event').at(-1).flow.next, null);
    for (const file of ['minimal.json', 'shared-routes.json']) {
      const saved = fs.readFileSync(path.join(__dirname, '../fixtures/report', file), 'utf8');
      assert.equal(capsule.serializeCapsule(capsule.parseCapsule(saved)), saved, 'legacy bytes/hash unchanged');
      assert.equal(capsule.parseCapsule(saved).analytics, undefined);
    }
    const missing = capsule.createCapsule({ ...f.fixture(false), analytics: projectHandlerTopology() });
    assert.equal(missing.analytics.coverage.handlers.status, 'unavailable');
    const controlOwner = withoutTopology();
    let negative = 0;
    for (const variant of ['http', 'event']) {
      setup(directory, variant, true);
      let defaultAnalytics;
      for (const optimization of ['default', 'experimental-native-bounded-size']) {
        project = resolveProject({ cwd: directory, metadataOnly: true });
        const options = { emitWat: false, nativeOptimization: optimization === 'default' ? undefined : optimization };
        const control = controlOwner.compileNativeProjectInMemory(project, options);
        const prepared = execution.compileNativeProjectInMemory(project, options);
        assert.equal(control.reportReferences.topology, undefined);
        assert.deepEqual(prepared.plan, control.plan);
        assert.equal(prepared.native.source, control.native.source);
        assert.deepEqual(prepared.native.wasm, control.native.wasm);
        assert.deepEqual(prepared.native.manifest.optimization, control.native.manifest.optimization);
        const value = report(project, prepared, optimization);
        assertTopology(value, { event: variant === 'event', error: variant === 'http' });
        assert.equal(report(project, control, optimization).analytics.coverage.handlers.status, 'unavailable');
        if (optimization === 'default') defaultAnalytics = value.analytics;
        else assert.deepEqual(value.analytics, defaultAnalytics, 'semantic definitions/registrations do not depend on Native recipe');
        if (!negative) negative = negativeCases(value);
        const executions = await execute(prepared.native, variant === 'event') + await execute(control.native, variant === 'event');
        const built = execution.compileNativeProject(project, options);
        const replay = retained.collectArtifactReport(built.files.manifest).capsule;
        assert.deepEqual(replay.analytics, value.analytics);
        const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|typescript|project-config|project-execution|child_process|^(node:)?(http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(cli, 'internal/report/retained'))}).collectArtifactReport(process.argv[1]).capsule.analytics));`;
        assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script, built.files.manifest], { encoding: 'utf8' })), value.analytics);
        cells.push({ variant, optimization, executions, unchangedWasm: true, passiveReplay: true });
      }
    }
    // Nested mounts use ordered instance paths, not sorted sets of definitions.
    setup(directory, 'http', true);
    const source = path.join(directory, 'src/index.ts');
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace("app.use(rootMiddleware);", "const grand = new Router();\ngrand.get('/leaf', async ctx => ctx.text('leaf'));\nchild.mount('/nested', grand);\napp.use(rootMiddleware);"));
    project = resolveProject({ cwd: directory, metadataOnly: true });
    const nested = execution.compileNativeProjectInMemory(project, { emitWat: false });
    const nestedReport = report(project, nested);
    const leaves = nestedReport.analytics.registrations.filter(r => r.match.value.path?.endsWith('/leaf'));
    assert.equal(leaves.length, 2); assert.ok(leaves.every(r => r.mountPath.length === 2));
    assert.notDeepEqual(leaves[0].mountPath, leaves[1].mountPath);
    assert.equal(leaves[0].handlerId, leaves[1].handlerId);
    fs.writeFileSync(source, "export default async ctx => ctx.text('standalone');\n");
    project = resolveProject({ cwd: directory, metadataOnly: true });
    const standalone = report(project, execution.compileNativeProjectInMemory(project, { emitWat: false }));
    assert.equal(standalone.analytics.coverage.handlers.status, 'unavailable', 'no router producer is not a known-empty handler universe');
    console.log(JSON.stringify({ status: 'passed', cells, negativeCases: negative, importedSpans: true,
      nestedMounts: true, oldCapsulesUnchanged: true, reservedTablesUnavailable: true }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
