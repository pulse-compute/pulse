'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {acceptanceToolchain}=require('../acceptance-toolchain.cjs');
const target={endpoint:'https://objects.example.invalid',bucket:'upload-fixture',region:'us-east-1',accessId:'fixture-id',secret:'fixture-secret'};
const source=require('../upload-02/scaffold.cjs').source.replace("return ctx.text(result.status);","return ctx.text(result.status+':'+result.reason);").replace("  if(result.status==='stored')", "  await ctx.secret.get('AFTER_UPLOAD');\n  if(result.status==='stored')");
function project(host){
  const root=path.resolve(__dirname,'../../../..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload04-')),T=acceptanceToolchain();
  const cleanup=()=>fs.rmSync(cwd,{recursive:true,force:true});
  try {
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','s3'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
    const binding={endpoint:target.endpoint,bucket:target.bucket,region:target.region,accessKeyIdSecret:'S3_ID',secretAccessKeySecret:'S3_SECRET',maxTextBytes:16384,timeoutMs:10000,...host==='fastly'?{backend:'object_origin'}:{}};
    const config={maxDurationMs:15000,bindings:{s3:{objects:binding},...host==='fastly'?{secretStore:'app_secrets'}:{}}};
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,crypto:['SHA-256','HMAC-SHA256'],defaultProfile:'proof'},proof:{host:'${host}',target:'native',${host}:${JSON.stringify(config)}}}));`);
    const resolved=T.resolveProject({cwd,profile:'proof'}),compiled=T.compileNativeProjectInMemory(resolved);
    if(compiled.plan.effects.filter(x=>x.kind.startsWith('s3.')).length!==1||compiled.plan.effects.some(x=>x.grouped))throw Error('one ungrouped scaffold required');
    return {cwd,T,compiled,resolved,cleanup};
  }catch(error){cleanup();throw error;}
}
module.exports={project,target,source};
