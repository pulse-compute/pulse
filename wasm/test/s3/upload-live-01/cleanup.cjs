'use strict';
const fs=require('node:fs'),https=require('node:https'),assert=require('node:assert/strict');
const {signed}=require('../upload-01/transport.cjs');
const [stateFile,out,...receipts]=process.argv.slice(2),s=JSON.parse(fs.readFileSync(stateFile));
assert(s.deactivated,'Deactivate the owned service before cleanup');assert(Date.now()-Date.parse(s.deactivatedAt)>=45000,'Observe at least 45 seconds after deactivation');assert(!fs.existsSync(out),'Fresh receipt required');
const target={...s.target,accessId:s.objectKey.access_key,secret:s.objectKey.secret_key},agent=new https.Agent({proxyEnv:process.env,maxSockets:8});
const rows=receipts.flatMap(p=>JSON.parse(fs.readFileSync(p)).keys||[]),keys=[...new Set(rows.map(r=>{assert(r.beforeStatus===404&&r.key.startsWith(target.prefix));return r.key}))];
const report={status:'running',service:s.service.id,prefix:target.prefix,startedAt:new Date().toISOString(),deactivatedAt:s.deactivatedAt,quiescenceMs:Date.now()-Date.parse(s.deactivatedAt),keys:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');save();
async function call(method,key){const {url,headers}=await signed(target,method,key);return new Promise((resolve,reject)=>{const req=https.request(url,{method,headers,agent},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,length:Number(res.headers['content-length'])}));res.on('error',reject);});req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('cleanup-timeout')));req.end();});}
(async()=>{try{
 for(let i=0;i<keys.length;i+=8){await Promise.all(keys.slice(i,i+8).map(async key=>{const row={key};report.keys.push(row);try{row.before=await call('HEAD',key);assert([200,404].includes(row.before.status));row.delete=await call('DELETE',key);assert([200,204].includes(row.delete.status));row.after=await call('HEAD',key);assert.equal(row.after.status,404);row.status='passed';}catch(e){row.status='failed';row.error=e.code||e.message;}save();}));}
 report.status=report.keys.every(r=>r.status==='passed')?'passed-observed-absence':'failed';report.finishedAt=new Date().toISOString();save();if(report.status==='failed')process.exitCode=1;console.log(JSON.stringify({status:report.status,keys:keys.length}));
}finally{agent.destroy();}})().catch(e=>{report.status='failed';report.error=e.message;save();process.exitCode=1;});
