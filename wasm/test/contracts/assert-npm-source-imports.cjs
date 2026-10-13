'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileCanonicalProject } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const { compileCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-compiler');
const { buildReachableProjectGraph } = require('../../packages/compiler/src/project/reachable-graph-builder');
const { acceptanceToolchain } = require('../s3/acceptance-toolchain.cjs');
const repo = path.resolve(__dirname, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-npm-source-'));
const name = '@fixture/tick';
const write = (root, file, text) => { const absolute = path.join(root, file); fs.mkdirSync(path.dirname(absolute), { recursive: true }); fs.writeFileSync(absolute, text); return absolute; };
const manifest = { name, version: '1.2.3', exports: { './worker': './worker.js', './helper': { types: './types.d.ts', import: './helper.ts', default: './wrong.js' } } };
const worker = `export { tickHandler, middleware } from './handlers.js';`;
const handlers = `export async function middleware(ctx,next){ctx.state.set('prefix','ok');return next();}
export async function tickHandler(ctx){return ctx.text('tick',{status:202});}`;
const helper = `export async function lookup(ctx,input:string){const value=await ctx.fetch('https://source.test/'+input).text();return value+'!';}`;
const entry = `import {Pulse} from '@pulse-compute/pulse';
import {tickHandler,middleware} from '@fixture/tick/worker';
import {lookup} from '@fixture/tick/helper';
const app=new Pulse({auto:true});app.use(middleware);app.post('/tick',tickHandler);
app.get('/',async(ctx)=>{const result=await lookup(ctx,'value');return ctx.text(ctx.state.get('prefix')+':'+result);});export default app;`;
function setup(root) {
 write(root, 'src/index.ts', entry);
 write(root, 'node_modules/@fixture/tick/package.json', JSON.stringify(manifest));
 for (const [file, source] of Object.entries({ 'worker.js':worker, 'handlers.js':handlers, 'helper.ts':helper })) write(root, `node_modules/@fixture/tick/${file}`, source);
}
const options = root => ({ rootDir:root, workspaceRoot:repo, applicationProjectMetadata:{selectedProfile:{name:"test",source:"fixture"},strict:true,target:"native",host:"node",projectHash:"1".repeat(64),configPlanHash:"2".repeat(64),bindings:{config:[],secret:[]},fragments:{}}, strict:true, requireAsync:true, requireEffectAwait:true });
const compile = root => compileCanonicalProject(path.join(root,'src/index.ts'), options(root));
const codes = error => (error.diagnostics || []).map(d => d.code).join(',');
async function main() {
 const root = path.join(temp,'consumer'); setup(root);
 const compiled = compile(root);
 const graph = compiled.reachableGraph;
 const packages = graph.modules.filter(m => m.kind === 'package' && m.packageName === name);
 assert.equal(packages.length,2);
 assert.deepEqual(packages.map(m=>m.packageSubpath).sort(),['./helper','./worker']);
 assert.ok(packages.every(m=>m.packageVersion==='1.2.3' && m.source.file.startsWith('npm/@fixture/tick@1.2.3/')));
 const sources = graph.modules.filter(m=>m.kind==='project' && m.packageName===name);
 assert.equal(sources.length,3);
 assert.ok(sources.every(m=>m.owner==='third-party' && m.packageContract===null && m.contentHash.length===64));
 assert.equal(compiled.packageReachability.packages.filter(p=>p.nativeStatus==='static-source').length,2);
 assert.ok(compiled.watchFiles.includes(path.join(root,'node_modules/@fixture/tick/package.json')));
 assert.ok(compiled.watchFiles.includes(path.join(root,'node_modules/@fixture/tick/handlers.js')));
 assert.ok(graph.modules.find(m=>m.id===graph.handlers.find(h=>h.localName==='tickHandler').moduleId).source.file.endsWith('/handlers.js'));
 const plan = buildCanonicalNativePlan(compiled);
 assert.equal(plan.helpers.length,1); assert.equal(plan.effects.length,1);
 assert.match(plan.helpers[0].source.file,/^npm\/@fixture\/tick@1\.2\.3\//);
 const copied = path.join(temp,'copied'); fs.cpSync(root,copied,{recursive:true});
 assert.equal(compile(copied).reachableGraph.graphHash,graph.graphHash,'checkout relocation preserves identity');
 write(copied,'node_modules/@fixture/tick/handlers.js',handlers.replace("'tick'","'changed'"));
 assert.notEqual(compile(copied).reachableGraph.graphHash,graph.graphHash,'source bytes participate in graph identity');
 write(copied,'node_modules/@fixture/tick/package.json',JSON.stringify({...manifest,version:'1.2.4'}));
 assert.notDeepEqual(compile(copied).reachableGraph.handlers.map(h=>h.id),graph.handlers.map(h=>h.id),'package version participates in handler identity');
 const negative = [
  ['unexported',{'src/index.ts':entry.replace('/worker','/handlers.js')}],
  ['no exports',{'node_modules/@fixture/tick/package.json':JSON.stringify({name,version:'1.2.3',main:'./worker.js'})}],
  ['blocked',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':null}})}],
  ['array',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':['./worker.js']}})}],
  ['wildcard',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./*':'./*.js'}})}],
  ['escape',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':'../worker.js'}})}],
  ['encoded',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':'./%2e%2e/worker.js'}})}],
  ['missing',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':'./missing.js'}})}],
  ['declaration',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':'./worker.d.ts'}}),'node_modules/@fixture/tick/worker.d.ts':'export declare function tickHandler(ctx:any):any;'}],
  ['commonjs',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,exports:{'./worker':'./worker.cjs'}}),'node_modules/@fixture/tick/worker.cjs':'module.exports={};'}],
  ['commonjs type',{'node_modules/@fixture/tick/package.json':JSON.stringify({...manifest,type:'commonjs'})}],
  ['side effect import',{'src/index.ts':entry+"\nimport '@fixture/tick/worker';"}],
  ['initialization',{'node_modules/@fixture/tick/worker.js':worker+'\nglobalThis.__PULSE_NPM_EXECUTED=true;'}],
  ['factory',{'node_modules/@fixture/tick/handlers.js':"const make=()=>async(ctx)=>ctx.text('x');export const tickHandler=make();export async function middleware(ctx,next){return next();}"}],
  ['capture',{'node_modules/@fixture/tick/handlers.js':"const value='capture';"+handlers}],
  ['relative escape',{'node_modules/@fixture/tick/worker.js':"export {tickHandler,middleware} from '../../../outside.js';"}],
  ['dynamic import',{'node_modules/@fixture/tick/handlers.js':handlers.replace("return ctx.text('tick'","await import('./helper.ts');return ctx.text('tick'")}],
  ['ambient authority',{'node_modules/@fixture/tick/handlers.js':handlers.replace("return ctx.text('tick'","await fetch('https://bad.test');return ctx.text('tick'")}],
  ['cycle',{'node_modules/@fixture/tick/handlers.js':"export {tickHandler,middleware} from './worker.js';"}],
  ['unawaited helper',{'src/index.ts':entry.replace("await lookup(ctx,'value')","lookup(ctx,'value')")}],
  ['wrong ctx',{'src/index.ts':entry.replace("lookup(ctx,'value')","lookup({},'value')")}]
 ];
 for(const [label,files] of negative) {
  const trial=path.join(temp,label);setup(trial);for(const [file,source] of Object.entries(files))write(trial,file,source);
  assert.throws(()=>compile(trial),e=>{assert.ok(e.diagnostics?.length,`${label}: ${e.stack}`);return true;},label);
 }
 assert.equal(globalThis.__PULSE_NPM_EXECUTED,undefined,'compilation never evaluates dependency source');
 const rootExport=path.join(temp,'root-export');setup(rootExport);
 write(rootExport,'src/index.ts',entry.replace('@fixture/tick/worker','@fixture/tick'));
 write(rootExport,'node_modules/@fixture/tick/package.json',JSON.stringify({...manifest,exports:{'.':{types:'./unused.d.ts',default:'./worker.js',import:'./missing.js'},'./helper':'./helper.ts'}}));
 assert.equal(buildCanonicalNativePlan(compile(rootExport)).helpers.length,1,'condition declaration order is authoritative');
 const self=path.join(temp,'self-reference');setup(self);
 write(self,'node_modules/@fixture/tick/worker.js',"export {tickHandler,middleware} from '@fixture/tick/handlers';");
 write(self,'node_modules/@fixture/tick/package.json',JSON.stringify({...manifest,exports:{...manifest.exports,'./handlers':'./handlers.js'}}));
 assert.equal(compile(self).nativeEligibility.eligible,true,'package self-reference uses declared exports');
 const typed=path.join(temp,'typed');setup(typed);
 write(typed,'node_modules/@fixture/tick/types.d.ts','export type Input = string;');
 write(typed,'node_modules/@fixture/tick/helper.ts',"import type {Input} from './types.d.ts';"+helper);
 assert.equal(buildCanonicalNativePlan(compile(typed)).helpers.length,1,'type-only relative declarations do not become runtime modules');
 const scoped=path.join(temp,'alias-isolation');setup(scoped);
 write(scoped,'tsconfig.json',JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@dependency/helper':['src/poison.ts']}}}));
 write(scoped,'src/poison.ts',"throw new Error('application alias leaked into dependency');");
 write(scoped,'node_modules/@fixture/tick/helper.ts',"export {lookup} from '@dependency/helper';");
 write(scoped,'node_modules/@fixture/tick/node_modules/@dependency/helper/package.json',JSON.stringify({name:'@dependency/helper',version:'2.0.0',exports:'./index.ts'}));
 write(scoped,'node_modules/@fixture/tick/node_modules/@dependency/helper/index.ts',helper);
 assert.equal(buildCanonicalNativePlan(compile(scoped)).helpers.length,1,'nested dependency resolves from its importer, without application aliases');
 const duplicate=path.join(temp,'duplicate-roots');setup(duplicate);
 write(duplicate,'src/index.ts',entry+"\nimport {lookup as other} from '@fixture/wrapper';");
 write(duplicate,'node_modules/@fixture/wrapper/package.json',JSON.stringify({name:'@fixture/wrapper',version:'1.0.0',exports:'./index.js'}));
 write(duplicate,'node_modules/@fixture/wrapper/index.js',"export {lookup} from '@fixture/tick/helper';");
 fs.cpSync(path.join(duplicate,'node_modules/@fixture/tick'),path.join(duplicate,'node_modules/@fixture/wrapper/node_modules/@fixture/tick'),{recursive:true});
 assert.throws(()=>compile(duplicate),e=>/Ambiguous installed copies/.test(e.message));
 const typeOnly=path.join(temp,'type-only');setup(typeOnly);
 write(typeOnly,'src/index.ts',entry+"\nimport type {Unused} from '@fixture/types-only';");
 write(typeOnly,'node_modules/@fixture/types-only/package.json',JSON.stringify({name:'@fixture/types-only',version:'1.0.0',exports:null}));
 assert.equal(compile(typeOnly).nativeEligibility.eligible,true,'type-only package import does not expand source');
 const untrusted=path.join(temp,'untrusted-metadata');setup(untrusted);
 write(untrusted,'node_modules/@fixture/tick/package.json',JSON.stringify({...manifest,pulsewasm:{manifest:'./compiler.cjs'},pulse:{contract:'./compiler.cjs'}}));
 write(untrusted,'node_modules/@fixture/tick/compiler.cjs','globalThis.__PULSE_NPM_PLUGIN_EXECUTED=true;throw new Error("untrusted compiler metadata executed");');
 assert.equal(compile(untrusted).nativeEligibility.eligible,true,'source imports grant no metadata/compiler authority');
 assert.equal(globalThis.__PULSE_NPM_PLUGIN_EXECUTED,undefined);
 const {TRUSTED_LOWERER_PACKAGES}=require('../../packages/contracts/src/library/manifest');
 const release=JSON.parse(fs.readFileSync(path.join(repo,'release/pulse-release-manifest.json')));
 const lowerers=[];
 for(const dir of fs.readdirSync(path.join(repo,'packages'),{withFileTypes:true}).filter(e=>e.isDirectory())) {
  const file=path.join(repo,'packages',dir.name,'package.json');if(!fs.existsSync(file))continue;
  const pkg=JSON.parse(fs.readFileSync(file));if(pkg.pulsewasm?.manifest)lowerers.push(pkg.name);
 }
 assert.deepEqual([...TRUSTED_LOWERER_PACKAGES].sort(),lowerers.sort(),'new first-party compiler authority requires an explicit policy update');
 assert.ok(TRUSTED_LOWERER_PACKAGES.every(name=>JSON.stringify(release.packages).includes(name)));
 const symlinkRoot=path.join(temp,'symlink');setup(symlinkRoot);
 fs.unlinkSync(path.join(symlinkRoot,'node_modules/@fixture/tick/worker.js'));
 fs.symlinkSync(write(temp,'outside.js',handlers),path.join(symlinkRoot,'node_modules/@fixture/tick/worker.js'));
 assert.throws(()=>compile(symlinkRoot),e=>codes(e).includes('PULSE_NATIVE_IMPORT_UNSUPPORTED'));
 // A pnpm-style package-root link is allowed; its individual sources stay contained.
 const linked=path.join(temp,'linked');setup(linked);
 const store=path.join(temp,'store');fs.renameSync(path.join(linked,'node_modules/@fixture/tick'),store);
 fs.symlinkSync(store,path.join(linked,'node_modules/@fixture/tick'),'dir');
 assert.equal(compile(linked).reachableGraph.graphHash,graph.graphHash);
 // JavaScript keeps opaque dependencies and does not impose Native source restrictions.
 const javascript=path.join(temp,'javascript');setup(javascript);
 write(javascript,'node_modules/@fixture/tick/worker.js','throw new Error("never evaluate while planning");');
 const jsGraph=buildReachableProjectGraph(path.join(javascript,'src/index.ts'),{...options(javascript),target:'javascript'});
 assert.equal(jsGraph.graph.modules.filter(m=>m.kind==='project').length,1);
 const native=compileCanonicalNativePlan(plan,{cwd:repo,emitWat:false});
 const tc=acceptanceToolchain();const seen=[];
 const result=await tc.executeCanonicalNativeModule(native,{providerAdapter:{id:'npm-source',dispatchEffect(effect){seen.push(effect.parts.url);return {status:200,headers:{},body:'value'};}},request:{method:'GET',path:'/',url:'https://app.test/'}});
 assert.equal(result.response.body,'ok:value!');assert.deepEqual(seen,['https://source.test/value']);
 const tick=await tc.executeCanonicalNativeModule(native,{request:{method:'POST',path:'/tick',url:'https://app.test/tick'}});
 assert.deepEqual([tick.response.status,tick.response.body],[202,'tick']);
 const fastly=require('../../../packages/provider-fastly/src/build/native-platform-capabilities').compileFastlyNativePlatformCapabilitiesPlan(plan,{cwd:repo,canonicalBuild:true,requirePlatformCapability:false,emitWat:false,bindings:{effectBackends:{[plan.effects[0].id]:'proof'}}});
 const fastlyResult=tc.executeFastlyNativePlatformCapabilities(fastly,{request:{method:'GET',path:'/',url:'https://app.test/'},fixtures:{proof:{'/value':{status:200,body:'value'}}}});
 assert.equal(fastlyResult.response.body,result.response.body);
 console.log(JSON.stringify({status:'passed',sourceModules:sources.length,negativeCases:negative.length+2,nativeExecutions:3,graphHash:graph.graphHash}));
}
main().catch(error=>{console.error(error,error.diagnostics);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
