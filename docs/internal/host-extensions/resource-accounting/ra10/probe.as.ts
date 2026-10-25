// Internal destructive ABI probes. Never used by a production adapter.
@external('fastly_abi','init') declare function init(v:i64):i32;
@external('fastly_http_req','body_downstream_get') declare function ingress(r:usize,b:usize):i32;
@external('fastly_http_req','uri_get') declare function uri(h:i32,p:usize,n:i32,w:usize):i32;
@external('fastly_http_req','new') declare function reqNew(out:usize):i32;
@external('fastly_http_req','close') declare function reqClose(h:i32):i32;
@external('fastly_http_req','uri_set') declare function reqUri(h:i32,p:usize,n:i32):i32;
@external('fastly_http_req','send_async') declare function send(r:i32,b:i32,p:usize,n:i32,out:usize):i32;
@external('fastly_http_req','pending_req_wait_v2') declare function wait(h:i32,d:usize,r:usize,b:usize):i32;
@external('fastly_http_req','pending_req_poll_v2') declare function poll(h:i32,d:usize,done:usize,r:usize,b:usize):i32;
@external('fastly_http_resp','new') declare function respNew(out:usize):i32;
@external('fastly_http_resp','close') declare function respClose(h:i32):i32;
@external('fastly_http_resp','send_downstream') declare function downstream(r:i32,b:i32,s:i32):i32;
@external('fastly_http_body','new') declare function bodyNew(out:usize):i32;
@external('fastly_http_body','close') declare function bodyClose(h:i32):i32;
@external('fastly_http_body','abandon') declare function abandon(h:i32):i32;
@external('fastly_http_body','read') declare function read(h:i32,p:usize,n:i32,w:usize):i32;
@external('fastly_http_body','write') declare function write(h:i32,p:usize,n:i32,end:i32,w:usize):i32;
@external('fastly_async_io','select') declare function select(p:usize,n:i32,t:i32,out:usize):i32;
@external('fastly_async_io','is_ready') declare function ready(h:i32,out:usize):i32;
@external('fastly_cache','lookup') declare function lookup(k:usize,n:i32,m:i32,o:usize,out:usize):i32;
@external('fastly_cache','insert') declare function insert(k:usize,n:i32,m:i32,o:usize,out:usize):i32;
@external('fastly_cache','get_state') declare function state(h:i32,out:usize):i32;
@external('fastly_cache','get_body') declare function getBody(h:i32,m:i32,o:usize,out:usize):i32;
@external('fastly_cache','close') declare function cacheClose(h:i32):i32;
@external('wasi_snapshot_preview1','fd_write') declare function fdWrite(fd:i32,iov:usize,n:i32,out:usize):i32;
@external('wasi_snapshot_preview1','proc_exit') declare function exit(code:i32):void;
const slots:usize=memory.data(256), opts:usize=memory.data(128), buf:usize=memory.data(512);
function __pulse_fastly_abort(message:usize,file:usize,line:u32,column:u32):void {unreachable();}
let fields:string='';
function out(i:i32):usize {store<i32>(slots+i*4,-777);return slots+i*4;}
function val(i:i32):i32 {return load<i32>(slots+i*4);}
function row(k:string,v:i32):void {fields+=(fields.length?',':'')+'"'+k+'":'+v.toString();}
function log(s:string):void {const b=String.UTF8.encode(s+'\n');store<usize>(slots+200,changetype<usize>(b));store<i32>(slots+204,b.byteLength);fdWrite(1,slots+200,1,slots+208);}
function emit(name:string):string {const s='{"kind":"abi","case":"'+name+'","observations":{'+fields+'}}';log('RA10 '+s);return s;}
function answer(s:string):void {respNew(out(50));bodyNew(out(51));const b=String.UTF8.encode(s);write(val(51),changetype<usize>(b),b.byteLength,0,out(52));downstream(val(50),val(51),0);}
function launch(backend:string='origin',badBody:bool=false):i32 {
 row('req.new',reqNew(out(1)));const r=val(1);row('body.new',bodyNew(out(2)));const b=val(2);
 const u=String.UTF8.encode('http://origin.example/probe');row('uri.set',reqUri(r,changetype<usize>(u),u.byteLength));
 const be=String.UTF8.encode(backend);row('send',send(r,badBody?-999:b,changetype<usize>(be),be.byteLength,out(3)));
 const p=val(3);row('pending.output.changed',p!=-777?1:0);
 // No acquisition between the operation and these destructive validity probes.
 row('request.after.send',reqClose(r));row('body.after.send',bodyClose(b));return p;
}
function cacheLookup(key:string):i32 {const k=String.UTF8.encode(key);row('lookup',lookup(changetype<usize>(k),k.byteLength,0,opts,out(10)));return val(10);}
function cacheRead(h:i32):void {
 row('cache.ready',ready(h,out(11)));row('cache.ready.value',val(11));
 row('cache.state',state(h,out(12)));row('cache.state.value',val(12));
 row('cache.body',getBody(h,0,opts,out(13)));row('cache.body.output.changed',val(13)!=-777?1:0);
 if(val(13)!=-777){const b=val(13);let status=0,total=0,eof=0;for(let i=0;i<8;i++){status=read(b,buf,512,out(14));if(status!=0)break;total+=val(14);if(val(14)==0){eof=1;break;}}
  row('cache.read',status);row('cache.read.bytes',total);row('cache.read.eof',eof);row('reader.close',bodyClose(b));row('reader.stale',bodyClose(b));}
 row('cache.close',cacheClose(h));row('cache.stale',cacheClose(h));
}
export function _start():void {
 init(1);ingress(out(60),out(61));const incoming=val(60);uri(incoming,buf,512,out(62));
 const url=String.UTF8.decodeUnsafe(buf,val(62));const name=url.substring(url.lastIndexOf('/')+1);
 if(name=='body') {
  row('new',bodyNew(out(1)));const a=val(1);row('close',bodyClose(a));row('close.stale',bodyClose(a));
  row('new.second',bodyNew(out(2)));const b=val(2);row('same.request.reuse',a==b?1:0);row('abandon',abandon(b));row('abandon.stale',abandon(b));
 } else if(name=='namespace') {
  reqNew(out(1));respNew(out(2));row('response.zero.valid',val(2)==0?1:0);row('response.zero.close',respClose(val(2)));respNew(out(2));bodyNew(out(3));row('request.response.overlap',val(1)==val(2)?1:0);
  row('request.close',reqClose(val(1)));row('response.close',respClose(val(2)));row('body.close',bodyClose(val(3)));
  const hs=new StaticArray<i32>(256);let acquired=0,closed=0;for(let i=0;i<256;i++){if(bodyNew(out(4))!=0)break;hs[i]=val(4);acquired++;}
  for(let i=0;i<acquired;i++)if(bodyClose(hs[i])==0)closed++;row('body.acquired',acquired);row('body.closed',closed);
 } else if(name=='downstream-twice') {
  answer('first response');respNew(out(1));bodyNew(out(2));const r=val(1),b=val(2);
  row('second.send',downstream(r,b,0));row('response.after.send',respClose(r));row('body.after.send',bodyClose(b));emit(name);return;
 } else if(name=='send-unknown'||name=='send-badbody') {
  launch(name=='send-unknown'?'missing':'origin',name=='send-badbody');
 } else if(name.startsWith('wait-')||name.startsWith('poll-')) {
  const p=launch();
  if(name.startsWith('poll-')) {
   if(name=='poll-error'){store<i32>(slots+180,p);row('select',select(slots+180,1,2000,out(5)));}
   row('poll',poll(p,opts,out(6),out(7),out(8)));row('done',val(6));row('poll.response.changed',val(7)!=-777?1:0);row('poll.body.changed',val(8)!=-777?1:0);
   if(name=='poll-delay'){row('pending.retained',ready(p,out(9)));row('wait',wait(p,opts,out(7),out(8)));}
  }else row('wait',wait(p,opts,out(7),out(8)));
  row('pending.after.completion',ready(p,out(9)));
  if(val(7)>=0){row('response.close',respClose(val(7)));row('response.stale',respClose(val(7)));}
  if(val(8)>=0){row('body.close',bodyClose(val(8)));row('body.stale',bodyClose(val(8)));}
 } else if(name.startsWith('cache-')) {
  const key='ra10-'+name;
  if(name=='cache-miss'){cacheRead(cacheLookup(key));}
  else if(name=='cache-invalid') {
   const k=new Uint8Array(4097);row('insert.invalid',insert(k.dataStart,k.byteLength,0,opts,out(10)));row('insert.output.changed',val(10)!=-777?1:0);
  } else if(name=='cache-check-trap'||name=='cache-check-return') {
   cacheRead(cacheLookup(name=='cache-check-trap'?'ra10-cache-trap':'ra10-cache-return'));
  } else {
   const k=String.UTF8.encode(key);store<u64>(opts,60000000000);row('insert',insert(changetype<usize>(k),k.byteLength,0,opts,out(10)));const b=val(10);
   const data=String.UTF8.encode('payload');row('write',write(b,changetype<usize>(data),data.byteLength,0,out(11)));row('write.bytes',val(11));
   if(name=='cache-trap'){emit(name);unreachable();}
   if(name=='cache-return'){answer(emit(name));return;}
   row('writer.dispose',name=='cache-commit'?bodyClose(b):abandon(b));row('writer.stale',bodyClose(b));
   memory.fill(opts,0,128);cacheRead(cacheLookup(key));
  }
 } else if(name.endsWith('-pending')) {
  const p=launch();store<i32>(slots+180,p);row('select',select(slots+180,1,30,out(5)));row('select.index',val(5));
  emit(name);
  if(name=='trap-pending')unreachable();
  if(name=='exit-pending'){exit(0);return;}
  if(name=='kill-pending'){while(true){} }
  answer('returned with pending request');return;
 } else {row('unknown.case',1);}
 answer(emit(name));
}
