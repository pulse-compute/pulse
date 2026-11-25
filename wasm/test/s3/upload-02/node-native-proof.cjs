'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {source}=require('./scaffold.cjs'); // same explicit compiler scaffold
const {acceptanceToolchain}=require('../acceptance-toolchain.cjs');
const {createOwner}=require('./node-transport.cjs');
const {verify}=require('../upload-01/local.cjs');
const {bytesAt}=require('../upload-01/transport.cjs');
const target={endpoint:'https://objects.example.invalid',bucket:'upload-fixture',region:'us-east-1',accessId:'fixture-id',secret:'fixture-secret'};
async function run(){
  const root=path.resolve(__dirname,'../../../..'),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-upload02-node-native-'));
  const T=acceptanceToolchain();let fixture;
  const server=http.createServer((req,res)=>{void(async()=>{
    fixture.requests++; assert(verify(req.method,req.url,req.headers,target));
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    fixture.body=Buffer.concat(chunks);assert(fixture.body.length<=1048576);
    res.writeHead(200,{'content-length':'0',etag:'"opaque"'});res.end();
  })().catch(error=>{fixture.error=error;res.destroy();});});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  try{
    fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    for(const name of ['pulse','s3'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));fs.writeFileSync(path.join(cwd,'src/index.ts'),source);
    const binding={endpoint:target.endpoint,bucket:target.bucket,region:target.region,accessKeyIdSecret:'S3_ID',secretAccessKeySecret:'S3_SECRET',maxTextBytes:16384,timeoutMs:1500};
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>({pulse:{entry:'src/index.ts',strict:false,crypto:['SHA-256','HMAC-SHA256'],defaultProfile:'proof'},proof:{host:'node',target:'native',node:{maxDurationMs:2000,bindings:${JSON.stringify({s3:{objects:binding}})}}}}));`);
    const compiled=T.compileNativeProjectInMemory(T.resolveProject({cwd,profile:'proof'})),cases=[];
    assert.equal(compiled.plan.effects.filter(x=>x.kind.startsWith('s3.')).length,1);
    assert(!compiled.plan.effects.some(x=>x.grouped));
    for(const scenario of [...[0,1,16385,1048576].map(size=>({name:`binary-${size}`,size})),{name:'authorization-denied',size:1,denied:true},{name:'missing-length',size:1,missing:true}]){
      fixture={requests:0};let offset=0,reads=0,authorized=false;const size=scenario.size,effects=[];
      const body=new ReadableStream({pull(controller){assert(authorized);reads++;if(offset===size){controller.close();return;}const n=Math.min(65536,size-offset);controller.enqueue(bytesAt(offset,n));offset+=n;}},{highWaterMark:0});
      const request=new Request('https://app.example/',{method:'POST',body,duplex:'half'});
      const raw=[['x-object-key','café %/雪.bin'],...scenario.missing?[]:[['content-length',String(size)]]];
      const {owner,metrics}=createOwner(request,raw,{port:server.address().port,binding:target,timeoutMs:1500,secret:name=>name==='S3_ID'?target.accessId:target.secret});
      let result;
      try{
        result=await T.executeCanonicalNativeModule(compiled.native,{request:{method:'POST',url:'https://app.example/',headers:raw},incomingBody:owner,maxDurationMs:2000,
          providerAdapter:{id:'node-upload02-research',async dispatchEffect(effect,execution){
            effects.push(effect.kind);
            if(effect.kind==='secret.get'){assert.equal(reads,0);authorized=!scenario.denied;return scenario.denied?'denied':'allowed';}
            assert.equal(effect.kind,'s3.putText');assert(authorized);assert(!effect.grouped);
            const metadata={binding:effect.payload.binding,key:effect.payload.key};
            try{owner.claim(owner.marker(),metadata);}catch{return {status:'not-stored',reason:'admission'};}
            return owner.forward(target.endpoint,metadata,execution);
          }} });
      }finally{await owner.close();}
      if(fixture.error)throw fixture.error;
      const expected=scenario.denied?'denied':scenario.missing?'not-stored':'stored:'+size;
      assert.equal(result.response.body,expected,JSON.stringify(result.response));
      if(expected.startsWith('stored:')){assert.deepEqual(fixture.body,bytesAt(0,size));assert.equal(metrics.dispatches,1);assert(metrics.inputEOF&&metrics.uploadFinished);}
      else{assert.equal(reads,0);assert.equal(metrics.dispatches,0);}
      cases.push({name:scenario.name,status:'passed',result:expected,effects,sourceReads:reads,metrics});
    }
    return {status:'passed',cases,wasm:{bytes:compiled.native.wasm.length,sha256:require('node:crypto').createHash('sha256').update(compiled.native.wasm).digest('hex')},
      limitations:['putText plan is a compiler scaffold; research adapter supplies the upload operation','generic Native continuation proven; public upload lowering and admission not implemented','loopback HTTP; no TLS or installed-package claim']};
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));fs.rmSync(cwd,{recursive:true,force:true});}
}
module.exports={run};
if(require.main===module)run().then(r=>fs.writeFileSync(process.argv[2],JSON.stringify(r,null,2)+'\n')).catch(e=>{console.error(e);process.exitCode=1;});
