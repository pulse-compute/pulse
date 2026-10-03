// Standalone ABI feasibility probe, not a Pulse application or provider implementation.
@external('fastly_abi','init') declare function init(version:u64):i32;
@external('fastly_http_req','body_downstream_get') declare function incoming(req:usize,body:usize):i32;
@external('fastly_http_req','uri_get') declare function uriGet(req:i32,buf:usize,len:i32,out:usize):i32;
@external('fastly_http_req','new') declare function reqNew(out:usize):i32;
@external('fastly_http_req','uri_set') declare function uriSet(req:i32,buf:usize,len:i32):i32;
@external('fastly_http_req','method_set') declare function methodSet(req:i32,buf:usize,len:i32):i32;
@external('fastly_http_req','send_async') declare function send(req:i32,body:i32,backend:usize,len:i32,out:usize):i32;
@external('fastly_http_req','send_async_streaming') declare function sendStreaming(req:i32,body:i32,backend:usize,len:i32,out:usize):i32;
@external('fastly_http_req','pending_req_wait') declare function wait(req:i32,resp:usize,body:usize):i32;
@external('fastly_http_req','pending_req_poll') declare function poll(req:i32,done:usize,resp:usize,body:usize):i32;
@external('fastly_http_resp','new') declare function respNew(out:usize):i32;
@external('fastly_http_resp','send_downstream') declare function downstream(resp:i32,body:i32,streaming:i32):i32;
@external('fastly_http_body','new') declare function bodyNew(out:usize):i32;
@external('fastly_http_body','write') declare function write(body:i32,buf:usize,len:i32,end:i32,out:usize):i32;
@external('fastly_http_body','read') declare function read(body:i32,buf:usize,len:i32,out:usize):i32;
@external('fastly_http_body','close') declare function close(body:i32):i32;
@external('fastly_http_body','abandon') declare function abandon(body:i32):i32;
@external('fastly_async_io','is_ready') declare function ready(handle:i32,out:usize):i32;
@external('fastly_async_io','select') declare function select(handles:usize,len:i32,timeout:i32,out:usize):i32;
const out=memory.data(32), buffer=memory.data(16384);
function check(status:i32):void { if(status!=0) unreachable(); }
function bytes(text:string):ArrayBuffer { return String.UTF8.encode(text); }
function body():i32 { check(bodyNew(out));return load<i32>(out); }
function request(url:string):i32 {
  check(reqNew(out));const h=load<i32>(out),u=bytes(url),m=bytes('POST');
  check(uriSet(h,changetype<usize>(u),u.byteLength));check(methodSet(h,changetype<usize>(m),m.byteLength));return h;
}
function start(req:i32,b:i32,streaming:bool):i32 {
  const backend=bytes('origin');
  check(streaming?sendStreaming(req,b,changetype<usize>(backend),backend.byteLength,out):send(req,b,changetype<usize>(backend),backend.byteLength,out));return load<i32>(out);
}
function append(b:i32,text:string):void { const data=bytes(text);check(write(b,changetype<usize>(data),data.byteLength,0,out));if(load<i32>(out)!=data.byteLength)unreachable(); }
function response(text:string):void { check(respNew(out));const r=load<i32>(out),b=body();append(b,text);check(downstream(r,b,0)); }
function receipt(query:string):void {
  const p=start(request('http://origin/receipt?'+query),body(),false);
  check(wait(p,out,out+4));check(close(load<i32>(out+4)));
}
export function _start():void {
  check(init(1));check(incoming(out,out+4));const req=load<i32>(out),input=load<i32>(out+4);
  check(uriGet(req,buffer,16384,out));const uri=String.UTF8.decodeUnsafe(buffer,load<i32>(out));
  if(uri.endsWith('/direct')) {
    const p=start(request('http://origin/collect'),input,false);
    const readStatus=read(input,buffer,16,out);
    check(wait(p,out,out+4));const r=load<i32>(out),b=load<i32>(out+4);
    receipt('mode=direct&readAfterTransfer='+readStatus.toString());check(downstream(r,b,0));return;
  }
  check(close(input));
  if(uri.endsWith('/early')) {
    const b=body(),p=start(request('http://origin/early'),b,true);append(b,'prefix');
    store<i32>(out+16,p);const selected=select(out+16,1,250,out),index=load<i32>(out);
    const polled=poll(p,out,out+4,out+8),done=load<i32>(out);
    const abandoned=abandon(b);
    if(abandoned!=0)close(b);
    response('{"selectStatus":'+selected.toString()+',"selectedIndex":'+index.toString()+',"pollStatus":'+polled.toString()+',"done":'+done.toString()+',"abandonStatus":'+abandoned.toString()+'}');return;
  }
  check(respNew(out));const r=load<i32>(out),b=body();check(downstream(r,b,1));append(b,'prefix');
  const aborting=uri.endsWith('/abandon');
  const status=aborting?abandon(b):close(b),after=ready(b,out);
  receipt('mode='+(aborting?'abandon':'close')+'&terminalStatus='+status.toString()+'&readyAfterTerminal='+after.toString());
  if(status!=0)close(b);
}
