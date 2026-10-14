'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..'), cli = path.join(root, 'wasm/packages/cli/src');
const execution = require(path.join(cli, 'project-execution'));
const { resolveProject } = require(path.join(cli, 'project-config'));
const report = require(path.join(cli, 'internal/report/retained'));
const snapshots = require(path.join(cli, 'internal/report/snapshot'));
const { sourceInputsForCompiled } = require('../../packages/compiler/src/canonical-project-compiler');
const { captureSources, readSources } = require(path.join(cli, 'internal/report/source-inputs'));
const { serializeCapsule } = require(path.join(cli, 'internal/report/capsule'));
const { setup } = require('../support/report-analytics-fixture.cjs');
const results = path.join(root, 'wasm/.test-results'); fs.mkdirSync(results, { recursive: true });
const directory = fs.mkdtempSync(path.join(results, 'an9-04-'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const reject = fn => assert.throws(fn, error => /^REPORT_/.test(error.code));
try {
  setup(directory, 'http');
  const logical = path.join(directory, 'node_modules/@fixture/analytics');
  const installed = path.join(directory, 'node_modules/.pnpm/analytics/node_modules/@fixture/analytics');
  fs.mkdirSync(path.dirname(installed), { recursive: true }); fs.renameSync(logical, installed);
  fs.symlinkSync(path.relative(path.dirname(logical), installed), logical, 'dir');
  fs.renameSync(path.join(installed, 'index.ts'), path.join(installed, 'body.ts'));
  fs.symlinkSync('body.ts', path.join(installed, 'alias.ts'));
  write(path.join(installed, 'index.ts'), "export { sharedLookup, packageHandler } from './alias.ts';\nexport { extra } from '@fixture/nested';\n");
  const nested = path.join(installed, 'node_modules/@fixture/nested');
  write(path.join(nested, 'package.json'), JSON.stringify({ name: '@fixture/nested', version: '1.0.0', type: 'module', exports: './index.ts' }));
  write(path.join(nested, 'index.ts'), 'export function extra(value: string): string { return value; }');
  write(path.join(installed, 'unused.txt'), 'PRIVATE_UNUSED_PACKAGE_FILE_CANARY');
  const resolve = () => resolveProject({ cwd: directory, metadataOnly: true });
  const control = execution.compileNativeProjectInMemory(resolve(), { emitWat: false });
  const disabled = `const fs=require('node:fs'),M=require('node:module'),load=M._load;M._load=function(name,...args){if(/(?:^|\\/)report-source-inputs$/.test(name))return {readSourceInput:(_,file)=>fs.readFileSync(file,'utf8'),missingManifest(){},sourceResolution(){},retainSourceInputs(){},sourceInputsForCompiled(){}};return load.call(this,name,...args);};const p=require(${JSON.stringify(path.join(cli, 'project-config'))}).resolveProject({cwd:process.argv[1],metadataOnly:true});const c=require(${JSON.stringify(path.join(cli, 'project-execution'))}).compileNativeProjectInMemory(p,{emitWat:false});const hash=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');process.stdout.write(JSON.stringify([hash(c.native.source),hash(JSON.stringify(c.plan)),hash(c.native.wasm)]));`;
  const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', disabled, directory], { encoding: 'utf8' })),
    [hash(control.native.source), hash(JSON.stringify(control.plan)), hash(control.native.wasm)], 'read receipts do not change plan, executable source or Wasm');
  const built = execution.compileNativeProject(resolve(), { emitWat: false });
  assert.ok(built.manifest.reportCompletion, JSON.stringify(built.manifest.reportEvidence));
  assert.deepEqual(fs.readFileSync(built.files.nativeWasm), control.native.wasm);
  const inputs = JSON.parse(fs.readFileSync(path.join(built.outDir, report.INPUTS_FILE)));
  assert.ok(inputs.sourceInputs.some(r => r.kind === 'missing-manifest'));
  assert.ok(inputs.sourceInputs.some(r => r.kind === 'source-link' && r.location.file.endsWith('/alias.ts') && r.sha256 === null));
  assert.ok(inputs.sourceInputs.some(r => r.kind === 'source' && r.identity.startsWith('npm/@fixture/nested@')));
  assert.ok(!JSON.stringify(inputs).includes('PRIVATE_UNUSED_PACKAGE_FILE_CANARY'));
  assert.ok(!JSON.stringify(inputs.sourceInputs).includes(directory));
  assert.ok(!inputs.sourceInputs.some(r => r.location.file.endsWith('unused.txt')));
  const current = report.collectProjectReport({ cwd: directory });
  const artifact = report.collectArtifactReport(built.files.manifest);
  assert.equal(current.currentSnapshotMatched, true);
  assert.deepEqual(current.capsule.analytics, artifact.capsule.analytics);
  assert.ok(artifact.capsule.analytics.associations.length > 0);
  // Current mode admits only the bounded configuration parser, never a source
  // compiler/provider; artifact mode admits no compiler at all.
  const script = `const M=require('node:module'),load=M._load;M._load=function(name,...args){if((/compiler/.test(name)&&!(process.argv[2]==='current'&&name==='@pulse-compute/wasm-compiler/project-config-compiler'))||(name==='typescript'&&process.argv[2]!=='current')||/provider-|project-config$|project-execution|child_process|^(node:)?(http|https|net)$/.test(name))throw Error('Unexpected work: '+name);return load.call(this,name,...args);};const fs=require('node:fs');for(const key of ['writeFileSync','appendFileSync','unlinkSync','renameSync','mkdirSync','rmSync'])fs[key]=()=>{throw Error('Unexpected write: '+key)};const r=require(${JSON.stringify(path.join(cli, 'internal/report/retained'))});process.stdout.write(JSON.stringify((process.argv[2]==='current'?r.collectProjectReport({cwd:process.argv[1]}):r.collectArtifactReport(process.argv[1])).capsule.analytics));`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script, directory, 'current'], { encoding: 'utf8' })), artifact.capsule.analytics);
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', script, built.files.manifest, 'artifact'], { encoding: 'utf8' })), artifact.capsule.analytics);
  write(path.join(installed, 'unused.txt'), 'unrelated edit');
  assert.equal(report.collectProjectReport({ cwd: directory }).currentSnapshotMatched, true);
  for (const file of [path.join(installed, 'body.ts'), path.join(installed, 'package.json'), path.join(nested, 'index.ts')]) {
    const before = fs.readFileSync(file); fs.appendFileSync(file, '\n');
    reject(() => report.collectProjectReport({ cwd: directory }));
    assert.deepEqual(report.collectArtifactReport(built.files.manifest).capsule.analytics, artifact.capsule.analytics);
    fs.writeFileSync(file, before);
  }
  // A closer installed package would change canonical resolution even though
  // the previously selected package's bytes have not changed.
  const nearer = path.join(directory, 'src/node_modules/@fixture/analytics/package.json');
  write(nearer, fs.readFileSync(path.join(installed, 'package.json')));
  reject(() => report.collectProjectReport({ cwd: directory })); fs.rmSync(path.join(directory, 'src/node_modules'), { recursive: true });
  const alias = path.join(installed, 'alias.ts');
  write(path.join(installed, 'other.ts'), fs.readFileSync(path.join(installed, 'body.ts')));
  fs.unlinkSync(alias); fs.symlinkSync('other.ts', alias);
  reject(() => report.collectProjectReport({ cwd: directory }));
  fs.unlinkSync(alias); fs.symlinkSync('body.ts', alias);
  const alternate = path.join(directory, 'node_modules/.pnpm/alternate/node_modules/@fixture/analytics');
  fs.cpSync(installed, alternate, { recursive: true, verbatimSymlinks: true });
  fs.unlinkSync(logical); fs.symlinkSync(path.relative(path.dirname(logical), alternate), logical, 'dir');
  reject(() => report.collectProjectReport({ cwd: directory }));
  fs.unlinkSync(logical); fs.symlinkSync(path.relative(path.dirname(logical), installed), logical, 'dir');
  const project = resolve(), attempt = snapshots.beginSnapshot(project, {}, built.outDir), compiled = execution.compileProject(project);
  const file = path.join(installed, 'body.ts'), bytes = fs.readFileSync(file);
  fs.appendFileSync(file, '\n'); fs.writeFileSync(file, bytes);
  assert.throws(() => snapshots.finishSnapshot(project, attempt, compiled), { code: 'REPORT_CONCURRENT_CHANGE' });
  const fresh = execution.compileProject(resolve()), workspace = snapshots.workspaceControls(directory);
  const recorded = captureSources(directory, sourceInputsForCompiled(fresh), workspace);
  const bad = structuredClone(recorded.records); bad.find(r => r.kind === 'source').location.file = '../escape.ts';
  reject(() => readSources(directory, bad, workspace));
  const outside = structuredClone(recorded.records); outside[0].location.up = workspace.depth + 1;
  reject(() => readSources(directory, outside, workspace));
  const unknown = structuredClone(recorded.records); unknown[0].body = 'PRIVATE_SOURCE';
  reject(() => readSources(directory, unknown, workspace));
  reject(() => readSources(directory, null, workspace));
  reject(() => readSources(directory, Array(20001).fill(recorded.records[0]), workspace));
  const oversized = structuredClone(recorded.records); oversized.find(r => r.kind === 'source').bytes = 256 * 1024 * 1024 + 1;
  assert.throws(() => readSources(directory, oversized, workspace), { code: 'REPORT_LIMIT' });
  const inventoryFile = path.join(built.outDir, report.INVENTORY_FILE), inventory = fs.readFileSync(inventoryFile);
  const tampered = structuredClone(require(path.join(cli, 'internal/report/capsule')).parseCapsule(inventory)); tampered.analytics.associations[0].useSiteId = 'missing';
  fs.writeFileSync(inventoryFile, JSON.stringify(tampered)); reject(() => report.collectArtifactReport(built.files.manifest));
  fs.writeFileSync(inventoryFile, inventory);
  fs.renameSync(file, file + '.saved'); reject(() => report.collectProjectReport({ cwd: directory })); fs.renameSync(file + '.saved', file);
  const beforeRemoval = serializeCapsule(report.collectArtifactReport(built.files.manifest).capsule);
  fs.rmSync(path.join(directory, 'src'), { recursive: true }); fs.rmSync(path.join(directory, 'node_modules'), { recursive: true });
  assert.equal(serializeCapsule(report.collectArtifactReport(built.files.manifest).capsule), beforeRemoval, 'artifact replay survives absent sources and packages');
  console.log(JSON.stringify({ status: 'passed', importedCompletion: true, nestedPackages: true, passiveCurrentAndArtifact: true,
    exactInputsOnly: true, sourceAndManifestEdits: true, nearerPackageShadowing: true, linkRetargeting: true,
    concurrentRestoreRejected: true, tamperedAnalyticsRejected: true, sourceFreeArtifactReplay: true }));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
