'use strict';
// Runs only in an exact packed installation outside the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cell = process.argv[2];
const cwd = process.cwd();
const compiler = '@pulse-compute/wasm-compiler';
const contracts = '@pulse-compute/wasm-contracts';
const report = { status: 'running', cell, providerRealityValidated: false };
const run = args => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });

// Block just a declared package boundary in a fresh process. A checkout-relative
// recovery would load successfully and fail this assertion, including when the
// original error is an inaccessible export rather than a missing package.
if (cell === 'deny') {
  const [entry, request, code] = process.argv.slice(3);
  const Module = require('node:module');
  const load = Module._load;
  const denied = Object.assign(new Error('ARC-01 denied declared dependency'), { code });
  Module._load = function (name, ...args) {
    if (name === request && args[0]?.filename === require.resolve(entry)) throw denied;
    return load.call(this, name, ...args);
  };
  assert.throws(() => require(entry), error => error === denied);
} else main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
  if (cell === 'cli') {
    for (const dir of ['src', 'tests', '.pulse']) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync('src/index.ts', `import {Pulse} from '@pulse-compute/pulse';
      const app = new Pulse({auto:true});
      app.get('/hello', async ctx => { const label = await ctx.config.get('label'); return ctx.text(label ?? 'missing'); });
      export default app;`);
    fs.writeFileSync('tests/pulse.harness.ts', `export default {cases:[{name:'config effect',request:{method:'GET',path:'/hello'},config:{label:'ARC-01'},expect:{status:200,text:'ARC-01'}}]};`);
    const profiles = {};
    for (const host of ['node', 'fastly']) for (const target of ['native', 'javascript']) {
      profiles[host + '-' + target] = { host, target, outDir: `dist-${host}-${target}` };
    }
    fs.writeFileSync('.pulse/config.ts', `import {defineConfig} from '@pulse-compute/pulse'; export default defineConfig((_scope)=>(${JSON.stringify({pulse:{entry:'src/index.ts',tests:'tests/pulse.harness.ts',strict:false},...profiles})}));`);
    const cli = path.resolve('node_modules/@pulse-compute/cli/bin/pulse.js');
    report.workflows = {};
    for (const profile of Object.keys(profiles)) {
      const statuses = {};
      for (const [command, status] of [['doctor','passed'], ['test','passed'], ['build','built']]) {
        const result = JSON.parse(run([cli, command, '--profile', profile, '--json']));
        assert.equal(result.status, status, `${profile} ${command}`);
        if (command === 'test') {
          assert.equal(result.cases.length, 1);
          assert.equal(result.cases[0].status, 'passed');
        }
        statuses[command] = result.status;
      }
      report.workflows[profile] = statuses;
    }
    assert.match(run([path.resolve('node_modules/@pulse-compute/cli/bin/pulsewasm-extract.js'), '--help']), /[Uu]sage/);
  } else {
    const bootstrap = require(compiler + '/provider-toolchain');
    require(compiler); // The package root must also remain provider independent.
    for (const id of ['node', 'fastly']) {
      if (cell === id) continue;
      assert.equal(fs.existsSync(path.join('node_modules/@pulse-compute/provider-' + id)), false);
      assert.throws(() => require.resolve('@pulse-compute/provider-' + id + '/toolchain'), {code:'MODULE_NOT_FOUND'});
      assert.throws(() => bootstrap.resolveProviderToolchain(id, {projectRoot:cwd}), {code:'PULSE_PROVIDER_PACKAGE_NOT_FOUND'});
    }
    assert.equal(bootstrap.getProviderDriver('none').id, 'none');
    const compiled = require(compiler + '/canonical-api-compiler').compileCanonicalSource(
      `export default async function handler(ctx) { const label = await ctx.config.get('label'); return ctx.text(label ?? 'missing'); }`,
      {fileName:'arc01.ts',rootDir:cwd,strict:false,requireAsync:true}
    );
    const plan = require(compiler + '/canonical-native-plan').buildCanonicalNativePlan(compiled);
    const native = require(compiler + '/canonical-native-compiler').compileCanonicalNativePlan(plan, {cwd});
    assert.equal(WebAssembly.validate(native.wasm), true);
    assert.equal(native.manifest.policy.providerNeutral, true);
    report.neutralWasm = native.manifest.wasm.sha256;
    if (cell !== 'core') {
      const driver = bootstrap.getProviderDriver(cell, {projectRoot:cwd});
      const c = require(contracts + '/provider/toolchain');
      const providerConfig = driver.normalizeConfig({kind:cell});
      const providerPlan = driver.createLoweringPlan(c.createProviderPlanInput({version:c.PROVIDER_PLAN_INPUT_VERSION,
        capabilities:compiled.metadata.capabilities,providerOperations:compiled.metadata.providerOperations,
        opaqueReturnCount:compiled.metadata.opaqueReturnCount}), providerConfig);
      const input = { version:c.PROVIDER_TARGET_INVOCATION_VERSION, action:'execute-native', provider:cell,
        selectedTarget:driver.targets.native, applicationPlan:plan, providerPlan, providerConfig,
        requirements:c.projectProviderRequirements(plan,providerPlan), nativeArtifact:c.createProviderNativeArtifact(native),
        javascript:null, project:{root:cwd,outDir:path.join(cwd,'dist'),profile:'isolated'},
        synchronizedPackages:[], timeoutMs:60000 };
      const execute = driver.prepareNativeExecution(c.createProviderTargetInvocation(input));
      const result = await execute(driver.executionOptions(providerConfig, {request:{method:'GET',path:'/hello'},config:{label:'ARC-01'}}));
      assert.equal(result.response.status, 200);
      assert.equal(result.response.body, 'ARC-01');
      const written = await driver.writeTarget(c.createProviderTargetInvocation({...input,action:'write-native'}));
      assert.equal(written.status, 'built');
      report.provider = cell;
      report.response = result.response.body;
      report.execution = result.evidence || {kind:'node-native-wasm'};
      report.build = written.status;
    }
    // Legacy executable creation is lazy even when neither provider exists.
    assert.match(run([path.resolve('node_modules/@pulse-compute/wasm-compiler/bin/pulsewasm-extract.js'), '--help']), /[Uu]sage/);
    report.failClosed = [];
    for (const [entry, request] of [
      ['canonical-api-compiler', contracts + '/handler/canonical-runtime'],
      ['canonical-native-plan', contracts + '/handler/canonical-native-plan'],
      ['canonical-native-compiler', '@pulse-compute/wasm-runtime-core-as/compiler/canonical-native'],
      ['canonical-native-compiler', '@pulse-compute/wasm-guest-link']
    ]) for (const code of ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED']) {
      run([__filename, 'deny', compiler + '/' + entry, request, code]);
      report.failClosed.push({entry,request,code});
    }
    const loadedProviders = [...new Set(Object.keys(require.cache).flatMap(file => {
      const match = file.match(/node_modules\/@pulse-compute\/(provider-[^/]+)\//);
      return match ? [match[1]] : [];
    }))].sort();
    assert.deepEqual(loadedProviders, cell === 'core' ? [] : ['provider-' + cell]);
    report.loadedProviders = loadedProviders;
  }
  report.status = 'passed';
  console.log(JSON.stringify(report));
}
