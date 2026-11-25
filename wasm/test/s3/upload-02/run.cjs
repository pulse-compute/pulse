'use strict';
// Separate processes keep research overlays from contaminating another target.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../..');
const output=path.resolve(process.argv[2]||path.join(os.tmpdir(),`pulse-upload02-${Date.now()}.json`));
if(fs.existsSync(output))throw new Error('Refusing to overwrite an earlier evidence attempt: '+output);
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const sourceFiles=fs.readdirSync(__dirname).filter(x=>/\.(cjs|ts)$/.test(x)).sort();
const receipt={schema:'pulse.upload02.evidence.v1',status:'running',startedAt:new Date().toISOString(),node:process.version,
  baseCommit:git('rev-parse','HEAD'),baseTree:git('rev-parse','HEAD^{tree}'),workingTree:git('status','--porcelain'),
  sourceSha256:Object.fromEntries(sourceFiles.map(name=>[name,hash(fs.readFileSync(path.join(__dirname,name)))])),
  productSupportClaim:false,compilerAdmissionClaim:false,liveProviderClaim:false,targets:[]};
const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload02-receipts-'));
save();
try {
  // The baseline tree pins all reused owners. Reject hidden product modifications.
  const changes=git('diff','HEAD','--name-only').split('\n').filter(Boolean);
  if(changes.some(x=>!x.startsWith('wasm/test/s3/upload-02/')))throw new Error('Product changes outside this research directory');
  for(const name of ['node-proof','node-native-proof','native-proof']) {
    const target={name,status:'running'};receipt.targets.push(target);save();
    const file=path.join(tmp,name+'.json');
    const result=cp.spawnSync(process.execPath,[path.join(__dirname,name+'.cjs'),file],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
    target.exitCode=result.status;target.signal=result.signal;
    if(result.status!==0||result.error){target.status='failed';target.diagnostic=(result.error?.message||result.stderr||result.stdout).slice(-12000);throw new Error(name+' failed');}
    target.evidence=JSON.parse(fs.readFileSync(file,'utf8'));
    if(target.evidence.status!=='passed'||!target.evidence.cases.length||target.evidence.cases.some(x=>x.status!=='passed'))throw new Error(name+' incomplete');
    target.status='passed';save();
    console.log(name+': '+target.evidence.cases.length+' cases passed');
  }
  receipt.status='passed';
} catch(error) {receipt.status='failed';receipt.error=error.message;process.exitCode=1;console.error(error.message);}
finally {receipt.finishedAt=new Date().toISOString();save();fs.rmSync(tmp,{recursive:true,force:true});console.log(output);}
