const fs=require('node:fs'),path=require('node:path');
const root='/workspace/scratch/d3826bbd4bf5/pulse-10a';
const f=require(root+'/packages/provider-fastly/src/testing/fastly-cli.js');
const out='/tmp/pulse-10a-retained-probe.json';
(async()=>{const launcher=f.inspectFastlyComputeLauncher({launcherKind:'fastly-cli',binary:'/tmp/pulse-10a-tools/fastly',viceroyBinary:'/tmp/467-recovery-tools/viceroy',timeoutMs:5000});
const dir=root+'/wasm/.test-results/mcp-installed-Q6FBan/fastly-local/resources';
const s=await f.startFastlyComputeServe({launcher,packageRoot:dir,startTimeoutMs:45000});
const result={artifact:dir+'/bin/main.wasm',sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(dir+'/bin/main.wasm')).digest('hex'),requests:[]};
try{for(const mode of ['', 'bounds','','resource-bounds','','single','allocation','']){const r=await f.requestFastlyCompute(s,{path:'/',headers:{mode},timeoutMs:10000});result.requests.push({mode,status:r.status,body:r.body.toString()});console.log(JSON.stringify(result.requests.at(-1)));}}
finally{await new Promise(r=>setTimeout(r,150));await s.stop();result.logs=s.logs;fs.writeFileSync(out,JSON.stringify(result,null,2));}})().catch(e=>{console.error(e);process.exitCode=1});
