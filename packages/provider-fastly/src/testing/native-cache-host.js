'use strict';
// Independent injected authority for the emitted ABI. Never loaded by execution.
function attachCacheHost(imports,host,options) {
 const {view,writeU32,readBytes,readUtf8,alloc,bodies,bodyBytes,trace,now,advance}=host;
 const entries=options.entries || new Map(),lookups=new Map(),writers=new Map(),readers=new Map();
 const event=(name,detail={})=>{const fault=options.onCall?.(name,detail)||{};advance(fault.delayMs||0);trace.push({module:'cache-proof',name,...detail,status:fault.status||0});return fault;};
 imports.fastly_cache={
  lookup(ptr,len,mask,opts,out){const key=readUtf8(ptr,len),f=event('lookup',{key});if(f.status)return f.status;
   if(mask!==0)throw Error('Unexpected cache lookup mask');const h=alloc('cache');lookups.set(h,{key,item:entries.get(key),readyAt:now()+(f.readyDelayMs||0)});writeU32(out,h);return 0;},
  insert(ptr,len,mask,opts,out){const key=readUtf8(ptr,len),ttl=view().getBigUint64(opts,true),f=event('insert',{key,ttl:String(ttl)});if(f.status)return f.status;
   if(mask!==0||ttl<=0n)throw Error('Invalid insertion ABI');const h=alloc('body');bodies.set(h,{bytes:Buffer.alloc(0),readOffset:0,writes:[],readyAt:now()+(f.readyDelayMs||0)});writers.set(h,{key,ttl});entries.set(key,{bytes:Buffer.alloc(0),complete:false});writeU32(out,h);return 0;},
  get_state(h,out){const l=lookups.get(h);if(!l||l.readyAt>now())throw Error('Cache get_state before readiness');const f=event('get_state',{handle:h});if(f.status)return f.status;writeU32(out,f.state??(l.item?3:0));return 0;},
  get_body(h,mask,opts,out){const l=lookups.get(h);if(!l||l.readyAt>now())throw Error('Cache get_body before readiness');const f=event('get_body',{handle:h});if(f.status)return f.status;if(!l.item)return 10;
   if(mask!==0)throw Error('Unexpected body range');const b=alloc('body');bodies.set(b,{bytes:Buffer.from(l.item.bytes),writes:[],readOffset:0,readyAt:now()+(f.readyDelayMs||0)});readers.set(b,l.item);writeU32(out,b);return 0;},
  close(h){const l=lookups.get(h);if(!l||l.readyAt>now())throw Error('Cache close before readiness or duplicate');const f=event('cache.close',{handle:h});if(!f.status||f.consume)lookups.delete(h);return f.status||0;}
 };
 const ready=imports.fastly_async_io.is_ready,select=imports.fastly_async_io.select;
 imports.fastly_async_io.is_ready=(h,out)=>{if(!lookups.has(h))return ready(h,out);const f=event('is_ready',{handle:h});if(f.status)return f.status;writeU32(out,f.ready??(lookups.get(h).readyAt<=now()?1:0));return 0;};
 imports.fastly_async_io.select=(ptr,n,ms,out)=>{const hs=Array.from({length:n},(_,i)=>view().getUint32(ptr+4*i,true));if(!hs.some(h=>lookups.has(h)))return select(ptr,n,ms,out);
  const waits=hs.map(h=>{const l=lookups.get(h)||bodies.get(h);if(!l)throw Error('Unknown async handle');return Math.max(0,l.readyAt-now());}),wait=Math.min(...waits),f=event('select',{handles:hs,timeout:ms});
  if(f.status)return f.status;advance(Math.min(wait,ms));writeU32(out,wait>=ms?0xffffffff:waits.indexOf(wait));return 0;};
 const read=imports.fastly_http_body.read,write=imports.fastly_http_body.write,close=imports.fastly_http_body.close,abandon=imports.fastly_http_body.abandon;
 imports.fastly_http_body.read=(h,...args)=>{if(readers.has(h)){const f=event('read',{handle:h});if(f.status)return f.status;if(!readers.get(h).complete)return 1;}return read(h,...args);};
 imports.fastly_http_body.write=(h,...args)=>{if(writers.has(h)){const f=event('write',{handle:h});if(f.status)return f.status;}return write(h,...args);};
 imports.fastly_http_body.close=h=>{if(writers.has(h)){const w=writers.get(h),f=event('commit',{handle:h,key:w.key});if(!f.status||f.consume){entries.set(w.key,{bytes:Buffer.from(bodyBytes(h)),complete:true});writers.delete(h);close(h);}return f.status||0;}
  if(readers.has(h)){const f=event('reader.close',{handle:h});if(f.status){if(f.consume){readers.delete(h);close(h);}return f.status;}readers.delete(h);}return close(h);};
 imports.fastly_http_body.abandon=h=>{if(writers.has(h)){const w=writers.get(h),f=event('abandon',{handle:h,key:w.key});if(!f.status||f.consume){entries.set(w.key,{bytes:Buffer.from(bodyBytes(h)),complete:false});writers.delete(h);abandon(h);}return f.status||0;}return abandon(h);};
 return {entries,lookups,writers,readers};
}
module.exports={attachCacheHost};
