'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root='/tmp/rc-h05/provider-binding/consumer',out='/tmp/rc-h05/provider-binding/k4-build';fs.mkdirSync(out);
const {createRequire}=require('node:module'),req=createRequire(root+'/package.json');
const config=req('@pulse-compute/cli/project-config'),execution=req('@pulse-compute/cli/project-execution');
const platform=require(root+'/node_modules/@pulse-compute/provider-fastly/src/build/native-platform-capabilities.js');
fs.mkdirSync(root+'/.pulse',{recursive:true});fs.mkdirSync(root+'/src',{recursive:true});
let source=fs.readFileSync(process.cwd()+'/wasm/test/kv/k2/consumer.ts','utf8');
source=source.replace('  const command =',"  const token = await ctx.secret.get('PROBE_TOKEN');\n  if(ctx.req.header('x-probe-token')!==token)return ctx.text('denied',{status:403});\n  const command =");
fs.writeFileSync(root+'/src/index.ts',source);fs.writeFileSync(out+'/source.ts',source);
fs.writeFileSync(root+'/.pulse/config.ts',`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',defaultProfile:'proof',strict:false},proof:{host:'fastly',target:'native',schemas:{maxBytes:262144},fastly:{bindings:{kv:{catalog:'k4_catalog'},secretStore:'app_secrets'}}}}));`);
const resolved=config.resolveProject({cwd:root,profile:'proof'}),native=execution.compileNativeProjectInMemory(resolved);
const built=platform.compileFastlyNativePlatformCapabilitiesPlan(native.plan,{cwd:root,bindings:resolved.providerConfig.bindings,canonicalBuild:true});
fs.writeFileSync(out+'/uninstrumented.wasm',built.wasm);fs.writeFileSync(out+'/uninstrumented.as.ts',built.source);
const match=built.source.match(/@external\("fastly_http_resp", "send_downstream"\) declare function (\w+)\(/);if(!match)throw Error('Response instrumentation seam moved');
let as=built.source.replace(match[0],match[0].replace(match[1]+'(','__rc_send_raw('));
as+=`\n@external('wasi_snapshot_preview1','environ_sizes_get') declare function __rc_env_sizes(a:usize,b:usize):i32
@external('wasi_snapshot_preview1','environ_get') declare function __rc_env_get(a:usize,b:usize):i32
function __rc_env(name:string):string {
 const sizes=new StaticArray<i32>(2);if(__rc_env_sizes(changetype<usize>(sizes),changetype<usize>(sizes)+4)!=0)return '';
 const count=unchecked(sizes[0]),size=unchecked(sizes[1]);if(count<1||count>128||size<1||size>65536)return '';
 const pointers=new StaticArray<usize>(count),buffer=new StaticArray<u8>(size);if(__rc_env_get(changetype<usize>(pointers),changetype<usize>(buffer))!=0)return '';
 for(let i=0;i<count;i++){const p=unchecked(pointers[i]);let n:i32=0;while(n<256&&load<u8>(p+n)!=0)n++;const s=String.UTF8.decodeUnsafe(p,n);if(s.startsWith(name+'='))return s.substring(name.length+1);}return '';
}
function __rc_header(h:i32,k:string,v:string):void {const a=String.UTF8.encode(k),b=String.UTF8.encode(v);fastly_http_resp_header_append(h,changetype<usize>(a),a.byteLength,changetype<usize>(b),b.byteLength);}
function ${match[1]}(h:i32,b:i32,s:i32):i32 {
 __rc_header(h,'x-rc-pop',__rc_env('FASTLY_POP'));
 __rc_header(h,'x-rc-service',__rc_env('FASTLY_SERVICE_ID'));
 __rc_header(h,'x-rc-version',__rc_env('FASTLY_SERVICE_VERSION'));
 __rc_header(h,'x-rc-request',__rc_env('FASTLY_TRACE_ID'));
 __rc_header(h,'cache-control','private, no-store');
 return __rc_send_raw(h,b,s);
}
`;
fs.writeFileSync(out+'/fastly-native-platform-capabilities.as.ts',as);
const asc=root+'/node_modules/assemblyscript/bin/asc.js';
const args=[asc,'fastly-native-platform-capabilities.as.ts','--outFile',out+'/main.wasm','--runtime','stub','--noAssert','--optimize','--use','abort=fastly-native-platform-capabilities.as/__pulse_fastly_abort'];
const result=cp.spawnSync(process.execPath,args,{cwd:out,encoding:'utf8',timeout:180000});if(result.status!==0)throw Error(result.stderr);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const receipt={candidate:JSON.parse(fs.readFileSync('/tmp/rc-h05/provider-binding/terminal-ci/bundle/installed.json')).candidate,kind:'installed Pulse K2 consumer with QA auth guard and response-only WASI identity instrumentation',originalConsumerSha256:hash(fs.readFileSync(process.cwd()+'/wasm/test/kv/k2/consumer.ts')),wasmSha256:hash(fs.readFileSync(out+'/main.wasm')),uninstrumentedSha256:hash(built.wasm),instrumentedSourceSha256:hash(Buffer.from(as)),sourceSha256:hash(Buffer.from(source)),argv:args,guestUnits:built.guestUnits?.length||0};
if(receipt.guestUnits!==0)throw Error('Unexpected linked guest units');fs.writeFileSync(out+'/artifact.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
