'use strict';
const fs=require('node:fs'),https=require('node:https'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='/tmp/rc-h04-live',s=JSON.parse(fs.readFileSync(root+'/resources.json')),svc=s.resources.find(r=>r.label==='origins'),base='https://'+svc.domain;
const key=fs.readFileSync(root+'/api-key','utf8').trim(),target={...s.target,accessId:s.objectKey.access_key,secret:s.objectKey.secret_key};
const {signed}=require(process.cwd()+'/wasm/test/s3/upload-01/transport.cjs'),agent=new https.Agent({proxyEnv:process.env,maxSockets:4});
const report={schemaVersion:'pulse.rc-h04-origin-proof.v1',status:'running',serviceId:svc.id,serviceVersion:svc.version,artifact:JSON.parse(fs.readFileSync(root+'/origin-build/artifact.json')),cases:[],keys:[]};
const save=()=>fs.writeFileSync(root+'/origin-proof.json',JSON.stringify(report,null,2)+'\n');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function call(route,options={}){const start=performance.now();const r=await fetch(base+route,{...options,headers:{'x-probe-token':s.probeToken,...options.headers},signal:AbortSignal.timeout(20000),redirect:'error'});const body=Buffer.from(await r.arrayBuffer());assert(body.length<=131072);return{status:r.status,body,headers:r.headers,elapsedMs:performance.now()-start};}
async function storage(method,key,body){const spec=await signed(target,method,key,body?{size:body.length,payloadHash:hash(body)}:{});return new Promise((resolve,reject)=>{const req=https.request(spec.url,{method,headers:spec.headers,agent},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject);});req.setTimeout(20000,()=>req.destroy(Error('storage-deadline')));req.on('error',reject);req.end(body);});}
async function inspect(){const request=async p=>{const r=await fetch('https://api.fastly.com'+p,{headers:{'Fastly-Key':key},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};const [v,p]=await Promise.all([request(`/service/${svc.id}/version/${svc.version}`),request(`/service/${svc.id}/version/${svc.version}/package`)]);assert(v.active);assert.equal(p.metadata.files_hash,svc.filesHash);return{active:true,filesHash:p.metadata.files_hash};}
function record(name,detail){report.cases.push({name,status:'passed',...detail});save();}
(async()=>{save();try{report.before=await inspect();save();
 const object=s.target.prefix+'payload.txt';const beforeStatus=await storage('HEAD',object);assert.equal(beforeStatus,404);report.keys.push({key:object,beforeStatus});save();
 const text='RC-H04 café / 雪 / '+ 'x'.repeat(4096),bytes=Buffer.from(text);
 let r=await call('/put',{method:'POST',body:text});assert.equal(r.status,200);let j=JSON.parse(r.body);assert.equal(j.status,'stored');assert.equal(j.byteLength,bytes.length);assert.equal(j.sha256,hash(bytes));record('putText',{bytes:bytes.length,sha256:hash(bytes),elapsedMs:r.elapsedMs});
 r=await call('/head');j=JSON.parse(r.body);assert.equal(j.status,'found');assert.equal(j.byteLength,bytes.length);record('head',{bytes:j.byteLength,etag:j.etag});
 r=await call('/text');j=JSON.parse(r.body);assert.equal(j.status,'found');assert.equal(j.text,text);assert.equal(j.sha256,hash(bytes));record('getText',{sha256:j.sha256});
 r=await call('/body');assert.equal(r.status,200);assert.deepEqual(r.body,bytes);record('getBody-text',{bytes:r.body.length,sha256:hash(r.body)});
 r=await call('/absent');assert.deepEqual(JSON.parse(r.body),{status:'not-found'});record('missing-object',{});
 const binary=Buffer.from(Array.from({length:4096},(_,i)=>(i*31)&255));assert([200,204].includes(await storage('PUT',object,binary)));record('fixture-binary-seed',{bytes:binary.length,sha256:hash(binary),scope:'direct signed fixture setup; not Pulse upload support'});
 r=await call('/body');assert.equal(r.status,200);assert.deepEqual(r.body,binary);record('getBody-binary',{bytes:r.body.length,sha256:hash(r.body)});
 r=await call('/range');assert.equal(r.status,206);assert.deepEqual(r.body,binary.subarray(2,8));record('getBody-range',{bytes:r.body.length,contentRange:r.headers.get('content-range')});
 r=await call('/conditional');assert.equal(r.status,304);assert.equal(r.body.length,0);record('getBody-conditional',{httpStatus:304});
 for(const method of ['GET','DELETE','OPTIONS']){r=await call('/fetch-'+method.toLowerCase());j=JSON.parse(r.body);assert.equal(j.status,'fulfilled');assert.equal(j.value,'origin-'+method);assert(j.elapsedMs>=0);record('fetch-'+method,{outcome:j,clientMs:r.elapsedMs});}
 r=await call('/timeout');j=JSON.parse(r.body);assert.equal(j.status,'rejected');assert.equal(j.error.code,'PULSE_FETCH_TIMEOUT');assert(j.elapsedMs>=350&&j.elapsedMs<1500);record('fetch-timeout',{outcome:j,clientMs:r.elapsedMs});
 r=await call('/network');j=JSON.parse(r.body);assert.equal(j.status,'rejected');assert.equal(j.error.code,'PULSE_FETCH_NETWORK');record('fetch-network',{outcome:j,clientMs:r.elapsedMs});
 r=await call('/body-header');j=JSON.parse(r.body);assert.deepEqual(j,{status:202});record('fetch-header-only',{clientMs:r.elapsedMs});
 r=await call('/body-timed');j=JSON.parse(r.body);assert.equal(j.status,'fulfilled');assert.equal(j.value,'late-body');assert(j.elapsedMs>=1500);record('fetch-body-timing',{outcome:j,clientMs:r.elapsedMs});
 report.after=await inspect();assert.deepEqual(report.after,report.before);report.status='passed';save();console.log(JSON.stringify({status:report.status,cases:report.cases.length}));
 }catch(e){report.status='failed';report.error=e.message;save();throw e;}finally{agent.destroy();}})().catch(e=>{console.error(e);process.exitCode=1;});
