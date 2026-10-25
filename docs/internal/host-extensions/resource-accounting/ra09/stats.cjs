'use strict';
const assert=require('node:assert/strict');
function quantile(values,p){assert(values.length);const a=[...values].sort((a,b)=>a-b),i=(a.length-1)*p,lo=Math.floor(i);return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo);}
function summary(values){return {samples:values.length,min:Math.min(...values),p10:quantile(values,.1),median:quantile(values,.5),p90:quantile(values,.9),max:Math.max(...values)};}
function paired(before,after){
 assert.equal(before.length,after.length);assert(before.length>=8);
 const deltas=after.map((v,i)=>v-before[i]);let seed=12909;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const boot=Array.from({length:2000},()=>quantile(Array.from({length:deltas.length},()=>deltas[Math.floor(random()*deltas.length)]),.5));
 const interval=[quantile(boot,.025),quantile(boot,.975)];
 return {delta:summary(deltas),bootstrapMedian95:interval,signal:interval[0]<=0&&interval[1]>=0?'inconclusive':interval[0]>0?'positive-local-delta':'negative-local-delta',productionSpeedupClaim:false};
}
module.exports={quantile,summary,paired};
