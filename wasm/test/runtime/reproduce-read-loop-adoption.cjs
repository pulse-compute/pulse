#!/usr/bin/env node
'use strict';
// An adoption gate, deliberately separate from the passing loop contract suite.
// Exit 1 means the existing pure request cannot coexist with a read-loop route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {acceptanceToolchain} = require('../s3/acceptance-toolchain.cjs');
const {verifyClosure} = require('../release/assert-request-deadline-packages.cjs');
async function main(root, release) {
  assert.ok(root && release, 'Usage: reproduce-read-loop-adoption.cjs <isolated-install> <release-pack>');
  assert.equal(process.env.NODE_PATH, undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(release, 'pulse-release-manifest.json')));
  verifyClosure(root, release, manifest);
  const tc = acceptanceToolchain(root), rows = [];
  const cwd = fs.mkdtempSync(path.join(root, 'read-loop-adoption-'));
  try {
    const fixture = path.resolve(__dirname, '../fixtures/projects/bounded-read-loops');
    for (const dir of ['src', '.pulse']) fs.cpSync(path.join(fixture, dir), path.join(cwd, dir), {recursive:true});
    const config=path.join(cwd,'.pulse/config.ts');
    fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace("secretStore: 'app_secrets',","secretStore: 'app_secrets', kv: {pages:'pages'},"));
    const common = `import {Pulse} from '@pulse-compute/pulse';
const app=new Pulse({auto:true});
app.get('/scan',async(ctx)=>{const state={count:0};
for(let page=0;page<64;page++){for(let offset=0;offset<1024;offset++){
const pos=page*1024+offset;const ch=pos%16;
if(ch>=0&&ch<16)state.count+=1;
if(ch===0||ch===1||ch===2||ch===3)state.count+=0;
}}return ctx.text(''+state.count)});
`;
    const loop = `app.get('/pages',async(ctx)=>{for(let i=0;i<64;i++){const row=await ctx.kv('pages').getVersioned('p');if(row.status==='not-found')break}return ctx.text('done')});`;
    for (const withReadLoop of [false, true]) {
      fs.writeFileSync(path.join(cwd, 'src/index.ts'), common + (withReadLoop ? loop : '') + '\nexport default app');
      const request = {method:'GET',path:'/scan',url:'https://app.example.invalid/scan',headers:[],body:''};
      for (const target of ['node', 'fastly']) {
        const project = tc.resolveProject({cwd,profile:target});
        const artifact = target === 'node' ? tc.compileNativeProjectInMemory(project) : tc.compileFastly(project);
        try {
          const result = target === 'node'
            ? await tc.executeCanonicalNativeModule(artifact.native, tc.driver.executionOptions(project.providerConfig,{request,strict:false}))
            : tc.executeFastlyNativePlatformCapabilities(artifact,{request});
          assert.equal(result.response.status,200);assert.equal(result.response.body,'65536');
          rows.push({target,withReadLoop,status:'passed',memory:result.memory});
        } catch (error) {
          if (!withReadLoop) throw error;
          rows.push({target,withReadLoop,status:'failed',code:error.code,message:error.message,detail:error.detail});
        }
      }
    }
    verifyClosure(root, release, manifest);
    return {schemaVersion:'pulse.read-loop-adoption-reproduction.v1',status:rows.every(r=>r.status==='passed')?'passed':'blocked',rows,installedBytesUnchanged:true,providerReality:false};
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
}
if(require.main===module)main(process.argv[2],process.argv[3]).then(report=>{console.log(JSON.stringify(report));process.exitCode=report.status==='passed'?0:1}).catch(error=>{console.error(error.stack);console.error(JSON.stringify(error.diagnostics||error.detail||{}));process.exitCode=1});
