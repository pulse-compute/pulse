'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const [artifactDir,out]=process.argv.slice(2),root=path.resolve(__dirname,'../../../..');
if(fs.existsSync(out))throw Error('Refusing to overwrite receipt');
const receipt={status:'running',sourceRevision:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:process.version,artifacts:JSON.parse(fs.readFileSync(path.join(artifactDir,'artifacts.json'))),cases:[]};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'upload04-capacity-'));const save=()=>fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');save();
try{
  for(const mode of ['javascript','native'])for(const [size,concurrency,pace]of [...[65536,1048576,8388608,33554432].flatMap(size=>[1,8,16].map(c=>[size,c,'normal'])),[1048576,8,'slow-client'],[8388608,8,'slow-origin']]){
    const name=`${mode}-${size}-${concurrency}-${pace}`,file=path.join(tmp,name+'.json');
    const r=cp.spawnSync(process.execPath,['--expose-gc',path.join(__dirname,'node-capacity.cjs'),mode,String(size),String(concurrency),pace,path.join(artifactDir,'node.native'),file],{cwd:root,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
    if(r.status!==0){receipt.cases.push({name,status:'failed',exitCode:r.status,error:(r.error?.message||r.stderr).slice(-6000)});throw Error(name+' failed');}
    const result=JSON.parse(fs.readFileSync(file));receipt.cases.push({name,...result});save();console.log(name+': '+Math.round(result.p95Ms)+' ms p95');
  }
  receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.message;process.exitCode=1;}finally{save();fs.rmSync(tmp,{recursive:true,force:true});}
