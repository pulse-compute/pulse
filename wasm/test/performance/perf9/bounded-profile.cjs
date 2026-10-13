'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const child = require('node:child_process');
const cli = require('../../../../packages/provider-fastly/src/testing/fastly-cli.js');
const host = require('./measurement-host.cjs');
const { hash } = require('./measurement-protocol.cjs');
const digest = file => hash(fs.readFileSync(file));
function feasibility(binary) {
  const help = child.execFileSync(binary, ['serve', '--help'], {encoding:'utf8'});
  assert(help.includes('perfmap, jitdump, vtune, guest'));
  return {viceroySha256:digest(binary), help,
    probe:JSON.parse(child.execFileSync('python3', [path.join(__dirname,'bounded-perf-probe.py')], {encoding:'utf8'})),
    guestCpu:{status:'unavailable',reason:'Guest epoch samples are not an all-thread CPU sampler; no calibrated symbolized perf capture in this campaign'},
    hostCpu:{status:'unavailable'}, kernelCpu:{status:'unavailable'}, unknownCpu:{status:'unavailable'},
    samplingDenominator:null, calibratedCpuMilliseconds:false,
    upstream:{revision:'ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f',wasmtime:'39.0.2',
      execute:'https://github.com/fastly/Viceroy/blob/ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f/src/execute.rs',
      explanation:'configure_wasmtime passes native profiler strategy; guest sampling is driven by epoch increments in a sleeping thread, not process-wide CPU attribution'}};
}
async function diagnostic(launcher, artifacts, directory, persist, signal) {
  const results = [];
  for (const name of ['default','bounded','rust']) {
    const dir = path.join(directory,name);fs.mkdirSync(dir,{recursive:true});
    const profileDir = path.join(dir,'guest-profiles');fs.mkdirSync(profileDir);
    const origin = await host.originServer(), agent = new http.Agent({keepAlive:true,maxSockets:4});let server;
    const row = {name,artifactSha256:artifacts[name].sha256,status:'running',profiled:true,requests:[],files:[]};results.push(row);
    try {
      const config = path.join(dir,'fastly.toml');fs.writeFileSync(config,cli.renderFastlyLocalConfig({name:'perf9-02-profile-'+name,backends:{origin:{url:origin.url,useSni:false}}}));
      server = await cli.startFastlyComputeServe({launcher,packageRoot:dir,wasmFile:artifacts[name].file,manifestFile:config,
        extraArgs:[`--profile=guest,${profileDir},50us`],env:{RUST_LOG:'error'}});
      row.args=server.args;row.configurationSha256=digest(config);
      origin.begin('echo');
      for(let i=0;i<32;i++) { const result=await host.request(server.baseUrl,agent,{mode:'echo',bytes:1048576},{signal});row.requests.push(result);assert.equal(result.outcome,'ok'); }
      await origin.idle();await host.delay(100);
      for(const name of fs.readdirSync(profileDir).filter(n=>n.endsWith('.json')).sort()) {
        const file=path.join(profileDir,name),data=JSON.parse(fs.readFileSync(file));
        const threads=data.threads||[];
        row.files.push({file,sha256:digest(file),bytes:fs.statSync(file).size,
          samples:threads.reduce((n,t)=>n+(t.samples?.length||0),0),
          emptyStacks:threads.reduce((n,t)=>n+(t.samples?.stack||[]).filter(x=>x===null).length,0),
          functionNames:[...new Set(threads.flatMap(t=>(t.funcTable?.name||[]).map(i=>t.stringArray?.[i]).filter(Boolean)))].sort()});
      }
      row.profileCount=row.files.length;row.sampleCount=row.files.reduce((n,f)=>n+f.samples,0);
      row.interpretation='Guest-stack diagnostic only; samples are not guest/host CPU shares or precise milliseconds; no host/kernel/unknown sampling denominator';
      assert.equal(row.profileCount,32,'Expected one profile per diagnostic request');
      row.status='passed';
    } finally {
      const errors=[];agent.destroy();try{if(server){await server.stop();fs.writeFileSync(path.join(dir,'viceroy.stderr.log'),server.logs.stderr);}}catch(e){errors.push(String(e));}
      try{await origin.stop();}catch(e){errors.push(String(e));}if(errors.length){row.status='failed';row.cleanupErrors=errors;}persist(results);
      if(errors.length)throw Error('Profile cleanup failed: '+errors.join('; '));
    }
  }
  return results;
}
module.exports={feasibility,diagnostic};
