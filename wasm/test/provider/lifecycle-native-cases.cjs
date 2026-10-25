"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const hooks = require('../../../packages/provider-fastly/src/build/lifecycle-hooks');
const authority = require('../../../packages/provider-fastly/src/build/response-authority');
const terminal = require('../../../packages/provider-fastly/src/build/host-extensions');
const forwarding = require('../../../packages/provider-fastly/src/build/native-body-forwarding');
const { compile } = require('../../../docs/internal/host-extensions/resource-accounting/ra03/native/build.cjs');

// Composition harness, not authored admission: real service hook bodies with
// small explicit stubs for their I/O machinery. Full service execution is covered
// separately by HEX-03 and the forwarding qualification suite.
function run({ artifactDir } = {}) {
  const source = `
@external("probe", "send") declare function fastly_http_resp_send_downstream(handle:i32, body:i32, streaming:i32):i32
@external("probe", "deliver") declare function deliver():i32
const PULSE_ERROR_STATE:i32=2
let failure:i32=0
function __pulse_fastly_fail(code:i32,stage:i32,index:i32):void { failure=stage }
let __pulse_fastly_request_body_handle:i32=-1
let __pulse_extension_handles_owned:bool=false
let __pulse_extension_slot:i32=0
let __pulse_extension_invocation:i32=7
let __pulse_extension_token:i32=99
let __pulse_extension_delivering:bool=false
let __pulse_extension_settled:bool=false
let __pulse_invocation_closed:bool=false
let cleanup:i32=0
let __fwd_source:i32=-1
let __fwd_result:i32=88
let fwdError:bool=false
let events:i32=0
function __pulse_extension_slot_of(i:i32):i32 { return i==0?0:-1 }
function __pulse_extension_cleanup():void { if(__pulse_extension_handles_owned && __pulse_response_authority!=1){cleanup++;__pulse_extension_handles_owned=false;} }
function __fwd_cleanup():void { if(__fwd_source>=0){cleanup++;__fwd_source=-1;} }
function __fwd_error_response():bool { if(!fwdError)return false;__pulse_fastly_send_result(55);return true }
function __fwd_send():i32 { return fastly_http_resp_send_downstream(1,2,1) }
function __pulse_fastly_jwt_attach_evidence(result:i32):void {}
function __pulse_fastly_run_invocation():void {}
function __pulse_invocation_close(): void {
  __pulse_invocation_closed=true
}
function __pulse_invocation_settle(index: i32, ticket: i32, result: i32): i32 {
  return pulse_set_effect_result(index, result)
}
export function pulse_set_effect_result(effectIndex: i32, handle: i32): i32 {
  return deliver()
}
function __pulse_fastly_jwt_send_error(): void {
  __pulse_fastly_send_result(11)
}
function __request_send_timeout(): void {
  __pulse_fastly_send_result(12)
}
function __pulse_fastly_send_result(handle: i32): i32 {
  return fastly_http_resp_send_downstream(handle,2,0)
}
export function acquired():void {
  const handles=new StaticArray<i32>(2);unchecked(handles[1]=42)
  __pulse_fastly_request_body_handle = load<i32>(changetype<usize>(handles) + 4)
}
export function end():void {
  __pulse_fastly_run_invocation()
  __pulse_invocation_close()
}
export function final(result:i32):void {
  __pulse_fastly_jwt_attach_evidence(result)
  __pulse_fastly_send_result(result)
}
export function send():i32 { return __pulse_fastly_send_result(10) }
export function timeout():void { __request_send_timeout() }
export function error():void { __pulse_fastly_jwt_send_error() }
export function forwardError():void { fwdError=true;__pulse_fastly_jwt_send_error() }
export function begin():bool { return __pulse_response_begin() }
export function transfer():void { __pulse_response_transferred() }
export function settle(i:i32,t:i32,r:i32):i32 { return __pulse_invocation_settle(i,t,r) }
export function query(k:i32):i32 {
  if(k==0)return __pulse_response_authority
  if(k==1)return cleanup
  if(k==2)return events
  if(k==3)return __pulse_extension_delivering?1:0
  if(k==4)return __pulse_extension_settled?1:0
  return failure
}
`;
  const contributions = [...terminal.hooks([{index:0}]), ...forwarding.hooks({capabilities:['request.body.forward']}), ...authority.hooks(),
    {point:'effect.deliver',owner:'probe.outer',order:-10,before:'events=events*10+1',after:'events=events*10+4'},
    {point:'effect.deliver',owner:'probe.inner',order:20,before:'events=events*10+2',after:'events=events*10+3'}];
  const input=authority.instrument(source), composed=hooks.compose(input,contributions,{requestBudget:true});
  assert.equal(composed.source,hooks.compose(input,[...contributions].reverse(),{requestBudget:true}).source);
  const dir=artifactDir||fs.mkdtempSync(path.join(os.tmpdir(),'pulse-lifecycle-'));
  fs.mkdirSync(dir,{recursive:true});
  let count=0;
  try {
    const wasm=compile(composed.source,dir,'composition');
    function instance({status=0,trap=false,accepted=1,deliverTrap=false,reenter=false}={}) {
      let e, sends=0;
      const module=new WebAssembly.Module(wasm);
      const imports={env:{abort(){throw new Error('guest abort');}},probe:{
        send(){sends++;if(reenter){e.error();e.timeout();e.send();}if(trap)throw new Error('send trap');return status;},
        deliver(){if(deliverTrap)throw new Error('delivery trap');return accepted;}
      }};
      e=new WebAssembly.Instance(module,imports).exports;
      return {e,sends:()=>sends};
    }
    function test(name,fn){fn();count++;console.log('ok - lifecycle native '+name);}
    test('ordinary send, reentrant and late responders share authority',()=>{
      const {e,sends}=instance({reenter:true});e.send();e.error();e.timeout();e.send();assert.equal(sends(),1);assert.equal(e.query(0),3);
    });
    test('ambiguous status never reopens authority',()=>{
      const {e,sends}=instance({status:3});e.send();e.timeout();e.error();assert.equal(sends(),1);assert.equal(e.query(0),1);
    });
    test('trapped dispatch never reopens authority',()=>{
      const {e,sends}=instance({trap:true});assert.throws(()=>e.send(),/send trap/);e.error();e.timeout();assert.equal(sends(),1);assert.equal(e.query(0),1);
    });
    test('forwarding claim uses shared send authority',()=>{
      const {e,sends}=instance();e.acquired();e.final(88);e.error();e.timeout();assert.equal(e.query(0),2);assert.equal(sends(),1);e.end();assert.equal(e.query(1),2);e.end();assert.equal(e.query(1),2);
    });
    test('forwarding error claim can send while authority owned',()=>{
      const {e,sends}=instance();e.forwardError();e.forwardError();assert.equal(sends(),1);assert.equal(e.query(0),3);
    });
    test('terminal claim settles and suppresses ordinary and forwarding sends',()=>{
      const {e,sends}=instance();e.acquired();assert.equal(e.begin(),1);e.transfer();assert.equal(e.settle(0,7,99),1);assert.equal(e.query(2),1234);assert.equal(e.query(3),0);assert.equal(e.query(4),1);e.final(99);e.final(88);e.error();e.timeout();assert.equal(e.query(0),3);assert.equal(sends(),0);e.end();assert.equal(e.query(1),2);
    });
    test('foreign settlement stops before delivery',()=>{
      const {e}=instance();e.begin();e.transfer();assert.equal(e.settle(0,8,99),0);assert.equal(e.query(2),0);
    });
    test('normal rejected delivery still runs after hooks in reverse',()=>{
      const {e}=instance({accepted:0});e.begin();e.transfer();assert.equal(e.settle(0,7,99),0);assert.equal(e.query(2),1234);assert.equal(e.query(4),0);assert.equal(e.query(3),0);
    });
    test('delivery trap skips after hooks and closure',()=>{
      const {e}=instance({deliverTrap:true});e.acquired();e.begin();e.transfer();assert.throws(()=>e.settle(0,7,99),/delivery trap/);assert.equal(e.query(2),12);assert.equal(e.query(3),1);assert.equal(e.query(1),0);assert.equal(e.query(4),0);
    });
    return {cases:count,bytes:wasm.length,sha256:require('node:crypto').createHash('sha256').update(wasm).digest('hex'),registrationOrderIdentical:true};
  } finally {if(!artifactDir)fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module){const result=run({artifactDir:process.argv[3]});if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');}
module.exports={run};
