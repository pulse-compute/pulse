'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const b=require('../ra03/native/build.cjs');
function bridge(original,n){
 let s=original;const once=(a,v)=>{assert.equal(s.split(a).length-1,1,a);s=s.replace(a,v);};
 let glue='';
 function wrap(name,raw,params,args,body){const anchor='declare function '+name+'(';assert.equal(s.split(anchor).length-1,1,name);s=s.replace(anchor,'declare function '+raw+'(');glue+=`\nfunction ${name}(${params}):i32{return ${body||raw+'('+args+')'};}\n`;}
 wrap('fastly_http_req_new','raw_req_new','out:usize','out');
 wrap('fastly_http_body_new','raw_body_new','out:usize','out');
 wrap('fastly_http_req_send_async','raw_send','r:i32,b:i32,p:usize,n:i32,out:usize','r,b,p,n,out','rf_send(r,b,p,n,out)');
 wrap('fastly_http_req_pending_req_wait_v2','raw_wait','h:i32,d:usize,r:usize,b:usize','h,d,r,b','rf_wait(h,d,r,b)');
 wrap('__pulse_fetch_poll','raw_poll','h:i32,d:usize,done:usize,r:usize,b:usize','h,d,done,r,b','rf_poll(h,d,done,r,b)');
 wrap('__pulse_fetch_close_request','raw_close_req','h:i32','h','rf_close_req(h)');
 wrap('__pulse_fetch_close_body','raw_close_body','h:i32','h','rf_close_body(h)');
 wrap('__pulse_fetch_close_response','raw_close_resp','h:i32','h','rf_close_resp(h)');
 wrap('fastly_http_resp_send_downstream','raw_downstream','r:i32,b:i32,stream:i32','r,b,stream','rf_downstream(r,b,stream)');
 once('let status = fastly_http_req_new(changetype<usize>(requestOut))','let status = rf_new_req(effectIndex,changetype<usize>(requestOut))');
 once('status = fastly_http_body_new(changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71','status = rf_new_body(effectIndex,changetype<usize>(bodyOut)); if (status != FASTLY_STATUS_OK) { __pulse_fastly_fail(PULSE_ERROR_HOSTCALL, 71');
 once('      __pulse_effect_pending_0 = 1','      if(!rf_group()){__pulse_fastly_fail(PULSE_ERROR_STATE,384,-1);return -1;}\n      __pulse_effect_pending_0 = 1');
 once('  if (!__pulse_invocation_begin(effectIndex)) return;','  if (unchecked(__pulse_invocation_tickets[effectIndex])<=0) return;');
 once('function __pulse_invocation_close(): void { __pulse_fetch_reap();','function __pulse_invocation_close(): void { __pulse_fetch_reap(); rf_finish();');
 once('    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();','    if(!rf_read(handle)) return "";\n    const buffer = new Uint8Array(PULSE_FASTLY_BUFFER_BYTES), read = __pulse_fastly_out_i32();');
 once('    total += count;','    total += count; if(!rf_body_limit(handle,total)) return "";');
 let ledger=b.source(n,1).replaceAll('export function','function');
 const replaceLedger=(a,v)=>{assert.equal(ledger.split(a).length-1,1,a);ledger=ledger.replace(a,v);};
 replaceLedger('d==1?192:4','d==1?262336:4');
 replaceLedger('committed(1)+n*256','committed(1)+n*262400');
 replaceLedger('if(cr(c,1)!=3)return bad(23);','if(cr(c,1)!=3&&cr(c,1)!=5&&cr(c,1)!=6)return bad(23);if(cr(c,1)!=3&&b!=0)return bad(23);');
 const adapter=fs.readFileSync(path.join(__dirname,'adapter.as.ts'),'utf8').replace('/* COUNT */',n).replace('/* TABLE_BYTES */',n*13*4);
 return s+'\n'+ledger+'\n'+adapter+'\n'+glue;
}
module.exports={...b,bridge};
