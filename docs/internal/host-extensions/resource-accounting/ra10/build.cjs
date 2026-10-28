'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const prior=require('../ra07/build.cjs');
const once=(s,a,b)=>{assert.equal(s.split(a).length-1,1,a);return s.replace(a,b);};
const logging=`
@external('wasi_snapshot_preview1','fd_write') declare function ra10_write(fd:i32,iov:usize,n:i32,out:usize):i32;
function ra10_log(s:string):void {const b=String.UTF8.encode('RA10 '+s+'\\n'),v=new StaticArray<i32>(3);v[0]=i32(changetype<usize>(b));v[1]=b.byteLength;ra10_write(1,changetype<usize>(v),1,changetype<usize>(v)+8);}
function ra10_snapshot():void {
 ra10_log('{"kind":"composed","closed":'+proof_closed().toString()+',"handles":'+proof_query(0,0).toString()+',"bytes":'+proof_query(1,0).toString()+',"records":'+proof_query(2,0).toString()+',"invocations":'+proof_query(3,0).toString()+',"ledgerError":'+proof_query(17,0).toString()+',"fetchCloses":'+proof_query(14,0).toString()+',"cacheDisposals":'+proof_query(15,0).toString()+',"cleanupErrors":'+proof_query(16,0).toString()+'}');
}
`;
function build(out,width){
 const a=prior.build(path.join(out,'generated'),'fixture',width);
 let s=once(a.source,"@external('ra06_proof','event') declare function cc_event(code:i32,index:i32,value:i32):void;",'function cc_event(code:i32,index:i32,value:i32):void {}');
 s=once(s,'na_end();cc_event(31,-1,0);','na_end();cc_event(31,-1,0);ra10_snapshot();');s+=logging;
 const wasm=prior.compile(s,out,'module');
 const imports=WebAssembly.Module.imports(new WebAssembly.Module(wasm));
 assert(!imports.some(x=>x.module==='ra06_proof'||x.module==='env'));
 const withoutLogs=xs=>xs.filter(x=>x.module!=='ra06_proof'&&!(x.module==='wasi_snapshot_preview1'&&x.name==='fd_write')).map(x=>JSON.stringify(x)).sort();
 assert.deepEqual(withoutLogs(imports),withoutLogs(a.imports));
 return {source:s,wasm,imports};
}
if(require.main===module){const out=path.resolve(process.argv[2]);assert(!fs.existsSync(out),'fresh output directory required');fs.mkdirSync(out,{recursive:true});prior.compile(fs.readFileSync(path.join(__dirname,'probe.as.ts'),'utf8'),path.join(out,'abi'),'module');for(const n of [1,8,32]){build(path.join(out,'width-'+n),n);console.log('built '+n);}}
module.exports={...prior,build};
