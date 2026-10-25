'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const b = require('./build.cjs'), {execute} = require('./host.cjs');
const output = path.resolve(process.argv[2] || '/tmp/hex-ra06'); fs.mkdirSync(output, {recursive: true});
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const inputFiles = ['build.cjs','service.as.ts','host.cjs','check.cjs'].map(f => path.join(__dirname,f)).concat(
  ['../ra03/native/build.cjs','../ra03/native/service.as.ts','../../ownership/prototype.cjs','../../ownership/fixture.cjs'].map(f => path.join(__dirname,f)),
  ['packages/provider-fastly/src/build/lifecycle-hooks.js','packages/provider-fastly/src/build/response-authority.js',
    'packages/provider-fastly/src/build/host-extensions.js','packages/provider-fastly/src/build/native-platform-capabilities.js',
    'packages/provider-fastly/src/build/effect-invocations.js','packages/provider-fastly/src/build/request-budget.js',
    'packages/provider-fastly/src/build/request-budget.as.ts','wasm/packages/contracts/src/handler/execution-lifecycle.js',
    'wasm/packages/contracts/src/host/http-lifecycle.js','wasm/packages/contracts/src/provider/host-extension.js','pnpm-lock.yaml'].map(f => path.join(b.root,f)));
const inputs = () => inputFiles.map(f => ({file:path.relative(b.root,f),sha256:hash(fs.readFileSync(f))}));
const git = (...args) => execFileSync('git',args,{cwd:b.root,encoding:'utf8'}).trim();
const receipt = {version:'hex.ra06.cache.v1',status:'running',base:git('rev-parse','HEAD'),workingTree:git('status','--porcelain'),
  node:process.version,compiler:{version:JSON.parse(fs.readFileSync(path.join(path.dirname(b.asc.script),'../package.json'))).version,
    sha256:hash(fs.readFileSync(b.asc.script))},inputs:inputs(),artifacts:[],cases:[],mutations:[],
  scope:{productionAdmission:false,realHost:false,javascriptParity:false,jointFetchAccounting:false,
    owner:'@hex-spike/cache / investigation-owned-resource.v0',membership:'one direct or fixed homogeneous keyed cohort per fresh instance',
    profile:{work:[3,320,4],cleanup:[2,64,2],exit:[2,64,2],readBackingBytes:257,writeBackingBytes:192},
    diagnosticImport:'ra06_proof.event is an explicit private baseline addition, not package authority'}};
const save = () => fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n'); save();
const calls = (r,n) => r.trace.filter(x => x.call === n);
function compile(name,op,width=1,options={}) {
  const a=b.build(output,name,op,width,options);
  receipt.artifacts.push({name,op,width,options,bytes:a.wasm.length,sha256:hash(a.wasm),sourceSha256:hash(a.source),
    authoredSha256:hash(a.authored),imports:a.imports,policySha256:a.policy?.sha256,registrationOrderIdentical:!options.mutation&&op!=='none'});
  save(); console.log('built - '+name);return a;
}
function record(name,a,options,verify) {
  let result;
  try {result=execute(a.wasm,options);verify(result);}
  catch(error){receipt.failedCase={name,options,result,error:error.stack};throw error;}
  receipt.cases.push({name,options,status:'passed',result});save();console.log('ok - '+name);return result;
}
function normal(r,op,width=1) {
  assert.equal(r.thrown,null);assert.equal(r.error,0);assert.equal(r.status,200);assert.equal(r.closed,1);assert.equal(r.authority,3);
  assert.deepEqual(r.remaining,[]);assert.equal(r.accounting.handles,0);assert.equal(r.accounting.bytes,width*(op==='getText'?257:192));
  assert.equal(r.accounting.records,width);assert.equal(r.accounting.captures,width);
  assert(r.slots.every(s=>s.accepted===1&&s.business===1));assert.equal(calls(r,'send').length,1);
  const values=width===1?[r.json]:Object.values(r.json);assert.equal(values.length,width);
  values.forEach((v,i)=>assert.deepEqual(v,op==='getText'?{status:'hit',value:'value:k'+i}:{status:'stored'}));
  assert.equal(r.accounting.commitAttempts,op==='getText'?0:width);
  assert.equal(r.committed.length,op==='getText'?0:width);
  if(op==='putText')assert(r.committed.every(v=>v.value==='payload'));
}
function failure(r,stage,status=500) {assert.equal(r.thrown,null);assert.equal(r.status,status);assert.equal(r.stage,stage);assert.equal(r.closed,1);assert(!r.slots.some(s=>s.business===1));}
function shortage(r,width) {failure(r,400);assert.equal(calls(r,'acquire').length,0);assert.equal(r.accounting.handles,0);assert.equal(r.accounting.bytes,0);assert.equal(r.accounting.captures,width);}
function cleanupAfterClosure(r,call) {const rows=calls(r,call);assert(rows.length>0);assert(rows.every(x=>x.closed===1&&x.ticket===0));}
function authenticated(r,op) {normal(r,op);const a=calls(r,'attack')[0];assert(a);assert.equal(a.result,0);assert.equal(a.before,a.after);}
function abandoned(r) {failure(r,417);assert.equal(r.committed.length,0);assert.equal(calls(r,'commit').length,0);assert.equal(calls(r,'abandon').length,1);assert.equal(r.accounting.handles,0);cleanupAfterClosure(r,'abandon');}
function unknownCommit(r) {failure(r,419);assert.equal(r.accounting.handles,1);assert.equal(calls(r,'commit').length,1);assert.equal(calls(r,'abandon').length,0);}
function unready(r) {failure(r,261);assert.equal(r.accounting.handles,1);assert.equal(calls(r,'cache.close').length,0);assert.equal(calls(r,'is_ready').length,1);}
function acquisitionStops(r,op) {failure(r,op==='getText'?402:415);assert.equal(calls(r,op==='getText'?'lookup':'insert').length,1);assert.equal(r.accounting.handles,1);assert.equal(r.accounting.bytes,op==='getText'?257:192);assert.equal(r.accounting.captures,2);}
try {
  const base=compile('baseline','none',1,{adapter:false,imported:false});
  const absent=compile('absent','none',1,{imported:false}), unused=compile('unused','none');
  assert.deepEqual(base.wasm,absent.wasm);assert.equal(base.source,absent.source);
  assert.equal(unused.wasm.length,base.wasm.length);
  receipt.identity={absentSourceIdentical:true,absentWasmIdentical:true,unusedDeltaBytes:unused.wasm.length-base.wasm.length,
    unusedWholeWasmIdentical:hash(unused.wasm)===hash(base.wasm),isolatedRuntimeCostClaim:false};save();
  record('unused package has no runtime cache authority',unused,{},r=>{assert.equal(r.thrown,null);assert.equal(r.body,'ok');assert.equal(calls(r,'acquire').length,0);});
  const read=compile('read-1','getText'),write=compile('write-1','putText');
  assert.throws(()=>b.build(output,'production-rejection','getText',1,{adapter:false}),
    e=>e.code==='PULSE_HOST_EXTENSION_PLACEMENT','production service admission remains closed');
  receipt.productionAdmissionRejected=true;save();
  record('read hit resumes compiled handler and disposes zero-valued cache handle',read,{},r=>{normal(r,'getText');assert.equal(calls(r,'acquire')[0].h,0);assert.equal(calls(r,'select')[0].pending,1);assert(calls(r,'reader.close')[0].closed===0);});
  record('write commits zero-valued writer once after bounded partial progress',write,{chunk:2},r=>normal(r,'putText'));
  record('maximum read payload fits the declared backing allowance',read,{value:'x'.repeat(64)},r=>{
    assert.equal(r.thrown,null);assert.equal(r.error,0);assert.equal(r.json.value.length,64);assert.equal(r.accounting.bytes,257);
    assert.equal(r.accounting.handles,0);assert.equal(calls(r,'read').length,9);
  });
  for(const [op,a] of [['getText',read],['putText',write]]) {
    record('whole-cohort shortage before any '+op+' acquisition',a,{short:true},r=>shortage(r,1));
    record('repeat closure and responders do not repeat '+op+' work',a,{repeatClose:true,postResponders:true},r=>normal(r,op));
    record('shared deadline consumption for '+op,a,{delayAt:'select',delayMs:37},r=>{normal(r,op);assert.equal(calls(r,'select')[0].timeout,1000);assert(calls(r,'select').slice(1).every(x=>x.timeout===963));});
    for(const attack of ['wrong-ticket','wrong-result','direct-result','undefined-success'])
      record(op+' rejects '+attack,a,{attack},r=>authenticated(r,op));
  }
  for(const mode of ['miss','stale'])record(mode+' is a policy miss without body acquisition',read,{[mode]:true},r=>{
    assert.equal(r.thrown,null);assert.equal(r.error,0);assert.deepEqual(r.json,{status:'miss'});assert.equal(calls(r,'body').length,0);
    assert.equal(r.accounting.handles,0);assert.equal(r.accounting.bytes,257);assert.deepEqual(r.remaining,[]);
  });
  for(const [op,a,call,stage] of [['getText',read,'lookup',402],['getText',read,'body',404],['putText',write,'insert',415]])
    for(const allocateOnFailure of [false,true])record(call+' uncertain acquisition/'+allocateOnFailure,a,{failAt:call,allocateOnFailure,repeatClose:true},r=>{
      failure(r,stage);assert.equal(r.accounting.handles,1);assert.equal(r.remaining.length,allocateOnFailure?1:0);assert.equal(r.accounting.records,2);
      assert.equal(calls(r,op==='getText'?'commit':'abandon').length,0);
    });
  for(const [name,a,options,stage] of [
    ['cache state failure',read,{failAt:'state'},403],['read failure',read,{failAt:'read'},405],
    ['read byte bound',read,{value:'x'.repeat(65),chunk:64},412],['malformed read count',read,{badLength:true},412],
    ['read step bound',read,{value:'x'.repeat(20),chunk:1},411],['ASCII profile bound',read,{value:'é'},413],
    ['write failure',write,{failAt:'write'},417],['partial write failure',write,{failAt:'write',failNth:2,chunk:2},417],
    ['zero write progress',write,{zeroWrite:true},418],['malformed write count',write,{badLength:true},418],
    ['write step bound',write,{chunk:1},416]
  ])record(name,a,options,r=>{failure(r,stage);assert.equal(r.accounting.handles,0);assert.deepEqual(r.remaining,[]);assert.equal(r.committed.length,0);});
  record('incomplete writer cleanup abandons after ticket invalidation',write,{failAt:'write',repeatClose:true},abandoned);
  for(const consumeOnFailure of [false,true]) {
    record('ambiguous commit is not retried or abandoned/'+consumeOnFailure,write,{failAt:'commit',consumeOnFailure,repeatClose:true},r=>{
      unknownCommit(r);assert.equal(r.remaining.length,consumeOnFailure?0:1);assert.equal(r.committed.length,consumeOnFailure?1:0);
    });
    for(const [a,call,primary] of [[read,'reader.close',405],[read,'cache.close',405],[write,'abandon',417]])
      record('cleanup failure retains claim and primary error/'+call+'/'+consumeOnFailure,a,
        {failAt:[a===read?'read':'write',call],consumeOnFailure,repeatClose:true},r=>{
          failure(r,primary);assert.equal(r.accounting.handles,1);assert.equal(r.accounting.cleanupErrors,1);
          assert.equal(calls(r,call).length,1);assert.equal(r.remaining.length,consumeOnFailure?0:1);cleanupAfterClosure(r,call);
          if(call==='reader.close')assert.equal(calls(r,'cache.close').length,1);
        });
  }
  for(const [call,stage] of [['reader.close',409],['cache.close',410]])record('success-path disposal failure is not a hit/'+call,read,{failAt:call,repeatClose:true},r=>{
    failure(r,stage);assert.equal(r.accounting.handles,1);assert.equal(calls(r,call).length,1);assert.equal(r.remaining.length,1);
  });
  record('unready lookup is retained without a blocking close',read,{failAt:'select',pendingOnCleanup:true,repeatClose:true},unready);
  record('ready failed lookup can close within remaining budget',read,{failAt:'select',readyOnCleanup:true},r=>{
    failure(r,261);assert.equal(r.accounting.handles,0);cleanupAfterClosure(r,'cache.close');
  });
  record('readiness failure leaves lookup charged',read,{failAt:['select','is_ready'],readyOnCleanup:true},r=>{failure(r,261);assert.equal(r.accounting.handles,1);assert.equal(calls(r,'cache.close').length,0);});
  record('readiness observation cannot renew cleanup time',read,{failAt:'select',readyOnCleanup:true,expireAt:'is_ready'},r=>{assert.equal(r.thrown,null);assert.equal(r.accounting.handles,1);assert.equal(calls(r,'cache.close').length,0);});
  for(const [a,options,handles] of [[read,{timeoutSelect:true},1],[read,{expireAt:'read'},2],[write,{timeoutSelect:true},1],[write,{expireAt:'write'},1]])
    record('expiry grants no cleanup allowance/'+JSON.stringify(options)+'/'+(a===read?'read':'write'),a,options,r=>{
      failure(r,260,504);assert.equal(r.accounting.handles,handles);assert.equal(r.accounting.disposals,0);assert.equal(r.committed.length,0);
    });
  record('timeout after commit cannot undo the accepted write',write,{expireAt:'commit'},r=>{failure(r,260,504);assert.equal(r.accounting.handles,0);assert.equal(r.committed.length,1);assert.equal(calls(r,'abandon').length,0);});
  for(const [a,call,handles] of [[read,'lookup',1],[read,'body',0],[write,'insert',0],[write,'write',0]])
    record('cancellation/'+call,a,{cancelAt:call,pendingOnCleanup:true},r=>{failure(r,406);assert.equal(r.accounting.handles,handles);assert.equal(r.committed.length,0);});
  record('late readiness cannot reopen a closed invocation',read,{timeoutSelect:true,lateReady:true,repeatClose:true,postResponders:true},r=>{
    assert.equal(r.thrown,null);assert.equal(r.accounting.handles,1);assert.deepEqual(r.post,[{settle:0,direct:0}]);assert.equal(calls(r,'cache.close').length,0);assert.equal(calls(r,'send').length,1);
  });
  record('known failure rejects forged success before ticket consumption',read,{failAt:'lookup',attack:'success-on-failure'},r=>{
    failure(r,402);const a=calls(r,'attack')[0];assert.equal(a.result,0);assert.equal(a.before,a.after);
  });
  record('diagnostic failure-placeholder delivery is not business success',read,{failAt:'lookup',attack:'failure-placeholder'},r=>{
    failure(r,402);assert.equal(calls(r,'attack')[0].result,1);assert.equal(r.slots[0].accepted,1);assert.equal(r.slots[0].business,0);
  });
  for(const [a,trapAt] of [[read,'lookup'],[read,'body'],[read,'read'],[read,'reader.close'],[read,'cache.close'],[read,'hook.5'],[write,'write'],[write,'commit'],[write,'abandon']])
    record('trap has no implied finalizer/'+trapAt,a,{trapAt,...(trapAt==='abandon'?{failAt:'write'}:{})},r=>{
      assert(r.thrown?.includes('injected'));assert.equal(r.closed,trapAt==='abandon'?1:0);
      assert(r.accounting.bytes>0);if(trapAt!=='hook.5')assert(r.accounting.handles>0);
      if(trapAt==='hook.5')assert.equal(r.accounting.delivery,0);
    });
  record('out-of-profile handle records containment without complete-accounting claim',read,{startHandle:1000000},r=>{failure(r,408);assert.equal(r.accounting.containment,1);assert.equal(calls(r,'cache.close').length,0);});
  for(const op of ['getText','putText'])for(const width of [2,8,16,32]) {
    const a=compile((op==='getText'?'read-':'write-')+width,op,width);
    record(op+' width '+width+' makes progress under whole-cohort reservation',a,{width},r=>{
      normal(r,op,width);const firstWait=r.trace.findIndex(x=>x.call==='select');
      assert.equal(r.trace.slice(0,firstWait).filter(x=>x.call===(op==='getText'?'lookup':'insert')).length,width);
      assert(Math.max(...r.trace.map(x=>x.handles))<=2*width);
    });
    record(op+' width '+width+' shortage rejects before dispatch',a,{width,short:true},r=>shortage(r,width));
    if(width===2)record(op+' acquisition failure suppresses undispatched siblings',a,
      {width,failAt:op==='getText'?'lookup':'insert',failNth:1,allocateOnFailure:true},r=>acquisitionStops(r,op));
    if(width===2&&op==='putText') {
      record('first failing writer abandons both admitted siblings',a,{width,failAt:'write'},r=>{failure(r,417);assert.equal(calls(r,'abandon').length,2);assert.equal(r.committed.length,0);assert.equal(r.accounting.handles,0);});
      record('later failure preserves earlier commit without atomicity claim',a,{width,failAt:'write',failNth:2},r=>{
        assert.equal(r.thrown,null);assert.equal(r.stage,417);assert.equal(r.committed.length,1);assert.equal(calls(r,'abandon').length,1);assert.equal(r.accounting.handles,0);assert.equal(r.slots[0].business,1);assert.equal(r.slots[1].business,0);
      });
    }
  }
  for(const [mutation,op,options,verify] of [
    ['no-settle-guard','getText',{attack:'wrong-result'},r=>authenticated(r,'getText')],
    ['no-result-guard','getText',{attack:'direct-result'},r=>authenticated(r,'getText')],
    ['no-cleanup','putText',{failAt:'write'},abandoned],['commit-on-cleanup','putText',{failAt:'write'},abandoned],
    ['refund-unknown','putText',{failAt:'commit',consumeOnFailure:true},unknownCommit],
    ['close-unready','getText',{failAt:'select',pendingOnCleanup:true},unready],
    ['dispatch-after-failure','getText',{width:2,failAt:'lookup',failNth:1,allocateOnFailure:true},r=>acquisitionStops(r,'getText')]
  ]) {
    const a=compile('mutation-'+mutation,op,options.width??1,{mutation});let detected,result;
    try {result=execute(a.wasm,options);verify(result);} catch(error) {if(!(error instanceof assert.AssertionError))throw error;detected=error.message;}
    assert(detected,'mutation must fail oracle: '+mutation);receipt.mutations.push({mutation,options,detected:true,assertion:detected,result});save();console.log('ok - mutation '+mutation);
  }
  receipt.status='passed';
} catch(error) {receipt.status='failed';receipt.error=error.stack;console.error(error.stack);process.exitCode=1;}
if(JSON.stringify(inputs())!==JSON.stringify(receipt.inputs)){receipt.status='failed';receipt.error='inputs changed during run';process.exitCode=1;}
save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,mutations:receipt.mutations.length,output}));
