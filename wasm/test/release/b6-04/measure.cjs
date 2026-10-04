#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {root,hash,json,write,run,identity,snapshot}=require('./common.cjs');
const CONTROL='e9bf187d0de0ccc54248a29bca24937d6bed79a9';
const modes=['default','experimental-native-bounded-size','experimental-native-size'];
const output=fs.mkdtempSync(path.join(root,'wasm/.test-results/b6-04-measure-'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-b6-04-measure-')),control=path.join(temp,'control');
const report={schema:'pulse.b6-04.measurements.v1',status:'running',candidate:identity(),controlRevision:CONTROL,node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,oracleSha256:hash(Buffer.concat(['common.cjs','measure.cjs','measure-worker.cjs'].map(f=>fs.readFileSync(path.join(__dirname,f))))),rows:[],note:'Serial fresh workers; compile repeats and timings are observations, not a statistical performance guarantee. RSS is Linux wait4 largest-process high-water RSS including descendants, not simultaneous tree RSS. Request lifecycle includes instantiation; isolated instantiation is also recorded.'};
const save=()=>write(path.join(output,'report.json'),report);
let worktree=false;
function setup(cwd,selected,kind){
 fs.mkdirSync(cwd,{recursive:true});
 if(kind==='history') require('../../runtime/compiler-efficiency/o25-history-helper.cjs').fixture(cwd,16);
 else{
  fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));
  for(const file of ['partition.ts','types.ts'])fs.copyFileSync(path.join(root,'wasm/test/fixtures/pure-helpers',file),path.join(cwd,'src',file));
  fs.writeFileSync(path.join(cwd,'src/schemas.ts'),"import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';import type {PartitionHead} from './types';export default defineSchemaRegistry({schemas:{'app.Head':schema<PartitionHead>()}});\n");
  fs.writeFileSync(path.join(cwd,'src/index.ts'),"import {Pulse} from '@pulse-compute/pulse';import {validPartition} from './partition';const app=new Pulse({auto:true});app.post('/',async(ctx)=>{const head=await ctx.req.json('app.Head');const a=validPartition(head,'item','abc',0);const b=validPartition(head,'item','abc',0);return ctx.text(''+a+'|'+b);});export default app;\n");
  fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),"import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>({pulse:{entry:'src/index.ts',schema:'src/schemas.ts',strict:false},node:{host:'node',target:'native'}}));\n");
 }
 fs.rmSync(path.join(cwd,'node_modules'),{recursive:true,force:true});fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
 for(const name of ['pulse','runtime','s3','crypto'])fs.symlinkSync(path.join(selected,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
 return {source:snapshot(path.join(cwd,'src')),config:snapshot(path.join(cwd,'.pulse'))};
}
function toolchain(selected){const {createRequire}=require('node:module'),req=createRequire(path.join(selected,'wasm/packages/compiler/package.json'));return {assemblyscript:req('assemblyscript/package.json').version,jsonAs:req('json-as/package.json').version,binaryen:createRequire(path.join(selected,'wasm/packages/wasm-guest-link/package.json'))('binaryen/package.json').version};}
function worker(phase,selected,cwd,mode,out){
 const args=[process.execPath,path.join(__dirname,'measure-worker.cjs'),phase,selected,cwd,mode,out];
 // Python wait4 accounts for the complete child lifetime including synchronous compiler descendants.
 const python="import os,sys,json,time,subprocess\nt=time.monotonic()\np=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE,stderr=subprocess.PIPE)\nout,err=p.communicate()\nimport resource\nr=resource.getrusage(resource.RUSAGE_CHILDREN)\nif p.returncode: sys.stderr.buffer.write(err);sys.exit(p.returncode)\nprint(json.dumps({'result':json.loads(out),'processWallMs':(time.monotonic()-t)*1000,'maxRssKiB':r.ru_maxrss}))";
 return JSON.parse(run('python3',['-c',python,...args],{cwd:selected,timeout:360000}));
}
try{
 assert.equal(process.platform,'linux','RSS metric currently defined for Linux');save();
 run('git',['worktree','add','--detach',control,CONTROL],{cwd:root});worktree=true;
 const locks=[root,control].map(r=>fs.readFileSync(path.join(r,'pnpm-lock.yaml'),'utf8'));
 assert.equal(locks[0].slice(locks[0].indexOf('\npackages:')),locks[1].slice(locks[1].indexOf('\npackages:')),'identical external package versions, integrity and snapshots required');
 report.lockfiles={candidate:hash(locks[0]),control:hash(locks[1]),externalResolutionsEqual:true,workspaceTopology:'each revision retains its own workspace importers'};
 const {ensurePnpm}=require('../../../../scripts/pnpm-toolchain.cjs'),version=require('../../../../scripts/package-support.cjs').PUBLICATION.pnpmVersion;
 const pnpm=ensurePnpm(root,version);report.pnpm=run(pnpm,['--version']).trim();
 console.log('measure - restore pinned control dependencies and build');
 run(pnpm,['install','--frozen-lockfile','--ignore-scripts'],{cwd:control});run(pnpm,['build'],{cwd:control});
 report.control=identity(control);report.toolchain=toolchain(root);assert.deepEqual(toolchain(control),report.toolchain);
 for(const kind of ['compact','history']){
  const projects={};for(const [name,selected]of [['control',control],['candidate',root]])projects[name]={cwd:path.join(temp,name,kind),identity:setup(path.join(temp,name,kind),selected,kind)};
  assert.deepEqual(projects.control.identity,projects.candidate.identity);
  for(const mode of modes)for(const [name,selected]of [['control',control],['candidate',root]]){
   const {cwd,identity:source}=projects[name],out=path.join(output,`${kind}-${mode}-${name}`);
   console.log(`measure - ${kind} ${mode} ${name}`);
   const row={kind,mode,revision:name,source,compile:[]};report.rows.push(row);save();
   for(let trial=0;trial<2;trial++){const measured=worker('compile',selected,cwd,mode,out);row.compile.push(measured);save();}
   assert.equal(row.compile[0].result.wasmSha256,row.compile[1].result.wasmSha256);assert.equal(row.compile[0].result.planHash,row.compile[1].result.planHash);
   row.structure=worker('structure',selected,cwd,mode,out).result;row.startup=worker('startup',selected,cwd,mode,out);row.runtime=worker('runtime',selected,cwd,mode,out);row.status='passed';save();
  }
 }
 assert.equal(report.rows.length,12);assert.ok(report.rows.every(r=>r.status==='passed'));report.status='passed';
}catch(e){report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1;}
finally{report.completedAt=new Date().toISOString();save();if(worktree)run('git',['worktree','remove','--force',control],{cwd:root});fs.rmSync(temp,{recursive:true,force:true});console.log(`measurement report: ${path.join(output,'report.json')}`);}
