'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {acceptanceToolchain}=require('../s3/acceptance-toolchain.cjs');
const root=path.resolve(__dirname,'../../..');
async function main(options={}){
  const installed=options.packedRoot?require('node:module').createRequire(path.join(options.packedRoot,'package.json')):require;
  const product=(name,fallback)=>options.packedRoot?installed(name):require(fallback);
  const assetsRoot=options.packedRoot?path.join(options.packedRoot,'node_modules/@pulse-compute/assets'):path.join(root,'packages/assets');
  const {createEmbeddedManifest}=await import(pathToFileURL(path.join(assetsRoot,'dist/embedded.js')));
  const bytes=Buffer.from([0,255,192,128,254,1]);
  const manifest=await createEmbeddedManifest([{path:'/image.bin',bytes},{path:'/empty',bytes:new Uint8Array()}]);
  const serialized=JSON.stringify(manifest), etag='"'+manifest.files.find(f=>f.path==='/image.bin').sha256+'"';
  const cwd=options.packedRoot||fs.mkdtempSync(path.join(__dirname,'.native-embedded-'));
  try{
    fs.mkdirSync(path.join(cwd,'src'));fs.mkdirSync(path.join(cwd,'.pulse'));fs.mkdirSync(path.join(cwd,'node_modules/@pulse-compute'),{recursive:true});
    if(!options.packedRoot)for(const name of ['pulse','assets'])fs.symlinkSync(path.join(root,'packages',name),path.join(cwd,'node_modules/@pulse-compute',name),'dir');
    const config={pulse:{entry:'src/index.ts',defaultProfile:'native',strict:false},native:{host:'node',target:'native'},fastly:{host:'fastly',target:'native',fastly:{maxDurationMs:1000}}};
    fs.writeFileSync(path.join(cwd,'.pulse/config.ts'),`import {defineConfig} from '@pulse-compute/pulse';export default defineConfig((_scope)=>(${JSON.stringify(config)}));`);
    const route=(method,url,key)=>`app.${method.toLowerCase()}('${url}',async ctx=>{const r=await assets.lookup(ctx,'embedded','${key}',{method:'${method}',embeddedManifest:${JSON.stringify(serialized)}});return r;});`;
    fs.writeFileSync(path.join(cwd,'src/index.ts'),`import {Pulse} from '@pulse-compute/pulse';import {assets} from '@pulse-compute/assets';const app=new Pulse({auto:true});${route('GET','/image','/image.bin')}${route('HEAD','/head','/image.bin')}${route('GET','/empty','/empty')}${route('GET','/missing','/absent')}export default app;`);
    const tools=acceptanceToolchain(options.packedRoot),project=tools.resolveProject({cwd,profile:'native'});
    const compileFastly=()=>{
      const built=tools.buildProject(tools.resolveProject({cwd,profile:'fastly'}));assert.equal(built.status,'built');
      const wasm=fs.readFileSync(path.join(built.outDir,'bin/main.wasm'));return {wasm,inspection:{imports:WebAssembly.Module.imports(new WebAssembly.Module(wasm))}};
    };
    const native=tools.compileNativeProjectInMemory(project), fastly=compileFastly();
    fs.unlinkSync(path.join(cwd,'src/index.ts')); // Native artifacts are self-contained.

    let count=0;
    for(const target of ['native','fastly']){
      async function run(route,headers=[]){
        count++;
        const request={method:route==='/head'?'HEAD':'GET',path:route,url:'https://app.invalid'+route,headers};
        if(target==='fastly'){
          const result=tools.executeFastlyNativePlatformCapabilities(fastly,{request,bodyWriteChunkBytes:2});
          assert.equal(result.trace.some(x=>x.module==='fastly_kv_store'||x.name==='send_async'),false,'embedded lookup never contacts a store or origin');
          return {status:result.response.status,headers:new Headers(result.response.headers),bytes:result.response.bodyBytes};
        }
        const result=await tools.executeCanonicalNativeModule(native.native,tools.driver.executionOptions(project.providerConfig,{request,strict:false}));
        assert.equal(result.status,'completed');
        const response=new Response(result.response.bodyStream??null,{status:result.response.status,headers:result.response.headers});
        return {status:response.status,headers:response.headers,bytes:Buffer.from(await response.arrayBuffer())};
      }
      let r=await run('/image');assert.deepEqual(r.bytes,bytes);assert.equal(r.headers.get('etag'),etag);assert.equal(r.headers.get('content-length'),'6');
      r=await run('/head',[['range','bytes=1-3']]);assert.equal(r.bytes.length,0);assert.equal(r.headers.get('content-length'),'6');
      r=await run('/image',[['range','bytes=1-3']]);assert.equal(r.status,206);assert.deepEqual(r.bytes,bytes.subarray(1,4));assert.equal(r.headers.get('content-range'),'bytes 1-3/6');
      r=await run('/image',[['range','bytes=1-99']]);assert.deepEqual(r.bytes,bytes.subarray(1));
      r=await run('/image',[['range','bytes=6-9']]);assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */6');
      for(const range of ['bytes=1-','bytes=-1','bytes=3-2','bytes=0-1,3-4','bytes=0-9007199254740992']){r=await run('/image',[['range',range]]);assert.equal(r.status,400);}
      r=await run('/image',[['range','bytes=1-3'],['if-range','"different"']]);assert.deepEqual(r.bytes,bytes);
      r=await run('/image',[['range','bytes=1-3'],['if-range',etag]]);assert.equal(r.status,206);
      r=await run('/image',[['if-none-match','W/'+etag],['range','bytes=99-100']]);assert.equal(r.status,304);assert.equal(r.bytes.length,0);
      r=await run('/image',[['if-none-match','*']]);assert.equal(r.status,304);
      r=await run('/image',[['if-none-match','"one"'],['if-none-match','"two"']]);assert.equal(r.status,400);
      r=await run('/image',[['range','bytes=0-1'],['range','bytes=2-3']]);assert.equal(r.status,400);
      r=await run('/empty');assert.equal(r.bytes.length,0);assert.equal(r.headers.get('content-length'),'0');
      r=await run('/empty',[['range','bytes=0-1']]);assert.equal(r.status,416);
      r=await run('/missing');assert.equal(r.status,404);
    }
    const ts=installed('typescript');
    const lower=({sourceText})=>product('@pulse-compute/assets/pulsewasm/compiler','../../../packages/assets/pulsewasm.compiler.cjs').buildAssetsLoweringPlan({sourceFile:ts.createSourceFile('embedded.ts',sourceText,ts.ScriptTarget.Latest,true),typescript:ts});
    const source=(serialized,key='/image.bin')=>`import {assets} from '@pulse-compute/assets';app.get('/',async ctx=>{const r=await assets.lookup(ctx,'embedded',${JSON.stringify(key)},{embeddedManifest:${JSON.stringify(serialized)}});return r;});`;
    assert.equal(lower({sourceText:source(serialized)}).hasErrors,false);
    for(const key of ['/../image.bin','/%2e/image.bin','/a//b','/a\\b'])assert.equal(lower({sourceText:source(serialized,key)}).hasErrors,true);
    for(const mutate of [m=>m.id='0'.repeat(64),m=>m.files[0].data='AAAA',m=>m.files.reverse(),m=>m.byteLength++,m=>m.files[0].extra=true]){
      const invalid=structuredClone(manifest);mutate(invalid);assert.equal(lower({sourceText:source(JSON.stringify(invalid))}).hasErrors,true);
    }
    const select=product('@pulse-compute/wasm-contracts/assets/contracts','../../packages/contracts/src/assets/contracts.js').selectEmbeddedAsset;
    const maximum=await createEmbeddedManifest(Array.from({length:4},(_,i)=>({path:'/file'+i,bytes:new Uint8Array(262144)})));
    assert.equal(select(JSON.stringify(maximum),'/file0').embeddedLength,262144);
    assert.throws(()=>select(serialized+' ','/image.bin'));
    // Exercise the inclusive byte boundary through both actual Native artifacts.
    const maximumSource=`import {Pulse} from '@pulse-compute/pulse';import {assets} from '@pulse-compute/assets';const app=new Pulse({auto:true});app.get('/',async ctx=>{const r=await assets.lookup(ctx,'embedded','/file0',{embeddedManifest:${JSON.stringify(JSON.stringify(maximum))}});return r;});export default app;`;
    fs.writeFileSync(path.join(cwd,'src/index.ts'),maximumSource);
    const largeProject=tools.resolveProject({cwd,profile:'native'}), large=tools.compileNativeProjectInMemory(largeProject);
    const largeFastly=compileFastly();
    const request={method:'GET',url:'https://app.invalid/',path:'/',headers:[]};
    const largeResult=await tools.executeCanonicalNativeModule(large.native,tools.driver.executionOptions(largeProject.providerConfig,{request,strict:false}));
    assert.equal(largeResult.status,'completed');
    assert.equal((await new Response(largeResult.response.bodyStream).arrayBuffer()).byteLength,262144);
    assert.equal(tools.executeFastlyNativePlatformCapabilities(largeFastly,{request}).response.bodyBytes.length,262144);count+=2;
    const portable=await import(pathToFileURL(path.join(assetsRoot,'dist/portable.js')));
    assert.throws(()=>portable.lookup({},'embedded','/image.bin',{embeddedManifest:serialized}),/Native-only/);
    if(options.packedRoot) for(const file of Object.keys(require.cache)) if(file.startsWith(path.join(root,'packages')+path.sep)||file.startsWith(path.join(root,'wasm/packages')+path.sep)) assert.equal(file,path.join(root,'packages/provider-fastly/src/testing/native-platform-capabilities-host.js'));
    console.log(`ok - AST-02D ${count} real Node/Fastly Native binary response executions, manifest identity, bounds, HTTP subset and no store dispatch`);
  }finally{const cleanup=()=>{if(!options.packedRoot)fs.rmSync(cwd,{recursive:true,force:true});};cleanup();process.once('exit',cleanup);}
}
module.exports={main};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
