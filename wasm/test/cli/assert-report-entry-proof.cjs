'use strict';

// RPT8-00/01: independently check production ownership against the actual
// generated declarations and verified final emission. Raw names stay test-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { compileCanonicalRouterSource } = require('../../packages/compiler/src/canonical-router-compiler');
const { compileCanonicalSource } = require('../../packages/compiler/src/canonical-api-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { collectInventory } = require('../../packages/cli/src/internal/report/inventory');
const { addSizeEvidence } = require('../../packages/cli/src/internal/report/size');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/report/transfer-router.ts'), 'utf8');

function prepare() {
  const options = { fileName: 'src/index.ts', rootDir: root };
  // Exact duplicate route registrations remain invalid. Repeated middleware and
  // the same handler registered at distinct paths are the supported cases.
  assert.throws(() => compileCanonicalRouterSource(fixture.replace("'/duplicate/b'", "'/duplicate/a'"), options),
    error => error.diagnostics?.some(row => row.code === 'PULSE_CANONICAL_ROUTER_DUPLICATE_ROUTE_HANDLER'));
  const router = compileCanonicalRouterSource(fixture, options);
  const compiled = compileCanonicalSource(router.sourceText, { ...options, strict: false,
    compilerPrelude: router.compilerPrelude, compilerOwnedCalls: router.compilerOwnedCalls,
    internalGeneratedHandler: true, metadataExtensions: { router: router.metadata } });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.routing.entries.length, 9);
  assert.equal(plan.handlers.length, 4);
  assert.equal(plan.stages.length, 1);
  const stage = plan.stages[0];
  assert.equal(stage.registrations.length, 2);
  assert.notEqual(stage.registrations[0].entryId, stage.registrations[1].entryId);
  assert.notEqual(stage.registrations[0].effectIds[0], stage.registrations[1].effectIds[0]);
  for (const row of stage.registrations) {
    const effect = plan.effects.find(effect => effect.id === row.effectIds[0]);
    assert.equal(effect.routerEntryStableId, row.entryId);
    assert.equal(effect.stageId, stage.id);
    assert.equal(effect.stageSite, 0);
    assert.equal(plan.continuations.find(item => item.id === row.continuationIds[0]).stageId, stage.id);
  }
  return { compiled, plan };
}

function loadObserved(relative, intercept) {
  const file = path.join(root, relative), owner = new Module(file, module);
  owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
  const original = owner.require.bind(owner);
  owner.require = id => intercept(id, original(id));
  owner._compile(fs.readFileSync(file, 'utf8'), file);
  return owner.exports;
}

function build(plan, target, capture, optimization, directory) {
  let control, layout, generated, generatorCalls = 0, ascCalls = 0, recipe;
  const generator = loadObserved('wasm/packages/runtime-core-as/src/compiler/canonical-native.js', (id, value) =>
    id !== './canonical-native-control.js' ? value : { ...value,
      buildNativeControl(...args) { control = value.buildNativeControl(...args); return control; },
      layoutNativeControl(...args) { layout = value.layoutNativeControl(...args); return layout; }
    });
  const captureFile = path.join(directory, 'capture.json');
  fs.rmSync(captureFile, { force: true });
  const owner = loadObserved(target === 'portable' ? 'wasm/packages/compiler/src/canonical-native-compiler.js'
    : 'packages/provider-fastly/src/build/native-platform-capabilities.js', (id, value) => {
    if (id === '@pulse-compute/wasm-runtime-core-as/compiler/canonical-native') return { ...value,
      generateCanonicalNativeAssemblyScript(...args) {
        generatorCalls++; generated = generator.generateCanonicalNativeAssemblyScript(...args); return generated;
      }
    };
    if (id !== 'node:child_process') return value;
    return { ...value, spawnSync(executable, args, options) {
      ascCalls++; assert.match(args[0], /asc\.js$/); assert.ok(!args.includes('--debug'));
      // Compare the complete recipe except the observer itself and temporary paths.
      const ordinary = args.slice();
      const observer = ordinary.findIndex((arg, i) => i > 0 && ordinary[i - 1] === '--transform'
        && path.basename(arg) === 'report-capture.cjs');
      if (observer >= 0) ordinary.splice(observer - 1, 2);
      recipe = ordinary.map(arg => path.isAbsolute(arg) && !arg.startsWith(root + path.sep)
        ? '<temporary>/' + path.basename(arg) : arg);
      const selected = capture ? [...args, '--transform', path.join(root, 'docs/internal/prpt00c/capture-transform.cjs')] : args;
      return spawnSync(executable, selected, { ...options,
        env: { ...(options.env || process.env), PRPT00C_CAPTURE_FILE: captureFile } });
    } };
  });
  const options = { cwd: root, reportCapture: capture, nativeOptimization: optimization, emitWat: false,
    bindings: { effectBackends: Object.fromEntries(plan.effects.map(effect => [effect.id, 'fixture'])) },
    canonicalBuild: true, requirePlatformCapability: false };
  const artifact = target === 'portable' ? owner.compileCanonicalNativePlan(plan, options)
    : owner.compileFastlyNativePlatformCapabilitiesPlan(plan, options);
  assert.equal(generatorCalls, 1); assert.equal(ascCalls, 1);
  assert.equal(artifact.guestUnits?.length || 0, 0, 'proof is final and unlinked');
  return { artifact, control, layout, generated, recipe,
    capture: capture ? JSON.parse(fs.readFileSync(captureFile, 'utf8')) : null };
}

// Join completed generator chunks to actual declarations by their exact program
// counter cases. No name-pattern guess, numeric Wasm-index assumption, or second
// source generation is used to identify the emitted function.
function chunkSymbols(source, layout) {
  const parsed = ts.createSourceFile('generated.as.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  for (const statement of parsed.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.name) continue;
    const selectors = statement.body.statements.filter(node => ts.isSwitchStatement(node)
      && node.expression.getText(parsed) === '__pulse_pc');
    for (const selector of selectors) declarations.push({ name: statement.name.text,
      states: selector.caseBlock.clauses.filter(ts.isCaseClause).map(row => {
        assert.ok(ts.isNumericLiteral(row.expression)); return Number(row.expression.text);
      }) });
  }
  const symbols = layout.chunks.map(chunk => {
    const states = chunk.map(row => row.id);
    const matches = declarations.filter(row => JSON.stringify(row.states) === JSON.stringify(states));
    assert.equal(matches.length, 1, 'each completed chunk has one exact emitted declaration');
    return matches[0].name;
  });
  assert.equal(new Set(symbols).size, symbols.length);
  return symbols;
}

function entryProof(plan, ownership, symbols, capture, prefix) {
  const entries = new Map(plan.routing.entries.map(entry => [entry.stableId, entry]));
  const names = new Map(capture.functions.filter(row => row.name).map(row => [row.name, row.index]));
  const owners = new Map();
  function add(entryId, handlerId, chunks, relation) {
    assert.equal(entries.get(entryId)?.handlerId, handlerId, 'canonical entry and handler identity must agree');
    assert.ok(chunks.length > 0);
    assert.ok(!owners.has(entryId), 'one implementation family per entry in this fixture');
    const indices = chunks.map(chunk => {
      assert.ok(symbols[chunk], 'generator chunk must have an emitted declaration');
      return names.get(prefix + symbols[chunk]) ?? null;
    });
    owners.set(entryId, { entryId, handlerId, relation, expected: chunks.length,
      indices: [...new Set(indices.filter(index => index !== null))],
      complete: indices.every(index => index !== null),
      reason: indices.includes(null) ? 'final-symbol-not-surviving' : null });
  }
  for (const owner of ownership.handlerBodies) add(owner.id, owner.handlerId, owner.chunks, 'terminal-body');
  for (const stage of plan.stages) {
    const owner = ownership.stages.find(row => row.id === stage.id);
    assert.ok(owner); assert.equal(owner.handlerId, stage.handlerId);
    assert.equal(owner.registrations, stage.registrations.length);
    for (const registration of stage.registrations) add(registration.entryId, stage.handlerId, owner.chunks, 'shared-stage-body');
  }
  return plan.routing.entries.map(entry => owners.get(entry.stableId) || {
    entryId: entry.stableId, handlerId: entry.handlerId, relation: 'dispatcher-carrier',
    expected: null, indices: [], complete: false, reason: 'entry-ownership-not-retained'
  });
}

function prepareAdditional(directory) {
  const cwd = path.join(directory, 'application');
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.pulse'));
  fs.mkdirSync(path.join(cwd, 'node_modules/@pulse-compute'), { recursive: true });
  for (const name of ['pulse', 'runtime']) fs.symlinkSync(path.join(root, 'packages', name), path.join(cwd, 'node_modules/@pulse-compute', name), 'dir');
  fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',strict:false},node:{host:'node',target:'native'}}));`);
  fs.writeFileSync(path.join(cwd, 'src/helper.ts'), `export const lookup=async(ctx,input:string)=>{
let value=await ctx.fetch('https://fixture.test/value').text();for(let i=0;i<8;i++){value=value+':'+i;}return value+input;};`);
  fs.writeFileSync(path.join(cwd, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';import {lookup} from './helper';
const app=new Pulse({auto:true});
app.get('/helper-a',async ctx=>{const value=await lookup(ctx,'a');return ctx.text(value);});
app.get('/helper-b',async ctx=>{const value=await lookup(ctx,'b');return ctx.text(value);});
app.get('/many',async ctx=>{let value=ctx.req.header('x-value')||'a';${"value=value+'b';".repeat(70)}return ctx.text(value);});
const forward=async(ctx,next)=>{const value=await ctx.fetch('https://fixture.test/value').text();ctx.state.set('extra',value);return next();};
app.get('/stage-a',forward);app.get('/stage-b',forward);
app.get('/stage-a',async ctx=>ctx.text(ctx.state.get('extra')));
app.get('/stage-b',async ctx=>ctx.text(ctx.state.get('extra')));
export default app;`);
  const tc = require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const compiled = tc.compileProject(tc.resolveProject({ cwd, profile: 'node' }));
  const plan = buildCanonicalNativePlan(compiled);
  assert.equal(plan.helpers.length, 1); assert.equal(plan.stages.length, 1);
  return { compiled, plan, cwd };
}

async function execute(artifact, target, cases = [
    ['/ordinary', {}, 200, 'ordinary', 0], ['/next', {}, 200, 'fallback', 0],
    ['/next', { 'x-stop': 'yes' }, 200, 'stopped', 0], ['/error', {}, 418, 'FIXTURE', 0],
    ['/duplicate/a', {}, 200, 'xx', 2], ['/duplicate/b', {}, 200, 'xx', 2],
    ['/missing', {}, 404, 'Not Found', 0]
  ]) {
  for (const [pathname, headers, status, body, expectedFetches] of cases) {
    let fetches = 0;
    const adapter = target === 'portable'
      ? require('../../../packages/provider-node/src/runtime/canonical-api-runtime').createNodeProviderAdapter({
          fetches: { 'https://fixture.test/value': { body: 'x' } }
        }) : null;
    const result = target === 'fastly'
      ? require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host')
        .executeFastlyNativePlatformCapabilities(artifact, {
          request: { path: pathname, headers: Object.entries(headers) },
          fixtures: { fixture: { '/value': { status: 200, body: 'x' } } },
          onOutboundRequest() { fetches++; }
        })
      : await require('../../packages/host-runtime/src/runtime/canonical-native-host').executeCanonicalNativeModule(artifact, {
          request: { path: pathname, headers },
          providerAdapter: { ...adapter, dispatchEffect(effect, options) {
            if (effect.kind === 'fetch') fetches++;
            return adapter.dispatchEffect(effect, options);
          } }
        });
    assert.equal(result.response.status, status); assert.equal(result.response.body, body);
    assert.equal(fetches, expectedFetches);
  }
  return cases.length;
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-report-entry-proof-'));
  const { compiled, plan } = prepare(), cells = [];
  const planBefore = JSON.stringify(plan);
  try {
    for (const [target, optimization] of [['portable', undefined], ['fastly', undefined], ['portable', 'experimental-native-size'],
      ['portable', 'experimental-native-bounded-size'], ['fastly', 'experimental-native-bounded-size']]) {
      const control = build(plan, target, false, optimization, directory);
      const observed = build(plan, target, true, optimization, directory);
      const { artifact, capture, generated, layout } = observed;
      assert.deepEqual(artifact.wasm, control.artifact.wasm, 'whole executable unchanged, including custom sections');
      assert.equal(artifact.source, control.artifact.source); assert.deepEqual(observed.recipe, control.recipe);
      assert.equal(control.artifact.reportAttribution, null);
      assert.equal(capture.artifactSha256, hash(artifact.wasm));
      assert.equal(capture.nonCustomSectionsIdentical, true); assert.equal(capture.restoredSerializationIdentical, true);
      assert.equal(artifact.reportAttribution.artifactSha256, capture.artifactSha256);
      const symbols = chunkSymbols(generated.source, layout);
      const prefix = target === 'portable' ? 'canonical-native.as/' : 'fastly-native-platform-capabilities.as/';
      const rows = entryProof(plan, generated.manifest, symbols, capture, prefix);
      const production = artifact.reportAttribution;
      assert.equal(production.attributionVersion, 2);
      assert.equal(production.entries.length, plan.routing.entries.length);
      for (const body of generated.manifest.reportOwnership.bodies) {
        assert.equal(body.symbol, symbols[body.chunk], 'metadata names the actual declaration');
        const mapped = production.chunkMappings.find(row => row.chunk === body.chunk);
        assert.equal(mapped.functionIndex, capture.functions.find(row => row.name === prefix + body.symbol)?.index ?? null);
      }
      for (const row of rows.filter(row => row.complete)) {
        const owner = production.entries.find(entry => entry.entryId === row.entryId);
        assert.equal(owner.handlerId, row.handlerId); assert.equal(owner.reason, null);
        assert.deepEqual(owner.bodies.map(body => production.chunkMappings.find(item => item.chunk === body.chunk).functionIndex), row.indices);
      }
      assert.equal(rows.filter(row => row.complete).length, 6, 'four terminal entries and two shared middleware registrations');
      const shared = rows.filter(row => row.relation === 'shared-stage-body');
      assert.deepEqual(shared[0].indices, shared[1].indices, 'duplicate registrations share the same physical stage body');
      assert.ok(shared[0].indices.length > 0);
      assert.equal(rows.filter(row => row.relation === 'dispatcher-carrier').length, 3);
      assert.ok(observed.control.blocks.some(row => row.boundary && row.handlerId === undefined && row.entryId), 'transfer/error states retain observational entry ownership');
      assert.equal(production.entries.filter(row => row.bodies.some(body => body.relation === 'dispatcher-carrier')).length, 3);
      assert.equal(generated.manifest.stages[0].registrations, 2, 'manifest currently retains only the registration count');
      const record = { id: 'artifact:' + capture.artifactSha256, sha256: capture.artifactSha256,
        bytes: artifact.wasm.length, stage: 'final', target };
      const seed = collectInventory({ root, provider: target === 'portable' ? 'node' : 'fastly' },
        { compiled, plan, native: artifact }, [record], record.id, optimization || 'default');
      const capsule = addSizeEvidence(seed, new Map([[record.id, artifact.wasm]]), artifact.reportAttribution);
      const routeIds = new Set(capsule.routes.map(row => row.id));
      const direct = capsule.measurements.filter(row => row.metric === 'handler-body' && routeIds.has(row.subjectId));
      assert.equal(direct.length, 6); assert.equal(direct.filter(row => row.fact.state === 'available').length, 4);
      assert.ok(direct.filter(row => row.fact.state === 'unavailable').every(row => row.fact.reason === 'dispatcher-carrier'));
      const middleware = capsule.entries.filter(row => row.kind === 'middleware');
      const stageSizes = middleware.map(entry => capsule.measurements.find(row => row.subjectId === entry.id && row.metric === 'handler-body'));
      assert.ok(stageSizes.every(row => row.fact.state === 'available' && row.fact.coverage === 'exact'));
      assert.deepEqual(stageSizes[0].bodyIds, stageSizes[1].bodyIds);
      const stageInventory = capsule.implementations.filter(row => row.origin === 'consolidated-stage');
      assert.equal(stageInventory.length, 1);
      assert.deepEqual(stageInventory[0].roles, ['middleware']);
      assert.deepEqual(stageInventory[0].entryIds, middleware.map(row => row.id).sort());
      assert.deepEqual(stageInventory[0].bodyIds, stageSizes[0].bodyIds);
      assert.equal(stageInventory[0].entryCoverage.status, 'partial');
      assert.ok(capsule.implementations.some(row => row.origin === 'dispatcher'));
      assert.ok(capsule.measurements.filter(row => ['own', 'shared'].includes(row.metric)).every(row => row.fact.value === null));
      const missing = { ...capture, functions: capture.functions.filter(row => !shared[0].indices.includes(row.index)) };
      assert.ok(entryProof(plan, generated.manifest, symbols, missing, prefix)
        .filter(row => row.relation === 'shared-stage-body').every(row => !row.complete && row.reason === 'final-symbol-not-surviving'));
      const wrongOwner = structuredClone(generated.manifest); wrongOwner.stages[0].handlerId = 'wrong';
      assert.throws(() => entryProof(plan, wrongOwner, symbols, capture, prefix), /AssertionError/);
      const requests = await execute(control.artifact, target) + await execute(artifact, target);
      const sizes = new Map(capture.functions.map(row => [row.index, row.bytes]));
      cells.push({ target, optimization: optimization || 'default', entries: rows.length, provenEntries: 6,
        productionMappedRoutes: 4, productionExpectedRoutes: 6, sharedRegistrations: shared.length,
        sharedPhysicalBodies: shared[0].indices.length, sharedPhysicalBytes: shared[0].indices.reduce((n, index) => n + sizes.get(index), 0),
        dispatcherCarrierEntries: 3, wholeExecutableUnchanged: true, generatorCalls: 2, ascCalls: 2, requests,
        graph: artifact.reportAttribution.graph.state, convergenceEmissions: capture.convergenceEmissions });
    }
    assert.equal(JSON.stringify(plan), planBefore, 'observation never mutates the executable plan');
    const additional = prepareAdditional(directory), extraCells = [];
    for (const target of ['portable', 'fastly']) for (const optimization of [undefined, 'experimental-native-bounded-size']) {
      const control = build(additional.plan, target, false, optimization, directory);
      const observed = build(additional.plan, target, true, optimization, directory);
      const { artifact, generated, capture, layout } = observed, attribution = artifact.reportAttribution;
      assert.deepEqual(artifact.wasm, control.artifact.wasm); assert.equal(artifact.source, control.artifact.source);
      assert.deepEqual(observed.recipe, control.recipe);
      const symbols = chunkSymbols(generated.source, layout);
      const prefix = target === 'portable' ? 'canonical-native.as/' : 'fastly-native-platform-capabilities.as/';
      for (const body of generated.manifest.reportOwnership.bodies) {
        assert.equal(body.symbol, symbols[body.chunk]);
        assert.equal(attribution.chunkMappings.find(row => row.chunk === body.chunk).functionIndex,
          capture.functions.find(row => row.name === prefix + body.symbol)?.index ?? null);
      }
      const helperBodies = attribution.chunkMappings.filter(row => row.kind === 'shared-helper-body');
      assert.ok(helperBodies.length > 0);
      assert.ok(helperBodies.every(row => row.functionIndex === null ? row.reason === 'final-symbol-not-surviving' : row.reason === null));
      assert.equal(helperBodies.filter(row => row.functionIndex !== null).length,
        optimization === 'experimental-native-bounded-size' ? 1 : 0, 'pinned surviving/optimized-away helper cases; never force retention');
      assert.ok(helperBodies.every(row => row.implementationId === additional.plan.helpers[0].id));
      const helperCallers = attribution.entries.filter(row => row.bodies.some(body => body.relation === 'shared-helper-body'));
      assert.equal(helperCallers.length, 2);
      assert.deepEqual(helperCallers[0].bodies.filter(body => body.relation === 'shared-helper-body'),
        helperCallers[1].bodies.filter(body => body.relation === 'shared-helper-body'));
      const manyEntry = additional.plan.routing.entries.find(row => row.path === '/many');
      assert.ok(attribution.entries.find(row => row.entryId === manyEntry.stableId).bodies.length > 1, 'one entry spans multiple surviving bodies');
      const record = { id: attribution.artifactId, sha256: attribution.artifactSha256, bytes: artifact.wasm.length, stage: 'final', target };
      const seed = collectInventory({ root: additional.cwd, provider: target === 'portable' ? 'node' : 'fastly' },
        { compiled: additional.compiled, plan: additional.plan, native: artifact }, [record], record.id, optimization || 'default');
      const capsule = addSizeEvidence(seed, new Map([[record.id, artifact.wasm]]), attribution);
      const helperInventory = capsule.implementations.filter(row => row.origin === 'authored-helper');
      assert.equal(helperInventory.length, 1);
      assert.deepEqual(helperInventory[0].roles, ['helper']);
      assert.equal(helperInventory[0].entryIds.length, 2);
      assert.equal(helperInventory[0].routeIds.length, 2);
      assert.equal(helperInventory[0].bodyCoverage.observed, optimization === 'experimental-native-bounded-size' ? 1 : 0);
      assert.equal(helperInventory[0].bodyCoverage.expected, helperBodies.length);
      assert.ok(helperInventory[0].bodyIds.every(id => capsule.bodies.some(row => row.id === id)));
      const direct = capsule.measurements.filter(row => row.metric === 'handler-body');
      assert.equal(direct.length, 7); assert.ok(direct.every(row => row.fact.state === 'available'));
      for (const route of capsule.routes) {
        const entry = capsule.entries.find(row => row.id === route.entryId);
        const owner = attribution.entries.find(row => row.entryId === entry.canonicalId);
        const expected = owner.bodies.length;
        const mapped = owner.bodies.filter(body => attribution.chunkMappings.find(row => row.chunk === body.chunk).functionIndex !== null).length;
        const measurement = direct.find(row => row.subjectId === route.id);
        assert.equal(measurement.expectedChunks, expected); assert.equal(measurement.mappedChunks, mapped);
        assert.equal(measurement.fact.coverage, mapped === expected ? 'exact' : 'partial');
        if (mapped !== expected) assert.equal(capsule.measurements.find(row => row.subjectId === route.id && row.metric === 'reachable').fact.value, null);
      }
      assert.equal(new Set(capsule.bodies.map(row => row.id)).size, capsule.bodies.length);
      assert.equal(capsule.bodies.reduce((total, row) => total + row.bytes, 0), capsule.artifacts[0].ledger.codeBodyBytes);
      const cases = [['/helper-a', {}, 200, 'x:0:1:2:3:4:5:6:7a', 1], ['/helper-b', {}, 200, 'x:0:1:2:3:4:5:6:7b', 1],
        ['/many', {}, 200, 'a' + 'b'.repeat(70), 0], ['/stage-a', {}, 200, 'x', 1], ['/stage-b', {}, 200, 'x', 1]];
      const requests = await execute(control.artifact, target, cases) + await execute(artifact, target, cases);
      extraCells.push({ target, optimization: optimization || 'default', mappedRoutes: direct.length,
        exactRoutes: direct.filter(row => row.fact.coverage === 'exact').length,
        sharedHelperConsumers: helperCallers.length, helperBodies: helperBodies.length,
        survivingHelperBodies: helperBodies.filter(row => row.functionIndex !== null).length, requests, wholeExecutableUnchanged: true });
    }
    console.log(JSON.stringify({ status: 'passed', fixture: 'transfer-router', cells,
      additional: extraCells,
      scope: 'Production entry/stage capture; dispatcher carriers are explicit, not handler sizes. No exclusive ownership claim.' }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
