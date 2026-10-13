'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const [variant,directory]=process.argv.slice(2);
assert(['default','elided'].includes(variant));assert(!fs.existsSync(directory));fs.mkdirSync(directory,{recursive:true});
const report={variant,status:'running',rows:[],recipes:[],controlGate:null};
const persist=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');
persist();
const original=child.spawnSync;let builds=0;
child.spawnSync=function(executable,args,options){
  const result=original(executable,args,options);
  if(!args?.[0]?.endsWith('/assemblyscript/bin/asc.js'))return result;
  assert.equal(result.status,0,result.stderr);builds++;
  report.recipes.push({executable,args,cwd:options.cwd});
  assert.equal(args.some(a=>String(a).includes('schema-cache-arena-transform')),variant==='elided');
  fs.copyFileSync(args[args.indexOf('--outFile')+1],path.join(directory,'control.wasm'));
  fs.copyFileSync(path.resolve(options.cwd,args[1]),path.join(directory,'generated.ts'));
  for(const mode of ['observed','reduced']){
    const actual=args.slice(1);actual[actual.indexOf('--outFile')+1]=path.join(directory,mode+'.wasm');
    if(actual.includes('--textFile'))actual.splice(actual.indexOf('--textFile'),2);
    const run=original(executable,[path.join(__dirname,'mem9-diagnostic-asc.mjs'),args[0],mode,...actual],{...options,timeout:180000});
    fs.writeFileSync(path.join(directory,mode+'.build.log'),(run.stdout||'')+(run.stderr||''));
    assert.equal(run.status,0,run.stderr||run.error?.message);
  }
  return result;
};
try{
  const platform=require('../../../packages/provider-fastly/src/build/native-platform-capabilities.js');
  const compile=platform.compileFastlyNativePlatformCapabilitiesPlan;
  const platformModule=require.cache[require.resolve('../../../packages/provider-fastly/src/build/native-platform-capabilities.js')];
  platformModule.exports={...platform,compileFastlyNativePlatformCapabilitiesPlan:(plan,options)=>{
    fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
    return compile(plan,{...options,elideJsonCacheArena:variant==='elided'});
  }};
  try{require('../provider/assert-fastly-schema-allocation.cjs').main();report.controlGate={status:'passed'};}
  catch(e){
    if(variant!=='elided'||e.code!=='ERR_ASSERTION'||!/^schema allocation used \d+ bytes$/.test(e.message))throw e;
    report.controlGate={status:'failed',error:e.message,interpretation:'Retained existing 128 MiB gate failure, not waived or relabeled'};
  }
  assert.equal(builds,1);child.spawnSync=original;
  const {executeFastlyNativePlatformCapabilities:execute}=require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js');
  for(const mode of ['control','observed','reduced']){
    const wasm=fs.readFileSync(path.join(directory,mode+'.wasm'));
    const cases=mode==='reduced'?[0,1,64,128,256].map(n=>['small-'+n,'a',n]):[['escaped','\u0001'.repeat(80000),256],['unicode','😀雪"\\\n'.repeat(8000),256],['small','a',256]];
    for(const [shape,text,iterations] of cases){
      const Original=WebAssembly.Instance;const cycles=[];
      WebAssembly.Instance=new Proxy(Original,{construct(Target,args){
        const instance=Reflect.construct(Target,[args[0],{...args[1],mem9:{cycle(bytes){cycles.push(bytes);}}}]);
        if(mode==='reduced')instance.exports.mem9_iterations(iterations);return instance;
      }});
      try{
        const result=execute(wasm,{request:{method:'POST',path:'/encode',headers:[['content-type','application/json']],body:JSON.stringify({text})}});
        const encoded=JSON.stringify({rows:[{text,total:70000+iterations*2048},{text:'independent',total:7}]});
        const expected=JSON.stringify({encoded,digest:{status:'ok',byteLength:Buffer.byteLength(encoded),sha256:hash(encoded)}});
        const actual=JSON.parse(result.response.body),expectedValue=JSON.parse(expected);
        assert.equal(result.response.status,200);assert.deepEqual(actual,expectedValue);
        const fields=value=>[value.encoded,value.digest.status,value.digest.byteLength,value.digest.sha256];
        const ex=result.instance.exports,capacityBytes=ex.memory.buffer.byteLength;
        const handles=ex.mem9_count?.()??null,numericHandles=ex.mem9_numbers?.()??null;
        const before=cycles.length;ex.__collect();
        if(mode!=='control')assert(cycles.length>before,'Expected full collection completion');
        const managedAfterFullGc=mode==='control'?null:cycles.at(-1);
        assert.equal(ex.memory.buffer.byteLength,capacityBytes);
        const ownershipMask=ex.mem9_ownership?.()??null;
        if(mode!=='control')assert.equal(ownershipMask,511);
        report.rows.push({mode,shape,iterations,additions:iterations*2048,sha256:hash(wasm),responseSha256:hash(result.response.body),responseFieldsSha256:hash(JSON.stringify(fields(actual))),expectedFieldsSha256:hash(JSON.stringify(fields(expectedValue))),capacityBytes,handles,numericHandles,managedAfterFullGc,ownershipMask});persist();
      }finally{WebAssembly.Instance=Original;}
    }
  }
  report.status='passed';persist();console.log('ok - MEM9-01 '+variant+': '+report.rows.length+' retention/ownership cases; original gate '+report.controlGate.status);
}catch(e){report.status='failed';report.error=e.stack||String(e);persist();throw e;}
finally{child.spawnSync=original;}
