#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const cli = path.join(root, 'wasm/packages/cli/src');
const report = require(path.join(cli, 'internal/report/retained'));
const snapshots = require(path.join(cli, 'internal/report/snapshot'));
const capsule = require(path.join(cli, 'internal/report/capsule'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const execution = require(path.join(cli, 'project-execution'));
const { sha256, canonicalJson } = require(path.join(cli, 'internal/report/data'));
let negative = 0;
function rejects(fn, code) { negative++; assert.throws(fn, error => { if (code && error.code !== code) console.error(error.stack); return !code || error.code === code; }); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
async function main() {
  const directory = fs.mkdtempSync(path.join(root, 'wasm/.test-results/prpt02-'));
  try {
    const { createEmbeddedManifest } = await import(pathToFileURL(path.join(root, 'packages/assets/dist/embedded.js')));
    const embedded = await createEmbeddedManifest([{ path: '/logo.txt', bytes: Buffer.from('ASSET_BODY_CANARY'), contentType: 'text/plain' }]);
    const configFile = path.join(directory, '.pulse/config.ts'), entryFile = path.join(directory, 'src/index.ts');
    const schemaFile = path.join(directory, 'src/schemas.ts'), testsFile = path.join(directory, 'tests/harness.ts');
    const config = `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((scope)=>({pulse:{strict:false,entry:'src/index.ts',schema:'src/schemas.ts',tests:'tests/harness.ts',defaultProfile:'native'},native:{host:'node',target:'native',outDir:'dist',token:scope.secret('TOKEN'),dev:{secrets:{TOKEN:'SECRET_VALUE_CANARY'}}},fastly:{host:'fastly',target:'native',outDir:'dist',token:scope.secret('TOKEN'),fastly:{maxDurationMs:1000,bindings:{secretStore:'test-secrets'}}},js:{host:'node',target:'javascript',outDir:'dist'}}));`;
    write(configFile, config);
    write(schemaFile, `import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';export interface Input{name:string;enabled?:boolean};export default defineSchemaRegistry({schemas:{'app.Input':schema<Input>()}});`);
    // Neither metadata resolution nor report collection may import this module.
    write(testsFile, `throw new Error('TEST_HARNESS_EXECUTED');export default [];`);
    const source = `import {Pulse} from '@pulse-compute/pulse';import type {Input} from './schemas.js';import {assets} from '@pulse-compute/assets';const app=new Pulse({auto:true});
app.use(async (ctx,next)=>{return next();});
async function shared(ctx){return ctx.text('shared');}
app.get('/same',async (ctx,next)=>{return next();});app.get('/same',shared);app.get('/shared',shared);
app.post('/schema',async ctx=>{const input=await ctx.req.json<Input>('app.Input');const token=await ctx.secret.get('TOKEN');return ctx.json({name:input.name,tokenPresent:token!==undefined});});
app.get('/asset',async ctx=>{const asset=await assets.lookup(ctx,'embedded','/logo.txt',{embeddedManifest:${JSON.stringify(JSON.stringify(embedded))}});return asset;});
export default app;`;
    write(entryFile, source);
    const resolve = (options = {}) => resolveProject({ cwd: directory, metadataOnly: true, ...options });
    const project = resolve();
    assert.equal(project.tests.length, 0); assert.equal(project.configParity.status, 'not-evaluated');
    // Bind to the exact graph inputs even when the filesystem snapshot is stable.
    const workspaceFixture = path.join(directory, '.pulse-workspace-fixture');
    write(path.join(workspaceFixture, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    fs.mkdirSync(path.join(workspaceFixture, 'child'));
    const workspaceBefore = snapshots.workspaceControls(path.join(workspaceFixture, 'child'));
    fs.appendFileSync(path.join(workspaceFixture, 'package.json'), '\n');
    rejects(() => snapshots.sameSnapshot(workspaceBefore, snapshots.workspaceControls(path.join(workspaceFixture, 'child'))), 'REPORT_STALE_INPUTS');
    const freshAttempt = snapshots.beginSnapshot(resolve(), {}, path.join(directory, 'dist'));
    const forged = { watchFiles: [], reachableGraph: { modules: [{ kind: 'project', path: 'src/index.ts', contentHash: '0'.repeat(64) }] } };
    rejects(() => snapshots.finishSnapshot(resolve(), freshAttempt, forged), 'REPORT_STALE_INPUTS');
    const control = execution.compileNativeProjectInMemory(project);
    const started = Date.now(), built = execution.compileNativeProject(project);
    const buildMs = Date.now() - started;
    assert.equal(built.native.wasm.sha256, control.native.manifest.wasm.sha256, 'passive evidence preserves exact guest bytes');
    assert.ok(built.manifest.reportCompletion, JSON.stringify(built.manifest.reportEvidence));
    const reportStarted = Date.now(), collected = report.collectProjectReport({ cwd: directory });
    const reportMs = Date.now() - reportStarted;
    const saved = capsule.serializeCapsule(collected.capsule), c = collected.capsule;
    assert.equal(collected.currentSnapshotMatched, true);
    assert.ok(c.artifacts.every(row => row.sectionCoverage.status === 'complete'));
    assert.ok(c.measurements.some(row => row.metric === 'handler-body' && row.fact.state === 'available'));
    assert.equal(c.routes.length, 5); assert.equal(c.entries.length, 6);
    assert.equal(c.routes[1].handlerId, c.routes[2].handlerId); assert.notEqual(c.routes[0].id, c.routes[1].id);
    assert.equal(c.routes[0].composition.length, 2); assert.equal(c.routes[0].compositionCoverage, 'bounded');
    assert.equal(c.entries[0].kind, 'middleware'); assert.ok(c.entries[0].flow.nextEntryId);
    assert.equal(c.schemas[0].structure.topLevelKeys, 2); assert.equal(c.schemas[0].structure.requiredKeys, 1);
    assert.equal(c.schemas[0].routeIds.length, 1, 'schema references have canonical entry joins');
    assert.ok(c.bindings.some(row => row.kind === 'secret' && row.name === 'TOKEN' && row.declared && row.referenced));
    assert.equal(c.resources.length, 1); assert.equal(c.resources[0].inputBytes.value, 17);
    assert.equal(c.resources[0].retainedPayloadBytes.value, null);
    assert.equal(c.evidence.filter(row => row.kind === 'test').length, 0);
    assert.ok(!saved.includes('VALUE_CANARY') && !saved.includes('BODY_CANARY') && !saved.includes(directory));
    const manifestFile = path.join(built.outDir, 'pulse-compile.json');
    assert.equal(capsule.serializeCapsule(report.collectArtifactReport(manifestFile).capsule), saved);
    assert.equal(report.collectArtifactReport(manifestFile).currentSnapshotMatched, false);
    const attributionFile = path.join(built.outDir, report.ATTRIBUTION_FILE), attributionBytes = fs.readFileSync(attributionFile);
    fs.unlinkSync(attributionFile);
    const noOptional = report.collectArtifactReport(manifestFile);
    assert.deepEqual(noOptional.missingOptionalSidecars, ['attribution']);
    assert.ok(noOptional.capsule.measurements.every(row => row.fact.state === 'unavailable'));
    assert.ok(noOptional.capsule.artifacts.every(row => row.sectionCoverage.status === 'complete'));
    fs.writeFileSync(attributionFile, Buffer.from('{}')); rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_ARTIFACT_HASH');
    fs.writeFileSync(attributionFile, attributionBytes);
    const savedFile = path.join(built.outDir, 'saved-report.json'); fs.writeFileSync(savedFile, saved);
    assert.equal(report.collectArtifactReport(savedFile).kind, 'historical-capsule');
    rejects(() => report.collectProjectReport({ cwd: directory, profile: 'fastly' }), 'REPORT_IDENTITY');
    rejects(() => report.collectProjectReport({ cwd: directory, optimization: 'experimental-native-size' }), 'REPORT_STALE_INPUTS');
    for (const file of [entryFile, schemaFile, configFile, testsFile]) {
      const original = fs.readFileSync(file); fs.appendFileSync(file, '\n// changed');
      rejects(() => report.collectProjectReport({ cwd: directory }), 'REPORT_STALE_INPUTS');
      fs.writeFileSync(file, original);
    }
    // Fresh project matching needs no executable resolution; old artifact mode
    // remains a snapshot even when config is syntactically broken or absent.
    fs.renameSync(configFile, configFile + '.saved');
    assert.equal(capsule.serializeCapsule(report.collectArtifactReport(manifestFile).capsule), saved);
    fs.renameSync(configFile + '.saved', configFile);
    const wasmFile = path.join(built.outDir, built.manifest.native.wasm.file), originalWasm = fs.readFileSync(wasmFile);
    fs.writeFileSync(wasmFile, Buffer.from('bad')); rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_ARTIFACT_HASH');
    fs.writeFileSync(wasmFile, originalWasm);
    const markerFile = path.join(built.outDir, report.COMPLETION_FILE), markerBytes = fs.readFileSync(markerFile);
    fs.unlinkSync(markerFile); rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_MISSING_ARTIFACT');
    fs.writeFileSync(markerFile, markerBytes);
    const inventoryFile = path.join(built.outDir, report.INVENTORY_FILE), originalInventory = fs.readFileSync(inventoryFile);
    fs.writeFileSync(inventoryFile, Buffer.from('{}')); rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_ARTIFACT_HASH');
    fs.writeFileSync(inventoryFile, originalInventory);
    fs.unlinkSync(inventoryFile); rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_MISSING_ARTIFACT');
    fs.writeFileSync(inventoryFile, originalInventory);
    fs.renameSync(inventoryFile, inventoryFile + '.real'); fs.symlinkSync(inventoryFile + '.real', inventoryFile);
    rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_PATH');
    fs.unlinkSync(inventoryFile); fs.renameSync(inventoryFile + '.real', inventoryFile);
    const release = report.acquireBuildLock(resolve(), built.outDir);
    const replacement = report.acquireBuildLock(resolve(), built.outDir);
    rejects(() => release.verify(), 'REPORT_CONCURRENT_BUILD'); release();
    replacement.verify(); replacement();
    assert.deepEqual(fs.readdirSync(path.join(directory, '.pulse-report-locks')), []);
    const raceProject = resolve(), attempt = snapshots.beginSnapshot(raceProject, {}, built.outDir);
    const original = fs.readFileSync(entryFile); fs.appendFileSync(entryFile, '\n// transient'); fs.writeFileSync(entryFile, original);
    rejects(() => snapshots.finishSnapshot(raceProject, attempt, control.compiled), 'REPORT_CONCURRENT_CHANGE');
    // No-clean failure invalidates completion before the Native compiler starts.
    rejects(() => execution.compileNativeProject(resolve(), { clean: false, onNativePlan() { throw Object.assign(new Error('interrupted'), { code: 'TEST_INTERRUPT' }); } }), 'TEST_INTERRUPT');
    assert.equal(fs.existsSync(path.join(built.outDir, report.COMPLETION_FILE)), false);
    rejects(() => report.collectArtifactReport(manifestFile), 'REPORT_MISSING_ARTIFACT');
    assert.equal(capsule.serializeCapsule(report.collectArtifactReport(savedFile).capsule), saved);
    const unavailable = report.beginBuild(raceProject, {}, built.outDir);
    assert.equal(unavailable.error, 'REPORT_CONCURRENT_CHANGE', 'stale resolution disables evidence without changing ordinary build admission');
    assert.equal(fs.existsSync(path.join(built.outDir, report.COMPLETION_FILE)), false);
    // The provider-final path is separately verified and never borrows the
    // portable hash. This build also proves recovery after the failed attempt.
    const fastly = execution.buildProject(resolve({ profile: 'fastly' }));
    const provider = report.collectProjectReport({ cwd: directory, profile: 'fastly' });
    assert.equal(provider.capsule.context.host, 'fastly');
    assert.ok(provider.capsule.measurements.some(row => row.artifactId === provider.capsule.context.primaryArtifactId && row.metric === 'handler-body' && row.fact.state === 'available'));
    assert.ok(!JSON.stringify(provider.capsule).includes('__pulse_chunk_'));
    assert.equal(provider.capsule.artifacts.length, 2);
    assert.equal(provider.capsule.artifacts.find(row => row.id === provider.capsule.context.primaryArtifactId).sha256, fastly.manifest.providerTarget.wasm.sha256);
    const repeated = report.collectProjectReport({ cwd: directory, profile: 'fastly' });
    assert.equal(repeated.capsule.evidenceHash.value, provider.capsule.evidenceHash.value);
    // Artifact replay has no compiler, provider, harness, subprocess or network
    // imports. Read the actual build, not a hand-made manifest fixture.
    const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/compiler|provider-|typescript|project-config|project-execution|child_process|^(node:)?(http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};const r=require(${JSON.stringify(path.join(cli, 'internal/report/retained'))});process.stdout.write(r.collectArtifactReport(process.argv[1]).capsule.evidenceHash.value);`;
    assert.equal(execFileSync(process.execPath, ['-e', script, path.join(fastly.outDir, 'pulse-build.json')], { encoding: 'utf8' }), provider.capsule.evidenceHash.value);
    const projectScript = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if(/canonical-(project|api|native)|provider-drivers|provider-.*toolchain|typescript-module-loader|project-execution|child_process|^(node:)?(http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};const fs=require('node:fs');for(const key of ['writeFileSync','appendFileSync','unlinkSync','renameSync','mkdirSync','rmSync'])fs[key]=()=>{throw Error('Unexpected write: '+key)};const r=require(${JSON.stringify(path.join(cli, 'internal/report/retained'))});process.stdout.write(r.collectProjectReport({cwd:process.argv[1],profile:'fastly'}).capsule.evidenceHash.value);`;
    assert.equal(execFileSync(process.execPath, ['-e', projectScript, directory], { encoding: 'utf8' }), provider.capsule.evidenceHash.value);
    const inventoryCases = require('./report-inventory-cases.cjs')();
    const summary = { inventoryCases, status: 'passed', negativeCases: negative, nativeCompiles: 3, portableGuestUnchanged: true,
      routes: c.routes.length, entries: c.entries.length, schemas: c.schemas.length, bindings: c.bindings.length, resources: c.resources.length,
      providerArtifacts: provider.capsule.artifacts.length, buildMs, reportMs,
      capsuleBytes: Buffer.byteLength(saved), inputSidecarBytes: fs.statSync(path.join(fastly.outDir, report.INPUTS_FILE)).size,
      portableSha256: built.native.wasm.sha256, providerSha256: fastly.manifest.providerTarget.wasm.sha256 };
    console.log(JSON.stringify(summary));
    if (process.env.PRPT02_VALIDATION_FILE) fs.writeFileSync(process.env.PRPT02_VALIDATION_FILE, JSON.stringify(summary, null, 2) + '\n');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
