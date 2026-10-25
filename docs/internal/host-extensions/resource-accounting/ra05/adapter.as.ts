// Investigation-only fetch adapter. Per site: root, five (claim,handle) pairs,
// body-allocation claim and read count. Family-scoped handles; no raw diagnostics.
const RF:usize=memory.data(/* TABLE_BYTES */);
const RF_N:i32=/* COUNT */, RF_BYTES:i32=262336;
let rf_short:i32=0,rf_closed:i32=0,rf_unknown:i32=0,rf_consumed:i32=0,rf_transferred:i32=0,rf_suppressed:i32=0;
@inline function fg(i:i32,f:i32):i32{return load<i32>(RF+<usize>((i*13+f)*4));}
@inline function fw(i:i32,f:i32,v:i32):void{store<i32>(RF+<usize>((i*13+f)*4),v);}
function rf_claim(t:i32):i32{if(t<=0)return -1;let c=(t-1)%NC;return cr(c,1)!=0&&cr(c,0)==(t-1)/NC?c:-1;}
function rf_check():bool{if(__request_remaining()<=0){na_now(1000);return false;}return true;}
function rf_group():bool{
 na_init(RF_N*5+2-rf_short,RF_N*(RF_BYTES+64)+64,RF_N*6+2,1024,1000);
 for(let i=0;i<RF_N;i++){if(!__pulse_invocation_begin(i))return false;let r=na_capture();if(r<0)return false;fw(i,0,r);na_member(i,r);}
 if(na_admit(RF_N)<0){for(let i=0;i<RF_N;i++)na_deny(fg(i,0));return false;}return true;
}
function rf_find(role:i32,h:i32):i32{for(let i=0;i<RF_N;i++){let t=fg(i,1+role*2);if(t>0&&fg(i,2+role*2)==h){let c=rf_claim(t);if(c>=0)return i;}}return -1;}
function rf_prepare(i:i32,role:i32):i32{let t=na_prepare(fg(i,0),1,0,1,1);if(t>0)fw(i,1+role*2,t);return t;}
function rf_adopt(i:i32,role:i32,h:i32):bool{
 fw(i,2+role*2,h);if(h<0||h>=1000000||na_adopt(fg(i,1+role*2),(role==0?1:role==1||role==4?2:role==2?3:4)*1000000+h)<0){na_unexpected(h);__pulse_fastly_fail(PULSE_ERROR_STATE,380,i);return false;}return true;
}
function rf_uncertain(t:i32):void{if(t>0){let c=rf_claim(t);if(c>=0&&cr(c,1)!=4){na_observe(t,4,0);rf_unknown++;}}}
// Successful consumption/transfer retires guest handle+record only. No bytes.
function rf_retire(t:i32,state:i32):void{let c=rf_claim(t);if(c<0)return;if(cr(c,1)!=2&&cr(c,1)!=7){rf_uncertain(t);return;}cw(c,1,state);na_refund(t,1,0,1);if(state==5)rf_consumed++;else rf_transferred++;}
function rf_new_req(i:i32,out:usize):i32{if(!rf_check()||rf_prepare(i,0)<0)return 1;let s=raw_req_new(out);if(s==0){if(!rf_adopt(i,0,load<i32>(out)))return 1;}else rf_uncertain(fg(i,1));return s;}
function rf_new_body(i:i32,out:usize):i32{if(!rf_check()||rf_prepare(i,1)<0)return 1;let s=raw_body_new(out);if(s==0){if(!rf_adopt(i,1,load<i32>(out)))return 1;}else rf_uncertain(fg(i,3));return s;}
function rf_send(r:i32,b:i32,p:usize,n:i32,out:usize):i32{
 let i=rf_find(0,r);if(i<0)return 1;if(!rf_check()||rf_prepare(i,2)<0)return 1;
 cw(rf_claim(fg(i,1)),1,7);cw(rf_claim(fg(i,3)),1,7);let s=raw_send(r,b,p,n,out);if(s==0){rf_retire(fg(i,1),6);rf_retire(fg(i,3),6);if(!rf_adopt(i,2,load<i32>(out)))return 1;}
 else{rf_uncertain(fg(i,1));rf_uncertain(fg(i,3));rf_uncertain(fg(i,5));}return s;
}
function rf_wait(h:i32,d:usize,r:usize,b:usize):i32{
 let i=rf_find(2,h);if(i<0)return 1;if(!rf_check())return 1;
 if(rf_prepare(i,3)<0||rf_prepare(i,4)<0)return 1;
 cw(rf_claim(fg(i,5)),1,7);let s=raw_wait(h,d,r,b);if(s==0){rf_retire(fg(i,5),5);let ar=rf_adopt(i,3,load<i32>(r)),ab=rf_adopt(i,4,load<i32>(b));if(!ar||!ab)return 1;}
 else{rf_uncertain(fg(i,5));rf_uncertain(fg(i,7));rf_uncertain(fg(i,9));}return s;
}
// A not-ready successful poll proves no output; retire only those registrations.
function rf_no_output(t:i32):void{let c=rf_claim(t);if(c<0)return;cw(c,1,3);na_refund(t,1,0,1);}
function rf_poll(h:i32,d:usize,done:usize,r:usize,b:usize):i32{
 let i=rf_find(2,h);if(i<0)return 1;if(!rf_check()){rf_uncertain(fg(i,5));return 1;}
 if(rf_prepare(i,3)<0||rf_prepare(i,4)<0)return 1;
 cw(rf_claim(fg(i,5)),1,7);let s=raw_poll(h,d,done,r,b);if(s==0&&load<i32>(done)==1){rf_retire(fg(i,5),5);let ar=rf_adopt(i,3,load<i32>(r)),ab=rf_adopt(i,4,load<i32>(b));if(!ar||!ab)return 1;}
 else if(s==0&&load<i32>(done)==0){cw(rf_claim(fg(i,5)),1,2);rf_no_output(fg(i,7));rf_no_output(fg(i,9));fw(i,7,0);fw(i,9,0);}
 else{rf_uncertain(fg(i,5));rf_uncertain(fg(i,7));rf_uncertain(fg(i,9));}return s;
}
function rf_close(role:i32,h:i32):i32{
 let i=rf_find(role,h);if(i<0){rf_suppressed++;return 1;}let t=fg(i,1+role*2),c=rf_claim(t);
 if(c<0||cr(c,1)!=2){rf_suppressed++;return 1;}
 if(!rf_check()||na_step(fg(i,0),2)<0){rf_uncertain(t);return 1;}
 // Fence before consuming entry, including traps; failure never grants retry.
 cw(c,1,4);let s=role==0?raw_close_req(h):role==3?raw_close_resp(h):raw_close_body(h);
 if(s==0){cw(c,1,3);na_refund(t,1,0,1);rf_closed++;}else rf_unknown++;return s;
}
function rf_close_req(h:i32):i32{return rf_close(0,h);}
function rf_close_body(h:i32):i32{let i=rf_find(4,h);return rf_close(i>=0?4:1,h);}
function rf_close_resp(h:i32):i32{return rf_close(3,h);}
function rf_downstream(r:i32,b:i32,stream:i32):i32{
 let i=rf_find(3,r);if(i<0)return raw_downstream(r,b,stream);
 if(stream!=0)return 1;cw(rf_claim(fg(i,7)),1,7);cw(rf_claim(fg(i,9)),1,7);let s=raw_downstream(r,b,stream);
 if(s==0){rf_retire(fg(i,7),6);rf_retire(fg(i,9),6);}else{rf_uncertain(fg(i,7));rf_uncertain(fg(i,9));}return s;
}
function rf_read(h:i32):bool{
 let i=rf_find(4,h);if(i<0)return true;
 if(!rf_check()||fg(i,12)>=4){__pulse_fastly_fail(PULSE_ERROR_STATE,381,i);return false;}
 if(fg(i,11)==0){let t=na_prepare(fg(i,0),0,RF_BYTES,1,1);if(t<0){__pulse_fastly_fail(PULSE_ERROR_STATE,382,i);return false;}fw(i,11,t);na_adopt(t,5000000+i);}
 fw(i,12,fg(i,12)+1);return true;
}
function rf_body_limit(h:i32,total:i32):bool{if(rf_find(4,h)<0||total<=64)return true;__pulse_fastly_fail(PULSE_ERROR_STATE,383,-1);return false;}
function rf_finish():void{
 for(let i=0;i<RF_N;i++){let rt=fg(i,0);if(rt<=0||root(rt)<0)continue;
  for(let role=0;role<5;role++){let t=fg(i,1+role*2);if(t<=0)continue;let c=rf_claim(t);if(c<0)continue;
   if(cr(c,1)==2&&role!=2)rf_close(role,fg(i,2+role*2));else if(cr(c,1)==1||role==2)rf_uncertain(t);
  }
  na_finish(rt);
 }
 na_end();
}
export function ra05_control(short:i32):void{rf_short=short;}
export function ra05_query(k:i32,d:i32):i32{if(k<20)return na_query(k,d);if(k==20)return rf_closed;if(k==21)return rf_unknown;if(k==22)return rf_consumed;if(k==23)return rf_transferred;if(k==24)return rf_suppressed;if(k==25)return na_bytes()+RF_N*52;return 0;}
