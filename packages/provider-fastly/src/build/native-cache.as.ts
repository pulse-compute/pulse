// Nontransactional cache service. Existing driver tickets and waits own progress.
@external('fastly_cache','lookup') declare function __cache_lookup(key:usize,length:i32,mask:i32,options:usize,out:usize):i32;
@external('fastly_cache','insert') declare function __cache_insert(key:usize,length:i32,mask:i32,options:usize,out:usize):i32;
@external('fastly_cache','get_state') declare function __cache_get_state(handle:i32,out:usize):i32;
@external('fastly_cache','get_body') declare function __cache_get_body(handle:i32,mask:i32,options:usize,out:usize):i32;
@external('fastly_cache','close') declare function __cache_close(handle:i32):i32;
@external('fastly_async_io','is_ready') declare function __cache_is_ready(handle:i32,out:usize):i32;
@external('fastly_http_body','abandon') declare function __cache_abandon(handle:i32):i32;
@external('fastly_http_resp','close') declare function __cache_response_close(handle:i32):i32;
const __cache_io:usize=memory.data(256);
const __cache_ready=new StaticArray<bool>(__CACHE_COUNT);
let __cache_ra:PulseResourceLedger|null=null;
let __cache_origin:i64=0;
let __cache_cleaned:bool=false;
function __cache_now():u64 {
  const n=__request_clock();
  if(n<__cache_origin||__request_expired){return PRL_SAFE+1;}
  if(n>=__request_deadline)__request_expired=true;
  return u64(n-__cache_origin);
}
function __cache_fail(stage:i32,index:i32=-1):bool {
  __pulse_fastly_fail(PULSE_ERROR_HOSTCALL,stage,index);
  if(__cache_ra!==null)__cache_ra!.fail(1,u32(stage));
  return false;
}
function __cache_time():bool{return __cache_now()<__CACHE_DURATION||__cache_fail(300);}
function __cache_start(index:i32):bool {
  if(__pulse_fastly_last_error!=0)return false;
  if(index<0||index>=__CACHE_COUNT||__pulse_invocation_tickets[index]<=0||__pulse_invocation_tickets[index]!=__pulse_invocation_count||__pulse_invocation_count>__CACHE_COUNT)return __cache_fail(301,index);
  if(__cache_ra===null){
    __cache_origin=__request_deadline-i64(__CACHE_DURATION);
    const l=new PulseResourceLedger(1,__CACHE_RECORDS,__CACHE_HANDLES,__CACHE_BACKING,__CACHE_STEPS+2,__CACHE_COUNT,__CACHE_DURATION,__CACHE_STORAGE);__cache_ra=l;
    if(!l.begin(1,__cache_now(),__CACHE_STEPS,2,__CACHE_COUNT,true))return __cache_fail(301,index);
    for(let s=0;s<__CACHE_HANDLES;s++)if(!l.stageRecord(1,1,__cache_ns(s),1,s>=__CACHE_HANDLES-2?3:1,0))return __cache_fail(301,index);
    if(!l.stageRecord(1,2,0,1,1,__CACHE_SCRATCH)||!l.stageRecord(1,2,0,1,1,__CACHE_ENCODING)||!l.stageRecord(1,2,0,1,1,__CACHE_READER)||!l.stageRecord(1,2,0,1,3,64)||!l.stageRecord(1,3,0,1,1,0)||!l.commit(1,__cache_now()))return __cache_fail(301,index);
    for(let s=0;s<__CACHE_RECORDS;s++)if(l.reservedSlot(s)!=s||l.reservedGeneration(s)!=1)return __cache_fail(301,index);
    if(!l.consume(1,__CACHE_HANDLES,1,1,__CACHE_SCRATCH,false,__cache_now())||!l.consume(1,__CACHE_HANDLES+1,1,1,__CACHE_ENCODING,false,__cache_now())||!l.consume(1,__CACHE_HANDLES+2,1,1,__CACHE_READER,false,__cache_now()))return __cache_fail(301,index);
  }
  return __cache_time();
}
function __cache_acquire(slot:i32):bool {
  return __cache_ra!==null&&(__cache_ra!.beginAcquire(1,slot,1,__cache_ns(slot),1,slot>=__CACHE_HANDLES-2,__cache_now())||__cache_fail(301));
}
function __cache_acquired(slot:i32,status:i32):bool {
  const l=__cache_ra!;
  if(status!=0||load<u32>(__cache_io)==0xffffffff){l.noAcquisition(1,slot,1,__cache_ns(slot),1,false);return __cache_fail(302);}
  return l.acquired(1,slot,1,__cache_ns(slot),1,load<u32>(__cache_io))||__cache_fail(302);
}
function __cache_handle(slot:i32):i32{return i32(__cache_ra!.bank[slot*8+6]);}
function __cache_live(slot:i32):bool{return __cache_ra!==null&&__cache_ra!.bank[slot*8+5]==PRL_LIVE;}
function __cache_dispose(slot:i32,commit:bool=false):bool {
  const l=__cache_ra!,ns=__cache_ns(slot);
  if(!l.beginDispose(1,slot,1,ns,1,__cache_now()))return false;
  const h=__cache_handle(slot);
  // Fence before entry. A failed commit is unknown, never followed by abandon.
  const status=__CACHE_READS&&ns==5?__cache_close(h):ns==2?__cache_response_close(h)
    :__CACHE_WRITES&&__cache_writer_slot(slot)&&!commit?__cache_abandon(h):__pulse_fetch_close_body(h);
  l.disposed(1,slot,1,ns,1,status==0);
  return status==0;
}
function __cache_begin(index:i32,payload:__PulseFastlyValue):void {
  if(!__cache_start(index)||!__cache_acquire(__cache_slot(index)))return;
  const key=String.UTF8.encode(__cache_key(index));
  memory.fill(__cache_io,0,256);store<i32>(__cache_io,-1);
  store<u64>(__cache_io+64,__cache_ttl(index));
  if(!__cache_time())return;
  const status=(!__CACHE_READS||(__CACHE_WRITES&&__cache_put(index)))?__cache_insert(changetype<usize>(key),key.byteLength,0,__cache_io+64,__cache_io)
    :__cache_lookup(changetype<usize>(key),key.byteLength,0,__cache_io+64,__cache_io);
  if(!__cache_acquired(__cache_slot(index),status))return;
  __pulse_fastly_pending[index]=__cache_handle(__cache_slot(index));
  __pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_ASYNC;
}
function __cache_result(status:string,text:string=''):i32 {
  const output=host_value_object();host_value_object_set(output,__pulse_fastly_string_value('status'),__pulse_fastly_string_value(status));
  if(status=='found')host_value_object_set(output,__pulse_fastly_string_value('text'),__pulse_fastly_string_value(text));
  return output;
}
function __cache_wait(index:i32):i32 {
  if(__pulse_fastly_last_error!=0||!__cache_live(__cache_slot(index))||!__cache_time())return 0;
  // The canonical resolver has completed its original-deadline readiness wait.
  __cache_ready[index]=true;
  __pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_NONE;__pulse_fastly_pending[index]=0;
  const root=__cache_handle(__cache_slot(index));
  if(__CACHE_WRITES&&__cache_put(index)){
    const bytes=String.UTF8.encode(__cache_text(index));let offset=0;
    // At most byteLength iterations; each successful iteration must progress.
    while(offset<bytes.byteLength){
      if(!__request_wait(root,index)||!__cache_time())return 0;
      store<i32>(__cache_io+4,0);
      const status=fastly_http_body_write(root,changetype<usize>(bytes)+offset,bytes.byteLength-offset,0,__cache_io+4),n=load<i32>(__cache_io+4);
      if(status!=0||n<=0||n>bytes.byteLength-offset){__cache_fail(303,index);return 0;}
      offset+=n;
    }
    if(!__request_wait(root,index)||!__cache_time())return 0;
    if(!__cache_dispose(__cache_slot(index),true)){__cache_fail(304,index);return 0;}
    return __cache_time()?__cache_result('stored'):0;
  }
  if(__CACHE_READS){
  store<i32>(__cache_io+4,-1);
  if(__cache_get_state(root,__cache_io+4)!=0){__cache_fail(305,index);return 0;}
  const state=load<u32>(__cache_io+4);
  // Core-cache v1 bits. Unknown bits and USABLE without FOUND fail closed.
  if((state&~u32(15))!=0||((state&2)!=0&&(state&1)==0)){__cache_fail(305,index);return 0;}
  if((state&3)!=3){
    if(!__cache_dispose(__cache_slot(index))){__cache_fail(306,index);return 0;}
    return __cache_time()?__cache_result('miss'):0;
  }
  if(!__cache_acquire(__cache_slot(index)+1))return 0;
  memory.fill(__cache_io+64,0,128);store<i32>(__cache_io,-1);
  if(!__cache_time())return 0;
  if(!__cache_acquired(__cache_slot(index)+1,__cache_get_body(root,0,__cache_io+64,__cache_io)))return 0;
  const reader=__cache_handle(__cache_slot(index)+1),bound=__cache_bound(index),bytes=new Uint8Array(bound+1);let length=0;
  while(true){
    // Qualification blocker: Viceroy 0.21.1 may consume a body error in this
    // wait and expose EOF below. Keep the bounded wait and failing wire proof;
    // do not treat injected-host coverage as qualification of that host.
    if(!__request_wait(reader,index)||!__cache_time())return 0;
    store<i32>(__cache_io+4,0);
    const status=fastly_http_body_read(reader,bytes.dataStart+length,bound+1-length,__cache_io+4),n=load<i32>(__cache_io+4);
    if(status!=0){__cache_fail(307,index);return 0;}
    if(n<0||n>bound+1-length||length+n>bound){__cache_fail(308,index);return 0;}
    length+=n;if(n==0)break;
  }
  if(!__pulse_request_utf8_valid(bytes,length)){__cache_fail(309,index);return 0;}
  const text=String.UTF8.decodeUnsafe(bytes.dataStart,length);
  const bodyClosed=__cache_dispose(__cache_slot(index)+1),lookupClosed=__cache_dispose(__cache_slot(index));
  if(!bodyClosed||!lookupClosed){__cache_fail(306,index);return 0;}
  return __cache_time()?__cache_result('found',text):0;
  }
  return 0;
}
function __cache_cleanup(final:bool=false):void {
  if(__cache_ra===null)return;
  const l=__cache_ra!;l.close(1);
  if(!__cache_cleaned){
    __cache_cleaned=true;
    for(let i=0;i<__CACHE_COUNT;i++){
      if(!__cache_put(i)&&__cache_live(__cache_slot(i)+1))__cache_dispose(__cache_slot(i)+1);
      if(!__cache_live(__cache_slot(i)))continue;
      if(__CACHE_READS&&!__cache_put(i)&&!__cache_ready[i]){
        if(!l.cleanupStep(1,false,__cache_now()))continue;
        store<i32>(__cache_io+4,0);
        const status=__cache_is_ready(__cache_handle(__cache_slot(i)),__cache_io+4);
        if(status!=0||load<i32>(__cache_io+4)!=1)continue;
        __cache_ready[i]=true;
      }
      __cache_dispose(__cache_slot(i)); // Writers abandon; an unready lookup never closes.
    }
  }
  for(let s=0;s<__CACHE_HANDLES;s++)if(l.bank[s*8+5]==PRL_RESERVED&&(final||s<__CACHE_HANDLES-2))l.unused(1,s,1,__cache_ns(s),1);
  if(final)for(let s=__CACHE_HANDLES-2;s<__CACHE_HANDLES;s++)if(__cache_live(s))__cache_dispose(s);
}
function __cache_error():bool {
  // Even failure before admission cannot borrow a fresh response deadline.
  if(__cache_ra===null)return __request_expired;
  const l=__cache_ra!;if(l.primary==0)l.fail(1,u32(__pulse_fastly_error_stage));
  __cache_cleanup();
  if(!__pulse_response_owned()||!l.consume(1,__CACHE_HANDLES+3,1,1,64,true,__cache_now()))return true;
  const rs=__CACHE_HANDLES-2,bs=__CACHE_HANDLES-1;
  if(!__cache_acquire(rs)||!__cache_acquired(rs,fastly_http_resp_new(__cache_io)))return true;
  if(!__cache_acquire(bs)||!__cache_acquired(bs,fastly_http_body_new(__cache_io)))return true;
  const response=__cache_handle(rs),body=__cache_handle(bs);
  if(!__cache_time()||fastly_http_resp_status_set(response,500)!=0)return true;
  const text='Internal Server Error';for(let i=0;i<text.length;i++)store<u8>(__cache_io+192+i,u8(text.charCodeAt(i)));
  let offset=0;
  while(offset<text.length){
    if(!__cache_time())return true;store<i32>(__cache_io+4,0);
    const status=fastly_http_body_write(body,__cache_io+192+offset,text.length-offset,0,__cache_io+4),n=load<i32>(__cache_io+4);
    if(status!=0||n<=0||n>text.length-offset)return true;offset+=n;
  }
  if(!l.beginDispose(1,rs,1,2,1,__cache_now())||!l.beginDispose(1,bs,1,3,1,__cache_now()))return true;
  const sent=fastly_http_resp_send_downstream(response,body,0);
  l.disposed(1,rs,1,2,1,sent==0);l.disposed(1,bs,1,3,1,sent==0);return true;
}
