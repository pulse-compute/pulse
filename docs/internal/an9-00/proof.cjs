'use strict';
// AN9-00 is a bounded investigation. These assertions describe current gaps;
// they are intentionally an explicit task, not permanent product acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'wasm/packages/cli/src');
const compiler = path.join(root, 'wasm/packages/compiler/src');
const ts = require(path.join(root, 'node_modules/typescript'));
const execution = require(path.join(cli, 'project-execution'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const spine = require(path.join(compiler, 'spine/canonical-router'));
const authority = require(path.join(compiler, 'spine/handler-surface-authority'));
const { buildCanonicalNativePlan, collectCanonicalReportReferences } = require(path.join(compiler, 'canonical-native-plan'));
const { collectInventory } = require(path.join(cli, 'internal/report/inventory'));
const capsule = require(path.join(cli, 'internal/report/capsule'));
const retained = require(path.join(cli, 'internal/report/retained'));
const nativeHost = require(path.join(root, 'wasm/packages/host-runtime/src/runtime/canonical-native-host'));
const events = require(path.join(root, 'wasm/packages/contracts/src/events/contracts'));
const { createNodeProviderAdapter } = require(path.join(root, 'packages/provider-node/src/runtime/canonical-api-runtime'));
const { setup } = require('./fixture.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
function withoutProjection() {
  const file = path.join(cli, 'project-execution.js'), owner = new Module(file, module);
  owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
  const original = owner.require.bind(owner);
  owner.require = name => {
    const value = original(name);
    return name === '@pulse-compute/wasm-compiler/canonical-native-plan'
      ? { ...value, collectCanonicalReportReferences: () => undefined } : value;
  };
  owner._compile(fs.readFileSync(file, 'utf8'), file);
  return owner.exports;
}
function inventory(project, prepared, optimization) {
  const artifact = { id: capsule.artifactId(prepared.native.manifest.wasm.sha256), ...prepared.native.manifest.wasm,
    stage: 'final', target: 'portable-native-wasm' };
  return collectInventory(project, prepared, [artifact], artifact.id, optimization);
}
function authoredSpan(file, node) {
  const start = node.getStart(file), end = node.end;
  const point = offset => { const p = file.getLineAndCharacterOfPosition(offset);
    return { offset, line: p.line + 1, column: p.character + 1 }; };
  return { file: file.fileName, start: point(start), end: point(end) };
}
function trace(compiled) {
  const topology = spine.topologyForCanonicalRouterOutput(compiled.router);
  const facts = spine.surfaceFactsForCanonicalRouterOutput(compiled.router);
  const model = authority.sourceModelForRouterRecognition(facts.recognition);
  const ir = spine.handlerIrsForCanonicalRouterOutput(compiled.router);
  const plan = buildCanonicalNativePlan(compiled);
  const references = collectCanonicalReportReferences(compiled, plan);
  const handlers = topology.handlerTable.handlers.map(h => ({ id: h.id, kind: 'handler', name: h.localName,
    source: h.loc, sourceTextHash: h.sourceTextHash }));
  const registrations = topology.entries.map(({ entry, rawEntry }) => ({ ...entry, source: rawEntry.loc }));
  const sites = new Map();
  for (const descriptor of topology.entries) {
    if (!descriptor.functionNode) continue;
    const entry = descriptor.entry;
    const visit = node => {
      const surface = model.surfaceForNode(entry.stableId, node);
      if (surface && !['handler-wrapper', 'javascript-only', 'terminal-transfer'].includes(surface.class)) {
        const source = authoredSpan(descriptor.sourceFile, node);
        const fact = model.factsForEntry(entry.stableId).find(f => f.position.offset === source.start.offset && f.surfaceId === surface.surfaceId);
        assert.ok(fact, 'AST identity binds recognition to an original-source span');
        const provider = authority.extractProviderCall(ts.isAwaitExpression(node) ? node.expression : node, 'ctx', new Map(), { unwrap: true });
        const literal = provider?.name && ts.isStringLiteral(provider.name) ? provider.name.text : null;
        const id = 'use:' + hash(JSON.stringify([entry.handlerId, source.file, source.start.offset, source.end.offset, surface.surfaceId]));
        if (!sites.has(id)) sites.set(id, { id, ownerId: entry.handlerId, surfaceId: surface.surfaceId,
          operation: surface.canonicalOperation, source, registrationIds: [],
          binding: provider?.name ? { kind: provider.providerKind, name: literal, state: literal === null ? 'dynamic' : 'resolved' } : null,
          basis: 'canonical-recognition-node-identity' });
        sites.get(id).registrationIds.push(entry.stableId);
      }
      ts.forEachChild(node, visit);
    };
    visit(descriptor.functionNode);
  }
  const helper = topology.options.linkedProjectModules.sourceHelpers[0];
  assert.equal(helper.functionNode.name.text, 'sharedLookup');
  const helperFile = helper.functionNode.getSourceFile();
  handlers.push({ id: helper.id, kind: 'helper', name: 'sharedLookup', source: authoredSpan(helperFile, helper.functionNode), sourceTextHash: null });
  // This replay proves that the authored helper node is available. Production
  // router recognition does not currently retain it; this is NOT a plan join.
  const visitHelper = node => {
    if (ts.isAwaitExpression(node)) {
      const surface = authority.recognizeHandlerSurface(node, { ctxName: 'ctx', unwrap: true });
      assert.equal(surface.surfaceId, 'ctx.secret.get');
      const source = authoredSpan(helperFile, node);
      const id = 'use:' + hash(JSON.stringify([helper.id, source.file, source.start.offset, source.end.offset, surface.surfaceId]));
      sites.set(id, { id, ownerId: helper.id, surfaceId: surface.surfaceId,
        operation: surface.canonicalOperation, source: authoredSpan(helperFile, node),
        basis: 'diagnostic-recognition-replay', planUseSiteJoin: 'unavailable' });
    }
    ts.forEachChild(node, visitHelper);
  };
  visitHelper(helper.functionNode);
  const reused = handlers.find(h => h.name === 'reused');
  const reusedSites = [...sites.values()].filter(s => s.ownerId === reused.id && s.binding);
  assert.deepEqual(reusedSites.map(s => s.binding.name), ['REGION', 'REGION', 'OTHER']);
  assert.equal(new Set(reusedSites.map(s => s.id)).size, 3);
  assert.ok(reusedSites.every(s => s.registrationIds.length === 2));
  const packageHandler = handlers.find(h => h.name === 'packageHandler');
  const importedSite = [...sites.values()].find(s => s.ownerId === packageHandler.id && s.binding);
  assert.match(importedSite.source.file, /^npm\/@fixture\/analytics@1\.0\.0\/[a-f0-9]{64}\/index\.ts$/);
  assert.equal(importedSite.source.start.line, 7);
  assert.equal([...sites.values()].find(s => s.basis === 'diagnostic-recognition-replay').source.start.line, 2);
  const helperEffect = plan.effects.find(e => e.helperId === helper.id);
  assert.equal(helperEffect.capability, 'secret.get');
  assert.equal(helperEffect.source.file, 'src/index.ts');
  assert.notEqual(helperEffect.source.file, helperFile.fileName, 'Native source is generated, not an authored link');
  const packageEntry = registrations.find(r => r.handlerId === packageHandler.id);
  const packageEffect = plan.effects.find(e => e.routerEntryStableId === packageEntry.stableId || e.applicationEntryStableId === packageEntry.stableId);
  assert.ok(packageEffect);
  assert.notEqual(packageEffect.source.line, importedSite.source.start.line);
  const rootIr = ir.find(r => r.entryStableId === registrations[0].stableId).canonicalIr;
  assert.equal(rootIr.surfaceSummary.normalization.changed, true);
  assert.deepEqual(rootIr.effectSites, []);
  assert.ok(rootIr.capabilities.includes('req.header'));
  assert.equal(handlers.length, 13); // 12 handlers plus one imported helper.
  assert.equal(registrations.length, 18);
  const mounts = registrations.filter(r => r.kind === 'mount');
  assert.equal(mounts.length, 2);
  assert.notEqual(mounts[0].stableId, mounts[1].stableId);
  const scoped = handlers.find(h => h.name === 'scopedMiddleware');
  assert.equal(registrations.filter(r => r.handlerId === scoped.id).length, 2);
  assert.ok(references.references.some(r => r.state === 'dynamic' && r.canonicalId === null));
  const helperCalls = [];
  const collectCalls = value => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'helper-call') helperCalls.push({ helperId: value.helperId,
      callerEntryId: value.callerEntryId, statementPath: value.statementPath });
    for (const child of Object.values(value)) if (child && typeof child === 'object') {
      if (Array.isArray(child)) child.forEach(collectCalls); else collectCalls(child);
    }
  };
  collectCalls(plan.entry.body); plan.handlers.forEach(h => collectCalls(h.body));
  assert.equal(helperCalls.length, 2);
  const helperReference = references.references.find(r => r.canonicalId === 'HELPER_TOKEN');
  assert.deepEqual(helperReference.entryIds, helperCalls.map(c => c.callerEntryId).sort());
  // Deliberately selected fixture paths, NOT a general association analyzer.
  // Each joins canonical owner identities; no generated effect/source pairing.
  const direct = registrations.find(r => r.path === '/direct-a');
  const scopedRoute = registrations.find(r => r.path === '/api/scoped' && r.kind === 'route');
  const scopedRegistration = registrations.find(r => r.handlerId === scoped.id);
  assert.ok(scopedRegistration.index >= mounts[0].childStartIndex && scopedRegistration.index < mounts[0].parentContinueIndex);
  const helperSite = [...sites.values()].find(s => s.ownerId === helper.id);
  const derivedAssociations = [
    { consumerRegistrationId: direct.stableId, useSiteId: reusedSites[0].id,
      via: [{ kind: 'direct', id: direct.stableId }], lane: 'normal' },
    ...helperCalls.map(call => ({ consumerRegistrationId: call.callerEntryId, useSiteId: helperSite.id,
      via: [{ kind: 'direct', id: call.callerEntryId }, { kind: 'helper', id: call.helperId }], lane: 'normal' })),
    { consumerRegistrationId: scopedRoute.stableId, useSiteId: [...sites.values()].find(s => s.ownerId === scoped.id && s.binding).id,
      via: [{ kind: 'mount', id: mounts[0].stableId }, { kind: 'middleware', id: scopedRegistration.stableId }], lane: 'normal' }
  ].map(row => ({ ...row, conditional: true, coverage: { status: 'partial', observed: 1, expected: null,
    reason: 'fixture-selected-paths-not-exhaustive' }, basis: 'canonical-owner-links-and-fixture-paths' }));
  return { handlers, registrations, useSites: [...sites.values()],
    normalization: { rootCapabilities: rootIr.capabilities, rootEffectSites: rootIr.effectSites,
      helperNativeSource: helperEffect.source, packageNativeSource: packageEffect.source },
    helperCalls, derivedAssociations, references: references.references };
}
function examples(trace) {
  const selected = new Set(trace.derivedAssociations.flatMap(a => [a.consumerRegistrationId, ...a.via.map(v => v.id)]));
  const registrations = trace.registrations.filter(r => selected.has(r.stableId) || r.path === '/direct-b' || r.kind === 'mount');
  const handlers = trace.handlers.filter(h => selected.has(h.id) || registrations.some(r => r.handlerId === h.id) || h.name === 'packageHandler');
  return { format: 'an9-00.producer-examples.v1', status: 'selected-proof-records-not-a-report-capsule',
    handlers, registrations,
    useSites: trace.useSites.filter(s => handlers.some(h => h.id === s.ownerId) && (s.binding || s.basis === 'diagnostic-recognition-replay')),
    helperCalls: trace.helperCalls, derivedAssociations: trace.derivedAssociations,
    unsupportedJoin: { authoredUseSiteToNativeEffect: 'unavailable', reason: 'generated-source-reparse-loses-node-identity' } };
}
function assertReportGaps(report) {
  const names = (route, collection, key) => report[collection].filter(row => route[key].includes(row.id)).map(row => row.name).sort();
  for (const path of ['/helper-a', '/helper-b']) {
    const route = report.routes.find(r => r.path === path);
    assert.ok(names(route, 'bindings', 'bindingIds').includes('HELPER_TOKEN'));
    assert.ok(!names(route, 'declarations', 'declarationIds').includes('secret.get'), 'known helper capability loss');
    assert.ok(!names(route, 'declarations', 'declarationIds').includes('response.text'), 'known synchronous capability loss');
  }
  for (const path of ['/api/plain', '/v2/plain']) {
    const route = report.routes.find(r => r.path === path);
    assert.equal(route.compositionCoverage, 'bounded');
    assert.ok(names(route, 'bindings', 'bindingIds').includes('SCOPED'), 'known sibling-scope overassociation');
  }
  const error = report.routes.find(r => r.path === '/error');
  if (error) assert.ok(!names(error, 'bindings', 'bindingIds').includes('RECOVERY'), 'error continuation is absent from composition');
  assert.equal(report.references.filter(r => r.kind === 'binding' && r.canonicalId === 'REGION').length, 1);
  assert.ok(report.references.some(r => r.kind === 'binding' && r.state === 'dynamic' && r.targetId === null));
}
async function runRuntime(native, variant) {
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
  if (variant === 'http') cases.push(['/error', 'AN9:recovery', ['ROOT', 'RECOVERY'], 418]);
  for (const [url, body, effects, status = 200, headers = []] of cases) {
    calls.length = 0;
    const result = await nativeHost.executeCanonicalNativeModule(native, { request: { path: url, headers }, providerAdapter });
    assert.equal(result.response.status, status, url); assert.equal(result.response.body, body, url);
    assert.deepEqual(calls.map(e => e.name), effects, url); count++;
  }
  if (variant === 'event') {
    calls.length = 0;
    const result = await nativeHost.executeCanonicalNativeEvent(native, {
      version: events.EVENT_FRAME_VERSION, type: 'analytics.tick', schemaId: null
    }, { providerAdapter });
    assert.equal(result.status, events.EVENT_EXECUTION_STATUS.COMPLETED);
    assert.deepEqual(calls.map(e => e.name), ['EVENT'], 'event does not inherit HTTP middleware'); count++;
  }
  return count;
}
async function main() {
  const results = path.join(root, 'wasm/.test-results'); fs.mkdirSync(results, { recursive: true });
  const directory = fs.mkdtempSync(path.join(results, 'an9-00-'));
  const fixtureDirectory = path.join(directory, 'project');
  setup(fixtureDirectory);
  const project = resolveProject({ cwd: fixtureDirectory, metadataOnly: true });
  const authored = trace(execution.compileProject(project));
  save(directory, 'authored-trace.json', authored);
  const exampleRecords = examples(authored);
  if (process.argv.includes('--update-examples')) save(__dirname, 'examples.json', exampleRecords);
  else assert.deepEqual(JSON.parse(JSON.stringify(exampleRecords)), JSON.parse(fs.readFileSync(path.join(__dirname, 'examples.json'))),
    'compare serialized producer examples; internal optional properties may be undefined');
  assert.throws(() => execution.compileNativeProjectInMemory(project, { emitWat: false }), e =>
    e.code === 'PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED' && /explicit compiler-owned entry boundaries/.test(e.message));
  const cells = [], controlOwner = withoutProjection();
  for (const variant of ['http', 'event']) {
    let defaultAssociations;
    for (const optimization of ['default', 'experimental-native-bounded-size']) {
      setup(fixtureDirectory, variant);
      const project = resolveProject({ cwd: fixtureDirectory, metadataOnly: true });
      const options = { emitWat: false, nativeOptimization: optimization === 'default' ? undefined : optimization };
      const control = controlOwner.compileNativeProjectInMemory(project, options);
      const prepared = execution.compileNativeProjectInMemory(project, options);
      assert.equal(control.reportReferences, undefined);
      assert.deepEqual(prepared.plan, control.plan);
      assert.equal(prepared.native.source, control.native.source);
      assert.deepEqual(prepared.native.wasm, control.native.wasm);
      assert.deepEqual(prepared.native.manifest.optimization, control.native.manifest.optimization);
      const report = inventory(project, prepared, optimization);
      assertReportGaps(report);
      const semantic = report.routes.map(route => ({ path: route.path, handlerId: route.handlerId,
        entryId: route.entryId, composition: route.composition, bindings: route.bindingIds, capabilities: route.declarationIds }));
      if (optimization === 'default') defaultAssociations = semantic;
      else assert.deepEqual(semantic, defaultAssociations, 'bounded-size recipe must not redefine semantic ownership');
      const saved = capsule.serializeCapsule(report);
      assert.equal(capsule.serializeCapsule(capsule.parseCapsule(saved)), saved);
      assert.throws(() => capsule.validateCapsule({ ...report, analytics: { version: 'pulse.report-analytics.v1' } }),
        'AN9-01 validates the optional block; an incomplete block is rejected');
      // AN9-01 owns analytics now. Unknown future keys still project away.
      assert.throws(() => capsule.createCapsule({ ...report, analytics: {} }));
      assert.equal(capsule.serializeCapsule(capsule.createCapsule({ ...report, futureAnalytics: {} })), saved);
      const requests = await runRuntime(prepared.native, variant) + await runRuntime(control.native, variant);
      // The imported source graph is accepted by IMP9, but report snapshots do
      // not yet bind arbitrary npm source. Keep that failure visible.
      const built = execution.compileNativeProject(project, options);
      const importedManifest = JSON.parse(fs.readFileSync(built.files.manifest));
      assert.deepEqual(importedManifest.reportEvidence, { status: 'unavailable', reason: 'REPORT_INPUT_UNBOUND' });
      assert.throws(() => retained.collectArtifactReport(built.files.manifest), e => e.code === 'REPORT_MISSING_COMPLETION');
      assert.deepEqual(fs.readFileSync(built.files.nativeWasm), prepared.native.wasm);
      // Isolate the snapshot gap with identical helper/handler source in a
      // project module. This replay is not evidence for imported-source replay.
      setup(fixtureDirectory, variant, true);
      const local = execution.compileNativeProject(resolveProject({ cwd: fixtureDirectory, metadataOnly: true }), options);
      const manifest = local.files.manifest;
      const replay = retained.collectArtifactReport(manifest).capsule;
      assertReportGaps(replay);
      const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|typescript|project-config|project-execution|child_process|^(node:)?(http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};const r=require(${JSON.stringify(path.join(cli, 'internal/report/retained'))});process.stdout.write(r.collectArtifactReport(process.argv[1]).capsule.evidenceHash.value);`;
      assert.equal(execFileSync(process.execPath, ['-e', script, manifest], { encoding: 'utf8' }), replay.evidenceHash.value);
      save(directory, `${variant}-${optimization}-report.json`, report);
      cells.push({ variant, optimization, wasmBytes: prepared.native.wasm.length,
        wasmSha256: hash(prepared.native.wasm), executions: requests, localSourcePassiveReplay: true,
        importedSourceReplay: 'REPORT_INPUT_UNBOUND', projectionNoninterference: true });
      console.log(JSON.stringify(cells.at(-1)));
    }
  }
  const summary = { status: 'passed', fixtureSha256: hash(fs.readFileSync(path.join(__dirname, 'fixture/index.ts'))),
    packageSha256: hash(fs.readFileSync(path.join(__dirname, 'fixture/package.ts'))),
    completeFixtureNative: 'known-error-event-boundary-rejection', cells };
  save(directory, 'summary.json', summary);
  console.log(`AN9-00 proof passed: ${path.join(directory, 'summary.json')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
