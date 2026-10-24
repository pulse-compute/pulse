'use strict';
// Injected ABI behavior, not Viceroy or hosted Fastly acceptance.
function execute(wasm, options = {}) {
  let instance, next=100, cpu=0, status=200;
  const trace=[], writes=[];
  const bytes=()=>new Uint8Array(instance.exports.memory.buffer), view=()=>new DataView(bytes().buffer);
  const put=(p,n)=>view().setUint32(p,n,true);
  const output=(value,p,max,w)=>{const b=Buffer.from(value);if(b.length>max)throw Error('fixture output overflow');bytes().set(b,p);put(w,b.length);return 0;};
  function sample(name, callback) {
    trace.push({call:name}); options.beforeObservation?.(instance,name);
    if(options.trap)throw new WebAssembly.RuntimeError('injected observation trap');
    const result=callback();options.afterObservation?.(instance,name);return options.failureStatus??result;
  }
  const imports={
    fastly_abi:{init:()=>0},
    wasi_snapshot_preview1:{clock_time_get:(_id,_p,out)=>{view().setBigUint64(out,BigInt(options.clock?.(instance)??0),true);return 0;}},
    fastly_async_io:{select:()=>{throw Error('Immediate observation must not poll');}},
    fastly_compute_runtime:{
      get_vcpu_ms:p=>sample('vcpu',()=>{view().setBigUint64(p,options.largeInteger?9007199254740992n:BigInt(++cpu),true);return 0;}),
      get_heap_mib:p=>sample('heap',()=>{put(p,12);return 0;})
    },
    fastly_http_downstream:{
      downstream_tls_protocol:(request,p,n,w)=>sample('tls.protocol',()=>{
        if(request!==41)throw Error('wrong request identity');
        const result=output('TLSv1.3',p,n,w);if(options.badLength)put(w,65);if(options.badAscii)bytes()[p]=255;
        return options.tlsUnavailable?10:result;
      }),
      downstream_tls_cipher_openssl_name:(request,p,n,w)=>sample('tls.cipher',()=>{
        if(request!==41)throw Error('wrong request identity');return output('TLS_AES_128_GCM_SHA256',p,n,w);
      })
    },
    fastly_http_req:{body_downstream_get:(r,b)=>{put(r,41);put(b,42);return 0;},
      method_get:(_h,p,n,w)=>output('GET',p,n,w),uri_get:(_h,p,n,w)=>{const result=output('https://proof.invalid/',p,n,w);options.onUri?.(instance);return result;},
      header_value_get:()=>10,close:()=>0},
    fastly_http_resp:{new:p=>{put(p,++next);return 0;},status_set:(_r,s)=>{status=s;return 0;},header_append:()=>0,
      status_get:()=>{throw Error('Object observation must not read a fetch response status');},
      send_downstream:()=>{trace.push({call:'send',status});return 0;},close:()=>0},
    fastly_http_body:{new:p=>{put(p,++next);return 0;},close:()=>0,
      write:(_b,p,n,_end,w)=>{writes.push(Buffer.from(bytes().subarray(p,p+n)).toString());put(w,n);return 0;}}
  };
  instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);
  let thrown=null;
  try{options.beforeStart?.(instance);instance.exports._start();}catch(e){thrown=e.message;}
  const body=writes.join('');let json;try{json=JSON.parse(body);}catch{}
  return {instance,trace,body,json,status,thrown,error:instance.exports.pulse_fastly_last_error(),stage:instance.exports.pulse_fastly_error_stage()};
}
module.exports={execute};
