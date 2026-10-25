'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {compile} = require('../../../docs/internal/host-extensions/measure.cjs');
const {execute} = require('../../../docs/internal/host-extensions/injected-host.cjs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const extension = require('../../../packages/provider-fastly/src/build/host-extensions');
const {compileCanonicalProject, packageRealizationArtifactsForCompiled} = require('../../packages/compiler/src/canonical-project-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const root=path.resolve(__dirname,'../../..');
function run() {
  const receipt={kind:'injected-host; not Fastly acceptance', cases:[], artifacts:[]};
  const retain=(name,run)=>{assert.equal(new Set(run.resources.closes.map(x=>x.kind+":"+x.handle)).size,run.resources.closes.length,"cleanup must not repeat"); const e=run.instance.exports;receipt.cases.push({name,trace:run.trace,resources:run.resources,thrown:run.thrown||null,state:e.pulse_extension_state(),status:e.pulse_extension_status(),error:e.pulse_fastly_last_error(),stage:e.pulse_fastly_error_stage(),token:e.hex03_token?.(),ticket:e.hex03_ticket?.(),closed:e.hex03_closed?.()});};
  for(const fixture of ['fanout','websocket']) {
    const built=compile(fixture), {plan,options,native}=built;
    const expected=fixture==='fanout'?'redirect_to_grip_proxy_v2':'redirect_to_websocket_proxy_v2';
    assert.deepEqual(native.inspection.imports.filter(i=>i.name.startsWith('redirect_to_')).map(i=>i.name),[expected]);
    const success=execute(native);assert.equal(success.state,3);assert.equal(success.error,0);assert.equal(success.trace.length,1);assert.deepEqual(success.resources.closes,[{kind:'request',handle:41,status:0},{kind:'body',handle:42,status:0}]);retain(fixture+' success',success);
    for(const status of [1,2,3,4,5,6,7,8,9,10,11,12,13,14]) {
      const result=execute(native,{status});assert.equal(result.state,1);assert.equal(result.trace.length,1);assert.equal(result.resources.closes.length,0);assert.notEqual(result.error,0);retain(fixture+' unknown ownership status '+status,result);
    }
    const trapped=execute(native,{trap:true});assert.match(trapped.thrown,/ambiguous/);assert.equal(trapped.resources.closes.length,0);trapped.instance.exports._start();assert.equal(trapped.trace.length,1);retain(fixture+' trap then repeated entry',trapped);
    // Extra exports are test-only access to provider state, never contributed
    // package source, public protocol or production artifact exports.
    const original=extension.source;
    let observed;
    try {
      extension.source=selected=>original(selected)+`\nexport function hex03_replace_result(): void { __pulse_result = 2147483647 }
export function hex03_settled(): i32 { return __pulse_extension_settled ? 1 : 0 }
export function hex03_token(): i32 { return __pulse_extension_token }
export function hex03_ticket(): i32 { return __pulse_extension_invocation }
export function hex03_closed(): i32 { return __pulse_invocation_closed ? 1 : 0 }
export function hex03_cancel(): void { __pulse_invocation_close() }
export function hex03_settle(ticket:i32, token:i32): i32 { return __pulse_invocation_settle(0,ticket,token) }
export function hex03_error(): void { __pulse_fastly_jwt_send_error() }
export function hex03_timeout(): void { __request_send_timeout() }
export function hex03_send(token:i32): i32 { return __pulse_fastly_send_result(token) }
`;
      observed=platform.compileFastlyNativePlatformCapabilitiesPlan(plan,{...options,maxDurationMs:1000});
    } finally { extension.source=original; }
    const completed=execute(observed);const e=completed.instance.exports;
    assert.equal(completed.state,3);assert.equal(e.hex03_token(),0);assert.equal(e.hex03_ticket(),0);assert.equal(e.hex03_closed(),1);
    assert.equal(e.hex03_settle(1,1),0);assert.equal(e.pulse_set_effect_result(0,1),0);e.hex03_error();e.hex03_timeout();e.hex03_send(1);e._start();assert.equal(completed.trace.length,1);retain(fixture+' stale/reused completion and all late send paths',completed);
    for(const handle of [0,-1,1,2147483647,'actual']) {
      const result=execute(observed,{afterHandoff:instance=>{const e=instance.exports;assert.equal(e.pulse_set_effect_result(0,handle==='actual'?e.hex03_token():handle),0);}});
      assert.equal(result.state,2);assert.notEqual(result.error,0);assert.equal(result.trace.length,1);assert.equal(result.instance.exports.hex03_token(),0);retain(fixture+' forged/premature raw setter '+handle,result);
    }
    const cancelled=execute(observed,{onUri:instance=>instance.exports.hex03_cancel()});assert.equal(cancelled.trace.some(x=>x.call==='handoff'),false);retain(fixture+' closed invocation before dispatch',cancelled);
    const cancelDuring=execute(observed,{afterHandoff:instance=>instance.exports.hex03_cancel()});assert.equal(cancelDuring.state,2);assert.equal(cancelDuring.trace.length,1);retain(fixture+' closure during dispatch',cancelDuring);
    let expired=false;
    const beforeDeadline=execute(observed,{onUri:()=>{expired=true;},clock:()=>expired?1000000000n:0n});assert.equal(beforeDeadline.trace.some(x=>x.call==='handoff'),false);assert.equal(beforeDeadline.trace.filter(x=>x.call==='send').length,1);assert(beforeDeadline.trace.some(x=>x.call==='status'&&x.status===504));retain(fixture+' deadline before dispatch',beforeDeadline);
    const lastFence=execute(observed,{clock:instance=>instance.exports.pulse_extension_state()===0 && instance.exports.hex03_token()>0 ? 1000000000n : 0n});
    assert.equal(lastFence.trace.some(x=>x.call==='handoff'),false);assert.equal(lastFence.resources.closes.length,2);retain(fixture+' deadline at final pre-ABI fence',lastFence);
    expired=false;
    const afterDeadline=execute(observed,{afterHandoff:()=>{expired=true;},clock:()=>expired?1000000000n:0n});assert.equal(afterDeadline.state,2);assert.equal(afterDeadline.trace.length,1);assert.equal(afterDeadline.instance.exports.hex03_token(),0);retain(fixture+' deadline after transfer',afterDeadline);
    let attempted=false;
    const wrongTicket=execute(observed,{clock:instance=>{const e=instance.exports;if(!attempted&&e.pulse_extension_state()===2){attempted=true;assert.equal(e.hex03_settle(e.hex03_ticket()+1,e.hex03_token()),0);}return 0n;}});
    assert(attempted);assert.equal(wrongTicket.trace.length,1);assert.notEqual(wrongTicket.error,0);retain(fixture+' foreign invocation ticket',wrongTicket);
    const cleanupFailed=execute(observed,{closeStatus:3});assert.equal(cleanupFailed.state,2);assert.equal(cleanupFailed.stage,285);assert.equal(cleanupFailed.trace.length,1);assert.equal(cleanupFailed.resources.closes.length,2);cleanupFailed.instance.exports._start();assert.equal(cleanupFailed.resources.closes.length,2);retain(fixture+' cleanup failure without retry or response',cleanupFailed);
    let escaped=false;
    const forgedFinal=execute(observed,{clock:instance=>{const e=instance.exports;if(!escaped && e.hex03_settled() && e.pulse_pending_count()===0){escaped=true;e.hex03_replace_result();}return 0n;}});
    assert(escaped);assert.equal(forgedFinal.stage,283);assert.equal(forgedFinal.trace.length,1);retain(fixture+' forged terminal result after settlement',forgedFinal);
    const ordinary=execute(observed,{path:'/ordinary'});assert.equal(ordinary.error,0);assert.equal(ordinary.trace.filter(x=>x.call==='send').length,1);retain(fixture+' ordinary response',ordinary);
    const ordinaryFailed=execute(observed,{path:'/ordinary',sendStatus:3});
    assert.equal(ordinaryFailed.state,1);assert.equal(ordinaryFailed.trace.filter(x=>x.call==='send').length,1);
    assert.equal(ordinaryFailed.resources.closes.length,2,'an uncertain ordinary output does not make borrowed ingress uncertain');
    ordinaryFailed.instance.exports.hex03_error();ordinaryFailed.instance.exports.hex03_timeout();
    assert.equal(ordinaryFailed.trace.filter(x=>x.call==='send').length,1);retain(fixture+' ordinary send failure retains output fence but closes ingress',ordinaryFailed);
    const ordinaryReentrant=execute(observed,{path:'/ordinary',onSend:instance=>{instance.exports.hex03_error();instance.exports.hex03_timeout();instance.exports.hex03_send(1);}});
    assert.equal(ordinaryReentrant.state,3);assert.equal(ordinaryReentrant.trace.filter(x=>x.call==='send').length,1);
    assert.equal(ordinaryReentrant.resources.closes.length,2);retain(fixture+' reentrant ordinary responders share the pre-ABI fence',ordinaryReentrant);
    receipt.artifacts.push({fixture,bytes:native.wasm.length,sha256:native.inspection.sha256,imports:native.inspection.imports,policySha256:native.manifest.hostExtensionPolicy.sha256,observedBytes:observed.wasm.length,observedSha256:observed.inspection.sha256});
    for(const [provider,target] of [['node','native'],['node','javascript'],['fastly','javascript']]) {
      const descriptor=require(path.join(root,`packages/provider-${provider}/src/${provider==='fastly'?'toolchain/index.js':'toolchain.js'}`)).createDriver().targets[target];
      assert.throws(()=>compileCanonicalProject(path.join(root,'docs/internal/host-extensions/fixtures',fixture+'.ts'),{rootDir:root,target,packageTargetDescriptor:descriptor}),{code:'PULSE_HOST_EXTENSION_TARGET'});
    }
  }
  // Authored containment, not only fabricated plan flags.
  const temporary=fs.mkdtempSync(path.join(__dirname,'.hex03-placement-'));
  try {
    const target=require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native;
    const bodies={call:'return ctx.call(child, 1);',escaped:'const result = grip.handoffWebSocket("fanout"); return result;',parallel:'return await ctx.parallel([() => grip.handoffWebSocket("fanout")]);',prior:'await ctx.time.now(); return grip.handoffWebSocket("fanout");'};
    for(const [name,body] of Object.entries(bodies)) {
      const file=path.join(temporary,name+'.ts');fs.writeFileSync(file,`import {grip} from '@pulse-compute/grip'; function child(ctx, input){ return grip.handoffWebSocket('fanout'); } export default async function handler(ctx){${body}}`);
      assert.throws(()=>{const c=compileCanonicalProject(file,{rootDir:root,target:'native',packageTargetDescriptor:target});platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(buildCanonicalNativePlan(c),{bindings:{backends:{fanout:'backend'}},realizationArtifacts:packageRealizationArtifactsForCompiled(c)});},undefined,name);
    }
    for(const errorHandler of [false,true]) {
      const file=path.join(temporary,'router.ts');fs.writeFileSync(file,`import {Pulse} from '@pulse-compute/pulse';import {grip} from '@pulse-compute/grip';const app=new Pulse({auto:true});app.get('/',async ctx=>grip.handoffWebSocket('fanout'));${errorHandler?"app.error('E',async ctx=>ctx.text('error'));":''}export default app;`);
      assert.throws(()=>{const c=compileCanonicalProject(file,{rootDir:root,target:'native',packageTargetDescriptor:target});platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(buildCanonicalNativePlan(c),{bindings:{backends:{fanout:'backend'}},realizationArtifacts:packageRealizationArtifactsForCompiled(c)});},undefined,'Router/error-handler composition');
    }
    const fanout=compile('fanout'),websocket=compile('websocket');
    const unused=platform.compileFastlyNativePlatformCapabilitiesPlan(fanout.plan,{...fanout.options,realizationArtifacts:[...websocket.options.realizationArtifacts,...fanout.options.realizationArtifacts]});
    assert.deepEqual(unused.wasm,fanout.native.wasm,'unselected second-method contribution has no Wasm baggage');
    assert.equal(unused.inspection.imports.some(i=>i.name==='redirect_to_websocket_proxy_v2'),false);
    receipt.unusedSecondMethod={sha256:fanout.native.inspection.sha256,bytes:fanout.native.wasm.length,identical:true};
    for(const change of [p=>p.callables=[{}],p=>p.routing={entries:[{kind:'error'}]},p=>p.effects[0].grouped=true]) {
      const plan=structuredClone(fanout.plan);change(plan);
      assert.throws(()=>platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(plan,fanout.options),{code:'PULSE_HOST_EXTENSION_PLACEMENT'});
    }

  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  console.log('ok - HEX-03 both operations, '+receipt.cases.length+' lifecycle traces, authenticated settlement, deadline/closure fences and rejected composition');
  return receipt;
}
if(require.main===module) {const receipt=run();if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(receipt,null,2)+'\n');}
module.exports={run};
