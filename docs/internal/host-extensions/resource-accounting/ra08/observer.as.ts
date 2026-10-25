// Evidence only. Never reads a payload, host handle or address into diagnostics.
// The observer cannot alter ledger state, admission, cleanup or host control flow.
const RD_CAP:i32=/* CAPACITY */, RD_EVERY:i32=/* SAMPLE_EVERY */;
const RD_IDS:usize=memory.data(NC*4), RD_SITES:usize=memory.data(NC*4), RD_COUNTS:usize=memory.data(64*4);
const RD_EVENTS:usize=memory.data(RD_CAP>0?RD_CAP*28:1);
let rd_current:i32=-1;
let rd_next:i32=0,rd_total:i32=0,rd_kept:i32=0,rd_sampledOut:i32=0,rd_dropped:i32=0;
let rd_overflow:bool=false;
function rd_state(c:i32,old:i32,state:i32):void {
 if(c<0 || c>=NC || old==state)return;
 if(state==1){rd_next++;store<i32>(RD_IDS+<usize>(c*4),rd_next);store<i32>(RD_SITES+<usize>(c*4),rd_current);}
 // Saturation makes coverage partial, never wraps to a believable small count.
 if(rd_total>=/* COUNTER_LIMIT */){rd_overflow=true;return;}
 rd_total++;
 const pair=old*8+state,at=RD_COUNTS+<usize>(pair*4);
 store<i32>(at,load<i32>(at)+1);
 if((rd_total-1)%RD_EVERY!=0){rd_sampledOut++;return;}
 if(rd_kept>=RD_CAP){rd_dropped++;return;}
 const base=RD_EVENTS+<usize>(rd_kept*28);
 store<i32>(base,rd_total);store<i32>(base+4,c/8);
 store<i32>(base+8,load<i32>(RD_IDS+<usize>(c*4)));
 store<i32>(base+12,old);store<i32>(base+16,state);
 store<i32>(base+20,__pulse_invocation_closed?1:0);store<i32>(base+24,load<i32>(RD_SITES+<usize>(c*4)));rd_kept++;
}
// Numeric, read-only snapshot ABI. No raw pointer or ledger reference export.
export function rd_query(k:i32,i:i32,f:i32):i32 {
 if(k==0){
  if(i==0)return rd_total;if(i==1)return rd_kept;if(i==2)return rd_sampledOut;
  if(i==3)return rd_dropped;if(i==4)return rd_overflow?1:0;if(i==5)return RD_CAP;
  if(i==6)return RD_EVERY;if(i==7)return JQ_N;if(i==8)return NC;
  if(i==9)return jq_admitted?1:0;if(i==10)return __pulse_invocation_closed?1:0;
  if(i==11)return fault?1:0;if(i==12)return lost?1:0;
  if(i==13)return NC*8+64*4+(RD_CAP>0?RD_CAP*28:1);
 }
 if(k==1 && i>=0 && i<64)return load<i32>(RD_COUNTS+<usize>(i*4));
 if(k==2 && i>=0 && i<rd_kept && f>=0 && f<7)return load<i32>(RD_EVENTS+<usize>((i*7+f)*4));
 if(k==3 && i>=0 && i<NC){
  if(f==0)return cr(i,1);if(f==1)return i/8;
  if(f==2)return load<i32>(RD_IDS+<usize>(i*4));
  if(f>=3 && f<=5)return cr(i,f+1);if(f==6)return load<i32>(RD_SITES+<usize>(i*4));
 }
 if(k==4 && i>=0 && i<JQ_N){
  if(f==0)return rr(i,1);if(f>=1&&f<=3)return rr(i,5+f);
  if(f==4)return rr(i,2);if(f==5)return rr(i,3);
 }
 if(k==5 && i>=0 && i<3){if(f==0)return na_query(1,i);if(f==1)return committed(i);}
 // A cohort denial is attributed to its dimension, not an arbitrary child slot.
 if(k==6 && i>=0 && i<4){
  if(f==0)return i==0?JQ_N*5+2:i==1?JQ_N*262849+64:i==2?JQ_N*8+2:JQ_N*4;
  if(f==1)return i==0?nh:i==1?nb:i==2?nr:limit;
 }
 return -1;
}
