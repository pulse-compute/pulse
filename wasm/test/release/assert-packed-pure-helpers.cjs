'use strict';
// Test-only mirror: every product path resolves to sealed installed bytes. Test
// sources are copied; provider host fixtures also come from installed packages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {verifyClosure} = require('./assert-request-deadline-packages.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const repo = path.resolve(__dirname, '../../..');
const [consumerArg, releaseArg, outputArg] = process.argv.slice(2);
assert.ok(consumerArg && releaseArg && outputArg, 'usage: <installed consumer> <official pack directory> <fresh report directory>');
const consumer = fs.realpathSync(consumerArg), release = fs.realpathSync(releaseArg), output = path.resolve(outputArg);
assert.ok(!consumer.startsWith(repo + path.sep));
assert.equal(process.env.NODE_PATH, undefined);
assert.ok(!fs.existsSync(output));fs.mkdirSync(output, {recursive:true});
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'pulse-release-manifest.json')));
const catalog = JSON.parse(fs.readFileSync(path.join(release, 'pulse-source-release-catalog.json')));
const report = {schema:'pulse.pf05.packed-proof.v1',status:'running',node:process.version,manifestSha256:hash(fs.readFileSync(path.join(release,'pulse-release-manifest.json'))),packages:manifest.packages.map(p=>({name:p.name,sha256:p.sha256})),tasks:[],providerReality:false};
const save = ()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
save();
try {
 verifyClosure(consumer,release,manifest);
 const mirror = fs.mkdtempSync(path.join(consumer,'pf05-proof-'));
 report.mirror=mirror;
 fs.writeFileSync(path.join(mirror,'package.json'),JSON.stringify({private:true,workspaces:[]}));
 fs.mkdirSync(path.join(mirror,'wasm'));
 fs.cpSync(path.join(repo,'wasm/test'),path.join(mirror,'wasm/test'),{recursive:true});
 fs.symlinkSync(path.join(consumer,'node_modules'),path.join(mirror,'node_modules'),'dir');
 fs.symlinkSync(path.join(consumer,'node_modules'),path.join(mirror,'wasm/node_modules'),'dir');
 for(const p of catalog.packages){
  const dest=path.join(mirror,p.dir), installed=path.join(consumer,'node_modules',p.name);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.symlinkSync(installed,dest,'dir');
 }
 // Fail if any test accidentally reaches a workspace compiler/runtime package.
 const audit=path.join(mirror,'audit.cjs');fs.writeFileSync(audit,`const fs=require('node:fs'),assert=require('node:assert/strict');process.on('exit',()=>{for(const f of Object.keys(require.cache)){assert(!f.startsWith(${JSON.stringify(repo+'/packages/')}));assert(!f.startsWith(${JSON.stringify(repo+'/wasm/packages/')}));if(f.includes('/node_modules/@pulse-compute/'))assert(f.startsWith(${JSON.stringify(consumer+'/node_modules/')}));}fs.writeFileSync(process.env.PF05_AUDIT,JSON.stringify({workspaceProductModules:0,loadedModules:Object.keys(require.cache).length}));});`);
 const tasks=['lowering/assert-pure-source-helpers.cjs','lowering/assert-pure-record-helpers.cjs','lowering/assert-pure-argument-helpers.cjs','lowering/assert-pure-loop-helpers.cjs','lowering/assert-source-helpers.cjs','lowering/assert-loop-helpers.cjs','runtime/compiler-efficiency/o19-production-stage.cjs','runtime/compiler-efficiency/pf05-packed-proof.cjs'];
 for(const [i,task] of tasks.entries()){
  const script=path.join(mirror,'wasm/test',task),log=path.join(output,i+'.log'),auditFile=path.join(output,i+'-audit.json');
  const fd=fs.openSync(log,'w'),started=Date.now();
  const r=spawnSync(process.execPath,['--require',audit,script],{cwd:mirror,env:{...process.env,PF05_AUDIT:auditFile,PF05_OUTPUT:path.join(output,'sharing.json')},stdio:['ignore',fd,fd],timeout:300000});fs.closeSync(fd);
  report.tasks.push({task,testSha256:hash(fs.readFileSync(script)),exitCode:r.status,signal:r.signal,error:r.error?.message,durationMs:Date.now()-started,logSha256:hash(fs.readFileSync(log)),audit:fs.existsSync(auditFile)?JSON.parse(fs.readFileSync(auditFile)):null});save();
  console.error(task+': '+r.status);assert.equal(r.status,0,fs.readFileSync(log,'utf8').slice(-6000));assert.ok(report.tasks.at(-1).audit);
 }
 verifyClosure(consumer,release,manifest);report.installedClosureUnchanged=true;report.status='passed';
} catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;console.error(error);}
finally {report.completedAt=new Date().toISOString();save();}
