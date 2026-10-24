'use strict';
// Inventory probe only. Explicit host ownership outcomes are assumptions, not
// platform qualification. Include downstream allocations and borrowed ingress.
function execute(wasm,options={}) {
  let instance,next=100,now=0n,status=200,stagedResponse=false;
  const trace=[],resources=new Map(),counts={},attempts=[],sent=[];
  const bytes=()=>new Uint8Array(instance.exports.memory.buffer),view=()=>new DataView(bytes().buffer);
  const put=(p,n)=>view().setInt32(p,n,true),read=(p,n)=>Buffer.from(bytes().subarray(p,p+n)).toString();
  function event(call,detail={}){trace.push({call,...detail});counts[call]=(counts[call]||0)+1;}
  function fail(call){return options.fail===call && (counts[call]||0)===(options.nth||1);}
  function alloc(kind,extra={}){const h=next++;resources.set(h,{kind,...extra});event('acquire',{h,kind});return h;}
  function get(h){const r=resources.get(h);if(!r)throw Error('unknown live handle '+h);return r;}
  function retire(h,action){const r=get(h);resources.delete(h);event(action,{h,kind:r.kind});}
  function close(h,call){event(call,{h});if(!resources.has(h)){event('close-invalid',{h});return 3;}if(fail(call)&&!options.consumeFailure)return 1;retire(h,'release');return fail(call)?1:0;}
  function output(text,p,n,out){const b=Buffer.from(text);if(b.length>n)throw Error('host output overflow');bytes().set(b,p);put(out,b.length);return 0;}
  function newBody(out){const kind=stagedResponse?'output-body':'request-body';event('new.'+kind);if(fail('new.'+kind))return 1;put(out,alloc(kind,{text:''}));return 0;}
  function materialize(pending,rout,bout){retire(pending,'consume');put(rout,alloc('fetch-response'));put(bout,alloc('fetch-body',{text:options.value??'loaded',offset:0}));}
  const imports={
    fastly_abi:{init:()=>0},
    wasi_snapshot_preview1:{clock_time_get:(_id,_p,out)=>{view().setBigUint64(out,now,true);return 0;},fd_write:(_fd,p,n,out)=>{let size=0;for(let i=0;i<n;i++)size+=view().getUint32(p+i*8+4,true);put(out,size);return 0;}},
    fastly_async_io:{select:(p,n,timeout,out)=>{const handles=Array.from({length:n},(_,i)=>view().getInt32(p+i*4,true));handles.forEach(get);event('select',{handles,timeout});if(options.timeout){now+=BigInt(timeout)*1000000n;put(out,-1);}else put(out,0);return 0;}},
    fastly_http_req:{
      body_downstream_get:(r,b)=>{put(r,41);put(b,42);event('borrow',{handles:[41,42],kinds:['incoming-request','incoming-body']});return 0;},
      method_get:(_h,p,n,w)=>output('GET',p,n,w),uri_get:(_h,p,n,w)=>output('https://proof.invalid/',p,n,w),header_value_get:()=>10,
      new:out=>{event('new.request');if(fail('new.request'))return 1;put(out,alloc('request'));return 0;},
      method_set:()=>{event('method');if(options.expireAfterPreparation)now=1000000000n;return fail('method')?1:0;},
      uri_set:()=>{event('uri');return fail('uri')?1:0;},
      header_insert:()=>{event('header');return fail('header')?1:0;},
      send_async:(r,b,_p,_n,out)=>{event('send.async',{r,b});if(fail('send.async')){if(options.consumeFailure){retire(r,'consume-on-failure');retire(b,'consume-on-failure');}return 1;}retire(r,'transfer');retire(b,'transfer');put(out,alloc('pending'));return 0;},
      pending_req_wait_v2:(h,_d,r,b)=>{event('wait',{h});if(fail('wait')){if(options.consumeFailure)retire(h,'consume-on-failure');return 1;}materialize(h,r,b);return 0;},
      pending_req_poll_v2:(h,_d,done,r,b)=>{get(h);event('poll',{h});if(fail('poll')){if(options.consumeFailure)retire(h,'consume-on-failure');return 1;}if(options.lateReady && counts.poll>1){materialize(h,r,b);put(done,1);}else put(done,0);return 0;},
      close:h=>close(h,'close.request')
    },
    fastly_http_body:{
      new:newBody,
      read:(h,p,n,out)=>{const r=get(h);event('read',{h});if(options.trap)throw new WebAssembly.RuntimeError('injected read trap');if(fail('read'))return 1;const b=Buffer.from(r.text),size=Math.min(n,b.length-r.offset);bytes().set(b.subarray(r.offset,r.offset+size),p);r.offset+=size;put(out,size);return 0;},
      write:(h,p,n,_end,out)=>{const r=get(h);const call=r.kind==='request-body'?'write.request':'write.output';event(call,{h});if(fail(call))return 1;r.text+=read(p,n);put(out,n);return 0;},
      close:h=>close(h,'close.body'),abandon:h=>close(h,'abandon.body')
    },
    fastly_http_resp:{
      new:out=>{stagedResponse=true;event('new.output');if(fail('new.output'))return 1;put(out,alloc('output-response'));return 0;},
      status_set:(_h,s)=>{event('status.output');if(fail('status.output'))return 1;status=s;return 0;},
      header_append:()=>{event('header.output');return fail('header.output')?1:0;},
      status_get:(_h,out)=>{put(out,200);return 0;},header_value_get:()=>10,
      close:h=>close(h,'close.response'),
      send_downstream:(r,b,streaming)=>{event('send.downstream',{r,b,streaming});attempts.push({status,body:get(b).text});if(fail('send.downstream')){if(options.consumeFailure){retire(r,'consume-on-failure');retire(b,'consume-on-failure');}return 1;}sent.push({status,body:get(b).text});retire(r,'transfer');if(!streaming)retire(b,'transfer');return 0;}
    }
  };
  let thrown=null;
  try{instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);instance.exports._start();}catch(error){thrown=error.message;}
  let live=0,peak=0;for(const row of trace){if(row.call==='acquire')live++;if(['release','transfer','consume','consume-on-failure'].includes(row.call))live--;peak=Math.max(peak,live);}
  const e=instance?.exports;
  return {trace,sent,attempts,remaining:[...resources].map(([h,r])=>({h,kind:r.kind})),peakOwned:peak,borrowedIngressCount:2,thrown,error:e?.pulse_fastly_last_error(),stage:e?.pulse_fastly_error_stage(),retired:e?.pulse_fastly_fetch_retired(),unreaped:e?.pulse_fastly_fetch_unreaped()};
}
module.exports={execute};
