'use strict';
// Reuse the same injected host. Quiet mode drops trace recording and per-acquisition
// guest-query assertions, not host actions, resource checks or call counters.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const captureModule={exports:{}};
const captureSource=fs.readFileSync(path.join(__dirname,'../ra08/host.cjs'),'utf8').split('// Reuse the independent RA-07 host')[0];
new Function('require','module',captureSource+'\nmodule.exports={capture};')(require,captureModule);
let source=fs.readFileSync(path.join(__dirname,'../ra07/host.cjs'),'utf8');
function replace(anchor,next){assert.equal(source.split(anchor).length-1,1,'checked host anchor');source=source.replace(anchor,next);}
replace('let instance, next =','let instantiationNs=0,executionNs=0,initialMemory=0; let instance, next =');
replace('function event(call, detail = {}) {','function event(call, detail = {}) { if(options.quiet){calls[call]=(calls[call]||0)+1;return;}');
replace('if (query(0) !== null) assert','if (!options.quiet && query(0) !== null) assert');
replace('instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), imports);',
  'const compiled=wasm instanceof WebAssembly.Module?wasm:new WebAssembly.Module(wasm);const begin=process.hrtime.bigint();instance=new WebAssembly.Instance(compiled,imports);instantiationNs=Number(process.hrtime.bigint()-begin);initialMemory=e().memory.buffer.byteLength;');
replace('e()._start();','const beginRun=process.hrtime.bigint();try{e()._start();}finally{executionNs=Number(process.hrtime.bigint()-beginRun);}');
replace('return {trace, body, json, status, thrown, committed, accounting, post,',
  'const captureBegin=process.hrtime.bigint();const diagnosticSnapshot=options.collect?capture(exports):null;const captureNs=Number(process.hrtime.bigint()-captureBegin);return {cost:{instantiationNs,executionNs,captureNs,initialMemory,finalMemory:exports?.memory.buffer.byteLength??0},calls,diagnostics:diagnosticSnapshot,trace, body, json, status, thrown, committed, accounting, post,');
const result={exports:{}};
new Function('require','module','capture',source)(require,result,captureModule.exports.capture);
module.exports=result.exports;
