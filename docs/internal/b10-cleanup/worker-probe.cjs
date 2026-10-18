'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out);fs.mkdirSync(path.join(out,'tasks'));
const load=f=>require(path.join(root,f)), p=load('scripts/release-parallel.cjs'),r=load('scripts/release-recovery.cjs');
const candidate=load('scripts/release-feature-acceptance.cjs').candidateIdentity(root);
const report={candidate,status:'running',qualification:false,node:process.version};
const snapshot=dir=>cp.execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:dir,encoding:'utf8'});
async function main(){let layout;
try{
 layout=p.prepareWorkspaces(root,candidate,1,6144,1);
 const w=layout.workspaces[0],binding={root,candidate,directory:w.directory,layoutFile:path.join(path.dirname(w.directory),'layout.json'),inputs:r.inputIdentity(w.directory)};
 report.binding=binding;
 const task=load('wasm/test/suite/registry.cjs').tasks['fastly-native-platform-capabilities'];
 await p.verifyWorkerAsync(binding);
 report.result=await load('wasm/scripts/run-wasm-tests.cjs').runTask('fastly-native-platform-capabilities',task,{runDir:out,workerCleanup:binding,cwd:path.join(w.directory,'wasm'),executionRoot:w.directory});
 report.afterTask=snapshot(w.directory);
 try{report.nextAdmission=await p.verifyWorkerAsync(binding);}catch(e){report.nextAdmission={error:e.stack};}
 report.afterAdmission=snapshot(w.directory);if(report.afterAdmission)report.status='residue';
 report.status=report.result.status==='passed'&&!report.nextAdmission.error?'passed':'failed';
}finally{
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
 if(layout)p.cleanupWorkspaces(root,candidate.sourceTree,1);
}}
main().catch(e=>{report.status='failed';report.error=e.stack;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
