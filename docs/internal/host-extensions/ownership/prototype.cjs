'use strict';
// Isolated investigation adapter. No production registration or source mutation.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const contract = require(path.join(root, 'wasm/packages/contracts/src/provider/host-extension'));
const owner = require(path.join(root, 'packages/provider-fastly/src/build/host-extensions'));
const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
const PACKAGE = '@hex-spike/cache', CONTRACT = 'hex-spike.cache', SERVICE = 'investigation-owned-resource.v0';
const specs = {
  getText: { capability: 'cache.read', resources: ['cache-entry', 'read-body'], source:
`@external("fastly_cache", "lookup") declare function __ro_lookup(key:usize, n:i32, mask:i32, options:usize, out:usize):i32
function __ro_get(key:usize, n:i32, out:usize):i32 {
  const options = new StaticArray<i32>(3)
  return __ro_lookup(key, n, 0, changetype<usize>(options), out)
}`, imports: [['fastly_cache','lookup',5],['fastly_cache','get_state',2],['fastly_cache','get_body',4],['fastly_cache','close',1],['fastly_http_body','read',4],['fastly_http_body','close',1],['fastly_async_io','is_ready',2]] },
  putText: { capability: 'cache.write', resources: ['write-body'], source:
`@external("fastly_cache", "insert") declare function __ro_insert(key:usize, n:i32, mask:i32, options:usize, out:usize):i32
function __ro_put(key:usize, n:i32, out:usize):i32 {
  const options = new StaticArray<u64>(16)
  unchecked(options[0] = 60000000000)
  return __ro_insert(key, n, 0, changetype<usize>(options), out)
}`, imports: [['fastly_cache','insert',5],['fastly_http_body','write',5],['fastly_http_body','close',1],['fastly_http_body','abandon',1]] }
};
function artifacts() { return Object.entries(specs).map(([operation,spec]) => ({ version: contract.VERSION,
  id: `${PACKAGE}:${operation}`, kind: 'host-extension', mediaType:'text/assemblyscript', package:PACKAGE, contractId:CONTRACT,
  data:{ target:{provider:'fastly',target:'native',targetId:'fastly-compute-native'}, operation,service:SERVICE,
    source:spec.source,sha256:hash(spec.source),entry:operation==='getText'?'__ro_get':'__ro_put',
    imports:spec.imports.filter(([module,name])=>!require(path.join(root,'packages/provider-fastly/src/build/native-platform-capabilities')).FASTLY_NATIVE_PLATFORM_CAPABILITIES_IMPORTS.some(([m,n])=>m===module&&n===name)).map(([module,name,n])=>({module,name,parameters:Array(n).fill('i32'),results:['i32']})) } })); }
const ADMISSION=contract.normalizeAdmission({version:contract.ADMISSION_VERSION,protocols:[contract.VERSION],services:[SERVICE]});
const TARGET={provider:'fastly',target:'native',targetId:'fastly-compute-native',hostExtensions:ADMISSION};
const unique=s=>[...new Map(s.map(x=>[x.artifact.id,x.artifact])).values()];
function select(plan,options) {
  const effects=plan.effects.filter(e=>e.kind==='host.extension'); if(!effects.length)return [];
  const admitted=contract.select(effects,options.realizationArtifacts||[],TARGET);
  return effects.map(effect=>{const artifact=admitted.find(a=>contract.matches(effect,a));
    assert.equal(artifact.package,PACKAGE);assert(specs[effect.operation]);assert.equal(artifact.data.service,SERVICE);
    return {effect,artifact,index:plan.effects.indexOf(effect)};});
}
function source(selected) {
  const ops=new Set(selected.map(s=>s.effect.operation));
  let service=fs.readFileSync(path.join(__dirname,'service.as.ts'),'utf8');
  service=service.replace(/\/\/ BEGIN (getText|putText)\n([\s\S]*?)\/\/ END \1/g,(_,op,code)=>ops.has(op)?code:'');
  return unique(selected).map(x=>x.data.source).join('\n')+'\n'+service
    .replace('/* SLOT */',selected.map(s=>`index == ${s.index}`).join(' || '))
    .replace('/* BEGIN DISPATCH */',selected.map(s=>`case ${s.index}: __ro_begin_${s.effect.operation}(index, key); break;`).join('\n'))
    .replace('/* RESOLVE DISPATCH */',selected.map(s=>`case ${s.index}: return __ro_finish_${s.effect.operation}(index);`).join('\n'));
}
function instrument(source,selected) {
  if(!selected.length)return source;
  const replace=(from,to)=>{assert.equal(source.split(from).length-1,1,'one source anchor: '+from);source=source.replace(from,to);};
  replace('export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {',
    'export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {\n if (__ro_slot(effectIndex) && __ro_delivery != effectIndex) return 0;');
  replace('return pulse_set_effect_result(index, result)',
    '__ro_delivery = index\n const accepted = pulse_set_effect_result(index, result)\n __ro_delivery = -1\n return accepted');
  replace('function __pulse_fastly_wait_ready(effectIndex: i32): i32 {',
    'function __pulse_fastly_wait_ready(effectIndex: i32): i32 { if (__ro_slot(effectIndex)) return __ro_resolve(effectIndex);');
  replace('function __pulse_invocation_close(): void {',
    'function __pulse_invocation_close(): void { __pulse_invocation_closed = true; __ro_cleanup_all();');
  return source;
}
function policy(selected,baseline){return contract.composeImportPolicy(baseline.map(([module,name])=>({module,name,kind:'function'})),unique(selected));}
function withPrototype(callback, testSource='') {
  const saved={...owner};Object.assign(owner,{ADMISSION,TARGET,select,matches:contract.matches,
    source:s=>source(s)+testSource,instrument,policy,
    imports:s=>unique(s).flatMap(a=>a.data.imports),
    auditSignatures:(bytes,s,baseline)=>s.length?contract.auditWasm(bytes,policy(s,baseline)):undefined});
  try{return callback();}finally{Object.assign(owner,saved);}
}
module.exports={root,PACKAGE,CONTRACT,SERVICE,TARGET,specs,artifacts,withPrototype,hash};
