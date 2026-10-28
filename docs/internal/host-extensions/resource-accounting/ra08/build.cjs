'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const prior = require('../ra07/build.cjs');
const contract = require(path.join(prior.root, 'wasm/packages/contracts/src/provider/host-extension'));
function replace(source, anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, 'one checked observation anchor');
  return source.replace(anchor, replacement);
}
function observe(source, {capacity = 256, sampleEvery = 1, counterLimit = 1000000} = {}) {
  assert([0, 8, 64, 256, 4096].includes(capacity));
  assert([1, 4].includes(sampleEvery));
  assert([8, 1000000].includes(counterLimit)); // 8 is a test-only saturation pressure.
  const anchor = '@inline function cw(c:i32,f:i32,v:i32):void{store<i32>(CB+<usize>((c*CS+f)*4),v);}';
  let instrumented = replace(source, anchor,
    '@inline function cw(c:i32,f:i32,v:i32):void{const old=cr(c,f);store<i32>(CB+<usize>((c*CS+f)*4),v);if(f==1)rd_state(c,old,v);}');
  instrumented = replace(instrumented, 'function cc_prepare(i:i32):i32 {', 'function cc_prepare(i:i32):i32 {rd_current=i;');
  instrumented = replace(instrumented, 'const bytes=na_prepare(cc_roots[index]', 'rd_current=index;const bytes=na_prepare(cc_roots[index]');
  instrumented = replace(instrumented, 'function rf_prepare(i:i32,role:i32):i32{', 'function rf_prepare(i:i32,role:i32):i32{rd_current=i;');
  instrumented = replace(instrumented, 'let i=rf_find(4,h);if(i<0)return true;', 'let i=rf_find(4,h);if(i<0)return true;rd_current=i;');
  return instrumented + '\n' + fs.readFileSync(path.join(__dirname, 'observer.as.ts'), 'utf8')
    .replace('/* CAPACITY */', capacity).replace('/* SAMPLE_EVERY */', sampleEvery).replace('/* COUNTER_LIMIT */', counterLimit);
}
function build(out, name, width = 1, options = {}) {
  const base = options.controlArtifact || prior.build(out, name + '-control', width, options);
  if (options.controlArtifact) {
    fs.writeFileSync(path.join(out,name+'-control.as.ts'),base.source);
    fs.writeFileSync(path.join(out,name+'-control.wasm'),base.wasm);
  }
  const enabled = options.enabled !== false && base.plan.effects.length > 0;
  let source = enabled ? observe(base.source, options) : base.source;
  if (options.diagnosticMutation === 'no-events') source = replace(source,'if(f==1)rd_state(c,old,v);','');
  if (options.diagnosticMutation === 'wrong-site') source = source.replaceAll('rd_current=i;','rd_current=0;').replaceAll('rd_current=index;','rd_current=0;');
  if (options.diagnosticMutation === 'hide-overflow') source = replace(source,'rd_dropped++;','');
  if (options.diagnosticMutation === 'hide-backing') source = replace(source,'if(f>=3 && f<=5)return cr(i,f+1);','if(f>=3 && f<=5)return f==4?0:cr(i,f+1);');
  if (options.diagnosticMutation === 'hide-saturation') source = replace(source,'rd_overflow=true;','');
  const wasm = enabled ? prior.compile(source, out, name) : base.wasm;
  if (!enabled) {fs.writeFileSync(path.join(out, name + '.wasm'), wasm); fs.writeFileSync(path.join(out, name + '.as.ts'), source);}
  if (base.policy) contract.auditWasm(wasm, base.policy);
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(wasm)), base.imports, 'no diagnostic host imports');
  return {...base, wasm, source, control: base, enabled};
}
module.exports = {...prior, build, observe};
