'use strict';
// Fresh process: no prior WebAssembly.Module for these artifact bytes.
const fs=require('node:fs'),{performance}=require('node:perf_hooks');
const [folder,target]=process.argv.slice(2);
const data=JSON.parse(fs.readFileSync(folder+'/cold.json'));
const compiled={wasm:fs.readFileSync(folder+'/'+target+'.wasm'),plan:data.plan};
const run=target==='node'?require('../../packages/host-runtime/src/runtime/canonical-native-host').executeCanonicalNativeModule:require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host').executeFastlyNativePlatformCapabilities;
(async()=>{
 const cpu=process.cpuUsage(),start=performance.now();
 const result=await run(compiled,{request:data.request,maxDurationMs:5000});
 const used=process.cpuUsage(cpu);
 console.log(JSON.stringify({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,status:result.response.status,responseBytes:Buffer.byteLength(result.response.body),responseSha256:require('node:crypto').createHash('sha256').update(result.response.body).digest('hex'),memory:result.memory,guestMemoryBytes:result.guestMemoryBytes,valueHandleCount:result.valueHandleCount,processPeakRssBytes:process.resourceUsage().maxRSS*1024}));
})().catch(e=>{console.error(e);process.exitCode=1;});
