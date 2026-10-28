'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process'),b=require('./build.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const out=path.resolve(process.argv[2]),binary=path.resolve(process.argv[3]),upstream=path.resolve(process.argv[4]);
assert(!fs.existsSync(out),'fresh output directory required');fs.mkdirSync(out,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:b.root,encoding:'utf8',timeout:15000}).trim();
const upstreamRevision='ba6fb78c02b2f40b70f8c65ab86fa86c66f0641f';
const upstreamFiles=['src/wiggle_abi/body_impl.rs','src/wiggle_abi/req_impl.rs','src/wiggle_abi/resp_impl.rs','src/wiggle_abi/cache.rs','src/async_io.rs','src/sandbox.rs','src/sandbox/async_item.rs','src/streaming_body.rs','src/body.rs','src/cache.rs','src/cache/store.rs','src/body_tee.rs','src/execute.rs','wasm_abi/compute-at-edge-abi/compute-at-edge.witx','wasm_abi/compute-at-edge-abi/cache.witx','wasm_abi/compute-at-edge-abi/typenames.witx','LICENSE'];
const localFiles=['build.cjs','check.cjs','run.cjs','probe.as.ts','profile.json','../ra03/native/build.cjs','../ra03/native/service.as.ts','../ra05/adapter.as.ts','../ra06/service.as.ts','../ra07/build.cjs','../ra07/service.as.ts','../ra07/host.cjs','../../composition/prototype.cjs','../../composition/fixture.cjs','../../composition/service.as.ts','../../ownership/prototype.cjs','../../ownership/fixture.cjs','../../ownership/service.as.ts'].map(x=>path.resolve(__dirname,x)).concat(path.join(b.root,'pnpm-lock.yaml'));
const inputs=()=>localFiles.map(file=>({file:path.relative(b.root,file),sha256:hash(fs.readFileSync(file))}));
const receipt={version:'hex.ra10.qualification.v1',status:'running',base:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),inputs:inputs(),node:process.version,platform:process.platform,arch:process.arch,compiler:{version:JSON.parse(fs.readFileSync(path.join(path.dirname(b.asc.script),'../package.json'))).version,sha256:hash(fs.readFileSync(b.asc.script))},upstream:{repository:'fastly/Viceroy',revision:upstreamRevision,files:[]},controls:[],artifacts:[]};
const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();
function snapshot(file,relative){const dest=path.join(out,'inputs',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(file,dest);}
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
try{
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim(),upstreamRevision);
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:upstream,encoding:'utf8'}).trim(),'');
 for(const f of localFiles)snapshot(f,path.relative(b.root,f));
 for(const file of upstreamFiles){const f=path.join(upstream,file);receipt.upstream.files.push({file,sha256:hash(fs.readFileSync(f))});snapshot(f,'upstream/'+file);}
 const buildDir=path.join(out,'build');fs.mkdirSync(buildDir);
 const probe=b.compile(fs.readFileSync(path.join(__dirname,'probe.as.ts'),'utf8'),path.join(buildDir,'abi'),'module');
 assert(WebAssembly.Module.imports(new WebAssembly.Module(probe)).every(x=>x.module.startsWith('fastly_')||x.module==='wasi_snapshot_preview1'));
 const {execute}=require('../ra07/host.cjs');
 for(const width of [1,8,32]){
  const dir=path.join(buildDir,'width-'+width),a=b.build(dir,width),original=fs.readFileSync(path.join(dir,'generated/fixture.wasm'));
  for(const miss of [false,true]){
   const control=execute(original,{slots:width*4,miss}),observed=execute(a.wasm,{slots:width*4,miss});
   // The real-host bridge only replaces the injected event sink with post-close
   // WASI diagnostics. Preserve outcomes, ledger facts and independent host state.
   for(const key of ['body','json','status','thrown','committed','accounting','remaining','slots','error','stage','closed','authority'])assert.deepEqual(observed[key],control[key],key);
   assert.equal(observed.accounting.ledgerError,0);assert.equal(observed.accounting.handles,0);
   receipt.controls.push({width,miss,status:'passed',accounting:observed.accounting});save();
  }
  console.log('built and matched width '+width);
 }
 receipt.loadedSources=Object.keys(require.cache).filter(f=>f.startsWith(b.root+path.sep)&&!f.includes('/node_modules/')).sort().map(f=>({file:path.relative(b.root,f),sha256:hash(fs.readFileSync(f))}));
 for(const file of walk(buildDir))receipt.artifacts.push({file:path.relative(out,file),bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))});save();
 const log=fs.openSync(path.join(out,'host-run.log'),'w');try{execFileSync(process.execPath,[path.join(__dirname,'run.cjs'),buildDir,binary,path.join(out,'host')],{stdio:['ignore',log,log],timeout:130000});}finally{fs.closeSync(log);}
 const host=JSON.parse(fs.readFileSync(path.join(out,'host/receipt.json')));
 assert.equal(host.status,'passed');assert.equal(host.cleanup,true);assert.equal(host.cases.length,33);assert.equal(new Set(host.cases.map(c=>c.name)).size,33);assert(host.cases.every(c=>c.status==='passed'));
 for(const item of receipt.artifacts)assert.equal(hash(fs.readFileSync(path.join(out,item.file))),item.sha256);
 assert.deepEqual(inputs(),receipt.inputs,'source inputs changed during qualification');
 receipt.host={file:'host/receipt.json',sha256:hash(fs.readFileSync(path.join(out,'host/receipt.json'))),checks:host.cases.length};receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.stack;process.exitCode=1;console.error(error.stack);}
finally{save();console.log(JSON.stringify({status:receipt.status,controls:receipt.controls.length,host:receipt.host,out}));}
