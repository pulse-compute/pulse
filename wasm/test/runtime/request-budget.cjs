'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {compileCanonicalSource, loadCanonicalModule} = require('../../packages/compiler/src/canonical-api-compiler');
const {buildCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-plan');
const {compileCanonicalNativePlan} = require('../../packages/compiler/src/canonical-native-compiler');
const nativeHost = require('../../packages/host-runtime/src/runtime/canonical-native-host');
const canonicalHost = require('../../packages/host-runtime/src/runtime/canonical-api-runtime');
function clock() {
  let time = 0; const timers = new Map();
  return {now:()=>time,setTimeout(fn,ms){const id={};timers.set(id,{fn,at:time+ms});return id;},clearTimeout(id){timers.delete(id);},
    advance(ms, fire=true){time+=ms;if(fire)for(const[id,t]of[...timers])if(t.at<=time){timers.delete(id);t.fn();}},pending:()=>timers.size};
}
async function main() {
  const source = `import type { PulseContext } from '@pulse-compute/runtime';
export default async function handler(ctx: PulseContext) {
  const one = await ctx.config.get('one');
  const two = await ctx.config.get('two');
  const stored = await ctx.kv('jobs').put('checkpoint', 1);
  return ctx.text('done');
}`;
  const compiled = compileCanonicalSource(source,{fileName:path.join(__dirname,'request-budget-consumer.ts'),strict:false});
  const native = compileCanonicalNativePlan(buildCanonicalNativePlan(compiled));
  const program = loadCanonicalModule(compiled);
  for (const target of ['native','generator']) {
    const execute = (options) => target === 'native' ? nativeHost.executeCanonicalNativeModule(native,options)
      : canonicalHost.createCanonicalHostRuntime(options).execute(program,options);
    const c = clock(); let calls=0,writes=0;
    await assert.rejects(execute({request:{method:'GET',path:'/'},maxDurationMs:10000,requestClock:c,
      providerAdapter:{id:'deadline',dispatchEffect(effect){if(effect.kind==='kv.put'){writes++;return true;}calls++;c.advance(6000,false);return 'value';}}
    }),{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
    assert.equal(calls,2);assert.equal(writes,0);assert.equal(c.pending(),0);
    let finish, admitted, dispatched=0;
    const ready = new Promise(resolve=>{admitted=resolve;});const late=clock();
    const pending=execute({request:{method:'GET',path:'/'},maxDurationMs:10,requestClock:late,
      providerAdapter:{id:'late-write',dispatchEffect(effect,execution){if(effect.kind!=='kv.put')return 'value';dispatched++;admitted(execution.signal);return new Promise(resolve=>{finish=resolve;});}}
    });
    const rejected=assert.rejects(pending,{code:'PULSE_REQUEST_DEADLINE_EXCEEDED'});
    const signal=await ready;late.advance(10);await rejected;assert.equal(signal.aborted,true);
    finish(true);await Promise.resolve();await Promise.resolve();assert.equal(dispatched,1);assert.equal(late.pending(),0);
  }
  console.log('ok - Native and generator request budgets prevent late continuation and checkpoint dispatch');
}
module.exports={main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
