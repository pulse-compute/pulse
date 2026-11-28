'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { acceptanceToolchain } = require('./acceptance-toolchain.cjs');
const root = path.resolve(__dirname, '../../..');
const secrets = { S3_ACCESS_KEY_ID: 'list-access-sentinel', S3_SECRET_ACCESS_KEY: 'list-secret-sentinel' };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const enc = text => encodeURIComponent(text).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const xml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function page({ entries = [], prefix = '', maxKeys = 100, token, bucket = 'o1-fixture' } = {}) {
 return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${enc(prefix)}</Prefix><EncodingType>url</EncodingType><MaxKeys>${maxKeys}</MaxKeys><KeyCount>${entries.length}</KeyCount><IsTruncated>${token === undefined ? 'false' : 'true'}</IsTruncated>${token === undefined ? '' : '<NextContinuationToken>'+xml(token)+'</NextContinuationToken>'}${entries.map(e=>`<Contents><Key>${enc(e.key)}</Key><Size>${e.byteLength}</Size>${e.etag===undefined?'':'<ETag>'+xml(e.etag)+'</ETag>'}<LastModified>2026-11-05T00:00:00Z</LastModified><StorageClass>STANDARD</StorageClass></Contents>`).join('')}</ListBucketResult>`;
}
const fail = (status, reason, httpStatus) => ({status,reason,...(httpStatus===undefined?{}:{httpStatus})});
function cases() {
 const entries=[{key:'demo/é +%2F&雪',byteLength:7,etag:'"opaque&"'}];
 const listed={status:'listed',entries,isTruncated:false};
 const rows=[
  {id:'empty-default',route:'/default',body:page(),expected:{status:'listed',entries:[],isTruncated:false}},
  {id:'unicode-prefix',input:{prefix:'demo/',maxKeys:2},body:page({entries,prefix:'demo/',maxKeys:2}),expected:listed},
  {id:'first-page',input:{prefix:'demo/',maxKeys:2},body:page({entries,prefix:'demo/',maxKeys:2,token:'opaque +/%2F&雪'}),expected:{...listed,isTruncated:true,nextContinuationToken:'opaque +/%2F&雪'}},
  {id:'next-page',input:{prefix:'demo/',maxKeys:2,continuationToken:'opaque +/%2F&雪'},body:page({prefix:'demo/',maxKeys:2}),expected:{status:'listed',entries:[],isTruncated:false}},
  {id:'maximum-page',body:page({entries:Array.from({length:1000},(_,i)=>({key:'item-'+i,byteLength:i})),maxKeys:1000}),input:{maxKeys:1000},expected:{status:'listed',entries:Array.from({length:1000},(_,i)=>({key:'item-'+i,byteLength:i})),isTruncated:false}},
  {id:'xml-comments-and-entities',body:page({token:'opaque&'}).replace('<Prefix></Prefix>','<Prefix/><!-- comment -->').replace('opaque&amp;', 'opaque&#38;'),expected:{status:'listed',entries:[],isTruncated:true,nextContinuationToken:'opaque&'}},
  {id:'parallel',route:'/parallel',body:page(),expected:{page:{status:'listed',entries:[],isTruncated:false},removed:{status:'deleted'}}},
 ];
 for(const [id,body] of [
  ['bad-comment',page().replace('<Prefix>', '<!-- invalid---><Prefix>')],['bad-declaration-case',page().replace('version=', 'VERSION=')],['bad-root-quote',page().replace('01/"',"01/'")],['bad-declaration-quote',page().replace('1.0"',"1.0'")],['invalid-xml','<ListBucketResult>'],['truncated',page().slice(0,-5)],['duplicate-truncated',page().replace('</IsTruncated>','</IsTruncated><IsTruncated>false</IsTruncated>')],
  ['missing-cursor',page().replace('false','true')],['unexpected-cursor',page().replace('</ListBucketResult>','<NextContinuationToken>x</NextContinuationToken></ListBucketResult>')],
  ['wrong-count',page().replace('<KeyCount>0','<KeyCount>1')],['wrong-bucket',page({bucket:'wrong'})],['wrong-prefix',page({prefix:'other/'})],['wrong-max',page({maxKeys:1})],
  ['missing-encoding',page().replace('<EncodingType>url</EncodingType>','')],['bad-size',page({entries:[{key:'x',byteLength:1}]}).replace('<Size>1','<Size>-1')],
  ['duplicate-key',page({entries:[{key:'x',byteLength:1},{key:'x',byteLength:2}]})],['bad-url-encoding',page({entries:[{key:'x',byteLength:0}]}).replace('<Key>x','<Key>%FF')],
  ['external-entity','<!DOCTYPE foo SYSTEM "file:///etc/passwd">'+page()],['bad-entity',page().replace('<Name>o1-fixture','<Name>&unknown;')],
  ['nested-field',page().replace('<KeyCount>0</KeyCount>','<KeyCount><x>0</x></KeyCount>')],['oversized-cursor',page({token:'x'.repeat(4097)})],
  ['multiple-roots',page()+page()],['common-prefix',page().replace('</ListBucketResult>','<CommonPrefixes><Prefix>x</Prefix></CommonPrefixes></ListBucketResult>')]
 ]) rows.push({id,body,expected:fail('failed','protocol',200)});
 rows.push({id:'list-duplicate-headers',body:page(),headers:[['content-length','1'],['content-length','1']],expected:fail('failed','protocol',200)},
 {id:'list-truncated-body',body:page(),bodyReadStatus:1,expected:fail('failed','protocol',200)},
 {id:'list-timeout',delayMs:1000,expected:fail('failed','timeout')},
 {id:'list-credentials',secrets:{S3_ACCESS_KEY_ID:''},dispatch:false,expected:fail('failed','credentials')});
 for(const route of ['/list','/delete'])for(const cancel of ['before','after']) rows.push({id:route+'-cancel-'+cancel,route,cancel,dispatch:cancel!=='before'});
 rows.push({id:'same-cursor',input:{continuationToken:'same'},body:page({token:'same'}),expected:fail('failed','protocol',200)});
 for(const input of [{maxKeys:0},{maxKeys:1001},{maxKeys:1.5},{prefix:'x'.repeat(1025)},{continuationToken:'x'.repeat(4097)}])rows.push({id:'invalid-options-'+rows.length,input,dispatch:false,expected:fail('failed','invalid-options')});
 for(const [status,reason] of [[403,'not-authorized'],[404,'unavailable'],[429,'throttled'],[503,'unavailable']])rows.push({id:'list-http-'+status,status,expected:fail('failed',reason,status)});
 rows.push({id:'oversized-list',body:'x'.repeat(2097153),expected:fail('failed','too-large',200)});
 for(const [id,key] of [['delete-existing','demo/é +%2F'],['delete-missing','missing']])rows.push({id,route:'/delete',input:{key},status:204,expected:{status:'deleted'}});
 for(const [status,state,reason] of [[200,'unknown','protocol'],[404,'not-deleted','rejected'],[403,'not-deleted','not-authorized'],[429,'not-deleted','throttled'],[408,'unknown','timeout'],[503,'unknown','unavailable'],[302,'unknown','protocol']])rows.push({id:'delete-http-'+status,route:'/delete',status,expected:fail(state,reason,status)});
 rows.push({id:'delete-invalid-key',route:'/delete',input:{key:'../x'},dispatch:false,expected:fail('not-deleted','invalid-key')},
 {id:'delete-send-loss',route:'/delete',sendStatus:1,expected:fail('unknown','transport')},
 {id:'delete-timeout',route:'/delete',delayMs:1000,expected:fail('unknown','timeout')},
 {id:'delete-credentials',route:'/delete',secrets:{S3_ACCESS_KEY_ID:''},dispatch:false,expected:fail('not-deleted','credentials')},
 {id:'delete-rejection-truncated',route:'/delete',status:403,bodyReadStatus:1,expected:fail('unknown','protocol',403)},
 {id:'delete-nonempty-ack',route:'/delete',status:204,body:'x',expected:fail('unknown','protocol',204)});
 return rows.map(row=>({route:'/list',status:200,body:'',...row,input:row.route==='/delete'?{key:'gone',...row.input}:{prefix:'',continuationToken:'',maxKeys:100,...row.input}}));
}
function verify(request) {
 const headers=Object.fromEntries(request.headers),url=new URL(request.url);
 const match=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(headers.authorization);
 assert(match);assert.equal(match[1],secrets.S3_ACCESS_KEY_ID);assert.equal(headers.host,url.host);
 const names=match[3].split(';');assert.deepEqual(names,[...names].sort());assert.equal(headers['x-amz-content-sha256'],sha(''));
 const canonical=[request.method,url.pathname,url.search.slice(1),names.map(n=>`${n}:${headers[n].trim().replace(/\s+/g,' ')}\n`).join(''),match[3],sha('')].join('\n');
 let key=Buffer.from('AWS4'+secrets.S3_SECRET_ACCESS_KEY);for(const item of match[2].split('/'))key=crypto.createHmac('sha256',key).update(item).digest();
 assert.equal(match[4],crypto.createHmac('sha256',key).update(['AWS4-HMAC-SHA256',headers['x-amz-date'],match[2],sha(canonical)].join('\n')).digest('hex'));
}
async function main(options={}) {
 const api=acceptanceToolchain(options.packedRoot),cwd=options.cwd||fs.mkdtempSync(path.join(__dirname,'.list-delete-'));
 try {
  fs.mkdirSync(path.join(cwd,'src'),{recursive:true});fs.mkdirSync(path.join(cwd,'.pulse'),{recursive:true});
  if(!options.packedRoot){fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});for(const name of ['pulse','s3'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');}
  fs.copyFileSync(path.join(__dirname,'list-delete-consumer.ts'),path.join(cwd,'src/index.ts'));
  const bindings=structuredClone(require('./o1/bindings.json'));for(const provider of ['node','fastly'])Object.assign(bindings[provider].bindings.s3.objects,{timeoutMs:250});
  const config={pulse:{entry:'src/index.ts',defaultProfile:'node-native',strict:false,crypto:['SHA-256','HMAC-SHA256']}};
  for(const provider of ['node','fastly'])for(const target of ['native','javascript'])config[`${provider}-${target}`]={host:provider,target,schemas:{maxBytes:12648448},[provider]:bindings[provider]};
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse'\nexport default defineConfig((_scope)=>(${JSON.stringify(config)}))`);
  const projects=Object.fromEntries(Object.keys(config).filter(k=>k!=='pulse').map(profile=>[profile,api.resolveProject({cwd,profile})]));
  const node=api.compileNativeProjectInMemory(projects['node-native']),fastly=api.compileFastly(projects['fastly-native']),js=api.prepareJavascriptApplication(projects['node-javascript']);
  assert.equal(api.inspectProject(projects['fastly-javascript']).provider.targetSupport.project.status,'blocked');
  let executions=0;
  for(const row of cases())for(const mode of ['node-native','node-javascript','fastly-native']){
   const origin=bindings.node.bindings.s3.objects.endpoint+'/'+bindings.node.bindings.s3.objects.bucket+'/';
   const query=(row.input.continuationToken?'continuation-token='+enc(row.input.continuationToken)+'&':'')+'encoding-type=url&list-type=2&max-keys='+row.input.maxKeys+'&prefix='+enc(row.input.prefix||'');
   const url=row.route==='/delete'?origin+row.input.key.split('/').map(enc).join('/'):origin+'?'+query;
   const method=row.route==='/delete'?'DELETE':'GET',requests=[];
   const fixture={status:row.status,body:row.body,headers:row.headers||[['content-length',String(Buffer.byteLength(row.body))]],sendStatus:row.sendStatus,delayMs:row.delayMs,bodyReadStatus:row.bodyReadStatus};
   const fixtures={[method+' '+url]:fixture};if(row.route==='/parallel')fixtures['DELETE '+origin+'gone']={status:204,body:'',headers:[['content-length','0']]};
   const cancellation=new AbortController();
   const cancel=()=>cancellation.abort(new Error('S3 invocation cancelled'));
   if(row.cancel==='before')cancel();
   const onRequest=req=>{verify(req);requests.push(req);if(row.cancel==='after')cancel();};
   const fetchImplementation=async(url,init)=>{const f=fixtures[init.method+' '+url];assert(f,`${row.id}: unexpected ${url}`);onRequest({url,method:init.method,headers:Object.entries(init.headers)});if(f.sendStatus)throw Error('send loss');if(f.delayMs)return new Promise(()=>{});return {status:f.status,headers:f.headers,body:f.bodyReadStatus?new ReadableStream({start(c){c.error(Error('truncated'));}}):new Response(f.body).body};};
   const request={method:'POST',path:row.route,url:'https://app.example.test'+row.route,headers:[],body:JSON.stringify(row.input)};
   const execute=async()=>{let result;
   if(mode==='fastly-native')result=api.executeFastlyNativePlatformCapabilities(fastly,{signal:cancellation.signal,request,fixtures,secrets:{...secrets,...row.secrets},secretStore:bindings.fastly.bindings.secretStore,clockUnixSeconds:1369353600,onOutboundRequest:onRequest});
   else if(mode==='node-native')result=await api.executeCanonicalNativeModule(node.native,api.driver.executionOptions(projects[mode].providerConfig,{signal:cancellation.signal,request,secrets:{...secrets,...row.secrets},fetchImplementation,strict:false,maxStructuredBodyBytes:12648448}));
   else {const r=await api.executeNodeJavascriptApplication(js.loaded.application,new Request(request.url,{method:'POST',body:request.body}),{signal:cancellation.signal,s3:bindings.node.bindings.s3,secrets:{...secrets,...row.secrets},fetchImplementation,strict:false,maxStructuredBodyBytes:12648448});result={response:{status:r.status,body:await r.text()}};}
   return result;};
   if(row.cancel){await assert.rejects(execute(), /cancel/i, row.id+'/'+mode);assert.equal(requests.length,row.dispatch?1:0);executions++;continue;}
   const result=await execute();
   assert.equal(result.response.status,200,`${row.id}/${mode}: ${result.response.body}`);assert.deepEqual(JSON.parse(result.response.body),row.expected,`${row.id}/${mode}`);
   assert.equal(requests.length,row.dispatch===false?0:row.route==='/parallel'?2:1,`${row.id}/${mode}: bounded dispatch`);
   for(const secret of Object.values(secrets))assert(!JSON.stringify(result).includes(secret),'secret redaction');
   executions++;
  }
  const evidence={status:'passed',cases:cases().length,executions,targets:['node-native','node-javascript','fastly-native'],providerReality:false};if(!options.quiet)console.log(JSON.stringify(evidence));return evidence;
 }finally{if(!options.cwd)fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={main,page,cases};if(require.main===module)main().catch(e=>{console.error(e.stack||e);console.error(JSON.stringify(e.detail||e.diagnostics||{}));process.exitCode=1;});
