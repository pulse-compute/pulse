'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'wasm/packages/cli/src');
const execution = require(path.join(cli, 'project-execution'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const { buildCanonicalNativePlan, collectCanonicalReportReferences } = require('../../packages/compiler/src/canonical-native-plan');
const { collectInventory } = require(path.join(cli, 'internal/report/inventory'));
const capsule = require(path.join(cli, 'internal/report/capsule'));
const retained = require(path.join(cli, 'internal/report/retained'));
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
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
function inventory(project, prepared) {
  const artifact = { id: capsule.artifactId(prepared.native.manifest.wasm.sha256), ...prepared.native.manifest.wasm,
    stage: 'final', target: 'portable-native-wasm' };
  return collectInventory(project, prepared, [artifact], artifact.id, 'default');
}
async function main() {
  require('./report-schema-consumer-cases.cjs')();
  const results = path.join(root, 'wasm/.test-results'); fs.mkdirSync(results, { recursive: true });
  const directory = fs.mkdtempSync(path.join(results, 'rpt8-references-'));
  try {
    const { createEmbeddedManifest } = await import(pathToFileURL(path.join(root, 'packages/assets/dist/embedded.js')));
    const embedded = await createEmbeddedManifest([{ path: '/style.css', bytes: Buffer.from('RESOURCE_BODY_CANARY'), contentType: 'text/css' }]);
    write(path.join(directory, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';
export default defineConfig(scope=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false,defaultProfile:'native'},
native:{host:'node',target:'native',token:scope.secret('TOKEN'),region:scope.config('REGION'),unused:scope.config('UNUSED'),
dev:{secrets:{TOKEN:'SECRET_VALUE_CANARY'},config:{REGION:'CONFIG_VALUE_CANARY'}},outDir:'dist'}}));`);
    write(path.join(directory, 'src/schemas.ts'), `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
export interface Input{name:string};export interface Helper{name:string};export interface Unused{name:string};export default defineSchemaRegistry({schemas:{'app.Input':schema<Input>(),'app.Helper':schema<Helper>(),'app.Unused':schema<Unused>()}});`);
    write(path.join(directory, 'src/helper.ts'), `import type {Helper} from './schemas';export const lookup=async(ctx,input:string)=>{const text=await ctx.fetch('https://fixture.test/value').text();const decoded=ctx.decodeJson<Helper>(text,'app.Helper');let value=decoded.name;for(let i=0;i<8;i++){value=value+':'+i;}return value+input;};`);
    write(path.join(directory, 'src/index.ts'), `import {Pulse} from '@pulse-compute/pulse';import {assets} from '@pulse-compute/assets';
import {lookup} from './helper';import type {Input} from './schemas';const app=new Pulse({auto:true});
const schemaStage=async(ctx,next)=>{const stamp=await ctx.time.now();const value=ctx.decodeJson<Input>('{"name":"stage"}','app.Input');ctx.state.set('name',value.name);return next();};
app.use(schemaStage);app.use(schemaStage);
const binding=async ctx=>{const a=await ctx.config.get('REGION');const b=await ctx.config.get('REGION');const store=ctx.kv('cache');const item=await store.get('key');return ctx.text(a+b);};
app.get('/same',async(ctx,next)=>next());app.get('/same',binding);app.get('/other',binding);
app.get('/dynamic',async ctx=>{const name=ctx.req.header('x-name')||'REGION';const value=await ctx.config.get(name);return ctx.text(value||'');});
const token=async ctx=>{const value=await ctx.secret.get('TOKEN');return ctx.text(value||'');};
app.get('/secret-a',token);app.get('/secret-b',token);
app.post('/schema',async ctx=>{const value=await ctx.req.json<Input>('app.Input');return ctx.json(value,{schema:'app.Input'});});
const asset=async ctx=>{const value=await assets.lookup(ctx,'embedded','/style.css',{embeddedManifest:${JSON.stringify(JSON.stringify(embedded))}});return value;};
app.get('/asset-a',asset);app.get('/asset-b',asset);
app.get('/helper-a',async ctx=>{const value=await lookup(ctx,'a');return ctx.text(value);});
app.get('/helper-b',async ctx=>{const value=await lookup(ctx,'b');return ctx.text(value);});export default app;`);
    const project = resolveProject({ cwd: directory, metadataOnly: true });
    const controlOwner = withoutProjection(), cells = [];
    let saved, prepared;
    for (const optimization of ['default', 'experimental-native-bounded-size']) {
      const options = { nativeOptimization: optimization === 'default' ? undefined : optimization, emitWat: false };
      const control = controlOwner.compileNativeProjectInMemory(project, options);
      prepared = execution.compileNativeProjectInMemory(project, options);
      assert.equal(control.reportReferences, undefined);
      assert.deepEqual(prepared.plan, control.plan);
      assert.equal(prepared.native.source, control.native.source);
      assert.deepEqual(prepared.native.wasm, control.native.wasm);
      assert.deepEqual(prepared.native.manifest.optimization, control.native.manifest.optimization);
      let requests = 0;
      for (const native of [control.native, prepared.native]) for (const [url, body] of [
        ['/same', 'rr'], ['/other', 'rr'], ['/dynamic', 'r'], ['/secret-a', 't'], ['/secret-b', 't']
      ]) {
        const result = await executeCanonicalNativeModule(native, { request: { path: url },
          providerAdapter: createNodeProviderAdapter({ config: { REGION: 'r' }, secrets: { TOKEN: 't' }, kv: { cache: {} } }) });
        assert.equal(result.response.status, 200); assert.equal(result.response.body, body); requests++;
      }
      const report = inventory(project, prepared);
      const sameBehavior = report.routes.filter(row => row.path === '/same').map(row => row.behavior);
      assert.deepEqual(sameBehavior, [
        { kind: 'continuing', basis: 'canonical-handler-ir' }, { kind: 'terminal', basis: 'canonical-handler-ir' }
      ], 'same path retains distinct continuing/terminal registrations');
      assert.equal(report.routes.every(row => row.behavior), true, 'project compilation retains IR behavior');
      assert.equal(inventory(project, control).routes.some(row => row.behavior), false, 'no projection means unknown, not inferred terminal');
      assert.equal(prepared.plan.helpers.length, 1);
      const helperSchema = report.references.find(row => row.canonicalId === 'app.Helper');
      assert.equal(helperSchema.entryCoverage.status, 'complete');
      assert.deepEqual(helperSchema.entryIds, report.routes.filter(row => row.path.startsWith('/helper-')).map(row => row.entryId).sort());
      assert.equal(report.references.some(row => row.canonicalId === 'app.Unused'), false);
      assert.equal(report.bindings.length, 4, 'one row per kind/name, including an unused declaration');
      const binding = name => report.bindings.find(row => row.name === name);
      assert.ok(binding('REGION').declared && binding('REGION').referenced);
      assert.equal(binding('REGION').entryIds.length, 2);
      assert.ok(binding('UNUSED').declared && !binding('UNUSED').referenced);
      assert.ok(!binding('cache').declared && binding('cache').referenced);
      assert.equal(binding('TOKEN').entryIds.length, 2, 'shared handler retains both canonical registrations');
      assert.ok(report.bindings.every(row => row.resolution === 'unavailable'), 'static identity is not deployed realization');
      assert.equal(report.coverage.bindings.status, 'partial'); assert.equal(report.coverage.bindings.expected, null);
      const dynamic = report.references.filter(row => row.state === 'dynamic');
      assert.equal(dynamic.length, 1); assert.equal(dynamic[0].canonicalId, null); assert.equal(dynamic[0].targetId, null);
      assert.ok(report.observations.some(row => row.code === 'REPORT_DYNAMIC_REFERENCE' && row.subjectIds.includes(dynamic[0].id)));
      const assetResource = report.resources.find(row => row.kind === 'embedded-asset');
      assert.equal(report.resources.filter(row=>row.kind!=='response-payload').length, 4); assert.equal(assetResource.entryIds.length, 2);
      assert.equal(assetResource.inputBytes.value, 20); assert.equal(assetResource.retainedPayloadBytes.value, null);
      assert.equal(assetResource.generator.representationBytes.value, 28);
      assert.equal(report.schemas.length, 3);
      assert.equal(report.schemas.find(row => row.schemaId === 'app.Input').entryIds.length, 3, 'shared stage registrations and ordinary schema user remain distinct');
      assert.ok(prepared.plan.stages.some(row => row.registrations.length === 2), 'fixture exercises shared-stage lowering');
      const same = report.routes.filter(row => row.path === '/same');
      assert.equal(same.length, 2); assert.notEqual(same[0].id, same[1].id);
      assert.equal(report.references.filter(row => row.kind === 'binding' && row.state === 'resolved').length, 3);
      saved = capsule.serializeCapsule(report);
      assert.ok(!/VALUE_CANARY|RESOURCE_BODY_CANARY|embeddedManifest|providerConfig/.test(saved));
      assert.equal(capsule.serializeCapsule(capsule.parseCapsule(saved)), saved);
      cells.push({ optimization, bindings: report.bindings.length, references: report.references.length, requests, unchanged: true });
    }
    // Same offset in another file cannot borrow a generated entry's ownership.
    const foreign = { ...prepared.compiled, metadata: { ...prepared.compiled.metadata,
      schemaReferences: [...prepared.compiled.metadata.schemaReferences, { id: 'app.Input', file: 'foreign.ts',
        position: { offset: prepared.plan.routing.entries[0].generatedRange.start } }, { id: 'missing.Schema', position: { offset: -1 } }] } };
    const projected = collectCanonicalReportReferences(foreign, prepared.plan);
    const partial = inventory(project, { ...prepared, reportReferences: projected });
    const schema = partial.references.find(row => row.kind === 'schema' && row.canonicalId === 'app.Input');
    assert.equal(schema.entryCoverage.status, 'partial'); assert.equal(schema.entryCoverage.expected, null);
    const external = structuredClone(partial);
    external.references.find(row => row.canonicalId === 'app.Input').externalPackages = ['@example/codec'];
    const externalSaved = capsule.serializeCapsule(capsule.createCapsule(external));
    assert.equal(capsule.serializeCapsule(capsule.parseCapsule(externalSaved)), externalSaved);
    for (const packages of [[], ['@example/codec', '@example/codec']]) {
      const bad = structuredClone(external);
      bad.references.find(row => row.canonicalId === 'app.Input').externalPackages = packages;
      assert.throws(() => capsule.createCapsule(bad));
    }
    const invalidKind = structuredClone(external);
    invalidKind.references.find(row => row.kind === 'binding').externalPackages = ['@example/codec'];
    assert.throws(() => capsule.createCapsule(invalidKind));
    assert.ok(partial.references.some(row => row.kind === 'schema' && row.state === 'unknown' && row.targetId === null));
    const literal = value => ({ kind: 'literal', value });
    const original = prepared.plan.effects.find(row => row.providerKind === 'config');
    const adversarialPlan = { ...prepared.plan, effects: [
      { ...original, id: 'missing-name', inputs: [], resource: null },
      ...['config', 'secret'].map(providerKind => ({ ...original, id: providerKind, providerKind,
        inputs: [{ name: 'name', value: literal('SAME') }], resource: null,
        providerMetadata: { credentials: 'PRIVATE_METADATA_CANARY' } }))
    ] };
    const adversarial = collectCanonicalReportReferences(prepared.compiled, adversarialPlan);
    const bindingRefs = adversarial.references.filter(row => row.kind === 'binding');
    assert.equal(bindingRefs.length, 3);
    assert.equal(bindingRefs.filter(row => row.canonicalId === 'SAME').length, 2, 'kinds preserve distinct semantic identities');
    assert.equal(bindingRefs.find(row => row.canonicalId === null).state, 'unknown', 'missing evidence is not a dynamic expression');
    assert.ok(!JSON.stringify(adversarial).includes('PRIVATE_METADATA_CANARY'));
    const known = inventory(project, { ...prepared, reportReferences: { ...prepared.reportReferences,
      references: prepared.reportReferences.references.filter(row => row.state === 'resolved') } });
    assert.equal(known.coverage.references.status, 'complete');
    assert.equal(known.coverage.references.expected, known.references.length);
    assert.equal(known.coverage.bindings.expected, known.bindings.length);
    const empty = collectCanonicalReportReferences({ metadata: {} }, { entry: { body: [] }, effects: [] });
    assert.deepEqual(empty.references, [], 'known empty inventory has no invented observations');
    const reject = edit => {
      const value = JSON.parse(saved); edit(value);
      assert.throws(() => capsule.createCapsule(value));
    };
    reject(value => { value.coverage.references = { status: 'complete', observed: value.references.length, expected: value.references.length, reason: null }; });
    reject(value => { value.coverage.bindings = { status: 'complete', observed: value.bindings.length, expected: value.bindings.length, reason: null }; });
    reject(value => { value.references.find(row => row.state === 'dynamic').targetId = value.bindings[0].id; });
    reject(value => { value.references.find(row => row.state === 'resolved').entryIds.pop(); });
    reject(value => { value.references.find(row => row.state === 'resolved').canonicalId = 'wrong'; });
    reject(value => { delete value.coverage.references; });
    const privateMetadata = JSON.parse(saved);
    privateMetadata.references[0].providerMetadata = { credentials: 'PRIVATE_METADATA_CANARY' };
    assert.throws(() => capsule.validateCapsule(privateMetadata));
    assert.equal(capsule.serializeCapsule(capsule.createCapsule(privateMetadata)), saved, 'creation projects only allowlisted fields');
    reject(value => {
      const row = structuredClone(value.references.find(row => row.state === 'resolved'));
      row.id = capsule.stableReportId('reference', 'duplicate-semantic'); value.references.push(row);
      value.coverage.references.observed++;
    });
    // Normal completion persists the projection; replay is compiler-free and
    // hash-bound through the existing required inventory sidecar.
    const built = execution.compileNativeProject(project, { emitWat: false });
    const replay = retained.collectArtifactReport(path.join(built.outDir, 'pulse-compile.json')).capsule;
    assert.deepEqual(replay.routes.filter(row => row.path === '/same').map(row => row.behavior?.kind), ['continuing','terminal'],
      'completed inventory persists compiler behavior for passive replay');
    assert.ok(replay.references.length > 0);
    assert.equal(replay.bindings.length, 4);
    assert.equal(replay.coverage.bindings.expected, null);
    // Package-owned bindings are already resolved by the trusted lowerer. Read
    // just that canonical field, without exporting the resource's runtime key.
    const s3File = path.join(directory, 'src/s3.ts');
    write(s3File, `import {Pulse} from '@pulse-compute/pulse';import {s3} from '@pulse-compute/s3';
const app=new Pulse({auto:true});app.get('/object',async ctx=>{
const first=await s3.getText(ctx,'objects','PRIVATE_OBJECT_KEY_CANARY');
const second=await s3.head(ctx,'objects','PRIVATE_OBJECT_KEY_CANARY');return ctx.json(second);});export default app;`);
    const configFile = path.join(directory, '.pulse/config.ts');
    write(configFile, fs.readFileSync(configFile, 'utf8').replace("strict:false,defaultProfile", "strict:false,crypto:['SHA-256','HMAC-SHA256'],defaultProfile"));
    const s3Compiled = execution.compileProject({ ...resolveProject({ cwd: directory, metadataOnly: true }), entryFile: s3File });
    const s3Plan = buildCanonicalNativePlan(s3Compiled);
    const s3Projection = collectCanonicalReportReferences(s3Compiled, s3Plan);
    const s3References = s3Projection.references.filter(row => row.bindingKind === 's3');
    assert.equal(s3References.length, 1); assert.equal(s3References[0].canonicalId, 'objects');
    assert.equal(s3References[0].state, 'resolved'); assert.equal(s3References[0].entryIds.length, 1);
    assert.ok(!JSON.stringify(s3Projection).includes('PRIVATE_OBJECT_KEY_CANARY'));
    console.log(JSON.stringify({ status: 'passed', cells, retainedReplay: true, foreignOffsetRejected: true, packageBinding: true, redacted: true }));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack || error); if (error.diagnostics) console.error(JSON.stringify(error.diagnostics)); process.exitCode = 1; });
