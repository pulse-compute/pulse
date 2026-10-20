'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { executeCanonicalNativeModule } = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const { compileFastlyNativePlatformCapabilitiesPlan: fastlyCompile } = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const { executeFastlyNativePlatformCapabilities: fastlyExecute } = require('../../../packages/provider-fastly/src/testing/native-platform-capabilities-host');
const R = require('../../packages/contracts/src/resources/embedded');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-call-composition-'));
const output = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const report = { version: 'pulse.callable-composition-evidence.v1', status: 'running', providerReality: false, executions: 0, sourceRejections: [], planRejections: [] };
const save = () => { if (output) fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n'); };
const write = (name, source) => fs.writeFileSync(path.join(cwd,name), source);
const pair = "{inputSchema:'proof.Input',outputSchema:'proof.Output'}";
const secondPair = "{inputSchema:'proof.OtherInput',outputSchema:'proof.OtherOutput'}";
const imports = "import {query,unused} from './query';import {lookup} from './barrel';import {second} from './second';";
const body = `const a=ctx.call(query,{value:2},${pair});const b=ctx.call(second,{value:5},${secondPair});const c=ctx.call(lookup,{value:7},${pair});return ctx.json({a,b,c},{schema:'proof.Runs'});`;
const helper = "export function unusedHelper(value:number):number{return impossible();}import type {Payload} from './types';export function read(input:Payload):number{return input.value;}" + 'export function weight(value:number):number {let total=0;for(let i=0;i<2;i++){total+=value;}return total;}';
const query = `import {weight,weight as twice,read,unusedHelper} from './helper';import {LIMIT as CAP,LABEL} from './constants-barrel';
export function query(ctx,input){const data=ctx.resources.map('shared');const cells=ctx.workspace.numbers(CAP);const initial=cells[0];let total=0;for(let i=0;i<CAP;i++){cells[i]=data.readU8(i);total+=weight(cells[i]);}return {value:total+twice(input.value)+read(input),initial,word:LABEL};}
export function unused(ctx,input){const data=ctx.resources.map('unused');return ctx.fetch('https://unused.invalid');}`;
const second = `import {weight as multiply} from './helper';export function second(ctx,input){const shared=ctx.resources.map('shared-alias');const other=ctx.resources.map('distinct');const cells=ctx.workspace.numbers(2);const initial=cells[0];cells[0]=multiply(shared.readU8(0));return {value:cells[0]+other.readU8(0)+input.value,initial,word:other.readUtf8(1,3)};}`;
const budgets={files:3,bindings:4,fileBytes:128,totalBytes:384,serializedBytes:4096};
const resources=R.admitResourceCatalogue(JSON.stringify(R.createResourceManifest([
  {path:'/shared',bytes:Buffer.from('ABCD')},{path:'/distinct',bytes:Buffer.from('Z雪')},{path:'/unused',bytes:Buffer.from('UNREACHABLE_COMPOSITION_RESOURCE')}
],budgets)),[{id:'shared',path:'/shared'},{id:'shared-alias',path:'/shared'},{id:'distinct',path:'/distinct'},{id:'unused',path:'/unused'}],budgets);
let registry;
function source(text=body, imported=imports){write('index.ts',`${imported}\nexport default async function handler(ctx){${text}}`);}
function plan(){return buildCanonicalNativePlan(compileCanonicalProject(path.join(cwd,'index.ts'),{rootDir:cwd,workspaceRoot:root,target:'native',strict:true,schemas:{registry,maxBytes:4096},binaryResources:resources}));}
function hash(plan){delete plan.planHash;plan.planHash=sha(stableStringify(plan));return plan;}
function all(value, predicate, found=[]){if(!value||typeof value!=='object')return found;if(predicate(value))found.push(value);for(const child of Object.values(value))if(child&&typeof child==='object')all(child,predicate,found);return found;}
function forged(name, original, mutate, expected){const p=clone(original);mutate(p);for(const callee of p.callables||[])hash(callee);hash(p);assert.throws(()=>validateCanonicalNativePlan(JSON.parse(JSON.stringify(p))),error=>error.diagnostics?.some(d=>expected.test(d.message)),name);report.planRejections.push(name);}
async function main(){
  fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
  for(const name of ['pulse','runtime'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
  write('schemas.ts',`import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';interface Input {value:number} interface Output {value:number;initial:number;word:string} interface Runs {a:Output;b:Output;c:Output} export default defineSchemaRegistry({schemas:{'proof.Input':schema<Input>(),'proof.Output':schema<Output>(),'proof.OtherInput':schema<Input>(),'proof.OtherOutput':schema<Output>(),'proof.Runs':schema<Runs>()}});`);
  registry=require('../../packages/schema-json/src/compiler/schema-registry').extractSchemaRegistry(path.join(cwd,'schemas.ts'),{projectRoot:cwd}).registry;
  write('types.ts','export interface Payload {value:number}');write('constants-barrel.ts',"export {CAP as LIMIT,LABEL} from './constants';");write('helper.ts',helper);write('constants.ts',"export const CAP=4;export const LABEL='雪😀';");write('query.ts',query);write('second.ts',second);write('barrel.ts',"export {query as lookup} from './query';");source();
  const p=plan();assert.equal(p.callables.length,2);assert.deepEqual(all(p.entry,n=>n.kind==='callable-call').map(n=>n.index),[0,1,0]);
  assert.deepEqual(p.callables.map(c=>c.helpers.length),[2,1]);
  assert.deepEqual(p.callables.map(c=>c.callable.inputSchema),['proof.Input','proof.OtherInput']);
  assert.deepEqual(p.binaryResources.records.map(r=>r.id),['distinct','shared','shared-alias']);
  assert.equal(plan().planHash,p.planHash);
  assert.equal(p.binaryResources.blobs.length,2);
  assert.equal(p.binaryResources.backingBytes,8);
  assert.equal(p.binaryResources.records[1].blobId,p.binaryResources.records[2].blobId);
  assert(!JSON.stringify(p).includes('UNREACHABLE_COMPOSITION_RESOURCE'));
  // Aliases share one target; independently owned callees retain their own
  // helper/workspace slots even when helper identity and physical bytes match.
  assert.equal(p.callables[0].helpers[0].id,p.callables[1].helpers[0].id);
  const artifacts={node:compileCanonicalNativePlan(p,{cwd:root,emitWat:false,reportCapture:false}),fastly:fastlyCompile(p,{cwd:root,requirePlatformCapability:false,canonicalBuild:true,maxDurationMs:5000})};
  report.artifacts=Object.fromEntries(Object.entries(artifacts).map(([name,a])=>[name,{bytes:a.wasm.length,sha256:sha(a.wasm),imports:WebAssembly.Module.imports(new WebAssembly.Module(a.wasm))}]));
  const expected={a:{value:538,initial:0,word:'雪😀'},b:{value:225,initial:0,word:'雪'},c:{value:553,initial:0,word:'雪😀'}};
  for(let i=0;i<3;i++)for(const response of [(await executeCanonicalNativeModule(artifacts.node,{})).response,fastlyExecute(artifacts.fastly,{}).response]){assert.equal(response.status,200);assert.deepEqual(JSON.parse(response.body),expected);report.executions++;}
  report.plan={hash:p.planHash,targets:p.callables.length,sites:3,helperOwners:3,resources:p.binaryResources.records.map(r=>({id:r.id,path:r.path}))};save();
  for(const [name,mutate,pattern] of [
    ['forged target index',x=>all(x.entry,n=>n.kind==='callable-call')[0].index=9,/invalid callable target/],
    ['unreachable target',x=>x.callables.push(clone(x.callables[0])),/unreachable callable/],
    ['target count overflow',x=>x.callables=Array.from({length:17},()=>clone(x.callables[0])),/table exceeds/],
    ['conflicting schema',x=>x.callables[0].schemas.registry.schemas[0].id='forged',/schema identity|invalid callable/],
    ['conflicting resource',x=>x.callables[0].binaryResources.records[0].path='/forged',/resource identity|invalid callable/],
    ['cross-owner helper local',x=>all(x.callables[0].helpers[0].body,n=>n.kind==='local'&&n.id)[0].id=x.callables[0].callable.inputLocalId,/invalid callable/],
    ['forged helper bound',x=>all(x.callables[0].helpers[0].body,n=>n.kind==='pure-loop')[0].maxIterations=65537,/invalid callable/],
    ['forged borrowed helper mutation',x=>{const h=x.callables[0].helpers[1];h.body[0].value={kind:'assignment',operator:'=',target:{kind:'property',object:{kind:'local',id:h.parameters[0].localId,valueKind:'object'},property:'value',valueKind:'number'},value:{kind:'literal',value:1,valueKind:'number'},valueKind:'number'};},/invalid callable/],
    ['forged callable input mutation',x=>{const c=x.callables[0];all(c.entry,n=>n.kind==='return')[0].value={kind:'assignment',operator:'=',target:{kind:'property',object:{kind:'local',id:c.callable.inputLocalId,valueKind:'object'},property:'value',valueKind:'number'},value:{kind:'literal',value:1,valueKind:'number'},valueKind:'number'};},/invalid callable/],
    ['workspace escape',x=>all(x.callables[0].entry,n=>n.kind==='workspace-read')[0].workspaceId='foreign',/invalid callable/],
    ['resource escape',x=>all(x.callables[0].entry,n=>n.kind==='resource-read')[0].resourceId='distinct',/invalid callable/]
  ])forged(name,p,mutate,pattern);
  for(const [name,file,text] of [
    ['borrowed input mutation','query.ts',query.replace('const data=', 'input.value=4;const data=')],
    ['borrowed helper mutation','helper.ts','export function weight(value:number):number {value=4;return value;}'],
    ['helper capture','helper.ts','const extra=1;export function weight(value:number):number{return value+extra;}'],
    ['helper recursion','helper.ts','export function weight(value:number):number{return weight(value);}'],
    ['helper bound product','query.ts',query.replace('i<CAP','i<65536')],
    ['borrowed record helper mutation','helper.ts',helper.replace('return input.value;','input.value=4;return input.value;')],
    ['constant reassignment','constants.ts',"export const CAP=4;CAP=2;export const LABEL='x';"],
    ['mutable scalar import','constants.ts',"export let CAP=4;export const LABEL='x';"],
    ['nonliteral scalar import','constants.ts',"export const CAP=2+2;export const LABEL='x';"],
    ['helper alias write','query.ts',query.replace('const data=','weight=other;const data=')],
    ['awaited helper','query.ts',query.replace('total+=weight(cells[i])','total+=await (weight(cells[i]))')],
    ['nested helper arguments','query.ts',query.replace('total+=weight(cells[i])','total+=weight(weight(cells[i]))')],
    ['nested callable','query.ts',query.replace('const data=',`ctx.call(query,input,${pair});const data=`)],
    ['workspace return','query.ts',query.replace('return {value:total+twice(input.value)+read(input),initial,word:LABEL};','return cells;')],
    ['resource return','query.ts',query.replace('return {value:total+twice(input.value)+read(input),initial,word:LABEL};','return data;')]
  ]){write(file,file==='helper.ts' && !text.includes('function read') ? text+"export function read(input:{value:number}):number{return input.value;}" : text);assert.throws(()=>plan(),error=>Boolean(error.diagnostics?.length),name);report.sourceRejections.push(name);write('query.ts',query);write('helper.ts',helper);write('constants.ts',"export const CAP=4;export const LABEL='雪😀';");}
  write('helper-barrel.ts',"export {weight,read,unusedHelper} from './helper';");
  write('query.ts',query.replace("from './helper'","from './helper-barrel'"));
  assert.equal(plan().callables[0].planHash,p.callables[0].planHash);
  write('query.ts',query.replace("import {weight,weight as twice,read,unusedHelper} from './helper';","import {read} from './helper';").replace('twice(input.value)','weight(input.value)')+helper.slice(helper.indexOf('export function weight')));
  assert(plan().callables[0].helpers.some(h=>h.id==='helper:query.ts#weight'));
  write('query.ts',query);
  report.additionalCompositionCases=['helper re-export identity','same-module helper'];
  // Both envelope limits remain bounded; no Wasm compile needed for this cell.
  write('many.ts',Array.from({length:17},(_,i)=>`export function q${i}(ctx,input){return {value:input.value};}`).join('\n'));
  source(Array.from({length:16},(_,i)=>`const r${i}=ctx.call(q${i},{value:1},${pair});`).join('')+"return ctx.text('ok');",`import {${Array.from({length:16},(_,i)=>'q'+i).join(',')}} from './many';`);
  assert.equal(plan().callables.length,16);report.maxTargets=16;
  source(Array.from({length:17},(_,i)=>`const r${i}=ctx.call(q${i},{value:1},${pair});`).join('')+"return ctx.text('ok');",`import {${Array.from({length:17},(_,i)=>'q'+i).join(',')}} from './many';`);
  assert.throws(()=>plan(),e=>e.code==='PULSE_CALL_SOURCE_LIMIT');report.sourceRejections.push('17 targets/sites');
  report.source={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}).trim(),files:execFileSync('git',['ls-files','--modified','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).map(file=>({path:file,sha256:sha(fs.readFileSync(path.join(root,file)))}))};
  report.status='passed';save();console.log(JSON.stringify(report));
}
main().catch(error=>{report.status='failed';report.error={message:error.message,diagnostics:error.diagnostics,cause:error.cause?.diagnostics};save();console.error(error,error.diagnostics,error.cause?.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(cwd,{recursive:true,force:true}));
