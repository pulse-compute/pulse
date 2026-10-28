'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const installed=process.argv.includes('--installed');
const root=installed?process.cwd():path.resolve(__dirname,'../../..');
const fixture=require(installed?'./host-extension-fixture.cjs':'../support/host-extension-fixture.cjs');
const execute=require(installed?'./terminal-host.cjs':'../support/terminal-host.cjs');
const target=require(installed?'@pulse-compute/provider-fastly/build/canonical-target':'../../../packages/provider-fastly/src/build/canonical-target');
const toolchain=require(installed?'@pulse-compute/provider-fastly/toolchain':'../../../packages/provider-fastly/src/toolchain');
const productTemplate=require(installed?'./fixture-product.json':'../../../packages/grip/pulse.package.json');
const observer=require(installed?'./terminal-observer.cjs':'../support/terminal-observer.cjs');
// Optional observer probes deliberately use the same internal packed seam as foundation tests.
const platformFile=installed?path.join(path.dirname(require.resolve('@pulse-compute/provider-fastly/build/canonical-target')),'native-platform-capabilities.js'):path.join(root,'packages/provider-fastly/src/build/native-platform-capabilities.js');
if(installed)assert(fs.realpathSync(platformFile).startsWith(root+path.sep));
const platform=require(platformFile);
const cliBuild=require(installed?'./terminal-cli.cjs':'../support/terminal-cli.cjs');
const cells=[];
for(const [name,version,abiName] of [['@outside/terminal','37.4.2','redirect_to_grip_proxy_v2'],['@independent/edge','91.0.0','redirect_to_websocket_proxy_v2']]) {
  const f=fixture({name,version,abi:'fastly_http_req',abiName,productTemplate});
  try {
    if(installed) {
      const env={...process.env,NODE_PATH:'',npm_config_ignore_scripts:'true'};
      const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',f.root],{cwd:f.pkg,env,encoding:'utf8',timeout:60000}));
      fs.rmSync(f.pkg,{recursive:true,force:true});
      execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',path.join(f.root,packed[0].filename)],{cwd:f.root,env,encoding:'utf8',timeout:60000});
      assert(!fs.lstatSync(f.pkg).isSymbolicLink());assert.equal(JSON.parse(fs.readFileSync(path.join(f.pkg,'package.json'))).version,version);
    }
    const {compiled,plan,options}=f.compile();
    const input={plan,cwd:root,projectRoot:f.root,providerConfig:{bindings:options.bindings,maxDurationMs:options.maxDurationMs},
      targetDescriptor:toolchain.createDriver().targets.native,realizationArtifacts:options.realizationArtifacts,outDir:path.join(f.root,'out')};
    input.providerPlan=toolchain.createDriver().createLoweringPlan(compiled.metadata,input.providerConfig);
    input.metadata=compiled.metadata;
    const {native}=target.inspectFastlyCanonicalTarget(input);
    target.writeFastlyCanonicalTarget({...input,native});
    const bytes=fs.readFileSync(path.join(input.outDir,'bin/main.wasm'));assert.deepEqual(bytes,native.wasm);
    const r=execute(bytes,{abi:'fastly_http_req',abiName});assert.ifError(r.trap);assert.equal(r.error,0);assert.equal(r.calls,1);assert.equal(r.sends.length,0);
    assert.equal(native.manifest.hostExtensions.contributions[0].package,name);
    const observed=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,lifecycleServices:observer()});
    assert.equal(execute(observed.wasm,{abi:'fastly_http_req',abiName}).instance.exports.pulse_fastly_jwt_secret_calls(),12345678);
    const cliBytes=cliBuild(f.root,root,installed);
    const cliResult=execute(cliBytes,{abi:'fastly_http_req',abiName});assert.ifError(cliResult.trap);assert.equal(cliResult.calls,1);assert.equal(cliResult.sends.length,0);
    cells.push({package:name,version,abi:abiName,wasmSha256:native.manifest.wasm.sha256});
  } finally {f.close();}
}
console.log(JSON.stringify({status:'passed',mode:installed?'installed':'workspace',qualification:'injected-ABI; not hosted Fastly acceptance',cells}));
