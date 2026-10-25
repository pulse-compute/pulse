// Internal pressure fixture: one resource per canonical lease, four scoped pins.
// Trusted provider API. No host calls, allocator, waiting or scheduling.
const N:i32=/* WIDTH */, P:i32=N*4;
const B:usize=memory.data(/* BANK */); // resource: generation,state,owner,operation generation,operation kind
const Q:usize=memory.data(/* PINS */); // pin: generation, live resource generation
let guardStopped:bool=false, guardEnded:bool=false;
@inline function r(i:i32,f:i32):i32{return load<i32>(B+<usize>((i*5+f)*4));}
@inline function w(i:i32,f:i32,v:i32):void{store<i32>(B+<usize>((i*5+f)*4),v);}
function slot(t:i32):i32{if(t<=0)return -1;let i=(t-1)%N;return r(i,1)!=0&&r(i,0)==(t-1)/N?i:-1;}
function pins(i:i32):i32{let n=0;for(let j=i*4;j<i*4+4;j++)if(load<i32>(Q+<usize>(j*8+4))!=0)n++;return n;}
export function acquire(i:i32,owner:i32):i32{if(guardStopped||guardEnded||i<0||i>=N||owner<0||owner>3)return -1;if(r(i,1)!=0)return -2;let g=r(i,0)+1;if(g>1000000)return -3;w(i,0,g);w(i,1,1);w(i,2,owner);return g*N+i+1;}
export function pin(t:i32):i32{let i=slot(t);if(guardStopped||guardEnded||i<0||r(i,1)!=1)return -1;for(let j=i*4;j<i*4+4;j++){let p=Q+<usize>(j*8);if(load<i32>(p+4)==0){let g=load<i32>(p)+1;if(g>1000000)return -3;store<i32>(p,g);store<i32>(p+4,r(i,0));return g*P+j+1;}}return -4;}
export function unpin(t:i32,p:i32):i32{let i=slot(t);if(i<0||p<=0)return -1;let j=(p-1)%P,a=Q+<usize>(j*8);if(j/4!=i||load<i32>(a)!=(p-1)/P||load<i32>(a+4)!=r(i,0))return -5;store<i32>(a+4,0);return 0;}
export function handoff(t:i32,from:i32,to:i32):i32{let i=slot(t);if(guardStopped||guardEnded||i<0||r(i,1)!=1||pins(i)!=0||r(i,2)!=from||to<0||to>3||to==from)return -6;w(i,2,to);return 0;}
// kind 1 = read/work, kind 2 = disposal/cleanup. Both require no aliases.
export function begin(t:i32,owner:i32,kind:i32):i32{let i=slot(t);if(guardEnded||(guardStopped&&kind==1)||i<0||r(i,1)!=1||pins(i)!=0||r(i,2)!=owner||(kind!=1&&kind!=2))return -7;let g=r(i,3)+1;if(g>1000000)return -3;w(i,3,g);w(i,4,kind);w(i,1,2);return g*N+i+1;}
// Qualified completion: 1 retained/quiescent, 2 released/quiescent,
// 3 uncertain disposition or continuing access. Uncertainty is terminal here.
export function complete(t:i32,a:i32,result:i32):i32{let i=slot(t);if(i<0||a<=0||(a-1)%N!=i||(a-1)/N!=r(i,3)||r(i,1)!=2)return -8;if(result<1||result>3||(result==2&&r(i,4)!=2)||(result==1&&r(i,4)==2))return -9;w(i,1,result==2?0:result==3?3:1);return 0;}
export function stop():void{guardStopped=true;}
export function end():void{guardStopped=true;guardEnded=true;}
export function state(t:i32):i32{let i=slot(t);return i<0?-1:r(i,1);}
export function pinCount(t:i32):i32{let i=slot(t);return i<0?-1:pins(i);}
export function bytes():i32{return N*52;}
