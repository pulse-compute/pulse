'use strict';
const fs=require('node:fs'),https=require('node:https'),assert=require('node:assert/strict');
const {signed}=require('../upload-01/transport.cjs');
const [stateFile,cleanupFile,out]=process.argv.slice(2),s=JSON.parse(fs.readFileSync(stateFile)),cleanup=JSON.parse(fs.readFileSync(cleanupFile));
assert(s.deactivated&&!s.keyRevoked);assert.equal(cleanup.status,'passed-observed-absence');assert.equal(cleanup.service,s.service.id);assert.equal(cleanup.prefix,s.target.prefix);assert(!fs.existsSync(out));
const report={status:'running',service:s.service.id,prefix:s.target.prefix,cleanupFinishedAt:cleanup.finishedAt,startedAt:new Date().toISOString(),keys:[]},save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');save();
const agent=new https.Agent({proxyEnv:process.env,maxSockets:8}),target={...s.target,accessId:s.objectKey.access_key,secret:s.objectKey.secret_key};
(async()=>{try{
 await new Promise(r=>setTimeout(r,Math.max(0,30000-(Date.now()-Date.parse(cleanup.finishedAt)))));
 report.observationStartedAt=new Date().toISOString();report.graceAfterCleanupMs=Date.now()-Date.parse(cleanup.finishedAt);save();
 for(let i=0;i<cleanup.keys.length;i+=8)await Promise.all(cleanup.keys.slice(i,i+8).map(async row=>{
  assert(row.key.startsWith(target.prefix));const {url,headers}=await signed(target,'HEAD',row.key);
  const result={key:row.key};try{result.httpStatus=await new Promise((resolve,reject)=>{const req=https.request(url,{method:'HEAD',headers,agent},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject);});req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('head-timeout')));req.end();});result.status=result.httpStatus===404?'passed':'failed';}catch(e){result.status='failed';result.error=e.code||e.message;}report.keys.push(result);save();
 }));
 report.status=report.keys.every(r=>r.status==='passed')?'passed-observed-absence':'failed';report.finishedAt=new Date().toISOString();save();if(report.status==='failed')process.exitCode=1;console.log(JSON.stringify({status:report.status,keys:report.keys.length}));
}finally{agent.destroy();}})().catch(e=>{report.status='failed';report.error=e.message;save();process.exitCode=1;});
