'use strict';
// Injected host with a separate resource ledger. No engine or hosted acceptance.
function execute(wasm, options={}) {
  let instance,next=0,response=10000,status=200,expired=false,stagedRequest=null;
  const trace=[],resources=new Map(),committed=[],responseWrites=[],calls={};
  const bytes=()=>new Uint8Array(instance.exports.memory.buffer);
  const view=()=>new DataView(bytes().buffer);
  const put=(p,n)=>view().setInt32(p,n,true);
  const read=(p,n)=>Buffer.from(bytes().subarray(p,p+n)).toString();
  const output=(s,p,n,w)=>{const b=Buffer.from(s);if(b.length>n)throw Error('host buffer overflow');bytes().set(b,p);put(w,b.length);return 0;};
  function event(call,detail={}) { const row={call,...detail};trace.push(row);calls[call]=(calls[call]||0)+1;return row; }
  function done(call) {if(options.expireAt===call)expired=true;options.after?.(instance,call);}
  function failure(call) {return (Array.isArray(options.failAt)?options.failAt.includes(call):options.failAt===call) && (!options.failNth || calls[call]===options.failNth);}
  function alloc(kind,data={}) {const h=next++;resources.set(h,{kind,...data});event('acquire',{h,kind});return h;}
  function get(h,kind) {const r=resources.get(h);if(!r || (kind && r.kind!==kind))throw Error('invalid ownership '+h+' '+kind);return r;}
  function release(h,action) {const r=get(h);resources.delete(h);event('release',{h,kind:r.kind,action});}
  function close(h,abandon=false) {
    if(!resources.has(h)){if(h<100)throw Error('double or foreign close '+h);return 0;} // response bodies are outside this ledger
    const r=get(h),call=abandon?'abandon':r.kind==='writer'?'commit':r.kind==='reader'?'reader.close':'fetch.body.close';event(call,{h});
    if(options.trapAt===call)throw new WebAssembly.RuntimeError('injected '+call+' trap');
    if(failure(call) && !options.consumeOnFailure){done(call);return 3;}
    if(r.kind==='writer'&&!abandon)committed.push({key:r.key,value:r.value});
    release(h,call);done(call);return failure(call)?3:0;
  }
  const imports={
    fastly_abi:{init:()=>0},wasi_snapshot_preview1:{fd_write:(_fd,p,n,out)=>{let total=0;for(let i=0;i<n;i++)total+=view().getInt32(p+i*8+4,true);put(out,total);event('diagnostic',{bytes:total});return 0;},clock_time_get:(_id,_p,out)=>{view().setBigUint64(out,expired?1000000000n:0n,true);return 0;}},
    fastly_async_io:{
      select:(p,n,timeout,out)=>{const hs=Array.from({length:n},(_,i)=>view().getInt32(p+i*4,true));event('select',{hs,timeout});
        hs.forEach(h=>get(h));const timedOut=options.timeoutSelect || hs.some(h=>get(h).kind===options.timeoutKind);if(timedOut || failure('select')){expired=!!timedOut;put(out,-1);return timedOut?0:3;}
        put(out,0);done('select');return 0;},
      is_ready:(h,out)=>{get(h,'cache');event('is_ready',{h});put(out,options.pendingOnCleanup?0:1);return failure('is_ready')?3:0;}
    },
    fastly_cache:{
      lookup:(p,n,_mask,_opts,out)=>{const key=read(p,n);event('lookup',{key});if(failure('lookup'))return 3;
        put(out,alloc('cache',{key}));done('lookup');return 0;},
      insert:(p,n,_mask,opts,out)=>{const key=read(p,n);event('insert',{key,ttlNs:view().getBigUint64(opts,true).toString()});if(failure('insert'))return 3;
        put(out,alloc('writer',{key,value:''}));done('insert');return 0;},
      get_state:(h,out)=>{const r=get(h,'cache');event('state',{h});if(failure('state'))return 3;
        put(out,(options.miss || options.missKeys?.includes(r.key))?0:options.stale?7:3);done('state');return 0;},
      get_body:(h,_mask,_opts,out)=>{const r=get(h,'cache');event('body',{h});if(failure('body'))return 3;
        put(out,alloc('reader',{key:r.key,value:options.value??('value:'+r.key),offset:0}));done('body');return 0;},
      close:h=>{get(h,'cache');event('cache.close',{h});if(failure('cache.close')&&!options.consumeOnFailure)return 3;
        release(h,'cache.close');done('cache.close');return failure('cache.close')?3:0;}
    },
    fastly_http_body:{
      read:(h,p,n,out)=>{const r=get(h);if(!['reader','fetch-body'].includes(r.kind))throw Error('invalid reader');const call=r.kind==='reader'?'read':'fetch.read';event(call,{h});if(options.trapAt==='read')throw new WebAssembly.RuntimeError('injected read trap');if(failure(call))return 3;
        const b=Buffer.from(r.value),len=Math.min(n,options.chunk??8,b.length-r.offset);bytes().set(b.subarray(r.offset,r.offset+len),p);r.offset+=len;
        put(out,options.badLength?n+1:len);done(call);return 0;},
      write:(h,p,n,_end,out)=>{if(!resources.has(h)){responseWrites.push(read(p,n));put(out,n);return 0;}
        const r=get(h,'writer');event('write',{h,n});if(failure('write'))return 3;
        const len=options.zeroWrite?0:Math.min(n,options.chunk??8);r.value+=read(p,len);put(out,len);done('write');return 0;},
      close:h=>close(h),abandon:h=>close(h,true),new:p=>{put(p,stagedRequest===null?++response:alloc('request-body'));return 0;}
    },
    fastly_http_req:{
      new:out=>{stagedRequest=alloc('request');put(out,stagedRequest);return 0;},
      method_set:()=>0,uri_set:(h,p,n)=>{get(h,'request').url=read(p,n);return 0;},header_insert:()=>0,
      send_async:(h,b,p,n,out)=>{const r=get(h,'request');event('fetch.send',{url:r.url,backend:read(p,n)});
        if(failure('fetch.send')){stagedRequest=null;return 3;}release(h,'send.transfer');release(b,'send.transfer');stagedRequest=null;put(out,alloc('fetch-pending',{url:r.url}));done('fetch.send');return 0;},
      pending_req_wait_v2:(h,_detail,rout,bout)=>{const r=get(h,'fetch-pending');event('fetch.wait',{h});release(h,'wait.consume');
        if(failure('fetch.wait'))return 3;put(rout,alloc('fetch-response'));put(bout,alloc('fetch-body',{value:options.fetchValue??'loaded',offset:0}));done('fetch.wait');return 0;},
      pending_req_poll_v2:(h,_detail,ready,rout,bout)=>{get(h,'fetch-pending');event('fetch.poll',{h});put(ready,0);return 0;},
      body_downstream_get:(r,b)=>{put(r,41);put(b,42);return 0;},method_get:(_h,p,n,w)=>output('GET',p,n,w),
      uri_get:(_h,p,n,w)=>{const s=output('https://proof.invalid/',p,n,w);options.onUri?.(instance);return s;},header_value_get:()=>10,close:h=>{if(resources.has(h))release(h,'request.close');return 0;}},
    fastly_http_resp:{new:p=>{put(p,++response);return 0;},status_set:(_r,s)=>{status=s;return 0;},header_append:()=>0,close:h=>{if(resources.has(h))release(h,'response.close');return 0;},
      status_get:(_h,out)=>{put(out,200);return 0;},send_downstream:()=>{event('send',{status});return 0;}}
  };
  let thrown=null;
  try {instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);instance.exports._start();}catch(e){thrown=e.message;}
  const body=responseWrites.join('');let json;try{json=JSON.parse(body);}catch{}
  const exp=instance?.exports;
  return {trace,body,json,status,thrown,committed,remaining:[...resources].map(([h,r])=>({h,kind:r.kind})),
    error:exp?.pulse_fastly_last_error(),stage:exp?.pulse_fastly_error_stage(),
    composition:exp?.bc_passes?{passes:exp.bc_passes(),invocations:exp.bc_invocations(),progress:exp.bc_progress()}:null,
    counters:exp?.ro_peak?{peak:exp.ro_peak(),owned:exp.ro_owned_count(),unresolved:exp.ro_unresolved(),cleanupErrors:exp.ro_cleanup_errors(),commitAttempts:exp.ro_commits()}:null,instance};
}
module.exports={execute};
