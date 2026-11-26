'use strict';
// Research-only compilation. Public upload admission remains unimplemented.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const [targetFile,out]=process.argv.slice(2),target=JSON.parse(fs.readFileSync(targetFile));
if(fs.existsSync(out))throw Error('Use a fresh artifact directory');
if(!/^https:\/\/[a-z0-9-]+\.object\.fastlystorage\.app$/.test(target.endpoint)||!/^pulse-upload-live\/[a-f0-9-]+\/$/.test(target.prefix))throw Error('Invalid research target');
require('../upload-03/native-overlay.cjs').install();
const owner=require('../../../../packages/provider-fastly/src/build/s3-native.js'),previous=owner.s3NativeSource;
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Research boundary drift: '+a);return s.replace(a,b);}
owner.s3NativeSource=(plan,bindings)=>{
 let s=previous(plan,bindings).replaceAll('1048577','33554433').replaceAll('1048576','33554432');
 s=replace(s,'  __s3_dispatched[index] = true;',"  if (__ul_framing(req, 1) != 0) { __s3_close_req(req); __s3_close_body(body[0]); __s3_close_body(__pulse_fastly_request_body_handle); __s3_fail(index, 'framing'); return; }\n  __s3_dispatched[index] = true;");
 s=replace(s,'  __u2_claimed = true;', '  __ul_start = __s3_clock(1); __ul_initial = memory.size() * 65536;\n  __u2_claimed = true;');
 s=replace(s,'    const read = load<i32>(__u2_io + 76);','    const read = load<i32>(__u2_io + 76);\n    if (read > 0) { if (__ul_read == 0) __ul_first_read = __s3_clock(1); __ul_read += read; }');
 s=replace(s,'      offset += written;','      if (__ul_written == 0) __ul_first_write = __s3_clock(1); __ul_written += written;\n      offset += written;');
 s=s.replaceAll('__pulse_fastly_ready_effect(', '__ul_ready(');
 s=replace(s,"__s3_close_resp(response[0]); return __s3_remaining(index) == 0 ? __s3_failure(index, 'timeout') : result;","__s3_close_resp(response[0]); return __ul_decorate(__s3_remaining(index) == 0 ? __s3_failure(index, 'timeout') : result);");
 // Count successful guest close/abandon calls. These are not host reclamation measurements.
 for(const [name,arg] of [['__s3_close_req','request'],['__s3_close_resp','response'],['__s3_close_body','body'],['__u2_abandon','body']]){
  s=replace(s,`declare function ${name}(${arg}: i32): i32`,`declare function ${name}_raw(${arg}: i32): i32`);
  s+=`\nfunction ${name}(${arg}: i32): i32 { const r=${name}_raw(${arg}); if (r==0) __ul_closed++; else __ul_close_errors++; return r; }\n`;
 }
 return s+`\n@external('fastly_http_req', 'framing_headers_mode_set') declare function __ul_framing(req:i32,mode:i32):i32
let __ul_start:i64=0; let __ul_first_read:i64=0; let __ul_first_write:i64=0;
let __ul_initial:i32=0; let __ul_read:i32=0; let __ul_written:i32=0; let __ul_closed:i32=0; let __ul_close_errors:i32=0;
function __ul_number(result:i32,name:string,n:f64):void { const v=new __PulseFastlyValue(); v.kind=PULSE_VALUE_NUMBER; v.number=n; __s3_set(result,name,__pulse_fastly_put(v)); }
function __ul_decorate(result:i32):i32 {
 __ul_number(result,'guestInitialBytes',__ul_initial); __ul_number(result,'guestFinalBytes',memory.size()*65536);
 __ul_number(result,'readBytes',__ul_read); __ul_number(result,'writtenBytes',__ul_written);
 __ul_number(result,'operationMs',__ul_start==0?0:f64(__s3_clock(1)-__ul_start)/1000000);
 __ul_number(result,'firstReadMs',__ul_first_read==0?-1:f64(__ul_first_read-__ul_start)/1000000);
 __ul_number(result,'firstWriteMs',__ul_first_write==0?-1:f64(__ul_first_write-__ul_start)/1000000);
 __ul_number(result,'guestCloseCallsSucceeded',__ul_closed); __ul_number(result,'guestCloseErrors',__ul_close_errors);
 return result;
}
function __ul_ready(index:i32,result:i32):void {
 __pulse_fastly_ready_effect(index,__ul_decorate(result));
}
`;
};
owner.S3_IMPORTS=[...owner.S3_IMPORTS,'fastly_http_req:framing_headers_mode_set'];
const {acceptanceToolchain}=require('../acceptance-toolchain.cjs'),T=acceptanceToolchain();
const root=path.resolve(__dirname,'../../../..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload-live-build-'));
try {
 fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});for(const name of ['pulse','s3'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
 fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
 const source=`import {Pulse} from '@pulse-compute/pulse'; import {s3} from '@pulse-compute/s3';
const app=new Pulse({auto:true}); app.post('/',async ctx=>{
 const token=await ctx.secret.get('PROBE_TOKEN');
 if(ctx.req.header('x-probe-token')!==token)return ctx.text('denied',{status:403});
 const key=${JSON.stringify(target.prefix)}+ctx.req.header('x-object-key');
 const result=await s3.putText(ctx,'objects',key,'',{contentType:'application/octet-stream'});
 return ctx.json(result);
}); export default app;`;
 fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
 const binding={endpoint:target.endpoint,bucket:target.bucket,region:target.region,accessKeyIdSecret:'S3_ID',secretAccessKeySecret:'S3_SECRET',maxTextBytes:16384,timeoutMs:10000,backend:'object_origin'};
 const config={pulse:{entry:'src/index.ts',strict:false,crypto:['SHA-256','HMAC-SHA256'],defaultProfile:'proof'},proof:{host:'fastly',target:'native',fastly:{maxDurationMs:15000,bindings:{s3:{objects:binding},secretStore:'app_secrets'}}}};
 fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>(${JSON.stringify(config)}));`);
 const resolved=T.resolveProject({cwd,profile:'proof'}),compiled=T.compileFastly(resolved);
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'bin'));
 fs.writeFileSync(path.join(out,'bin/main.wasm'),compiled.wasm);fs.writeFileSync(path.join(out,'source.ts'),source);
 if(compiled.source)fs.writeFileSync(path.join(out,'generated.as.ts'),compiled.source);
 fs.writeFileSync(path.join(out,'fastly.toml'),'manifest_version = 3\nname = "pulse-upload-live-probe"\nlanguage = "other"\ndescription = "Bounded upload QA qualification"\nauthors = []\n');
 const receipt={kind:'research-scaffold',target,capBytes:33554432,operationMs:10000,requestMs:15000,wasmBytes:compiled.wasm.length,wasmSha256:crypto.createHash('sha256').update(compiled.wasm).digest('hex'),publicAdmission:false,telemetry:'Guest linear memory and successful close calls; not host RSS or pending-request reclamation'};
 fs.writeFileSync(path.join(out,'artifact.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(e){console.error(e.message,e.detail?.stderr||'');process.exitCode=1;}finally{fs.rmSync(cwd,{recursive:true,force:true});}
