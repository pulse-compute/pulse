// Investigation service: fixed 64-byte text values, 8 live handles, no child effects.
@external("fastly_http_body", "close") declare function __ro_close_body(handle:i32):i32
class __RoOwned {
  cache:i32 = -1
  body:i32 = -1
  writer:bool = false
  cacheReady:bool = false
  ticket:i32 = 0
}
const __ro_owned = new Array<__RoOwned | null>(PULSE_FASTLY_EFFECT_COUNT)
let __ro_delivery:i32 = -1
let __ro_handles:i32 = 0
let __ro_peak:i32 = 0
let __ro_unresolved:i32 = 0
let __ro_cleanup_errors:i32 = 0
let __ro_commit_attempts:i32 = 0
function __ro_slot(index:i32):bool { return /* SLOT */ }
function __ro_fail(index:i32, stage:i32):void { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL,stage,index) }
function __ro_live(index:i32):bool {
  const r=__ro_owned[index]
  if (__pulse_invocation_closed || __request_expired || r===null || r.ticket<=0 || r.ticket!=unchecked(__pulse_invocation_tickets[index])) { __ro_fail(index,330); return false }
  return __request_check(index)
}
function __ro_room(index:i32):bool {
  if (__ro_handles>=8) { __ro_fail(index,331); return false }
  return true
}
function __ro_adopt(index:i32, handle:i32, body:bool):bool {
  // Host-created handle values are opaque; -1 is the invalid sentinel, zero is valid.
  if (handle == -1) { __ro_fail(index,332); return false }
  const r=__ro_owned[index]!
  for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) {
    const other=__ro_owned[i]
    if(other!==null && (other.cache==handle || other.body==handle)) { __ro_fail(index,332); return false }
  }
  if(body)r.body=handle;else r.cache=handle
  __ro_handles++;__ro_peak=max<i32>(__ro_peak,__ro_handles)
  return true
}
function __ro_retire_body(index:i32, commit:bool=false):bool {
  const r=__ro_owned[index]!
  const handle=r.body;if(handle == -1)return true
  // Detach before a consuming host call; failed consumption is not safely retryable.
  r.body=-1;__ro_handles--
  let status:i32=0
  if(r.writer && !commit) {
    // BEGIN putText
    status=__ro_abandon(handle)
    // END putText
  } else status=__ro_close_body(handle)
  if(status!=0) { __ro_cleanup_errors++;__ro_unresolved++;__ro_fail(index,333);return false }
  return true
}
function __ro_retire_cache(index:i32):bool {
  // BEGIN getText
  const r=__ro_owned[index]!
  const handle=r.cache;if(handle == -1)return true
  r.cache=-1;__ro_handles--
  if(!r.cacheReady) {
    const ready=new StaticArray<i32>(1)
    const status=__ro_is_ready(handle,changetype<usize>(ready))
    // close(cache) may wait. Never perform an unbounded drain after cancellation.
    if(status!=0 || unchecked(ready[0])!=1) { __ro_unresolved++;return false }
  }
  if(__ro_cache_close(handle)!=0) { __ro_cleanup_errors++;__ro_unresolved++;__ro_fail(index,334);return false }
  // END getText
  return true
}
function __ro_cleanup(index:i32):void {
  if(__ro_owned[index]===null)return
  __ro_retire_body(index)
  __ro_retire_cache(index)
}
function __ro_cleanup_all():void { for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) __ro_cleanup(i) }
function __pulse_extension_begin(index:i32):void {
  if(__pulse_invocation_closed || __request_expired || !__request_check(index))return
  if(!__ro_room(index))return
  const r=new __RoOwned();r.ticket=unchecked(__pulse_invocation_tickets[index]);__ro_owned[index]=r
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[index]))
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,"payload"))
  const key=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,"key")))
  if(key.byteLength<1 || key.byteLength>64) { __ro_fail(index,335);return }
  switch(index) { /* BEGIN DISPATCH */ }
}
function __ro_resolve(index:i32):i32 {
  if(!__ro_live(index))return 0
  switch(index) { /* RESOLVE DISPATCH */ }
  __ro_fail(index,336);return 0
}
function __ro_result(index:i32,status:string,value:string=""):i32 {
  if(!__ro_live(index))return 0
  unchecked(__pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_NONE)
  unchecked(__pulse_fastly_pending[index]=0)
  const result=host_value_object()
  host_value_object_set(result,__pulse_fastly_string_value("status"),__pulse_fastly_string_value(status))
  if(status=="hit")host_value_object_set(result,__pulse_fastly_string_value("value"),__pulse_fastly_string_value(value))
  return result
}
// BEGIN getText
@external("fastly_cache", "get_state") declare function __ro_state(handle:i32,out:usize):i32
@external("fastly_cache", "get_body") declare function __ro_body(handle:i32,mask:i32,options:usize,out:usize):i32
@external("fastly_cache", "close") declare function __ro_cache_close(handle:i32):i32
@external("fastly_http_body", "read") declare function __ro_read(handle:i32,out:usize,max:i32,written:usize):i32
@external("fastly_async_io", "is_ready") declare function __ro_is_ready(handle:i32,out:usize):i32
function __ro_begin_getText(index:i32,key:ArrayBuffer):void {
  const out=new StaticArray<i32>(1);unchecked(out[0]=-1)
  if(__ro_get(changetype<usize>(key),key.byteLength,changetype<usize>(out))!=0) { __ro_fail(index,337);return }
  if(!__ro_adopt(index,unchecked(out[0]),false))return
  unchecked(__pulse_fastly_pending[index]=unchecked(out[0]))
  unchecked(__pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_ASYNC)
}
function __ro_finish_getText(index:i32):i32 {
  const r=__ro_owned[index]!;r.cacheReady=true // shared request wait established readiness
  const state=new StaticArray<i32>(1)
  if(__ro_state(r.cache,changetype<usize>(state))!=0) { __ro_fail(index,338);return 0 }
  if(!__ro_live(index))return 0
  if((unchecked(state[0]) & 3)!=3 || (unchecked(state[0]) & 4)!=0) {
    if(!__ro_retire_cache(index))return 0
    return __ro_result(index,"miss")
  }
  if(!__ro_room(index))return 0
  const options=new StaticArray<u64>(2),out=new StaticArray<i32>(1);unchecked(out[0]=-1)
  if(__ro_body(r.cache,0,changetype<usize>(options),changetype<usize>(out))!=0) { __ro_fail(index,339);return 0 }
  if(!__ro_adopt(index,unchecked(out[0]),true))return 0
  const buffer=new Uint8Array(65),written=new StaticArray<i32>(1)
  let total:i32=0,steps:i32=0
  while(true) {
    if(++steps>10) { __ro_fail(index,340);return 0 }
    if(!__ro_live(index) || !__request_wait(r.body,index) || !__ro_live(index))return 0
    unchecked(written[0]=-1)
    if(__ro_read(r.body,buffer.dataStart+total,65-total,changetype<usize>(written))!=0) { __ro_fail(index,341);return 0 }
    const n=unchecked(written[0])
    if(n<0 || n>65-total || total+n>64) { __ro_fail(index,342);return 0 }
    total+=n
    if(n==0)break
  }
  for(let i=0;i<total;i++)if(buffer[i]<32 || buffer[i]>126) { __ro_fail(index,343);return 0 }
  if(!__ro_retire_body(index) || !__ro_retire_cache(index))return 0
  return __ro_result(index,"hit",String.UTF8.decodeUnsafe(buffer.dataStart,total))
}
// END getText
// BEGIN putText
@external("fastly_http_body", "write") declare function __ro_write(handle:i32,data:usize,n:i32,end:i32,written:usize):i32
@external("fastly_http_body", "abandon") declare function __ro_abandon(handle:i32):i32
function __ro_begin_putText(index:i32,key:ArrayBuffer):void {
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[index]))
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,"payload"))
  const bytes=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,"value")))
  if(bytes.byteLength>64) { __ro_fail(index,344);return }
  const out=new StaticArray<i32>(1);unchecked(out[0]=-1)
  if(__ro_put(changetype<usize>(key),key.byteLength,changetype<usize>(out))!=0) { __ro_fail(index,345);return }
  const r=__ro_owned[index]!;r.writer=true
  if(!__ro_adopt(index,unchecked(out[0]),true))return
  unchecked(__pulse_fastly_pending[index]=unchecked(out[0]))
  unchecked(__pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_ASYNC)
}
function __ro_finish_putText(index:i32):i32 {
  const r=__ro_owned[index]!
  const outer=__pulse_fastly_value(unchecked(__pulse_fastly_payloads[index]))
  const payload=__pulse_fastly_value(__pulse_fastly_payload_field(outer,"payload"))
  const bytes=__pulse_fastly_utf8(__pulse_fastly_string(__pulse_fastly_payload_field(payload,"value")))
  const written=new StaticArray<i32>(1)
  let offset:i32=0,steps:i32=0
  while(offset<bytes.byteLength) {
    if(++steps>4) { __ro_fail(index,346);return 0 }
    if(!__ro_live(index) || !__request_wait(r.body,index) || !__ro_live(index))return 0
    unchecked(written[0]=-1)
    if(__ro_write(r.body,changetype<usize>(bytes)+offset,bytes.byteLength-offset,0,changetype<usize>(written))!=0) { __ro_fail(index,347);return 0 }
    const n=unchecked(written[0])
    if(n<=0 || n>bytes.byteLength-offset) { __ro_fail(index,348);return 0 }
    offset+=n
  }
  if(!__ro_live(index))return 0
  __ro_commit_attempts++
  if(!__ro_retire_body(index,true))return 0
  return __ro_result(index,"stored")
}
// END putText
