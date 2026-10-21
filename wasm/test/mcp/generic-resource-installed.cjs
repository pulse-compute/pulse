'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,writeProject,physical,hash}=require('../runtime/binary-resource-closure-fixture.cjs');
async function qualify({consumer,temporary,root,run,env,verifyCopy}) {
 const app=path.join(temporary,'generic-consumer'),proof=path.join(temporary,'generic-proof'),data=fixture();
 fs.mkdirSync(app);fs.mkdirSync(proof);fs.copyFileSync(path.join(consumer,'package.json'),path.join(app,'package.json'));
 fs.cpSync(path.join(consumer,'node_modules'),path.join(app,'node_modules'),{recursive:true,verbatimSymlinks:true});
 const installed=verifyCopy(app);require('node:child_process').execFileSync('git',['init','--quiet',app],{env});writeProject(app,data);
 const settings={consumer:app,checkoutProbe:path.join(root,'package.json'),expected:data.expected,result:path.join(proof,'result.json'),removedSources:['src','.pulse','inputs'].map(file=>path.join(app,file))};
 const settingsFile=path.join(proof,'settings.json');fs.writeFileSync(settingsFile,JSON.stringify(settings));
 fs.copyFileSync(path.join(__dirname,'context-installed-read-guard.cjs'),path.join(proof,'read-guard.cjs'));
 const scratch=path.join(app,'.native-temp');fs.mkdirSync(scratch);
 const buildEnv={...env,TMPDIR:scratch,NODE_COMPILE_CACHE:'',NODE_OPTIONS:`--require=${path.join(proof,'read-guard.cjs')}`};
 const cli=path.join(app,'node_modules/@pulse-compute/cli/bin/pulse.js');
 for(const profile of ['native','javascript'])await run(process.execPath,[cli,'build','--profile',profile,'--json'],{cwd:app,environment:buildEnv,timeout:180000});
 const build=JSON.parse(fs.readFileSync(path.join(app,'dist-native/pulse-build.json')));
 const native=physical(fs.readFileSync(path.join(app,'dist-native',build.portable.wasm.file)),data);assert.deepEqual(native.physicalCopies,{shared:1,distinct:1,unused:0});
 for(const file of settings.removedSources)fs.rmSync(file,{recursive:true});
 for(const file of fs.readdirSync(path.join(app,'dist-native')).filter(f=>/\.(?:cjs|ts)$/.test(f)))fs.unlinkSync(path.join(app,'dist-native',file));
 const worker=path.join(proof,'worker.cjs');fs.copyFileSync(path.join(__dirname,'generic-resource-worker.cjs'),worker);
 const allowed=[proof,path.join(app,'package.json'),path.join(app,'dist-native'),path.join(app,'dist-javascript')],modules=path.join(app,'node_modules');
 for(const scope of fs.readdirSync(modules))if(!scope.startsWith('.')){if(scope.startsWith('@')){for(const name of fs.readdirSync(path.join(modules,scope)))if(`${scope}/${name}`!=='@pulse-compute/cli')allowed.push(path.join(modules,scope,name));}else allowed.push(path.join(modules,scope));}
 await run(process.execPath,[worker,settingsFile],{cwd:app,environment:{...env,NODE_COMPILE_CACHE:'',NODE_OPTIONS:['--permission',...allowed.map(p=>`--allow-fs-read=${p}`),`--allow-fs-write=${proof}`].join(' ')},timeout:120000});
 assert.deepEqual(verifyCopy(app),installed);
 return {status:'passed',native,installed,manifestSha256:hash(data.serialized),budgets:data.budgets,sourceInputsRemoved:true,buildReadGuard:'same trusted-tooling content-read guard as 07A; not a hostile-code sandbox',runtime:JSON.parse(fs.readFileSync(settings.result))};
}
module.exports={qualify};
