'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { compile } = require('./measure.cjs');
const { execute } = require('./injected-host.cjs');
const root = path.resolve(__dirname, '../../..');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
const { compileCanonicalProject } = require('../../../wasm/packages/compiler/src/canonical-project-compiler.js');
function run({ compareBaseline = true, record = false } = {}) {
const receipt = { recipe: 'measure.cjs + assert-hex01.cjs; AssemblyScript defaults; canonicalBuild; same fixture paths', controls: {}, targets: [], executions: [] };
for (const name of ['absent', 'unused', 'generic']) {
  const { native } = compile(name);
  const evidence = { bytes: native.inspection.bytes, sha256: native.inspection.sha256, imports: native.inspection.imports };
  if (compareBaseline) assert.deepEqual(evidence, require('./hex01-baseline.json')[name], `${name}: exact unchanged baseline`);
  assert.equal(evidence.imports.some(item => item.name === 'redirect_to_grip_proxy_v2'), false);
  receipt.controls[name] = evidence;
}
const { native, compiled, plan, options } = compile('fanout');
assert.equal(plan.effects[0].kind, 'host.extension');
assert.equal(plan.effects[0].result.mode, 'return');
assert.deepEqual(compiled.packageReachability.selectedContracts, ['pulse.grip']);
assert.equal(options.realizationArtifacts.length, 1);
receipt.used = { bytes: native.inspection.bytes, sha256: native.inspection.sha256, imports: native.inspection.imports,
  deltaFromOrdinaryBytes: native.inspection.bytes - receipt.controls.absent.bytes, contribution: native.manifest.hostExtensions };
function retain(name, result) {
  const { instance, ...evidence } = result;
  receipt.executions.push({ name, ...evidence,
    state: instance.exports.pulse_extension_state?.(),
    status: instance.exports.pulse_extension_status?.(),
    error: instance.exports.pulse_fastly_last_error(),
    stage: instance.exports.pulse_fastly_error_stage() });
}
const success = execute(native);
assert.equal(success.error, 0);
assert.equal(success.state, 3);
assert.deepEqual(success.trace, [{call:'handoff', request:41, backend:'fanout_backend', length:14, status:0}]);
retain('success',success);
success.instance.exports._start();
assert.equal(success.trace.length, 1, 'repeat start neither redispatches nor responds');
assert.notEqual(success.instance.exports.pulse_fastly_last_error(),0);
retain('duplicate-start', { ...success, error: success.instance.exports.pulse_fastly_last_error() });
const ordinary = execute(native,{path:'/ordinary'});
assert.equal(ordinary.error,0);
assert.equal(ordinary.state,0);
assert.equal(ordinary.trace.filter(e=>e.call==='send').length,1);
assert.equal(ordinary.trace.some(e=>e.body==='ordinary response'),true);
retain('ordinary-route',ordinary);
for (const status of [1,2,3,4,5,6,7,8,9,10,11,12,13,14]) {
  const result=execute(native,{status});
  assert.equal(result.state,1);
  assert.equal(result.status,status);
  assert.notEqual(result.error,0);
  assert.equal(result.trace.length,1,'no assumed retry/response/cleanup after unknown outcome');
  retain(`injected-status-${status}`,result);
}
const trapped = execute(native,{trap:true});
assert.match(trapped.thrown,/ambiguous/);
assert.equal(trapped.trace.length,1);
trapped.instance.exports._start();
assert.equal(trapped.trace.length,1);
retain('trap-and-repeat-start',trapped);
// Reentrant fault injection attempts premature settlement during the hostcall.
const corrupted = execute(native,{afterHandoff: instance => instance.exports.pulse_set_effect_result(0,1)});
assert.equal(corrupted.trace.filter(e=>e.call==='send').length,0);
assert.notEqual(corrupted.error,0, 'post-transfer settlement failure is fenced');
retain('premature-settlement-injection',corrupted);
for (const [provider,target] of [['node','native'],['node','javascript'],['fastly','javascript']]) {
  const descriptor=require(path.join(root, `packages/provider-${provider}/src/${provider === 'fastly' ? 'toolchain/index.js' : 'toolchain.js'}`)).createDriver().targets[target];
  const targetId=descriptor.targetId;
  assert.throws(()=>compileCanonicalProject(path.join(__dirname,'fixtures/fanout.ts'),{rootDir:root,target,packageTargetDescriptor:descriptor}),error=> {
    assert.equal(error.code,'PULSE_HOST_EXTENSION_TARGET');
    assert.match(error.message,/not implemented for this host/);
    assert.equal(error.detail.loc.start.line,3);
    receipt.targets.push({target,targetId,code:error.code,message:error.message,source:error.detail.loc}); return true;
  });
  compileCanonicalProject(path.join(__dirname,'fixtures/generic.ts'),{rootDir:root,target,packageTargetDescriptor:descriptor});
}
assert.throws(()=>platform.inspectFastlyNativePlatformCapabilitiesWasm(native.wasm),/outside/,'unselected imports rejected');
for (const [code,change] of [['OWNER',a=>{a.package='other';}],['SOURCE',a=>{a.data.sha256='0'.repeat(64);} ],['SIGNATURE',a=>{a.data.imports[0].parameters=['i64'];}]]) {
  const artifacts=structuredClone(options.realizationArtifacts);change(artifacts[0]);
  assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,realizationArtifacts:artifacts}),{code:'PULSE_HOST_EXTENSION_'+code});
}
assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,bindings:{}}),/configured static backend/);
// The package guard covers dynamic JavaScript calls that static recognition misses.
require('node:child_process').execFileSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import { grip } from './packages/grip/dist/index.js';
  assert.throws(() => grip.handoffFanout('fanout'), /not implemented for this host/);
  assert.equal(grip.handoff({channels:['updates']}).status, 200);
`], { cwd: root });
const temp = fs.mkdtempSync(path.join(__dirname, 'fixtures/rejected-'));
try {
  for (const [name,body] of [
    ['assignment', 'const value = grip.handoffFanout("fanout"); return value'],
    ['prior-effect', 'await ctx.time.now(); return grip.handoffFanout("fanout")'],
    ['loop', 'while (ctx.req.path === "/fanout") { return grip.handoffFanout("fanout") } return ctx.text("ordinary")'],
    ['body', 'const body = await ctx.req.text(); return grip.handoffFanout("fanout")']
  ]) {
    const file=path.join(temp, name+'.ts');
    fs.writeFileSync(file, `import { grip } from '@pulse-compute/grip'\nexport default async function handler(ctx) { ${body} }\n`);
    assert.throws(() => {
      const c=compileCanonicalProject(file,{rootDir:root,target:'native',packageTargetDescriptor:require('../../../packages/provider-fastly/src/toolchain/index.js').createDriver().targets.native});
      const p=require('../../../wasm/packages/compiler/src/canonical-native-plan.js').buildCanonicalNativePlan(c);
      platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(p,{...options,realizationArtifacts:require('../../../wasm/packages/compiler/src/canonical-project-compiler.js').packageRealizationArtifactsForCompiled(c)});
    }, undefined, `${name} is outside the terminal proof`);
  }
} finally { fs.rmSync(temp, {recursive:true,force:true}); }
// Declared signature is not sufficient: inspect the actual emitted Wasm type.
const wrongType=structuredClone(options.realizationArtifacts);
wrongType[0].data.source=wrongType[0].data.source.replace('length: i32', 'length: i64');
wrongType[0].data.sha256=require('node:crypto').createHash('sha256').update(wrongType[0].data.source).digest('hex');
assert.throws(()=>platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,realizationArtifacts:wrongType}),/conflicting ABI signature/);
require('../../../wasm/test/provider/host-extension-admission-cases.cjs')({ native, compiled, plan, options });
if(record) fs.writeFileSync(path.join(__dirname,'hex01-result.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(`ok - HEX-01 authored proof, 3 ${compareBaseline ? 'exact baselines' : 'unused controls'}, 3 unsupported targets, ${receipt.executions.length} injected lifecycle cases, admission/import negatives`);
}
if (require.main === module) run({ record: process.argv.includes('--record') });
module.exports = { run };
