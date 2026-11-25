'use strict';
const fs=require('node:fs'),path=require('node:path'),v8=require('node:v8'),crypto=require('node:crypto');
const {install}=require('../upload-03/native-overlay.cjs');const evidence=install();
const owner=require('../../../../packages/provider-fastly/src/build/s3-native.js'),previous=owner.s3NativeSource;
owner.s3NativeSource=(plan,bindings)=>{
  let source=previous(plan,bindings).replaceAll('1048577','33554433').replaceAll('1048576','33554432');
  const anchor='  __s3_dispatched[index] = true;';
  if(source.split(anchor).length!==2)throw Error('UPLOAD04 framing boundary drift');
  source=source.replace(anchor, `  if (__u4_framing(req, 1) != 0) { __s3_close_req(req); __s3_close_body(body[0]); __s3_close_body(__pulse_fastly_request_body_handle); __s3_fail(index, 'framing'); return; }\n`+anchor);
  return source+`\n@external('fastly_http_req', 'framing_headers_mode_set') declare function __u4_framing(req: i32, mode: i32): i32\n`;
};
owner.S3_IMPORTS=[...owner.S3_IMPORTS,'fastly_http_req:framing_headers_mode_set'];
const {project}=require('./project.cjs');
const out=process.argv[2];if(fs.existsSync(out))throw Error('Use a new artifact directory');fs.mkdirSync(out,{recursive:true});const receipt={kind:'research-artifacts',capBytes:33554432,operationMs:10000,requestMs:15000,artifacts:{}};
for(const host of ['node','fastly']){
  const p=project(host);try{
    const compiled=host==='node'?p.compiled.native:p.T.compileFastly(p.resolved);
    const file=path.join(out,host==='node'?'node.native':'fastly.wasm');
    fs.writeFileSync(file,host==='node'?v8.serialize(compiled):compiled.wasm);
    receipt.artifacts[host]={file,bytes:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),wasmBytes:compiled.wasm.length,wasmSha256:crypto.createHash('sha256').update(compiled.wasm).digest('hex')};
  }finally{p.cleanup();}
}
fs.writeFileSync(path.join(out,'artifacts.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
