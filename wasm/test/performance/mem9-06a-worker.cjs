'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),child=require('node:child_process');
const {createHash,createPublicKey,verify}=require('node:crypto');
const {fixture,prototypeCompiler}=require('./mem9-06a-fixtures.cjs');
const [runtime,count,arena,directory]=process.argv.slice(2),cell={runtime,iterations:Number(count),arena};
assert(!fs.existsSync(directory));fs.mkdirSync(directory,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const report={...cell,status:'running',rows:[],recipes:[]};
const write=(name,v)=>fs.writeFileSync(path.join(directory,name),typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v,null,2)+'\n');
const persist=()=>write('result.json',report);persist();
const spawn=child.spawnSync;let strategy,mode;
child.spawnSync=function(exe,args,options){
  if(!args?.[0]?.endsWith('/assemblyscript/bin/asc.js'))return spawn(exe,args,options);
  const name=`${strategy}-${mode}`;
  report.recipes.push({strategy,mode,executable:exe,args,cwd:options.cwd});
  write(name+'.generated.ts',fs.readFileSync(path.resolve(options.cwd,args[1])));
  const result=spawn(exe,mode==='observed'?[path.join(__dirname,'mem9-06a-asc.mjs'),...args]:args,{...options,timeout:180000});
  write(name+'.build.log',(result.stdout||'')+(result.stderr||''));return result;
};
try{
  const cwd=path.join(directory,'fixture'),f=fixture(cell,cwd);write('fixture.json',f);
  const tc=require('../s3/acceptance-toolchain.cjs').acceptanceToolchain();
  const plan=require('../../packages/compiler/src/canonical-native-plan').buildCanonicalNativePlan(tc.compileProject(tc.resolveProject({cwd,profile:'node'})));
  const lowering=require('../../packages/compiler/src/spine/canonical-native-plan').packageLoweringForCanonicalNativePlan(plan);
  assert.equal(plan.helpers.length,4);assert.equal(plan.stages.length,1);write('plan.json',plan);
  const platform=require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
  const prototype=prototypeCompiler();assert.equal(require('../../../packages/provider-fastly/src/build/native-platform-capabilities'),platform);
  const fp=tc.resolveProject({cwd,profile:'fastly'});
  const options={cwd,canonicalBuild:true,requirePlatformCapability:false,emitWat:false,reportCapture:false,elideJsonCacheArena:arena==='elided',bindings:fp.providerConfig.bindings,guestUnits:lowering?.guestUnits||[],realizationArtifacts:lowering?.realizationArtifacts||[],targetDescriptor:require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native,synchronizedPackages:require('../../packages/cli/release-manifest.json').packages.map(({name,version})=>({name,version}))};
  assert.equal(options.guestUnits.length,f.linked?1:0);
  const canonical=require('../../packages/runtime-core-as/src/compiler/canonical-native');
  const boxed=canonical.generateCanonicalNativeAssemblyScript(plan),numeric=canonical.generateCanonicalNativeAssemblyScript(plan,{numericRegions:'host-numeric-regions-v1'});
  const shape=g=>g.blocks.map(({lines,...block})=>block);
  assert.deepEqual(shape(boxed),shape(numeric));assert.equal(boxed.manifest.guardStateCount,numeric.manifest.guardStateCount);
  const paths=numeric.manifest.numericRegions.regions.flatMap(r=>r.statementPaths);
  assert(plan.stages[0].body.some(s=>paths.includes(s.statementPath)));assert(paths.some(p=>p.startsWith('handlers.')));assert(paths.some(p=>p.startsWith('helpers.')));
  for(const h of plan.helpers)assert.equal(paths.some(p=>p.startsWith(`helpers.${h.id}.`)),['sum','edges'].includes(h.source.name),h.source.name);
  // Exercise the shared proof's explicit budget exclusion without changing the plan.
  const budget=require('../../packages/runtime-core-as/src/compiler/canonical-native-numeric').prepareNumericRegions({plan,policy:'host-numeric-regions-v1',schemaActive:f.schema,budgeted:true,localName:id=>String(id)});
  assert.equal(budget.manifest().regions.length,0);
  report.proof={owners:['entry','helper','stage'],declined:['unknown live-in','257-iteration flat loop','budgeted plan'],controlBlocksEqual:true};
  const outcomes=[];
  for(strategy of ['production','prototype'])for(mode of ['ordinary','observed']){
    const name=`${strategy}-${mode}`;let artifact;
    artifact=(strategy==='production'?platform.compileFastlyNativePlatformCapabilitiesPlan:prototype)(plan,options);
    write(name+'.wasm',artifact.wasm);write(name+'.manifest.json',artifact.manifest);
    if(f.linked){assert.equal(artifact.guestLink.audit.status,'passed');assert(artifact.guestLink.audit.checks.every(c=>c.status==='passed'));write(name+'.guest-link.json',artifact.guestLink);}
    const selected=artifact.manifest.numericRegions?.regions.length||0;assert.equal(selected>0,strategy==='prototype');
    const executions=[];
    // Fresh instances cover repeatability; stop exercises the shared-stage early exit.
    let blocked=false;
    for(const responseBody of ['ok','ok','stop']){
      let r;try{r=tc.executeFastlyNativePlatformCapabilities(artifact,{request:f.request,secrets:{TEST_KEY:JSON.stringify(f.key)},clockUnixSeconds:1800000000,fixtures:{'https://mem9.test/value':{status:200,body:responseBody}}});}catch(e){if(!f.schema||arena!=='default'||!(e instanceof WebAssembly.RuntimeError)||e.message!=='unreachable')throw e;report.rows.push({strategy,mode,status:'blocked',blocker:'existing-schema-runtime-trap',wasmSha256:hash(artifact.wasm),error:e.stack});blocked=true;persist();break;}
      assert.equal(r.response.status,200);
      if(responseBody==='stop')assert.equal(r.response.body,`stopped:${70000+cell.iterations}`);
      else{
        const value=JSON.parse(r.response.body);
        if(f.linked)for(const key of ['before','after']){
          const token=value[key],parts=token.split('.');assert.equal(parts.length,3);
          assert.equal(JSON.parse(Buffer.from(parts[0],'base64url')).alg,f.algorithm);
          assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).sub,key);
          assert(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:createPublicKey({key:f.key,format:'jwk'}),...(f.algorithm==='ES256'?{dsaEncoding:'ieee-p1363'}:{})},Buffer.from(parts[2],'base64url')));
          delete value[key];
        }
        assert.deepEqual(value,f.expected);
      }
      const ex=r.instance.exports,row={capacityBytes:ex.memory.buffer.byteLength,handles:null,numbers:null,allocatorSpanBytes:null,managedAfterFullGc:null};
      if(f.linked)assert.equal(row.capacityBytes,2097152);
      if(mode==='observed'){
        row.handles=ex.mem9_count();row.numbers=ex.mem9_numbers();row.allocatorSpanBytes=ex.mem9_allocated();row.managedAfterFullGc=ex.mem9_collect?.()??null;
        assert.equal(ex.mem9_count(),row.handles);assert.equal(ex.memory.buffer.byteLength,row.capacityBytes);assert.equal(ex.mem9_ownership(),511);
      }
      row.responseSha256=hash(r.response.body);executions.push(row);
      outcomes.push({scenario:responseBody,response:r.response,trace:r.trace,outbound:r.outboundRequests});
    }
    if(blocked)continue;
    assert.deepEqual(executions[0],executions[1]);
    report.rows.push({strategy,mode,status:'passed',wasmSha256:hash(artifact.wasm),selected,executions});persist();
  }
  for(const scenario of ['ok','stop']){const same=outcomes.filter(o=>o.scenario===scenario);for(const o of same)assert.deepEqual(o,same[0]);}
  assert.equal(report.rows.length,4);
  assert.equal(new Set(report.rows.map(r=>r.status)).size,1,'Prototype must not introduce or hide a feasibility failure');
  // Re-emission after prototype use must still follow the production gate.
  assert.equal(canonical.generateCanonicalNativeAssemblyScript(plan).source,boxed.source);
  report.disposition=report.rows[0].status==='blocked'?'blocked-existing-schema-runtime':'eligible-for-follow-up';
  report.status='passed';persist();console.log(`ok - ${runtime}/${count}/${arena}: ${report.disposition}`);
}catch(e){report.status='failed';report.error=e.stack;report.detail=e.detail||e.diagnostics;persist();console.error(e.stack);process.exitCode=1;}
finally{child.spawnSync=spawn;}
