const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(process.cwd(),'.cleanup-plain-'));
const c=cp.spawn(process.execPath,['-e',`const fs=require('node:fs'),p=require('node:path'),d=process.argv[1];fs.mkdirSync(p.join(d,'src'));fs.writeFileSync(p.join(d,'src/index.ts'),'probe');setTimeout(()=>{fs.rmSync(d,{recursive:true,force:true});console.log('child',fs.existsSync(d));},3000);`,dir],{cwd:path.join(process.cwd(),'wasm'),stdio:['ignore','pipe','pipe'],detached:true});
c.stdout.on('data',b=>process.stdout.write(b));c.on('close',()=>{console.log(JSON.stringify({dir,exists:fs.existsSync(dir),status:cp.execFileSync('git',['status','--porcelain'],{encoding:'utf8'})}));fs.rmSync(dir,{recursive:true,force:true});});
