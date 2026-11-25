'use strict';
const fs=require('node:fs'),https=require('node:https');
const [stateFile,keyFile,out,stopFile]=process.argv.slice(2);
if(fs.existsSync(out))throw Error('Fresh metrics receipt required');
const s=JSON.parse(fs.readFileSync(stateFile)),token=fs.readFileSync(keyFile,'utf8').trim(),agent=new https.Agent({proxyEnv:process.env});
const report={schema:'pulse.upload-live.metrics.v1',service:s.service.id,startedAt:new Date().toISOString(),status:'running',semantics:'Provider-reported one-second aggregates; compute_ram_used is not a measured host RSS peak',polls:[],records:[]},records=new Map();
const save=()=>{report.records=[...records.values()].sort((a,b)=>a.recorded-b.recorded);fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n')};
const selected=o=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>k.startsWith('compute_')));
(async()=>{let stamp=Math.floor(Date.now()/1000)-10;const start=Date.now();
 try{while(Date.now()-start<1200000){
  try{
   const d=await new Promise((resolve,reject)=>{const req=https.get(`https://rt.fastly.com/v1/channel/${s.service.id}/ts/${stamp}`,{agent,headers:{'Fastly-Key':token}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{if(res.statusCode!==200)return reject(Error('metrics-http-'+res.statusCode));try{resolve(JSON.parse(b))}catch{reject(Error('metrics-json'))}});res.on('error',reject);});req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('metrics-timeout')));});
   for(const r of d.Data||[])records.set(r.recorded,{recorded:r.recorded,aggregated:selected(r.aggregated),datacenter:Object.fromEntries(Object.entries(r.datacenter||{}).map(([k,v])=>[k,selected(v)]))});
   report.polls.push({at:new Date().toISOString(),timestamp:d.Timestamp,aggregateDelay:d.AggregateDelay,records:(d.Data||[]).length});if(d.Timestamp)stamp=d.Timestamp;
  }catch(e){report.polls.push({at:new Date().toISOString(),error:e.code||e.message});}
  save();if(fs.existsSync(stopFile))break;await new Promise(r=>setTimeout(r,5000));
 }}finally{report.status=report.polls.some(p=>p.error)?'completed-with-errors':'completed';report.finishedAt=new Date().toISOString();save();agent.destroy();console.log(JSON.stringify({status:report.status,records:report.records.length}));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
