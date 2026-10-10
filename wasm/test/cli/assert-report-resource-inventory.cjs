'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const f = require('./report-fixtures.cjs');
const root = path.resolve(__dirname, '../../..'), cli = path.join(root, 'wasm/packages/cli/src');
const { addResourceInventory } = require(path.join(f.reportRoot, 'resource-inventory'));
const { collectInventory } = require(path.join(f.reportRoot, 'inventory'));
const { addSizeEvidence } = require(path.join(f.reportRoot, 'size'));
const { createReportViewModel } = require(path.join(f.reportRoot, 'viewer/model'));
const capsule = require(path.join(f.reportRoot, 'capsule'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const execution = require(path.join(cli, 'project-execution'));
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { createNodeProviderAdapter } = require('../../../packages/provider-node/src/runtime/canonical-api-runtime');
const coverage = report => Object.fromEntries(report.resourceProducers.map(row => [row.scope, row.coverage]));
function synthetic(prepared, seed = f.fixture()) {
  addResourceInventory(seed, prepared, [f.buildId]);
  for (const row of seed.resources) row.routeIds = seed.routes.filter(route => route.composition.some(entry => row.entryIds.includes(entry))).map(row => row.id);
  seed.coverage.resources = { status: 'partial', observed: seed.resources.length, expected: null, reason: 'incomplete-mapping' };
  return capsule.createCapsule(seed);
}
const empty = { native: { manifest: { schemaCodecs: { codecs: [] }, packageRealizationArtifacts: { version: 'pulse.package-realization-artifact-set.v1', count: 0 } }, guestUnits: [] },
  reportReferences: { version: 'pulse.compiler-report-references.v1', references: [] } };
const zero = synthetic(empty, f.fixture(false)), unknown = synthetic({ native: { manifest: {} } }, f.fixture(false));
for (const scope of ['selected-embedded-assets', 'schema-codecs', 'package-guest-units', 'package-realizations']) {
  assert.equal(coverage(zero)[scope].status, 'complete'); assert.equal(coverage(zero)[scope].expected, 0);
  assert.equal(coverage(unknown)[scope].status, 'unavailable'); assert.equal(coverage(unknown)[scope].expected, null);
}
assert.equal(coverage(zero)['generated-support'].status, 'unavailable');
const unsupported = structuredClone(empty);
unsupported.native.guestUnits = [{version:'future-guest-unit',id:'PRIVATE_UNKNOWN_CANARY'}];
unsupported.native.manifest.schemaCodecs.codecs = [{}];
unsupported.reportReferences.references = [{kind:'resource',state:'unknown'}];
const partial = synthetic(unsupported, f.fixture(false));
assert.equal(coverage(partial)['package-guest-units'].expected,1);
assert.equal(coverage(partial)['package-guest-units'].status,'partial');
assert.equal(coverage(partial)['schema-codecs'].expected,1);
assert.equal(coverage(partial)['selected-embedded-assets'].expected,null);
assert.ok(!capsule.serializeCapsule(partial).includes('PRIVATE_UNKNOWN_CANARY'));
const prepared = structuredClone(empty);
prepared.native.manifest.schemaCodecs.codecs = [{ id: 'app.UpdateInput' }];
prepared.native.manifest.packageRealizationArtifacts = { version: 'pulse.package-realization-artifact-set.v1', count: 2, ids: ['PRIVATE_KEY_CANARY'], sha256: 'PRIVATE_HASH_CANARY' };
prepared.native.guestUnits = [{ version: 'pulse.guest-unit-contribution.v1', origin: 'package-prebuilt', id: 'crypto-support', owner: '@pulse-compute/crypto', packageVersion: '1.0.0', manifest: 'PRIVATE_PATH_CANARY' }];
prepared.reportReferences.references = [{ kind: 'resource', state: 'resolved', canonicalId: 'asset', resource: { encodedBytes: 16 } }];
const rich = synthetic(prepared), byKind = kind => rich.resources.find(row => row.kind === kind);
assert.equal(byKind('embedded-asset').generator.representationBytes.value, 16);
assert.equal(byKind('schema-validator').generator.representationBytes.value, rich.schemas[0].structure.descriptorBytes);
assert.equal(byKind('schema-validator').inputBytes.state, 'not-applicable');
assert.equal(byKind('schema-validator').entryIds.length, 2);
assert.equal(byKind('helper').generator.entryCoverage.expected, null);
assert.equal(coverage(rich)['package-realizations'].expected, 2);
assert.equal(coverage(rich)['package-realizations'].observed, 0);
assert.ok(!capsule.serializeCapsule(rich).includes('PRIVATE_'));
let negatives = 0;
for (const mutate of [
  c => { c.resourceProducers.pop(); },
  c => { c.resourceProducers.push(c.resourceProducers[0]); },
  c => { c.resourceProducers.find(row => row.scope === 'schema-codecs').coverage.expected = 0; },
  c => { c.resourceProducers.find(row => row.scope === 'schema-codecs').resourceIds = []; },
  c => { c.resources.find(row => row.kind === 'schema-validator').generator.representationBytes.value++; },
  c => { c.resources.find(row => row.kind === 'schema-validator').generator.schemaId = null; },
  c => { c.resources.find(row => row.kind === 'schema-validator').inputBytes = f.fact(10); },
  c => { c.resources.find(row => row.kind === 'embedded-asset').generator.representationBytes.value++; },
  c => { c.resources[0].retainedPayloadBytes = f.fact(1); c.resources[0].artifactId = f.aid; },
  c => { c.resources[0].generator.entryCoverage.observed++; },
  c => { c.resources.find(row => row.kind === 'schema-validator').routeIds = []; },
  c => { c.coverage.resources = f.coverage(c.resources.length); }
]) { const changed = structuredClone(rich); mutate(changed); assert.throws(() => capsule.createCapsule(changed)); negatives++; }
const futureSchema = structuredClone(prepared); futureSchema.native.manifest.schemaCodecs.codecs=[{id:'missing.Schema'}];
const absentSchema = synthetic(futureSchema);
assert.equal(absentSchema.resources.find(row=>row.kind==='schema-validator').generator.representationBytes.reason,'missing-evidence');
const input = structuredClone(rich), asset = input.resources.find(row => row.kind === 'embedded-asset');
input.resources.push(...[9, 100, 2000].map((value, i) => ({ ...asset, id: 'sort-' + i, inputBytes: f.fact(value), generator: { ...asset.generator, representationBytes: f.fact(value * 2) } })));
const model = createReportViewModel(input);
for (const metric of ['input', 'representation', 'retained']) for (const direction of ['asc', 'desc']) {
  Object.assign(model.state, { resourceSort: metric, resourceDir: direction });
  const values = model.sortedResources().map(row => model.factValue(metric === 'input' ? row.inputBytes : metric === 'representation' ? row.generator?.representationBytes : row.retainedPayloadBytes));
  const known = values.filter(value => value !== null), expected = [...known].sort((a,b) => direction === 'asc' ? a-b : b-a);
  assert.deepEqual(known, expected); assert.deepEqual(values.slice(known.length), Array(values.length-known.length).fill(null));
}
assert.equal(capsule.serializeCapsule(capsule.parseCapsule(capsule.serializeCapsule(rich))), capsule.serializeCapsule(rich));
const passive = `const M=require('node:module'),load=M._load;M._load=function(n,...a){if(/compiler|provider-|binaryen|typescript|child_process/.test(n))throw Error(n);return load.call(this,n,...a)};const c=require(${JSON.stringify(path.join(f.reportRoot,'capsule'))});process.stdout.write(c.serializeCapsule(c.parseCapsule(require('node:fs').readFileSync(0,'utf8'))));`;
assert.equal(execFileSync(process.execPath, ['-e', passive], { encoding: 'utf8', input: capsule.serializeCapsule(rich) }), capsule.serializeCapsule(rich));
function withoutProjection() {
  const file = path.join(cli, 'project-execution.js'), owner = new Module(file, module);
  owner.filename = file; owner.paths = Module._nodeModulePaths(path.dirname(file));
  const original = owner.require.bind(owner);
  owner.require = name => { const value = original(name); return name === '@pulse-compute/wasm-compiler/canonical-native-plan'
    ? { ...value, collectCanonicalReportReferences: () => undefined } : value; };
  owner._compile(fs.readFileSync(file, 'utf8'), file); return owner.exports;
}
async function main() {
  const responseCases = require('./report-response-payload-cases.cjs')();
  negatives += responseCases.negatives;
  const responseJson = capsule.serializeCapsule(responseCases.capsule);
  assert.equal(execFileSync(process.execPath, ['-e', passive], { encoding:'utf8', input:responseJson }), responseJson);
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/rpt8-resources-'));
  const write = (file, text) => { const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text); };
  const css = Buffer.from('/* ASSET_BODY_CANARY */\n' + '.panel{color:blue}\n'.repeat(3000));
  const js = Buffer.from('/* JAVASCRIPT_BODY_CANARY */\n' + 'globalThis.ready=true;\n'.repeat(1000));
  const cells = [];
  const inline = { css:'/* INLINE_CSS_CANARY */ body{color:blue} 😀é', js:'/* INLINE_JS_CANARY */ globalThis.ready=true;',
    html:'<!doctype html><h1>INLINE_HTML_CANARY 😀</h1>', empty:'' };
  try {
    const { createEmbeddedManifest } = await import(pathToFileURL(path.join(root,'packages/assets/dist/embedded.js')));
    const manifest = await createEmbeddedManifest([{path:'/app.css',bytes:css,contentType:'text/css'}, {path:'/app.js',bytes:js,contentType:'text/javascript'}, {path:'/unused.txt',bytes:Buffer.from('UNUSED_BODY_CANARY'),contentType:'text/plain'}]);
    write('.pulse/config.ts', "import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(scope=>({pulse:{entry:'src/index.ts',strict:false,defaultProfile:'native'},native:{host:'node',target:'native',outDir:'dist'}}));");
    const lookup = key => `async ctx=>{const asset=await assets.lookup(ctx,'embedded','${key}',{embeddedManifest:${JSON.stringify(JSON.stringify(manifest))}});return asset;}`;
    const inlineRoutes=Object.entries(inline).map(([key,value])=>`app.get('/inline/${key}',async ctx=>ctx.text(${JSON.stringify(value)},{headers:{'content-type':${JSON.stringify(key==='empty'?'text/plain':key==='js'?'text/javascript':'text/'+key)}}}));`).join('');
    write('src/index.ts', `import {Pulse} from '@pulse-compute/pulse';import {assets} from '@pulse-compute/assets';const app=new Pulse({auto:true});const style=${lookup('/app.css')};app.get('/a.css',style);app.get('/b.css',style);app.get('/app.js',${lookup('/app.js')});${inlineRoutes}
app.get('/inline/const',async ctx=>{const payload=${JSON.stringify(inline.html)};return ctx.text(payload,{headers:{'content-type':'text/html; charset=utf-8'}});});
app.get('/inline/dynamic',async ctx=>ctx.text(ctx.req.header('x-body')||''));export default app;`);
    const project = resolveProject({cwd:directory,metadataOnly:true}), controlOwner = withoutProjection();
    for (const optimization of ['default','experimental-native-bounded-size']) {
      const options = {emitWat:false,nativeOptimization:optimization==='default'?undefined:optimization};
      const control = controlOwner.compileNativeProjectInMemory(project,options), observed = execution.compileNativeProjectInMemory(project,options);
      assert.deepEqual(observed.plan,control.plan);assert.equal(observed.native.source,control.native.source);assert.deepEqual(observed.native.wasm,control.native.wasm);
      for (const compiled of [control,observed]) for (const [url,expected] of [['/a.css',css],['/b.css',css],['/app.js',js]]) {
        const response=(await executeCanonicalNativeModule(compiled.native,{request:{method:'GET',path:url},providerAdapter:createNodeProviderAdapter({})})).response;
        assert.equal(response.status,200);assert.deepEqual(Buffer.from(await new Response(response.bodyStream).arrayBuffer()),expected);
      }
      for (const compiled of [control,observed]) for (const [key,expected] of [...Object.entries(inline),['const',inline.html],['dynamic','']]) {
        const response=(await executeCanonicalNativeModule(compiled.native,{request:{method:'GET',path:'/inline/'+key},providerAdapter:createNodeProviderAdapter({})})).response;
        assert.equal(response.status,200);assert.equal(response.body,expected);
      }
      const physical = { ...observed.native.manifest.wasm, id:capsule.artifactId(observed.native.manifest.wasm.sha256), stage:'final',target:'portable-native-wasm' };
      const report=addSizeEvidence(collectInventory(project,observed,[physical],physical.id,optimization),new Map([[physical.id,observed.native.wasm]]),observed.native.reportAttribution);
      assert.equal(report.resources.filter(row=>row.kind==='embedded-asset').length,2);assert.equal(coverage(report)['selected-embedded-assets'].expected,2);
      const style=report.resources.find(row=>row.name==='/app.css');assert.equal(style.inputBytes.value,css.length);assert.equal(style.generator.representationBytes.value,css.toString('base64').length);assert.equal(style.routeIds.length,2);
      const payloads=report.resources.filter(row=>row.kind==='response-payload');
      for (const [key,value] of [...Object.entries(inline),['const',inline.html]]) {
        const route=report.routes.find(row=>row.path==='/inline/'+key);
        const payload=payloads.find(row=>row.routeIds.includes(route.id));
        assert.ok(payload,'retained response site for '+key);assert.equal(payload.inputBytes.value,Buffer.byteLength(value,'utf8'));
        assert.equal(payload.mediaType,key==='empty'?'text/plain':key==='const'?'text/html':key==='js'?'text/javascript':'text/'+key);
      }
      const dynamicRoute=report.routes.find(row=>row.path==='/inline/dynamic');
      assert.equal(payloads.find(row=>row.routeIds.includes(dynamicRoute.id)).inputBytes.reason,'dynamic-reference');
      assert.equal(coverage(report)['canonical-text-responses'].expected,payloads.length);
      assert.ok(report.resources.every(row=>row.retainedPayloadBytes.value===null));
      const artifact=report.artifacts[0];assert.equal(8+artifact.sections.reduce((n,row)=>n+row.bytes,0),physical.bytes);
      const bodies=report.measurements.filter(row=>row.metric==='handler-body');assert.ok(bodies.every(row=>row.fact.state==='available'&&row.fact.value<css.length));
      const saved=capsule.serializeCapsule(report);assert.ok(!/BODY_CANARY|INLINE_.*CANARY|embeddedData|embeddedManifest/.test(saved));
      cells.push({optimization,resources:report.resources.length,responseSites:payloads.length,handlerBytes:bodies.map(row=>row.fact.value),inputBytes:css.length+js.length,physicalBytes:physical.bytes,unchanged:true});
    }
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  console.log(JSON.stringify({status:'passed',negativeCases:negatives,passiveReplay:true,cells}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
