'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const installed = process.argv.includes('--installed');
const contracts = subpath => require(installed ? '@pulse-compute/wasm-contracts/' + subpath : '../../packages/contracts/src/' + subpath);
const { hostExtensions: contract, normalizeProviderTargetDescriptor } = contracts('provider/toolchain');
const { normalizePackageBuilderResult, normalizePackageLoweringBundle } = contracts('package/package-contract');
const { defineFinalWasmPolicy, FINAL_WASM_POLICY_VERSION } = contracts('provider/final-wasm-policy');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function reject(code, fn) { checks++; assert.throws(fn, error => error.code === 'PULSE_HOST_EXTENSION_' + code); }
const authority = { npmPackage: '@outside/transport', contractId: 'outside.transport', lowerableSubpath: '@outside/transport' };
function contribution(name = 'handoff', provider = 'sample') {
  const source = `@external("sample_http", "${name}") declare function __outside_${name}(request: i32, backend: usize, length: i32): i32\n`;
  return { version: contract.VERSION, id: authority.npmPackage + ':' + name + '-' + provider, kind: contract.KIND,
    mediaType: 'text/assemblyscript', package: authority.npmPackage, contractId: authority.contractId,
    data: { operation: name, target: { provider, target: 'native', targetId: provider + '-native' }, service: contract.TERMINAL_SERVICE,
      source, sha256: hash(source), entry: '__outside_' + name,
      imports: [{ module: 'sample_http', name, parameters: ['i32','i32','i32'], results: ['i32'] }] } };
}
const artifact = contribution();
const operation = { kind:'host.extension', package:authority.npmPackage, contractId:authority.contractId, operation:'handoff',
  source:{file:'src/app.ts',start:{line:7,column:2}}, resource:{kind:'literal',value:'upstream'} };
const target = { provider:'sample', target:'native', targetId:'sample-native', hostExtensions:{version:contract.ADMISSION_VERSION,
  protocols:[contract.VERSION], services:[contract.TERMINAL_SERVICE]} };
assert.equal(contract.normalizeContribution(artifact, authority).id, artifact.id); checks++;
assert(Object.isFrozen(contract.normalizeContribution(artifact).data.imports[0].parameters)); checks++;
// The exact normalized provider envelope retains optional service advertisement.
const normalizedTarget = normalizeProviderTargetDescriptor({ ...target, version:'pulse.provider-target-descriptor.v1', runtimeClass:'native',
  status:'supported', automaticFallback:false, commands:{compile:true}, finalWasmPolicy:defineFinalWasmPolicy({version:FINAL_WASM_POLICY_VERSION,
    descriptorOwner:'@outside/provider',toolchainVersion:'unrelated-version',descriptorIdentity:'sample-native',permittedImports:[],requiredExports:[]}) });
assert.deepEqual(normalizedTarget.hostExtensions,target.hostExtensions); checks++;
assert.deepEqual(contract.select([operation],[artifact],normalizedTarget),[artifact]); checks++;
assert.deepEqual(contract.select([{kind:'generic'}],[artifact],{}),[]); checks++;
assert.deepEqual(contract.select([operation,operation],[artifact],target),[artifact]); checks++;
function mutation(code, edit) { const changed=clone(artifact);edit(changed);reject(code,()=>contract.normalizeContribution(changed,authority)); }
mutation('PROTOCOL',a=>a.version='pulse.host-extension.v99');
mutation('OWNER',a=>a.package='@forged/owner');
mutation('OWNER',a=>a.contractId='forged.contract');
mutation('OWNER',a=>a.id='unqualified');
mutation('INVALID',a=>a.data.sourcePath='../../outside.as.ts');
mutation('INVALID',a=>a.export='./outside');
mutation('INVALID',a=>a.data.target.fallback='node');
mutation('SOURCE',a=>a.data.sha256='0'.repeat(64));
mutation('SOURCE',a=>{a.data.source='import "../../outside"';a.data.sha256=hash(a.data.source);});
mutation('SOURCE',a=>{a.data.source='export { hidden } from "/outside"';a.data.sha256=hash(a.data.source);});
mutation('SOURCE',a=>{a.data.source='__pulse_private()';a.data.sha256=hash(a.data.source);});
mutation('SOURCE',a=>a.data.entry='__pulse_private');
mutation('SOURCE',a=>{a.data.source='new __PulseFastlyValue()';a.data.sha256=hash(a.data.source);});
mutation('SOURCE',a=>{a.data.source='x'.repeat(65537);a.data.sha256=hash(a.data.source);});
mutation('SIGNATURE',a=>a.data.imports[0].parameters=['externref']);
mutation('CONFLICT',a=>a.data.imports.push(clone(a.data.imports[0])));
const accessor=clone(artifact);Object.defineProperty(accessor.data,'source',{get(){throw Error('getter executed');},enumerable:true});
reject('INVALID',()=>contract.normalizeContribution(accessor));
const arrayAccessor=clone(artifact);Object.defineProperty(arrayAccessor.data.imports,'0',{get(){throw Error('array getter executed');},enumerable:true});
reject('INVALID',()=>contract.normalizeContribution(arrayAccessor));
for(const changed of [{...target,target:'javascript'}, {...target,provider:'other'}, {...target,hostExtensions:undefined}]) {
  reject('TARGET',()=>contract.select([operation],[artifact],changed));
}
reject('TARGET',()=>contract.select([operation],[],target));
for(const field of ['protocols','services']) {const changed=clone(target);changed.hostExtensions[field]=[];reject('PROTOCOL',()=>contract.select([operation],[artifact],changed));}
reject('PROTOCOL',()=>contract.normalizeAdmission({...target.hostExtensions,version:'next'}));
reject('CONFLICT',()=>contract.normalizeAdmission({...target.hostExtensions,services:[contract.TERMINAL_SERVICE,contract.TERMINAL_SERVICE]}));
const overlapping=clone(artifact);overlapping.id+='-duplicate';
for(const entries of [[artifact,overlapping],[overlapping,artifact]]) reject('CONFLICT',()=>contract.select([operation],entries,target));
reject('CONFLICT',()=>contract.select([operation],[artifact,artifact],target));
reject('OWNER',()=>contract.select([operation,{...operation,contractId:'other'}],[artifact],target));
const alternate=contribution('handoff','other');
for(const entries of [[alternate,artifact],[artifact,alternate]]) {assert.deepEqual(contract.select([operation],entries,target),[artifact]);checks++;}
const second=contribution('other'), secondOp={...operation,operation:'other'};
const selected=contract.select([secondOp,operation],[second,artifact],target);
assert.deepEqual(selected,contract.select([operation,secondOp],[artifact,second],target));checks++;
const collision=clone(second);collision.data.entry=artifact.data.entry;
reject('CONFLICT',()=>contract.select([operation,secondOp],[artifact,collision],target));
const baseline=[{module:'provider',name:'baseline',kind:'function'}];
const policy=contract.composeImportPolicy(baseline,selected);
assert.deepEqual(policy,contract.composeImportPolicy(baseline,selected.slice().reverse()));checks++;
const rebind=clone(artifact);rebind.data.imports[0].module='provider';rebind.data.imports[0].name='baseline';
reject('CONFLICT',()=>contract.composeImportPolicy(baseline,[rebind]));
const shared=clone(second);shared.data.imports=clone(artifact.data.imports);
assert.equal(contract.composeImportPolicy(baseline,[artifact,shared]).imports.length,1);checks++;
shared.data.imports[0].parameters=['i64'];
reject('SIGNATURE',()=>contract.composeImportPolicy(baseline,[artifact,shared]));
const changed=clone(artifact);changed.data.source+='// content identity\n';changed.data.sha256=hash(changed.data.source);
assert.notEqual(contract.composeImportPolicy(baseline,[artifact]).sha256,contract.composeImportPolicy(baseline,[changed]).sha256);checks++;
// Real Wasm binary: independent type/import declarations exercise the auditor.
const leb = n => { const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b);}while(n);return out; };
const name = s => [...leb(Buffer.byteLength(s)),...Buffer.from(s)];
const section = (id,data) => [id,...leb(data.length),...data];
function wasm(rows) {
 const types=rows.flatMap(row=>[0x60,...leb(row.parameters.length),...row.parameters,...leb(row.results.length),...row.results]);
 const imports=rows.flatMap((row,index)=>[...name(row.module),...name(row.name),0,...leb(index)]);
 return Buffer.from([0,97,115,109,1,0,0,0,...section(1,[...leb(rows.length),...types]),...section(2,[...leb(rows.length),...imports])]);
}
const row={module:'sample_http',name:'handoff',parameters:[127,127,127],results:[127]};
const onePolicy=contract.composeImportPolicy(baseline,[artifact]);
assert.equal(contract.auditWasm(wasm([row]),onePolicy).policySha256,onePolicy.sha256);checks++;
reject('SIGNATURE',()=>contract.auditWasm(wasm([{...row,parameters:[127,127,126]}]),onePolicy));
reject('SIGNATURE',()=>contract.auditWasm(wasm([]),onePolicy));
reject('SIGNATURE',()=>contract.auditWasm(wasm([row,{...row,parameters:[126]}]),onePolicy));
reject('IMPORT',()=>contract.auditWasm(wasm([row,{...row,name:'undeclared'}]),onePolicy));
reject('IMPORT',()=>contract.auditWasm(wasm([row]),{...onePolicy,sha256:'0'.repeat(64)}));
reject('IMPORT',()=>contract.auditWasm(wasm([row]),{...onePolicy,permittedImports:[...onePolicy.permittedImports,{module:'hidden',name:'secret',kind:'function'}]}));
// The carrier, not just provider code, rejects forged contribution ownership.
const result={artifact:{version:'outside.builder.v17',status:'ok',contractId:authority.contractId,package:authority.npmPackage},realizationArtifacts:[artifact]};
assert.equal(normalizePackageBuilderResult(result,authority).contributions.realizationArtifacts[0].id,artifact.id);checks++;
const forged=clone(result);forged.realizationArtifacts[0].contractId='forged';
reject('OWNER',()=>normalizePackageBuilderResult(forged,authority));
// Reject structure before cloning: no getters run and no hidden metadata vanishes.
for (const edit of [
  a => { delete a.data.imports[0]; },
  a => { Object.setPrototypeOf(a.data.imports, {map() { throw Error('custom array method executed'); }}); },
  a => { a.data.imports.extra = true; },
  a => { a.data.imports[Symbol('hidden')] = true; },
  a => { Object.defineProperty(a.data.imports, 'hidden', {value: true}); },
  a => { Object.defineProperty(a.data, 'hidden', {value: true}); },
  a => { Object.defineProperty(a.data.imports, '0', {get() { throw Error('getter executed'); }}); },
  a => { Object.defineProperty(a, 'kind', {get() { throw Error('getter executed'); }}); }
]) {
  const malformed = clone(artifact); edit(malformed);
  reject('INVALID', () => contract.normalizeContribution(malformed, authority));
  reject('INVALID', () => normalizePackageBuilderResult({...result, realizationArtifacts:[malformed]}, authority));
}
mutation('INVALID', a => { a.data.imports[0].parameters = new Array(33).fill('i32'); });
mutation('INVALID', a => { a.data.imports[0].results = ['i32', 'i32']; });
mutation('PROTOCOL', a => { a.data.service = 'unreviewed-service.v1'; });
reject('PROTOCOL', () => contract.normalizeAdmission({...target.hostExtensions, protocols:['pulse.host-extension.v2']}));
reject('PROTOCOL', () => contract.normalizeAdmission({...target.hostExtensions, services:['unknown.v1']}));
reject('CONFLICT', () => contract.composeImportPolicy([...baseline, ...baseline], [artifact]));
reject('CONFLICT', () => contract.composeImportPolicy(baseline, [artifact, artifact]));
reject('IMPORT', () => contract.composeImportPolicy([{module:'env', name:'x'}], [artifact]));
reject('SIGNATURE', () => contract.auditWasm(Buffer.from([0,97]), onePolicy));
// Every baseline import kind is retained, and cannot substitute for a function.
function mixedWasm(extra) {
  const imports = [...name(row.module), ...name(row.name), 0, 0,
    ...extra.flatMap(i => [...name(i.module), ...name(i.name), ...i.descriptor])];
  return Buffer.from([0,97,115,109,1,0,0,0,
    ...section(1,[1,0x60,3,127,127,127,1,127]),
    ...section(2,[...leb(extra.length + 1),...imports])]);
}
const nonFunctions = [
  {module:'provider', name:'table', kind:'table', descriptor:[1,0x70,1,1,1]},
  {module:'provider', name:'memory', kind:'memory', descriptor:[2,1,1,1]},
  {module:'provider', name:'global', kind:'global', descriptor:[3,127,0]}
];
const completeBaseline = [...baseline, ...nonFunctions.map(({descriptor,...i}) => i)];
const completePolicy = contract.composeImportPolicy(completeBaseline, [artifact]);
const audited = contract.auditWasm(mixedWasm(nonFunctions), completePolicy);
assert.deepEqual(audited.observedImports.map(i => i.kind), ['function','table','memory','global']); checks++;
for (const item of nonFunctions) {
  reject('IMPORT', () => contract.auditWasm(mixedWasm([item]), onePolicy));
  const wrongKind = completeBaseline.map(i => i.name === item.name ? {...i,kind:'function'} : i);
  reject('IMPORT', () => contract.auditWasm(mixedWasm([item]), contract.composeImportPolicy(wrongKind, [artifact])));
}
reject('IMPORT', () => contract.auditWasm(mixedWasm([{...nonFunctions[2],module:row.module,name:row.name}]), completePolicy));
const unicodeBaseline = [{module:'provider / ✓', name:'baseline', kind:'function'}];
assert.equal(contract.auditWasm(wasm([row,{...row,...unicodeBaseline[0]}]), contract.composeImportPolicy(unicodeBaseline,[artifact])).observedImports.length,2); checks++;
// A valid baseline function need not be a contributed declaration.
assert.equal(contract.auditWasm(wasm([row,{...row,module:'provider',name:'baseline'}]), onePolicy).observedImports.length,2); checks++;
const bundleInput = {inputVersion:'fixture.v1',operations:[],packages:[{package:authority.npmPackage,contractId:authority.contractId}],realizationArtifacts:[artifact]};
assert.equal(normalizePackageLoweringBundle(bundleInput).realizationArtifacts[0].id,artifact.id); checks++;
reject('OWNER', () => normalizePackageLoweringBundle({...bundleInput,packages:[]}));
reject('TARGET', () => normalizeProviderTargetDescriptor({...normalizedTarget,version:'pulse.javascript-target-descriptor.v2',target:'javascript',runtimeClass:'javascript'}));
if (!installed) require('./host-extension-discovery-cases.cjs')(artifact, target);
console.log(`ok - P15 host contribution contract: ${checks} schema, owner, selection, service, policy and binary ABI cases`);
