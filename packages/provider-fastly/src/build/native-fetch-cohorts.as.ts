// One immutable invocation partition per existing driver ticket. No recycling,
// second effect counter, or scheduling authority is introduced here.
let __fetch_ra:PulseResourceLedger|null=null;
let __fca_origin:i64=0;
let __fca_clock_failed:bool=false;
let __fca_frame:i32=0;
const __fca_reaped=new StaticArray<bool>(__FCA_COUNT);
const __fca_io:usize=memory.data(32);
const __fca_exit:usize=memory.data(64);
function __fca_slot(local:i32):i32{return local>=5?__FCA_HANDLES-2+local-5:__fca_frame*5+local;}
function __fca_ns(slot:i32):u32{return slot==__FCA_HANDLES-2?2:slot==__FCA_HANDLES-1?3:slot%5==0?1:slot%5==2?4:slot%5==3?2:3;}
function __fca_now():u64{
  if(__fca_clock_failed)return PRL_SAFE+1;
  const now=__request_clock();
  if(now<__fca_origin||__request_expired){__fca_clock_failed=true;return PRL_SAFE+1;}
  if(now>=__request_deadline)__request_expired=true;
  return u64(now-__fca_origin);
}
function __fca_ok(ok:bool):bool{if(!ok)__pulse_fastly_fail(PULSE_ERROR_HOSTCALL,272,-1);return ok;}
function __fca_work():bool{return __fca_ok(__fca_now()<__FCA_DURATION);}
function __fca_start(index:i32):bool{
  const ticket=__pulse_invocation_tickets[index];
  if(ticket<=0||ticket>__FCA_COUNT||ticket!=__pulse_invocation_count)return __fca_ok(false);
  __fca_frame=ticket-1;
  if(__fetch_ra!==null)return __fca_work();
  if(__request_deadline<0||__request_last_clock<0)return __fca_ok(false);
  __fca_origin=__request_deadline-i64(__FCA_DURATION);
  const l=new PulseResourceLedger(1,__FCA_RECORDS,__FCA_HANDLES,__FCA_BACKING,5*__FCA_COUNT+2,__FCA_COUNT,__FCA_DURATION,__FCA_STORAGE);__fetch_ra=l;
  if(!l.begin(1,__fca_now(),5*__FCA_COUNT,2,__FCA_COUNT,true))return __fca_ok(false);
  for(let i=0;i<__FCA_HANDLES;i++)if(!l.stageRecord(1,1,__fca_ns(i),1,i>=__FCA_HANDLES-2?3:1,0))return __fca_ok(false);
  if(!l.stageRecord(1,2,0,1,1,__FCA_SCRATCH)||!l.stageRecord(1,2,0,1,1,__FCA_ENCODING)||!l.stageRecord(1,2,0,1,1,__FCA_READER)||!l.stageRecord(1,2,0,1,3,64)||!l.stageRecord(1,3,0,1,1,0)||!l.commit(1,__fca_now()))return __fca_ok(false);
  for(let i=0;i<__FCA_RECORDS;i++)if(l.reservedSlot(i)!=i||l.reservedGeneration(i)!=1)return __fca_ok(false);
  return __fca_ok(l.consume(1,__FCA_HANDLES,1,1,__FCA_SCRATCH,false,__fca_now())&&l.consume(1,__FCA_HANDLES+1,1,1,__FCA_ENCODING,false,__fca_now())&&l.consume(1,__FCA_HANDLES+2,1,1,__FCA_READER,false,__fca_now()));
}
function __fca_acquire(local:i32):bool{const s=__fca_slot(local);return __fetch_ra!==null&&__fca_ok(__fetch_ra!.beginAcquire(1,s,1,__fca_ns(s),1,local>=5,__fca_now()));}
function __fca_acquired(local:i32,status:i32,handle:i32):i32{const l=__fetch_ra!,s=__fca_slot(local);if(status==0)__fca_ok(l.acquired(1,s,1,__fca_ns(s),1,u32(handle)));else l.noAcquisition(1,s,1,__fca_ns(s),1,false);return status;}
function __fca_new(local:i32,out:usize):i32{if(!__fca_acquire(local))return 1;const ns=__fca_ns(__fca_slot(local));return __fca_acquired(local,ns==1?fastly_http_req_new(out):ns==2?fastly_http_resp_new(out):fastly_http_body_new(out),load<i32>(out));}
function __fca_dispose_slot(s:i32):i32{
  if(__fetch_ra===null)return 1;const l=__fetch_ra!,ns=__fca_ns(s);
  if(l.bank[s*8+5]!=PRL_LIVE||!l.beginDispose(1,s,1,ns,1,__fca_now()))return 1;
  const h=i32(l.bank[s*8+6]);const status=ns==1?__pulse_fetch_close_request(h):ns==2?__pulse_fetch_close_response(h):__pulse_fetch_close_body(h);l.disposed(1,s,1,ns,1,status==0);return status;
}
function __fca_dispose(local:i32):i32{return __fca_dispose_slot(__fca_slot(local));}
function __fca_dispatch(request:i32,body:i32,backend:usize,length:i32,out:usize):i32{
  if(!__fca_acquire(2)||!__fca_acquire(3)||!__fca_acquire(4))return 1;
  const l=__fetch_ra!,b=__fca_frame*5;
  if(!l.beginDispose(1,b,1,1,1,__fca_now())||!l.beginDispose(1,b+1,1,3,1,__fca_now()))return 1;
  const status=fastly_http_req_send_async(request,body,backend,length,out);
  l.disposed(1,b,1,1,1,status==0);l.disposed(1,b+1,1,3,1,status==0);return __fca_acquired(2,status,load<i32>(out));
}
function __fca_find(handle:i32,local:i32):bool{
  if(__fetch_ra===null)return false;const l=__fetch_ra!;
  for(let i=0;i<__FCA_COUNT;i++){const s=(i*5+local)*8;if(l.bank[s+5]==PRL_LIVE&&l.bank[s+6]==u32(handle)){__fca_frame=i;return true;}}
  return false;
}
function __fca_poll(handle:i32,detail:usize,done:usize,response:usize,body:usize):i32{
  if(!__fca_find(handle,2)||__fca_now()>=__FCA_DURATION)return 1;
  const l=__fetch_ra!,b=__fca_frame*5;
  const status=__pulse_fetch_poll(handle,detail,done,response,body),ready=load<i32>(done);
  if(status!=0||(ready!=0&&ready!=1)){l.uncertain(1,b+2,1,4,1);l.noAcquisition(1,b+3,1,2,1,false);l.noAcquisition(1,b+4,1,3,1,false);return status==0?2:status;}
  if(ready==1){l.transferred(1,b+2,1,4,1);__fca_acquired(3,0,load<i32>(response));__fca_acquired(4,0,load<i32>(body));}return 0;
}
function __fca_unreaped():i32{if(__fetch_ra===null)return 0;let n=0;for(let i=0;i<__FCA_COUNT;i++){const s=__fetch_ra!.bank[(i*5+2)*8+5];if(s!=PRL_FREE&&s!=PRL_RESERVED)n++;}return n;}
function __fca_cleanup(final:bool=false):void{
  if(__fetch_ra===null)return;const l=__fetch_ra!;l.close(1);
  for(let i=0;i<__FCA_COUNT;i++)if(!__fca_reaped[i]&&l.bank[(i*5+2)*8+5]==PRL_LIVE){__fca_reaped[i]=true;if(l.cleanupStep(1,false,__fca_now())){__pulse_send_error_detail_reset(__fca_io);store<i32>(__fca_io+20,0);__fca_poll(i32(l.bank[(i*5+2)*8+6]),__fca_io,__fca_io+20,__fca_io+24,__fca_io+28);}}
  for(let s=0;s<__FCA_HANDLES;s++){const state=l.bank[s*8+5];if(state==PRL_RESERVED&&(s<__FCA_HANDLES-2||final))l.unused(1,s,1,__fca_ns(s),1);else if(state==PRL_LIVE&&__fca_ns(s)!=4)__fca_dispose_slot(s);}
}
function __fca_transfer(response:i32,body:i32):i32{
  if(!__fca_find(response,3)||!__fca_work())return 1;
  const l=__fetch_ra!,b=__fca_frame*5;
  if(l.bank[(b+4)*8+6]!=u32(body)||!l.beginDispose(1,b+3,1,2,1,__fca_now())||!l.beginDispose(1,b+4,1,3,1,__fca_now()))return 1;
  const status=fastly_http_resp_send_downstream(response,body,0);l.disposed(1,b+3,1,2,1,status==0);l.disposed(1,b+4,1,3,1,status==0);return status;
}
function __fca_write(body:i32,value:string):i32{
  const bytes=__pulse_fastly_utf8(value);let offset=0;
  while(offset<bytes.byteLength){if(!__fca_work())return 1;store<i32>(__fca_io+20,0);const status=fastly_http_body_write(body,changetype<usize>(bytes)+offset,bytes.byteLength-offset,0,__fca_io+20),n=load<i32>(__fca_io+20);if(status!=0)return status;if(n<=0||n>bytes.byteLength-offset)return 1;offset+=n;}return 0;
}
class __FCA_Header{ name:string;value:string|null;constructor(name:string,value:string|null){this.name=name;this.value=value;} }
function __fca_header(response:__PulseFastlyValue,name:string):string|null{
  if(response.fetchHeaders===null)response.fetchHeaders=new Array<__FCA_Header>();
  for(let i=0;i<response.fetchHeaders!.length;i++){const h=response.fetchHeaders![i];if(h.name==name)return h.value;}
  if(__fca_header_id(name)<0||!__fca_find(response.responseHandle,3)||!__fca_work()){__fca_ok(false);return null;}
  const value=__pulse_header_lookup(response.responseHandle,name,true);response.fetchHeaders!.push(new __FCA_Header(name,value));return value;
}
function __fca_json_type(response:__PulseFastlyValue):bool{
  if(response.fetchJsonType==0){const value=__fca_header(response,'content-type');response.fetchJsonType=value!==null&&value!.length>0&&value!.toLowerCase().indexOf('json')>=0?1:-1;}
  return response.fetchJsonType==1;
}
function __fca_status(response:__PulseFastlyValue):i32{
  if(!__fca_find(response.responseHandle,3)||!__fca_work())return 0;
  if(fastly_http_resp_status_get(response.responseHandle,__fca_io+20)!=0){__pulse_fastly_fail(PULSE_ERROR_HOSTCALL,34,-1);return 0;}
  return host_value_number(load<i32>(__fca_io+20));
}
function __fca_error():bool {
  if(__fetch_ra===null) return false;
  const l=__fetch_ra!;
  // Capture the primary driver failure before cleanup or protected delivery.
  const status=__request_expired || __pulse_fastly_error_stage==271 ? 504
    : __pulse_fastly_last_error==PULSE_ERROR_TRANSPORT ? 502 : 500;
  if(l.primary==0) l.fail(1,u32(status));
  __fca_cleanup();
  if(!__pulse_response_owned() || !l.consume(1,__FCA_HANDLES+3,1,1,64,true,__fca_now())) return true;
  if(__fca_new(5,__fca_io+24)!=0) return true;
  const response=load<i32>(__fca_io+24);
  if(__fca_new(6,__fca_io+28)!=0) return true;
  const body=load<i32>(__fca_io+28);
  if(__fca_now()>=__FCA_DURATION || fastly_http_resp_status_set(response,status)!=0) return true;
  const header='content-typetext/plain; charset=utf-8';
  for(let i=0;i<header.length;i++) store<u8>(__fca_exit+i,u8(header.charCodeAt(i)));
  if(__fca_now()>=__FCA_DURATION || fastly_http_resp_header_append(response,__fca_exit,12,__fca_exit+12,header.length-12)!=0) return true;
  const text=status==504?'Gateway Timeout':status==502?'Bad Gateway':'Internal Server Error';
  for(let i=0;i<text.length;i++) store<u8>(__fca_exit+i,u8(text.charCodeAt(i)));
  let offset=0;
  while(offset<text.length) {
    if(__fca_now()>=__FCA_DURATION) return true;
    const result=fastly_http_body_write(body,__fca_exit+offset,text.length-offset,0,__fca_io+20);
    const written=load<i32>(__fca_io+20);
    if(result!=0 || written<=0 || written>text.length-offset) return true;
    offset+=written;
  }
  if(!l.beginDispose(1,__FCA_HANDLES-2,1,2,1,__fca_now()) || !l.beginDispose(1,__FCA_HANDLES-1,1,3,1,__fca_now())) return true;
  const sent=fastly_http_resp_send_downstream(response,body,0);
  l.disposed(1,__FCA_HANDLES-2,1,2,1,sent==0); l.disposed(1,__FCA_HANDLES-1,1,3,1,sent==0);
  return true;
}
