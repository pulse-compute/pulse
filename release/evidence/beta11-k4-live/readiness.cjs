'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=__dirname;
(async()=>{
 const d=JSON.parse(fs.readFileSync(path.join(root,'deployment.json'))),compute=d.services.find(r=>r.kind==='compute');
 const auth=fs.readFileSync(path.join(root,'probe-auth'),'utf8').trim();
 const result=[];
 for(const authenticated of [false,true]){
  const response=await fetch('https://'+compute.domain+'/',{method:'POST',headers:{'content-type':'application/json',...(authenticated?{'x-pulse-k4-auth':auth}:{})},body:JSON.stringify({operation:'get',key:'pulse-k4-readiness-absent'}),signal:AbortSignal.timeout(15000),redirect:'error'});
  const body=await response.text();assert.ok(body.length<4096);
  assert.equal(response.status,authenticated?200:401);
  if(authenticated)assert.deepEqual(JSON.parse(body),{status:'not-found'});
  result.push({authenticated,status:response.status,body,servedBy:response.headers.get('x-served-by')});
 }
 fs.writeFileSync(path.join(root,'readiness.json'),JSON.stringify({status:'passed',requests:result},null,2)+'\n');console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1});
