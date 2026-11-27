'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),output=path.resolve(process.argv[2]||path.join(os.tmpdir(),`pulse-upload03-${Date.now()}.json`));
if(fs.existsSync(output))throw Error('Refusing to overwrite an earlier attempt: '+output);
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const receipt={schema:'pulse.upload03.evidence.v1',status:'running',startedAt:new Date().toISOString(),node:process.version,
  baseCommit:git('rev-parse','HEAD'),baseTree:git('rev-parse','HEAD^{tree}'),workingTree:git('status','--porcelain'),
  sourceSha256:Object.fromEntries(fs.readdirSync(__dirname).filter(x=>/\.(cjs|ts)$/.test(x)).sort().map(name=>[name,hash(fs.readFileSync(path.join(__dirname,name)))])),
  productSupportClaim:false,compilerAdmissionClaim:false,liveProviderClaim:false,attempts:[]};
const save=()=>fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload03-receipts-'));save();
try{
  if(git('diff','HEAD','--name-only').split('\n').filter(Boolean).some(x=>!x.startsWith('wasm/test/s3/upload-03/')))throw Error('Tracked changes outside research directory');
  for(const [name,script,args,baseline]of [
    ['node-javascript','node-proof.cjs',['javascript'],false],['node-native','node-proof.cjs',['native'],false],
    ['fastly-upload02-regressions','native-proof.cjs',[],true],['fastly-fixed','native-proof.cjs',[],false]
  ]){
    const attempt={name,status:'running',startedAt:new Date().toISOString()};receipt.attempts.push(attempt);save();
    const file=path.join(tmp,name+'.json'),r=cp.spawnSync(process.execPath,[path.join(__dirname,script),...args,file],{
      cwd:root,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{...process.env,UPLOAD03_BASELINE:baseline?'1':'0'}});
    attempt.exitCode=r.status;attempt.signal=r.signal;attempt.finishedAt=new Date().toISOString();
    if(fs.existsSync(file))attempt.evidence=JSON.parse(fs.readFileSync(file,'utf8'));
    if(r.error||!attempt.evidence){attempt.status='failed';attempt.diagnostic=(r.error?.message||r.stderr||r.stdout).slice(-12000);throw Error(name+' did not finish');}
    const failed=attempt.evidence.cases.filter(x=>x.status==='failed').map(x=>x.name).sort();
    if(baseline){
      const expected=['send-error','deadline-response-close','late-early-rejection-cleanup'].sort();
      if(r.status!==1||attempt.evidence.status!=='failed'||JSON.stringify(failed)!==JSON.stringify(expected))throw Error('Historical reproduction did not match the three expected assertions');
      attempt.status='expected-failures-reproduced';attempt.expectedFailures=expected;
    }else{
      if(r.status!==0||failed.length||attempt.evidence.status!=='passed'||attempt.evidence.cases.length!==(name==='fastly-fixed'?40:32))throw Error(name+' failed or incomplete');
      attempt.status='passed';
    }
    console.log(name+': '+attempt.status+' ('+attempt.evidence.cases.length+' cases)');save();
  }
  receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.message;process.exitCode=1;console.error(error.message);}
finally{receipt.finishedAt=new Date().toISOString();save();fs.rmSync(tmp,{recursive:true,force:true});console.log(output);}
