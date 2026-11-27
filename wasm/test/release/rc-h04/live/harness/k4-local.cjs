const fs=require('node:fs'),assert=require('node:assert/strict');
const root='/tmp/rc-h04-live',cli=require(root+'/consumer/node_modules/@pulse-compute/provider-fastly/src/testing/fastly-cli.js');
const {scenarios}=require(process.cwd()+'/wasm/test/kv/k4/scenarios.cjs');
(async()=>{const dir=root+'/k4-build';const manifest=dir+'/fastly.toml';fs.writeFileSync(manifest,cli.renderFastlyLocalConfig({name:'rc-h04-instrumented-k4',kvStores:{k4_catalog:{}},secretStores:{app_secrets:{PROBE_TOKEN:'local-test-only'}}}));const launcher=cli.inspectFastlyComputeLauncher({viceroyBinary:'/tmp/rc-h04-viceroy-0211/viceroy',required:true});let server;
try{server=await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile:dir+'/main.wasm',manifestFile:manifest});
const r=await scenarios(async command=>{const r=await cli.requestFastlyCompute(server,{method:'POST',headers:{'content-type':'application/json','x-probe-token':'local-test-only'},body:JSON.stringify(command)});assert.equal(r.status,200);return JSON.parse(r.body);},'pulse-k4-instrumented');
assert.deepEqual(r.failures,[{check:'missing-key-cas',expected:{acknowledgement:'conflict',subsequentRead:'not-found'},actual:{acknowledgement:'stored',subsequentRead:'found'}}]);
fs.writeFileSync(root+'/k4-instrumented-local.json',JSON.stringify({status:'same-known-viceroy-discrepancy',artifact:JSON.parse(fs.readFileSync(dir+'/artifact.json')),result:r},null,2)+'\n');console.log('Instrumented artifact completed all '+r.requests+' local requests; only known missing-key discrepancy');
}finally{if(server)await server.stop();}})().catch(e=>{console.error(e);process.exitCode=1;});
