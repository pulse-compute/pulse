'use strict';
// Separate compiler wall-cost pass; never overlaps application timing.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const b=require('./build.cjs');
const input=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);assert(input!==out&&!fs.existsSync(out),'fresh compile output directory required');fs.mkdirSync(out,{recursive:true});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex'),proofBytes=fs.readFileSync(path.join(input,'receipt.json')),proof=JSON.parse(proofBytes);assert.equal(proof.status,'passed');
for(const row of proof.inputs)assert.equal(hash(fs.readFileSync(path.join(b.root,row.file))),row.sha256);
const scriptHash=hash(fs.readFileSync(__filename));
const receipt={version:'hex.ra09.compile.v1',status:'running',proofSha256:hash(proofBytes),scriptSha256:scriptHash,node:process.version,method:'one sequential wall sample per artifact; includes file preparation, compiler subprocess startup and optimization; excludes application execution; not a compile-time regression estimate',artifacts:[]};
const save=()=>fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');save();fs.copyFileSync(__filename,path.join(out,'compile.cjs'));
try{
 for(const row of proof.artifacts){
  const location=row.name.startsWith('ledger-')?'width-'+row.width+'/ledger':row.name.startsWith('width-')?row.name:'unused/'+row.name;
  const source=fs.readFileSync(path.join(input,location,'module.as.ts'),'utf8');assert.equal(hash(source),row.sourceSha256);
  const dir=path.join(out,row.name);fs.mkdirSync(dir,{recursive:true});const begin=process.hrtime.bigint();const bytes=b.compile(source,dir,'module');const wallMs=Number(process.hrtime.bigint()-begin)/1e6;
  assert.equal(hash(bytes),row.sha256,'same-basename reproduction must match bytes');receipt.artifacts.push({name:row.name,wallMs,sha256:row.sha256,sourceSha256:row.sourceSha256,bytes:bytes.length,identical:true});save();console.log('compiled - '+row.name);
 }
 assert.equal(receipt.artifacts.length,23);receipt.status='passed';
}catch(e){receipt.status='failed';receipt.error=e.stack;console.error(e.stack);process.exitCode=1;}
assert.equal(hash(fs.readFileSync(__filename)),scriptHash);save();console.log(JSON.stringify({status:receipt.status,artifacts:receipt.artifacts.length}));
