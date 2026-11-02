// Optional transport observations reuse the fetch driver's existing wait set.
@external('fastly_async_io', 'is_ready') declare function __pulse_timing_ready(handle:i32,out:usize):i32
const __pulse_timing_starts = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_timing_ends = new StaticArray<i64>(PULSE_FASTLY_EFFECT_COUNT)
const __pulse_timing_clock_out = new StaticArray<i64>(1)
const __pulse_timing_io = new StaticArray<i32>(1)
class __PulseTimedBody {
  value:i32; bytes:Uint8Array; total:i32=0; done:bool=false; last:i64=-2;
  constructor(value:i32) { this.value=value; this.bytes=new Uint8Array(__PULSE_SCHEMA_MAX_BYTES+1); }
}
const __pulse_timing_bodies = new Array<__PulseTimedBody|null>(PULSE_FASTLY_EFFECT_COUNT)
function __pulse_timing_selected(index:i32):bool { return /*TIMED*/ }
function __pulse_timing_projected(index:i32):bool { return /*PROJECTED*/ }
function __pulse_timing_clock():i64 {
  if(wasi_snapshot_preview1_clock_time_get(1,1,changetype<usize>(__pulse_timing_clock_out))!=0)return -1;
  return __pulse_timing_clock_out[0]>=0?__pulse_timing_clock_out[0]:-1;
}
function __pulse_timing_reset(index:i32):void {
  __pulse_timing_starts[index]=-1; __pulse_timing_ends[index]=-2; __pulse_timing_bodies[index]=null;
}
function __pulse_timing_begin(index:i32):void { if(__pulse_timing_selected(index))__pulse_timing_starts[index]=__pulse_timing_clock(); }
function __pulse_timing_end(index:i32):void { if(__pulse_timing_selected(index)&&__pulse_timing_ends[index]==-2)__pulse_timing_ends[index]=__pulse_timing_clock(); }
function __pulse_timing_elapsed(index:i32):i32 {
  const a=__pulse_timing_starts[index],b=__pulse_timing_ends[index];
  return a<0||b<a?host_value_null():host_value_number(f64(b-a)/1000000.0);
}
function __pulse_timing_active():bool {
  for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) {
    if(__pulse_timing_selected(i)&&__pulse_fetch_active(i))return true;
    const row=__pulse_timing_bodies[i];if(row!==null&&!row.done)return true;
  }
  return false;
}
function __pulse_timing_headers(index:i32,value:i32):void {
  if(!__pulse_timing_projected(index)){__pulse_fetch_complete(index,0,value);return;}
  if(__PULSE_SCHEMA_MAX_BYTES<=0||__PULSE_SCHEMA_MAX_BYTES>1073741823){__pulse_fastly_fail(PULSE_ERROR_SCHEMA,21,index);return;}
  // The member timeout ends at headers; enclosing authority still fences reads.
  __pulse_fetch_timeout[index]=0;
  __pulse_fastly_pending_mode[index]=PULSE_FASTLY_PENDING_READY;
  __pulse_fastly_pending[index]=0;
  __pulse_timing_bodies[index]=new __PulseTimedBody(value);
}
function __pulse_timing_read_round():void {
  const out=__pulse_timing_io;
  for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) {
    const row=__pulse_timing_bodies[i]; if(row===null||row.done)continue;
    if(!__pulse_fetch_request_check(i))return;
    const value=__pulse_fastly_value(row.value);
    out[0]=-1;
    if(__pulse_timing_ready(value.bodyHandle,changetype<usize>(out))!=0||out[0]<0||out[0]>1){__pulse_fastly_fail(PULSE_ERROR_HOSTCALL,272,i);return;}
    if(out[0]==0)continue;
    const capacity=min<i32>(PULSE_FASTLY_BUFFER_BYTES,row.bytes.length-row.total);
    out[0]=-1;
    const status=fastly_http_body_read(value.bodyHandle,row.bytes.dataStart+row.total,capacity,changetype<usize>(out));
    if(status!=0){row.done=true;__pulse_fetch_complete(i,status);continue;}
    if(out[0]<0||out[0]>capacity){__pulse_fastly_fail(PULSE_ERROR_HOSTCALL,20,i);return;}
    if(out[0]==0){row.done=true;if(row.last!=-2)__pulse_timing_ends[i]=row.last;__pulse_fetch_complete(i,0,row.value);continue;}
    const sample=__pulse_timing_clock();
    row.last=row.last==-1||sample<row.last?-1:sample;
    row.total+=out[0];
    if(row.total>__PULSE_SCHEMA_MAX_BYTES){__pulse_fastly_fail(PULSE_ERROR_SCHEMA,21,i);return;}
  }
}
function __pulse_timing_decode(value:__PulseFastlyValue):bool {
  if(value.bodyLoaded!=0)return true;
  for(let i=0;i<PULSE_FASTLY_EFFECT_COUNT;i++) {
    const row=__pulse_timing_bodies[i];
    if(row!==null&&row.done&&__pulse_fastly_value(row.value)===value){
      value.text=__pulse_fastly_decode(row.bytes,row.total);value.bodyLoaded=1;
      __pulse_timing_bodies[i]=null;return true;
    }
  }
  return false;
}
