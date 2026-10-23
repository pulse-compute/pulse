'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const provider = require('../../../packages/provider-fastly/src/provider-contract');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const driver = require('../../../packages/provider-fastly/src/toolchain').createDriver();
const root = require('node:path').resolve(__dirname, '../../..');
module.exports = function({ native, compiled, plan, options }) {
  const artifact = options.realizationArtifacts[0];
  const metadata = native.manifest.hostExtensions[0];
  assert.equal(metadata.contractId, artifact.contractId);
  assert.equal(metadata.service, 'terminal-request-backend.v1');
  assert.equal(metadata.source.line, 3);
  assert.equal(native.inspection.hostExtensionAudit.policySha256, native.manifest.hostExtensionPolicy.sha256);
  assert.equal(native.manifest.hostExtensionPolicy.contributions.length, 1);
  assert.equal(native.inspection.hostExtensionAudit.observedImports.filter(i=>i.name==='redirect_to_grip_proxy_v2').length,1);
  assert.throws(()=>provider.createFastlyLoweringPlan(compiled.metadata, {}),error=>{
    assert.equal(error.code,'PULSE_HOST_EXTENSION_BINDING');
    assert.equal(error.detail.loc.line,3);
    assert.equal(error.detail.operation,'handoffFanout');return true;
  });
  provider.createFastlyLoweringPlan(compiled.metadata,options.bindings);
  const extra = structuredClone(artifact);
  extra.id+='-unused';extra.data.operation='unused';extra.data.entry='__outside_unused';
  extra.data.source='@external("not_admitted", "unused") declare function __outside_unused(): i32\n';
  extra.data.sha256=crypto.createHash('sha256').update(extra.data.source).digest('hex');
  extra.data.imports=[{module:'not_admitted',name:'unused',parameters:[],results:['i32']}];
  for(const artifacts of [[extra,artifact],[artifact,extra]]) {
    const generated=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,realizationArtifacts:artifacts});
    assert.equal(generated.source.includes('not_admitted'),false);
    assert.equal(generated.manifest.hostExtensionPolicy.contributions.length,1);
    assert.deepEqual(generated.manifest.hostExtensionPolicy,native.manifest.hostExtensionPolicy);
  }
  // A different package/contract/operation reaches the same provider service
  // without adding a package-method constant to the compiler or provider.
  const foreign=structuredClone(artifact), foreignPlan=structuredClone(plan);
  foreign.package='@outside/transport';foreign.contractId='outside.transport';foreign.id=foreign.package+':transfer';foreign.data.operation='transfer';
  Object.assign(foreignPlan.effects[0],{package:foreign.package,contractId:foreign.contractId,operation:foreign.data.operation});
  for (const effect of foreignPlan.packages.effects) if (effect.kind === 'host.extension') Object.assign(effect,{package:foreign.package,contractId:foreign.contractId,operation:foreign.data.operation});
  const generated=platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(foreignPlan,{...options,realizationArtifacts:[foreign]});
  assert.equal(generated.manifest.hostExtensions[0].package,foreign.package);
  assert.equal(generated.manifest.hostExtensions[0].operation,'transfer');
  const duplicate=structuredClone(artifact);duplicate.id+='-overlap';
  for(const artifacts of [[duplicate,artifact],[artifact,duplicate]]) assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,{...options,realizationArtifacts:artifacts}),{code:'PULSE_HOST_EXTENSION_CONFLICT'});
  for(const field of ['protocols','services']) {
    const target=structuredClone(driver.targets.native);target.hostExtensions[field]=[];
    assert.throws(()=>compileCanonicalProject(require('node:path').join(root,'docs/internal/host-extensions/fixtures/fanout.ts'),{rootDir:root,target:'native',packageTargetDescriptor:target}),error=>{
      assert.equal(error.code,'PULSE_HOST_EXTENSION_PROTOCOL');assert.equal(error.detail.loc.start.line,3);return true;
    });
  }
  require('./host-extension-external-cases.cjs')(artifact);
  console.log('ok - HEX-02 provider metadata, source diagnostics, selected-only emission, order independence and external owner admission');
};
