'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const prior = require('../ra07/build.cjs'), {observe} = require('../ra08/build.cjs');
const contract = require(path.join(prior.root,'wasm/packages/contracts/src/provider/host-extension'));
const variants = {off:null,counts:{capacity:0},sampled:{capacity:256,sampleEvery:4},events:{capacity:256}};
function compile(source,out) {fs.mkdirSync(out,{recursive:true});return prior.compile(source,out,'module');}
function family(out,width) {
  const base = prior.build(path.join(out,'generated'),'fixture',width);
  const off = {...base,source:base.source,wasm:compile(base.source,path.join(out,'off'))};
  const result = {};
  for (const [name,options] of Object.entries(variants)) {
    const source = options ? observe(base.source,options) : base.source;
    const wasm = options ? compile(source,path.join(out,name)) : off.wasm;
    contract.auditWasm(wasm,base.policy);
    assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(wasm)),base.imports);
    result[name] = {...base,source,wasm,control:off};
  }
  return result;
}
function unused(out,kind) {
  const options = {unused:true,...(kind==='unused'?{}:{absent:true}),...(kind==='production'?{production:true}:{})};
  const a = prior.build(path.join(out,kind,'generated'),'fixture',1,options);
  return {...a,wasm:compile(a.source,path.join(out,kind))};
}
function ledger(out,width) {
  let source = prior.ledger(width);
  assert(source.includes('n*256+64,n*6+2'));
  source = source.replace('n*256+64,n*6+2','n*262849+64,n*8+2');
  source += '\nexport function cycle(n:i32,mode:i32):i32{return na_bench(n,mode);}\nexport function banks():i32{return na_bytes();}\nexport function records():i32{return na_query(6,0);}\n';
  const wasm = compile(source,out);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(wasm)),[]);
  return {source,wasm};
}
module.exports = {...prior,family,unused,ledger,variants};
