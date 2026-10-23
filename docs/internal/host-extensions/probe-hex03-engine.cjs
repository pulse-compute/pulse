'use strict';
// Opt-in standalone ABI evidence. Does not qualify the authored Pulse artifact,
// Pushpin transport, WebSocket frames or hosted Fastly ownership semantics.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');const crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const p=server.address().port;await new Promise(resolve=>server.close(resolve));return p;}
function source(abi,invalid) {return `
@external('fastly_abi','init') declare function init(version:i64):i32;
@external('fastly_http_req','body_downstream_get') declare function downstream(r:usize,b:usize):i32;
@external('fastly_http_req','${abi}') declare function handoff(r:i32,b:usize,n:i32):i32;
@external('fastly_http_req','method_get') declare function method(r:i32,b:usize,n:i32,w:usize):i32;
@external('fastly_http_req','close') declare function closeReq(r:i32):i32;
@external('fastly_http_body','close') declare function closeBody(b:i32):i32;
@external('wasi_snapshot_preview1','fd_write') declare function write(fd:i32,iov:usize,count:i32,out:usize):i32;
function log(s:string):void {const b=String.UTF8.encode(s+'\\n');const v=new StaticArray<i32>(2);v[0]=i32(changetype<usize>(b));v[1]=b.byteLength;const out=new StaticArray<i32>(1);write(1,changetype<usize>(v),1,changetype<usize>(out));}
function abort(a:usize,b:usize,c:i32,d:i32):void {unreachable();}
export function _start():void {
 init(1);const handles=new StaticArray<i32>(2);const acquired=downstream(changetype<usize>(handles),changetype<usize>(handles)+4);
 const req=handles[0],body=handles[1];const backend=String.UTF8.encode('backend');
 ${invalid==='utf8'?"store<u8>(changetype<usize>(backend),255);":''}
 const first=handoff(${invalid===true?'2147483647':'req'},changetype<usize>(backend),backend.byteLength);
 const status=${invalid==='repeat'?'handoff(req,changetype<usize>(backend),backend.byteLength)':'first'};
 const buffer=new StaticArray<u8>(32),written=new StaticArray<i32>(1);
 const requestStillReadable=method(req,changetype<usize>(buffer),32,changetype<usize>(written));
 const requestClose=closeReq(req),bodyClose=closeBody(body);
 const requestCloseAgain=closeReq(req),bodyCloseAgain=closeBody(body);
 log('HEX03:'+ '{"acquired":'+acquired.toString()+',"status":'+status.toString()+',"requestStillReadable":'+requestStillReadable.toString()+',"requestClose":'+requestClose.toString()+',"bodyClose":'+bodyClose.toString()+',"requestCloseAgain":'+requestCloseAgain.toString()+',"bodyCloseAgain":'+bodyCloseAgain.toString()+'}');
}`;}
async function run(binary) {
 const version=spawnSync(binary,['--version'],{encoding:'utf8'});if(version.status!==0)throw Error(version.stderr);assert.equal(version.stdout.trim(),'viceroy 0.18.0','this evidence recipe pins Viceroy 0.18.0');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'hex03-engine-'));
 const backend=http.createServer((req,res)=>{res.end('backend');});
 backend.on('upgrade',(req,socket)=>{const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');});
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const receipt={kind:'local core-Wasm ABI ownership and authored Pulse transport probes; not hosted acceptance',engine:{version:version.stdout.trim(),binarySha256:hash(fs.readFileSync(binary))},cases:[]};
 try {
 fs.writeFileSync(path.join(temporary,'fastly.toml'),`[local_server.backends.backend]\nurl = "http://127.0.0.1:${backend.address().port}"\n[local_server.backends.fanout_backend]\nurl = "http://127.0.0.1:${backend.address().port}"\n`);
 const cases=['redirect_to_grip_proxy_v2','redirect_to_websocket_proxy_v2'].flatMap(abi=>[false,true,'utf8','repeat'].map(invalid=>({abi,invalid})));
 for(const fixture of ['fanout','websocket'])for(const ordinary of [false,true])cases.push({fixture,ordinary});cases.push({fixture:'websocket',upgrade:true});
 for(const {abi,invalid,fixture,ordinary,upgrade} of cases) {
   const authored=fixture?require('./measure.cjs').compile(fixture).native:null;
   const src=authored?authored.source:source(abi,invalid);const file=path.join(temporary,'probe.ts'),wasm=path.join(temporary,'probe.wasm');fs.writeFileSync(file,src);
   if(authored)fs.writeFileSync(wasm,authored.wasm);
   const asc=path.resolve(__dirname,'../../../wasm/node_modules/assemblyscript/bin/asc.js');
   if(!authored) {const compiled=spawnSync(process.execPath,[asc,'probe.ts','--outFile',wasm,'--runtime','stub','--optimize','--use','abort=probe/abort'],{cwd:temporary,encoding:'utf8',timeout:30000});if(compiled.status!==0)throw Error(compiled.stderr);}
   const addr=await port();let logs='';const child=spawn(binary,[wasm,'--addr',`127.0.0.1:${addr}`,'-C',path.join(temporary,'fastly.toml'),'--log-stdout'],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
   let response;
   try {
    let ready=false;for(let n=0;n<200&&!ready;n++){if(child.exitCode!==null)throw Error(logs);ready=await new Promise(resolve=>{const c=net.connect(addr,'127.0.0.1');c.on('connect',()=>{c.destroy();resolve(true);});c.on('error',()=>resolve(false));});if(!ready)await delay(50);}
    if(!ready)throw Error('Viceroy startup timeout');
    if(upgrade)response=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:addr,path:'/fanout',headers:{connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ=='}},res=>{res.resume();resolve({status:res.statusCode});});req.on('upgrade',(res,socket)=>{socket.destroy();resolve({status:res.statusCode,upgrade:res.headers.upgrade});});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('upgrade timeout')));req.end();});
    else try {const r=await fetch(`http://127.0.0.1:${addr}/${fixture&&!ordinary?'fanout':'ordinary'}`,{signal:AbortSignal.timeout(3000)});response={status:r.status,body:await r.text()};}catch(error){response={error:error.message};}
    for(let n=0;!authored&&n<40&&!logs.includes('HEX03:');n++)await delay(50);
   } finally {child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('close',resolve)),delay(1000)]);if(child.exitCode===null)child.kill('SIGKILL');}
   const match=logs.match(/HEX03:(\{[^\n]+\})/);if(!authored&&!match)throw Error('Missing guest trace: '+logs);
   if(authored && (upgrade?response.status!==101:ordinary?response.body!=='ordinary response':fixture==='websocket'?response.body!=='backend':response.status!==500))throw Error('Authored transport mismatch: '+JSON.stringify(response)+' '+logs);
   if(match)assert.deepEqual(JSON.parse(match[1]),{acquired:0,status:invalid===true?3:invalid==='utf8'?2:invalid==='repeat'?1:0,requestStillReadable:0,requestClose:0,bodyClose:0,requestCloseAgain:3,bodyCloseAgain:3});
   receipt.cases.push({abi,scenario:invalid===true?'invalid request':invalid||'valid request',fixture,ordinary,upgrade,sourceSha256:hash(src),wasmSha256:hash(fs.readFileSync(wasm)),trace:match?JSON.parse(match[1]):null,response,logs});
 }
 } finally {await new Promise(resolve=>backend.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
 return receipt;
}
if(require.main===module) {if(!process.argv[2]||!process.argv[3])throw Error('Usage: node probe-hex03-engine.cjs /absolute/viceroy receipt.json');run(path.resolve(process.argv[2])).then(receipt=>{fs.writeFileSync(process.argv[3],JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}).catch(error=>{console.error(error);process.exitCode=1;});}
module.exports={run};
