#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function verifyClosure(packedRoot, releaseDir, manifest) {
  // Only the supervisor loads workspace packaging helpers. The consumer below
  // loads all product behavior through the installed package exports.
  const {readTarEntries} = require('../../../scripts/pack-release.cjs');
  const sourceBytes = fs.readFileSync(path.join(releaseDir, 'pulse-source-release-catalog.json'));
  const catalog = JSON.parse(sourceBytes);
  assert.equal(sha256(sourceBytes), manifest.sourceCatalog.sha256);
  assert.equal(manifest.packageCount, 19);
  assert.equal(manifest.packages.length, manifest.packageCount);
  assert.deepEqual(manifest.packages.map(p => p.name).sort(), catalog.packages.map(p => p.name).sort());
  assert.equal(new Set(manifest.packages.map(p => p.name)).size, 19);
  for (const entry of manifest.packages) {
    assert.equal(entry.version, catalog.releaseVersion);
    assert.equal(path.basename(entry.tarball), entry.tarball);
    const tarball = path.join(releaseDir, entry.tarball);
    assert.equal(sha256(fs.readFileSync(tarball)), entry.sha256, `${entry.name}: stale or altered tarball`);
    const packageRoot = path.join(packedRoot, 'node_modules', entry.name);
    assert.equal(fs.realpathSync(packageRoot), packageRoot, 'Pulse packages must not be symlinks');
    const expected = new Set();
    for (const [name, bytes] of readTarEntries(tarball)) {
      const relative = name.replace(/^package\//, '').replace(/(^|\/)\.gitignore$/, '$1.npmignore');
      const file = path.join(packageRoot, relative);
      assert.ok(file.startsWith(packageRoot + path.sep));
      assert.equal(fs.realpathSync(file), file, 'No linked installed files');
      assert.deepEqual(fs.readFileSync(file), bytes, `${entry.name}/${relative}: installed bytes differ`);
      expected.add(relative);
    }
    const visit = (dir, prefix = '') => {
      for (const file of fs.readdirSync(dir, {withFileTypes: true})) {
        const relative = prefix + file.name;
        assert.equal(file.isSymbolicLink(), false, 'No linked package content');
        if (file.isDirectory()) visit(path.join(dir, file.name), relative + '/');
        else assert.ok(expected.has(relative), `${entry.name}/${relative}: unsealed extra file`);
      }
    };
    visit(packageRoot);
  }
}

async function main() {
  const execute = process.argv[2] === '--execute';
  const [rootArgument, releaseArgument] = process.argv.slice(execute ? 3 : 2);
  assert.ok(rootArgument && releaseArgument, 'Usage: assert-request-deadline-packages.cjs <isolated-install> <release-pack>');
  const packedRoot = fs.realpathSync(rootArgument), releaseDir = fs.realpathSync(releaseArgument);
  const repoRoot = path.resolve(__dirname, '../../..');
  assert.ok(packedRoot !== repoRoot && !packedRoot.startsWith(repoRoot + path.sep));
  assert.equal(process.env.NODE_PATH, undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, 'pulse-release-manifest.json')));

  if (!execute) {
    verifyClosure(packedRoot, releaseDir, manifest);
    assert.throws(() => verifyClosure(packedRoot, releaseDir, {...manifest, packages: manifest.packages.slice(1)}));
    const stale = structuredClone(manifest);
    stale.packages[0].sha256 = '0'.repeat(64);
    assert.throws(() => verifyClosure(packedRoot, releaseDir, stale), /stale or altered tarball/);
    const child = spawnSync(process.execPath, [__filename, '--execute', packedRoot, releaseDir], {
      cwd: packedRoot, env: process.env, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'passed');
    verifyClosure(packedRoot, releaseDir, manifest);
    console.log(JSON.stringify({...result, schemaVersion:'pulse.request-deadline-packed.v1',
      packageCount:manifest.packageCount, packages:manifest.packages.map(({name,version,sha256})=>({name,version,sha256})),
      installedBytesUnchanged:true, incompleteClosureRejected:true, alteredTarballRejected:true}));
    return;
  }

  const installed = createRequire(path.join(packedRoot, 'package.json'));
  const load = name => {
    assert.ok(fs.realpathSync(installed.resolve(name)).startsWith(path.join(packedRoot, 'node_modules') + path.sep));
    return installed(name);
  };
  const typeFile = path.join(packedRoot, 'request-deadline-types.ts');
  fs.writeFileSync(typeFile, `import {fastly} from '@pulse-compute/provider-fastly';
import {createRequestBudget} from '@pulse-compute/runtime/host';
const config = fastly({maxDurationMs: 10000});
const budget = createRequestBudget({maxDurationMs: 10000});
budget.check(); budget.close(); void config;
`);
  const ts = load('typescript');
  const program = ts.createProgram([typeFile], {noEmit:true,strict:true,skipLibCheck:false,types:[],
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext});
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName:n=>n,getCurrentDirectory:()=>packedRoot,getNewLine:()=>'\n',
  }));

  const results = await require('../runtime/request-budget-transport.cjs').main({packedRoot,quiet:true});
  const execution = load('@pulse-compute/cli/project-execution');
  const {resolveProject} = load('@pulse-compute/cli/project-config');
  const project = resolveProject({cwd:packedRoot,profile:'fastly-native'});
  const plan = execution.compileNativeProjectInMemory(project).plan;
  const {inspectFastlyCanonicalTarget} = load('@pulse-compute/provider-fastly/build/canonical-target');
  const options = {plan,providerConfig:project.providerConfig,cwd:packedRoot,canonicalBuild:true};
  const {native} = inspectFastlyCanonicalTarget(options);
  assert.equal(sha256(native.wasm), results.fastlyWasmSha256, 'Regenerated exact-package Wasm must match');
  assert.throws(() => inspectFastlyCanonicalTarget({...options,native,
    providerConfig:{...project.providerConfig,maxDurationMs:9999}}), {code:'PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH'});
  const {fastlyJavascriptProjectRestrictions} = load('@pulse-compute/provider-fastly/javascript/target-support-policy');
  assert.throws(() => fastlyJavascriptProjectRestrictions({},project), {code:'PULSE_REQUEST_DURATION_UNSUPPORTED'});

  const hostFixtures = new Set(['native-platform-capabilities-host.js','conditional-kv-host.js']
    .map(file => path.join(repoRoot,'packages/provider-fastly/src/testing',file)));
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(path.join(repoRoot,'packages') + path.sep)
      || file.startsWith(path.join(repoRoot,'wasm/packages') + path.sep)) assert.ok(hostFixtures.has(file), `Workspace product module loaded: ${file}`);
    if (file.includes('/node_modules/@pulse-compute/')) assert.ok(file.startsWith(path.join(packedRoot,'node_modules') + path.sep));
  }
  console.log(JSON.stringify({status:'passed',results,publicTypes:'passed',workspaceProductModules:0,
    providerReality:false,staleArtifactRejected:true,fastlyJavascriptRejected:true,regeneratedArtifactMatches:true}));
}

module.exports = {verifyClosure};
if (require.main === module) main().catch(error => {console.error(error.stack || error);process.exitCode=1;});
