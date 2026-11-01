// Fixed one-cohort adapter. The existing effect owner and scheduler retain all
// dispatch/completion authority. Claims and retained text are never recycled.
let __fetch_ra: PulseResourceLedger | null = null;
let __fca_origin:i64 = 0;
let __fca_clock_failed:bool = false;
let __fca_reaped:bool = false;
const __fca_io:usize = memory.data(32);
const __fca_exit:usize = memory.data(64);
function __fca_ns(slot:i32):u32 { return slot == 0 ? 1 : slot == 2 ? 4 : slot == 3 || slot == 5 ? 2 : 3; }
function __fca_now():u64 {
  if (__fca_clock_failed) return PRL_SAFE + 1;
  const now = __request_clock();
  if (now < __fca_origin || __request_expired) { __fca_clock_failed = true; return PRL_SAFE + 1; }
  if (now >= __request_deadline) __request_expired = true;
  return u64(now - __fca_origin);
}
function __fca_work():bool { return __fca_ok(__fca_now() < __FCA_DURATION); }
function __fca_ok(ok:bool):bool {
  if (!ok) __pulse_fastly_fail(PULSE_ERROR_HOSTCALL,272,0);
  return ok;
}
function __fca_start():bool {
  if (__fetch_ra !== null || __request_deadline < 0 || __request_last_clock < 0
    || __pulse_invocation_count != 1 || __pulse_invocation_tickets[0] != 1) return __fca_ok(false);
  __fca_origin = __request_deadline - i64(__FCA_DURATION);
  const l = new PulseResourceLedger(1,__FCA_RECORDS,7,__FCA_BACKING,7,1,__FCA_DURATION,__FCA_STORAGE);
  __fetch_ra = l;
  if (!l.begin(1,__fca_now(),5,2,1,true)) return __fca_ok(false);
  for (let i=0;i<7;i++) if (!l.stageRecord(1,1,__fca_ns(i),1,i>=5?3:1,0)) return __fca_ok(false);
  if (!l.stageRecord(1,2,0,1,1,100) || !l.stageRecord(1,2,0,1,1,__FCA_ENCODING)
    || !l.stageRecord(1,2,0,1,1,__FCA_READER) || !l.stageRecord(1,2,0,1,3,64)
    || !l.stageRecord(1,3,0,1,1,0)
    /*FCA_HEADER_STAGE*/ || !l.commit(1,__fca_now())) return __fca_ok(false);
  for (let i=0;i<__FCA_RECORDS;i++) if (l.reservedSlot(i)!=i || l.reservedGeneration(i)!=1) return __fca_ok(false);
  return __fca_ok(l.consume(1,7,1,1,100,false,__fca_now())
    && l.consume(1,8,1,1,__FCA_ENCODING,false,__fca_now())
    && l.consume(1,9,1,1,__FCA_READER,false,__fca_now())
    /*FCA_HEADER_CONSUME*/);
}
function __fca_acquire(slot:i32):bool {
  return __fetch_ra !== null && __fca_ok(__fetch_ra!.beginAcquire(1,slot,1,__fca_ns(slot),1,slot>=5,__fca_now()));
}
function __fca_acquired(slot:i32,status:i32,handle:i32):i32 {
  const l=__fetch_ra!;
  if(status==0) __fca_ok(l.acquired(1,slot,1,__fca_ns(slot),1,u32(handle)));
  else l.noAcquisition(1,slot,1,__fca_ns(slot),1,false);
  return status;
}
function __fca_new(slot:i32,out:usize):i32 {
  if(!__fca_acquire(slot)) return 1;
  const ns=__fca_ns(slot);
  const status=ns==1?fastly_http_req_new(out):ns==2?fastly_http_resp_new(out):fastly_http_body_new(out);
  return __fca_acquired(slot,status,load<i32>(out));
}
function __fca_dispose(slot:i32):i32 {
  if(__fetch_ra===null) return 1;
  const l=__fetch_ra!,ns=__fca_ns(slot);
  if(l.bank[slot*8+5]!=PRL_LIVE || !l.beginDispose(1,slot,1,ns,1,__fca_now())) return 1;
  const handle=i32(l.bank[slot*8+6]);
  const status=ns==1?__pulse_fetch_close_request(handle):ns==2?__pulse_fetch_close_response(handle):__pulse_fetch_close_body(handle);
  l.disposed(1,slot,1,ns,1,status==0); return status;
}
function __fca_dispatch(request:i32,body:i32,backend:usize,length:i32,out:usize):i32 {
  if(!__fca_acquire(2)||!__fca_acquire(3)||!__fca_acquire(4)) return 1;
  const l=__fetch_ra!;
  if(!l.beginDispose(1,0,1,1,1,__fca_now())||!l.beginDispose(1,1,1,3,1,__fca_now())) return 1;
  const status=fastly_http_req_send_async(request,body,backend,length,out);
  l.disposed(1,0,1,1,1,status==0); l.disposed(1,1,1,3,1,status==0);
  return __fca_acquired(2,status,load<i32>(out));
}
function __fca_poll(handle:i32,detail:usize,done:usize,response:usize,body:usize):i32 {
  const l=__fetch_ra!;
  if(l.bank[2*8+5]!=PRL_LIVE || __fca_now()>=__FCA_DURATION) return 1;
  const status=__pulse_fetch_poll(handle,detail,done,response,body), ready=load<i32>(done);
  if(status!=0 || (ready!=0 && ready!=1)) {
    l.uncertain(1,2,1,4,1); l.noAcquisition(1,3,1,2,1,false); l.noAcquisition(1,4,1,3,1,false);
    return status==0?2:status;
  }
  if(ready==1) {
    l.transferred(1,2,1,4,1);
    __fca_acquired(3,0,load<i32>(response)); __fca_acquired(4,0,load<i32>(body));
  }
  return 0;
}
function __fca_cleanup(final:bool=false):void {
  if(__fetch_ra===null) return;
  const l=__fetch_ra!;
  l.close(1);
  if(!__fca_reaped && l.bank[2*8+5]==PRL_LIVE) {
    __fca_reaped=true;
    if(l.cleanupStep(1,false,__fca_now())) {
      __pulse_send_error_detail_reset(__fca_io); store<i32>(__fca_io+20,0);
      __fca_poll(i32(l.bank[2*8+6]),__fca_io,__fca_io+20,__fca_io+24,__fca_io+28);
    }
  }
  for(let i=0;i<7;i++) {
    const state=l.bank[i*8+5];
    if(state==PRL_RESERVED && (i<5||final)) l.unused(1,i,1,__fca_ns(i),1);
    else if(state==PRL_LIVE && i!=2) __fca_dispose(i);
  }
}
function __fca_error():bool {
  if(__fetch_ra===null) return false;
  const l=__fetch_ra!;
  // Capture the primary driver failure before cleanup or protected delivery.
  const status=__request_expired || __pulse_fastly_error_stage==271 ? 504
    : __pulse_fastly_last_error==PULSE_ERROR_TRANSPORT ? 502 : 500;
  if(l.primary==0) l.fail(1,u32(status));
  __fca_cleanup();
  if(!__pulse_response_owned() || !l.consume(1,10,1,1,64,true,__fca_now())) return true;
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
  if(!l.beginDispose(1,5,1,2,1,__fca_now()) || !l.beginDispose(1,6,1,3,1,__fca_now())) return true;
  const sent=fastly_http_resp_send_downstream(response,body,0);
  l.disposed(1,5,1,2,1,sent==0); l.disposed(1,6,1,3,1,sent==0);
  return true;
}
