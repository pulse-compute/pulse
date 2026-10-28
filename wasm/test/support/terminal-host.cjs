'use strict';
// Deliberately small injected ABI model. It proves emitted driver behavior only.
module.exports = function execute(wasm, options = {}) {
  const trace = [], sends = [], bodies = new Map(), responses = new Map();
  let instance, next = 10, clock = 0, calls = 0, trap;
  const memory = () => Buffer.from(instance.exports.memory.buffer);
  const text = (p,n) => memory().subarray(p,p+n).toString('utf8');
  const write = (p,n) => memory().writeInt32LE(n,p);
  const read = (value,p,size,out) => { const b=Buffer.from(value); if(b.length>size)return 4; b.copy(memory(),p);write(out,b.length);return 0; };
  const imports = {
    fastly_abi:{init:()=>0},
    wasi_snapshot_preview1:{clock_time_get:(_id,_precision,out)=>{clock++;memory().writeBigInt64LE(BigInt(options.clock?.(clock) ?? 0)*1000000n,out);return 0;},fd_write:()=>0},
    fastly_http_req:{body_downstream_get:(r,b)=>{write(r,1);write(b,2);return 0;},
      method_get:(_h,p,n,out)=>read('GET',p,n,out),uri_get:(_h,p,n,out)=>read('https://test.invalid'+(options.path||'/transfer'),p,n,out),
      close:()=>options.closeStatus||0},
    fastly_http_body:{close:()=>options.closeStatus||0,new:out=>{const h=next++;bodies.set(h,'');write(out,h);return 0;},
      write:(h,p,n,_end,out)=>{bodies.set(h,(bodies.get(h)||'')+text(p,n));write(out,n);return 0;}},
    fastly_http_resp:{new:out=>{const h=next++;responses.set(h,{status:200});write(out,h);return 0;},
      status_set:(h,status)=>{responses.get(h).status=status;return 0;},header_append:()=>0,
      send_downstream:(h,b)=>{sends.push({...responses.get(h),body:bodies.get(b)});return 0;}},
    fastly_async_io:{select:()=>{throw Error('terminal service must not poll');}}
  };
  const declarations=WebAssembly.Module.imports(new WebAssembly.Module(wasm));
  for(const d of declarations) if(!imports[d.module]?.[d.name]) {
    if(d.module!==options.abi || d.name!==(options.abiName||'handoff')) throw Error('Unexpected model import '+d.module+'.'+d.name);
    (imports[d.module]??={})[d.name]=(req,p,n)=>{calls++;options.onDispatch?.(instance.exports);trace.push({kind:'dispatch',request:req,backend:text(p,n)});if(options.trap)throw new WebAssembly.RuntimeError('injected dispatch trap');return options.status||0;};
  }
  for(const [module,ns] of Object.entries(imports))for(const [name,fn] of Object.entries(ns)) ns[name]=(...args)=>{trace.push({module,name,args});const value=fn(...args);options.afterCall?.(module,name,instance.exports);return value;};
  instance=new WebAssembly.Instance(new WebAssembly.Module(wasm),imports);
  try{if(options.run)options.run(instance.exports);else instance.exports._start()}catch(error){trap=error;}
  return {instance,trace,sends,calls,trap,error:instance.exports.pulse_fastly_last_error(),stage:instance.exports.pulse_fastly_error_stage(),
    closes:trace.filter(x=>x.name==='close'),clock};
};
