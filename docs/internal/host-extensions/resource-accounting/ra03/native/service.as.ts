// Internal fixed-profile Native prototype. No scheduler, hostcalls or GC objects.
// Generated WIDTH is 8/16/32; every root has work (3,192,4), cleanup (2,64,2).
// Arithmetic is explicitly bounded to signed i32-safe fixture ranges.
const NR:i32=/* ROOTS */; const NC:i32=NR*6; const NE:i32=/* EFFECTS */;
const RB:usize=memory.data(/* ROOT_BYTES */), CB:usize=memory.data(/* CLAIM_BYTES */);
const TB:usize=memory.data(/* CHILD_BYTES */), MB:usize=memory.data(128);
const RS:i32=15, CS:i32=8;
// Root: generation, phase, future, children, work steps, cleanup steps,
// live[3], work-live[3], tail[3]. Claim: generation,state,lane,owner,charge[3],payload.
let nh:i32=0,nb:i32=0,nr:i32=0,limit:i32=0,used:i32,now:i32=0,deadline:i32=0;
let stopped:bool=false,ended:bool=false,err:i32=0,eh:i32=0,eb:i32=0,er:i32=0;
let fault:bool=false,lost:bool=false,peak:i32=0,liveRecords:i32=0;
@inline function rr(r:i32,f:i32):i32{return load<i32>(RB+<usize>((r*RS+f)*4));}
@inline function rw(r:i32,f:i32,v:i32):void{store<i32>(RB+<usize>((r*RS+f)*4),v);}
@inline function cr(c:i32,f:i32):i32{return load<i32>(CB+<usize>((c*CS+f)*4));}
@inline function cw(c:i32,f:i32,v:i32):void{store<i32>(CB+<usize>((c*CS+f)*4),v);}
@inline function tr(t:i32,f:i32):i32{return load<i32>(TB+<usize>((t*2+f)*4));}
@inline function tw(t:i32,f:i32,v:i32):void{store<i32>(TB+<usize>((t*2+f)*4),v);}
@inline function work(d:i32):i32{return d==0?3:d==1?192:4;}
@inline function clean(d:i32):i32{return d==0?2:d==1?64:2;}
@inline function ex(d:i32):i32{return d==1?64:2;}
function bad(n:i32):i32{err=n;return -n;}
function gate(business:bool):i32{if(ended)return bad(1);if(now>=deadline){stopped=true;return bad(2);}if(business&&stopped)return bad(3);return 0;}
function root(t:i32):i32{if(t<=0)return bad(4);let r=(t-1)%NR,g=(t-1)/NR;if(rr(r,1)==0||rr(r,0)!=g)return bad(4);return r;}
function claim(t:i32):i32{if(t<=0)return bad(5);let c=(t-1)%NC,g=(t-1)/NC;if(cr(c,1)==0||cr(c,0)!=g)return bad(5);return c;}
function held(r:i32):bool{for(let c=r*6;c<r*6+6;c++)if(cr(c,1)!=0)return true;return false;}
function tail(r:i32,d:i32):i32{return held(r)?min(clean(d),max(0,rr(r,12+d)-rr(r,6+d))):0;}
function committed(d:i32):i32{let n=ex(d);for(let r=0;r<NR;r++){let p=rr(r,1);if(p==2||p==3)n+=work(d)+clean(d);else if(p==4)n+=rr(r,6+d)+tail(r,d);}return n;}
function promised():i32{let n=0;for(let r=0;r<NR;r++)n+=rr(r,2);return n;}
function retire(r:i32):void{if(rr(r,1)==4&&!held(r))rw(r,1,0);}
export function na_init(h:i32,b:i32,rec:i32,effects:i32,until:i32):i32{
 if(h<2||b<64||rec<2||h>1000000||b>1000000000||rec>1000000||effects<0||effects>1000000||until<=0)return bad(6);
 nh=h;nb=b;nr=rec;limit=effects;deadline=until;now=0;used=0;stopped=false;ended=false;err=0;eh=0;eb=0;er=0;fault=false;lost=false;peak=0;liveRecords=0;
 // Generations survive reset; old execution references cannot alias a new claim.
 for(let r=0;r<NR;r++)for(let f=1;f<RS;f++)rw(r,f,0);
 for(let c=0;c<NC+2;c++)for(let f=1;f<CS;f++)cw(c,f,0);
 for(let t=0;t<NR*3;t++)tw(t,1,0);return 0;
}
export function na_now(t:i32):i32{if(t<now||t<0)return bad(6);now=t;return 0;}
export function na_capture():i32{
 if(gate(true)<0)return -err;if(used+promised()>=limit)return bad(7);
 let r=0;while(r<NR&&rr(r,1)!=0)r++;if(r==NR)return bad(8);
 let g=rr(r,0)+1;if(g>1000000)return bad(9);for(let f=1;f<RS;f++)rw(r,f,0);rw(r,0,g);rw(r,1,1);used++;return g*NR+r+1;
}
export function na_member(i:i32,t:i32):i32{if(i<0||i>=32)return bad(6);store<i32>(MB+<usize>(i*4),t);return 0;}
export function na_admit(n:i32):i32{
 if(gate(true)<0)return -err;if(n<0||n>32)return bad(6);
 for(let i=0;i<n;i++){let t=load<i32>(MB+<usize>(i*4)),r=root(t);if(r<0)return -err;if(rr(r,1)!=1)return bad(10);for(let j=0;j<i;j++)if(load<i32>(MB+<usize>(j*4))==t)return bad(10);}
 if(committed(0)+n*5>nh||committed(1)+n*256>nb||committed(2)+n*6>nr)return bad(11);
 if(used+promised()+n*(NE-1)>limit)return bad(7);
 for(let i=0;i<n;i++){let r=root(load<i32>(MB+<usize>(i*4)));rw(r,1,2);rw(r,2,NE-1);}return 0;
}
export function na_deny(t:i32):i32{let r=root(t);if(r<0)return -err;if(rr(r,1)!=1)return bad(10);rw(r,1,0);return 0;}
export function na_child(t:i32):i32{
 if(gate(true)<0)return -err;let r=root(t);if(r<0)return -err;if(rr(r,1)!=2||rr(r,2)<=0)return bad(12);
 let k=r*3;while(k<r*3+3&&tr(k,1)!=0)k++;if(k==r*3+3)return bad(8);let g=tr(k,0)+1;if(g>1000000)return bad(9);
 tw(k,0,g);tw(k,1,1);rw(r,2,rr(r,2)-1);rw(r,3,rr(r,3)+1);used++;return g*(NR*3)+k+1;
}
export function na_settle_child(t:i32,child:i32):i32{let r=root(t);if(r<0)return -err;if(child<=0)return bad(13);let k=(child-1)%(NR*3),g=(child-1)/(NR*3);if(k/3!=r||tr(k,0)!=g||tr(k,1)!=1)return bad(13);tw(k,1,0);rw(r,3,rr(r,3)-1);return 0;}
export function na_step(t:i32,lane:i32):i32{if(lane!=1&&lane!=2)return bad(6);if(gate(lane==1)<0)return -err;let r=root(t);if(r<0)return -err;let p=rr(r,1);if(p==1||(lane==1&&p!=2))return bad(3);let f=lane==1?4:5;if(rr(r,f)>=10000)return bad(14);rw(r,f,rr(r,f)+1);return 0;}
export function na_prepare(t:i32,h:i32,b:i32,rec:i32,lane:i32):i32{
 if(gate(lane==1)<0)return -err;let r=root(t);if(r<0)return -err;if(h<0||b<0||rec<1||h>1000000||b>1000000||rec>1000000||(lane!=1&&lane!=2))return bad(6);
 let p=rr(r,1);if(p==1||(lane==1&&p!=2))return bad(3);
 for(let d=0;d<3;d++){let q=d==0?h:d==1?b:rec;if(lane==1&&rr(r,9+d)+q>work(d))return bad(15);if(p==4&&q>tail(r,d))return bad(16);if(rr(r,6+d)+q>work(d)+clean(d))return bad(17);}
 let c=r*6,end=r*6+(lane==1?4:6);while(c<end&&cr(c,1)!=0)c++;if(c==end)return bad(18);let g=cr(c,0)+1;if(g>1000000)return bad(9);if(na_step(t,lane)<0)return -err;
 cw(c,0,g);cw(c,1,1);cw(c,2,lane);cw(c,3,0);cw(c,4,h);cw(c,5,b);cw(c,6,rec);cw(c,7,-1);
 for(let d=0;d<3;d++){let q=d==0?h:d==1?b:rec;rw(r,6+d,rr(r,6+d)+q);if(lane==1)rw(r,9+d,rr(r,9+d)+q);}liveRecords++;peak=max(peak,liveRecords);return g*NC+c+1;
}
export function na_adopt(t:i32,payload:i32):i32{let c=claim(t);if(c<0)return -err;if(cr(c,1)!=1||payload<0)return bad(19);for(let j=0;j<NC;j++)if(j!=c&&(cr(j,1)==2||cr(j,1)==4)&&cr(j,7)==payload)return bad(20);cw(c,7,payload);cw(c,1,ended||now>=deadline?4:2);return 0;}
// Observation/proof are provider-owned inputs; fixture supports release and unknown.
export function na_observe(t:i32,state:i32,owner:i32):i32{let c=claim(t);if(c<0)return -err;if(cr(c,3)!=owner)return bad(21);if(state!=3&&state!=4)return bad(6);if(cr(c,1)==4&&state!=4)return bad(22);if(cr(c,1)==1&&state!=4)return bad(19);cw(c,1,state);return 0;}
export function na_handoff(t:i32,from:i32,to:i32):i32{if(gate(true)<0)return -err;let c=claim(t);if(c<0)return -err;if(cr(c,1)!=2||cr(c,3)!=from||to<0||to>5||to==from||rr(c/6,1)!=2)return bad(21);cw(c,3,to);return 0;}
export function na_refund(t:i32,h:i32,b:i32,rec:i32):i32{
 let c=claim(t);if(c<0)return -err;if(cr(c,1)!=3)return bad(23);if(h<0||b<0||rec<0||h>cr(c,4)||b>cr(c,5)||rec>cr(c,6))return bad(24);let r=c/6;
 for(let d=0;d<3;d++){let q=d==0?h:d==1?b:rec;cw(c,4+d,cr(c,4+d)-q);rw(r,6+d,rr(r,6+d)-q);if(cr(c,2)==1)rw(r,9+d,rr(r,9+d)-q);}
 if(cr(c,4)==0&&cr(c,5)==0&&cr(c,6)==0){cw(c,1,0);cw(c,7,-1);liveRecords--;retire(r);}return 0;
}
export function na_finish(t:i32):i32{let r=root(t);if(r<0)return -err;let p=rr(r,1);if(p!=2&&p!=3)return bad(10);if(rr(r,3)!=0)return bad(25);for(let c=r*6;c<r*6+6;c++)if(cr(c,1)==1)return bad(26);for(let d=0;d<3;d++)rw(r,12+d,min(work(d)+clean(d),rr(r,6+d)+clean(d)));rw(r,1,4);rw(r,2,0);retire(r);return 0;}
export function na_stop():void{stopped=true;}
export function na_end():void{stopped=true;ended=true;}
export function na_exit(h:i32,b:i32,rec:i32):i32{if(gate(false)<0)return -err;if(h<0||b<0||rec<0||h>2-eh||b>64-eb||rec>2-er)return bad(27);eh+=h;eb+=b;er+=rec;return 0;}
export function na_unexpected(payload:i32):i32{stopped=true;fault=true;if(payload<0){lost=true;return bad(28);}let c=NC;while(c<NC+2&&cr(c,1)!=0)c++;if(c==NC+2){lost=true;return bad(28);}cw(c,1,4);cw(c,7,payload);return 0;}
// Compact numeric diagnostics; payloads never appear here.
export function na_query(kind:i32,d:i32):i32{
 if(kind>=0&&kind<=3&&(d<0||d>2))return bad(6);
 if(kind==0)return committed(d);if(kind==1){let n=d==0?eh:d==1?eb:er;for(let r=0;r<NR;r++)n+=rr(r,6+d);return n;}
 if(kind==2||kind==3){let n=0;for(let r=0;r<NR;r++)if(rr(r,1)==4)n+=kind==2?rr(r,6+d):tail(r,d);return n;}
 if(kind==4)return used;if(kind==5)return promised();if(kind==6)return liveRecords;if(kind==7)return peak;if(kind==8)return err;if(kind==9)return lost?1:0;if(kind==10)return fault?1:0;
 return 0;
}
export function na_bytes():i32{return NR*RS*4+(NC+2)*CS*4+NR*3*2*4+128;}
export function na_ptr():usize{return RB;}
// Execute a matched synthetic lifecycle entirely inside Wasm: no per-event JS/Wasm
// crossing, no host I/O, and no allocator use. Caller supplies repetition count.
export function na_bench(repetitions:i32,mode:i32):i32{
 if(mode<0||mode>3||repetitions<1||repetitions>1000000)return bad(6);let checksum=0;
 for(let iteration=0;iteration<repetitions;iteration++){
  let n=NR/2;na_init(n*5+2,n*256+64,n*6+2,1024,100000);
  for(let i=0;i<n;i++){let t=na_capture();na_member(i,t);}if(na_admit(n)<0)return -err;
  for(let i=0;i<n;i++){let t=load<i32>(MB+<usize>(i*4));for(let j=0;j<(mode==0?1:3);j++){let ct=na_child(t);if(ct<0||na_settle_child(t,ct)<0)return -err;let c=na_prepare(t,1,64,j==2?2:1,1);if(c<0||na_adopt(c,i*10+j)<0)return -err;}}
  if(mode>=2){na_stop();for(let i=0;i<n;i++){let t=load<i32>(MB+<usize>(i*4)),c=na_prepare(t,2,64,2,2);if(c<0||na_adopt(c,i*10+3)<0)return -err;}}
  checksum+=liveRecords;
  for(let i=0;i<n;i++){let t=load<i32>(MB+<usize>(i*4)),r=root(t);for(let k=r*6;k<r*6+6;k++)if(cr(k,1)!=0){let c=cr(k,0)*NC+k+1;if(mode==3&&k==r*6){na_observe(c,4,0);continue;}let h=cr(k,4),b=cr(k,5),rec=cr(k,6);if(na_observe(c,3,0)<0||na_refund(c,h,b,rec)<0)return -err;}if(na_finish(t)<0)return -err;}
  na_end();
 }
 return checksum;
}
