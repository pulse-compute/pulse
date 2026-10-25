'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../../../..');
const {resolveAsc}=require(path.join(root,'wasm/packages/build-support/src/assemblyscript-compile'));
const {appendAssemblyScriptOptimizationArgs}=require(path.join(root,'wasm/packages/build-support/src/native-optimization'));
const asc=resolveAsc(path.join(root,'wasm/packages/compiler'));
function source(width,effects=4){const n=width*2;return fs.readFileSync(path.join(__dirname,'service.as.ts'),'utf8').replace('/* ROOTS */',n).replace('/* EFFECTS */',effects).replace('/* ROOT_BYTES */',n*15*4).replace('/* CLAIM_BYTES */',(n*6+2)*8*4).replace('/* CHILD_BYTES */',n*3*2*4);}
function compile(src,out,name){fs.mkdirSync(out,{recursive:true});const file=path.join(out,name+'.as.ts'),wasm=path.join(out,name+'.wasm');fs.writeFileSync(file,src);const args=[asc.script,path.basename(file),'--outFile',wasm,'--runtime','stub','--noAssert','--optimize'];appendAssemblyScriptOptimizationArgs(args,undefined,{guestLinked:false});if(src.includes('function __pulse_fastly_abort('))args.push('--use',`abort=${name}.as/__pulse_fastly_abort`);execFileSync(asc.executable,args,{cwd:out,stdio:'pipe',timeout:180000});return fs.readFileSync(wasm);}
function bridge(original,n,{active=true,diagnostics=true}={}){
 if(!active)return original;let s=original;const replace=(a,b)=>{assert.equal(s.split(a).length-1,1,a);s=s.replace(a,b);};
 replace('  let runStatus = pulse_start()',`  na_init(${n*5+2}-__na_short,${n*256+64},${n*6+2},1024,1000);\n  let runStatus = pulse_start()`);
 // Fixture is one fixed keyed cohort, statically matched to the exact plan.
 replace('      __pulse_effect_pending_0 = 1',`      if (!__na_group()) { __pulse_fastly_fail(PULSE_ERROR_STATE,370,-1); return -1; }\n      __pulse_effect_pending_0 = 1`);
 replace('  if (!__pulse_invocation_begin(effectIndex)) return;',`  if (unchecked(__pulse_invocation_tickets[effectIndex])<=0) { __pulse_fastly_fail(PULSE_ERROR_STATE,371,effectIndex); return; }
  na_now(i32((__request_last_clock-(__request_deadline-i64(1000)*1000000))/1000000));
  const nr=load<i32>(MB+<usize>(effectIndex*4));
  const nc=na_prepare(nr,1,64,1,1);
  if(nc<0||na_adopt(nc,effectIndex)<0){__pulse_fastly_fail(PULSE_ERROR_STATE,372,effectIndex);return;}
  store<i32>(__na_claims+<usize>(effectIndex*4),nc);`);
 replace('  unchecked(__pulse_invocation_tickets[index] = 0)',`  __na_settle(index);\n  unchecked(__pulse_invocation_tickets[index] = 0)`);
 replace('function __pulse_invocation_close(): void {',`function __pulse_invocation_close(): void {\n  __na_close();`);
 let kernel=source(n,1).replaceAll('export function','function');
 kernel+=`\nconst __na_claims:usize=memory.data(${n*4}); const __na_done:usize=memory.data(${n});
let __na_short:i32=0;let __na_unknown:bool=false;let __na_admitted:bool=false;
function __na_group():bool{
 for(let i=0;i<${n};i++){if(!__pulse_invocation_begin(i))return false;let t=na_capture();if(t<0)return false;na_member(i,t);}
 if(na_admit(${n})<0){for(let i=0;i<${n};i++)na_deny(load<i32>(MB+<usize>(i*4)));return false;}
 __na_admitted=true;return true;
}
function __na_settle(i:i32):void{let t=load<i32>(MB+<usize>(i*4)),c=load<i32>(__na_claims+<usize>(i*4));
 if(c>0){if(__na_unknown)na_observe(c,4,0);else{na_observe(c,3,0);na_refund(c,1,64,1);}}
 na_finish(t);store<u8>(__na_done+<usize>i,1);
}
function __na_close():void{if(__na_admitted)for(let i=0;i<${n};i++)if(load<u8>(__na_done+<usize>i)==0){let c=load<i32>(__na_claims+<usize>(i*4));if(c>0)na_observe(c,4,0);na_finish(load<i32>(MB+<usize>(i*4)));}na_end();}
`;
 if(diagnostics)kernel+=`\nexport function native_control(short:i32,unknown:i32):void{__na_short=short;__na_unknown=unknown!=0;}
export function native_query(k:i32,d:i32):i32{return na_query(k,d);}
export function native_tickets():i32{return __pulse_invocation_count;}
`;
 return s+'\n'+kernel;
}
module.exports={root,asc,source,compile,bridge};
