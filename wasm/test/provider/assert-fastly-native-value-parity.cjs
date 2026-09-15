'use strict';
const assert=require('node:assert/strict');
const {compileCanonicalSource}=require('../../packages/compiler/src/canonical-api-compiler.js');
const {buildCanonicalNativePlan}=require('../../packages/compiler/src/canonical-native-plan.js');
const source=String.raw`export default async function handler(ctx) {
 const input=await ctx.req.json();
 const ready=await ctx.fetch('https://values.test/ready').text();
 let n=input.version;let bits='';for(let i=0;i<53;i++){const bit=n%2;bits=(bit===0?'0':'1')+bits;n=(n-bit)/2;}
 const first=input.text[0];const second=input.text[1];
 return ctx.json({lt:input.left<input.right,le:input.left<=input.right,gt:input.left>input.right,ge:input.left>=input.right,
  length:input.text.length,first: first===input.first,second:second===input.second,
  stringKey:input.text['0']===first,badStringKey:input.text['01']===undefined,negative:input.text[-1]===undefined,fractional:input.text[0.5]===undefined,pastEnd:input.text[input.text.length]===undefined,bits,remainder:input.dividend%input.divisor});
}`;
const rows=[
 {left:'a',right:'b',text:'ab',first:'a',second:'b',version:1,dividend:5,divisor:2},
 {left:'10',right:'2',text:'😀',first:'\ud83d',second:'\ude00',version:9007199254740991,dividend:-5,divisor:2},
 {left:'😀',right:'\ue000',text:'é',first:'é',version:4503599627370496,dividend:5.5,divisor:2},
 {left:'same',right:'same',text:'',version:0,dividend:1,divisor:3},
 {left:'e\u0301',right:'é',text:'\ud800',first:'\ud800',version:2,dividend:0,divisor:3}
];
function main(kind='both') {
 const plan=buildCanonicalNativePlan(compileCanonicalSource(source,{fileName:'fastly-d2-values.ts',strict:false}));
 const modes={http:['../../../packages/provider-fastly/src/build/native-http-effects.js','compileFastlyNativeHttpEffectsPlan','../../../packages/provider-fastly/src/testing/native-http-effects-host.js','executeFastlyNativeHttpEffects'],platform:['../../../packages/provider-fastly/src/build/native-platform-capabilities.js','compileFastlyNativePlatformCapabilitiesPlan','../../../packages/provider-fastly/src/testing/native-platform-capabilities-host.js','executeFastlyNativePlatformCapabilities']};
 for(const [mode,[compiler,compile,host,execute]] of Object.entries(modes)) {
  if(kind!=='both' && mode!==kind)continue;
  const artifact=require(compiler)[compile](plan,{backends:{'https://values.test':'values_backend'},bindings:{backends:{'https://values.test':'values_backend'}},requirePlatformCapability:false,canonicalBuild:true});
  for(const row of rows){const actual=require(host)[execute](artifact,{fixtures:{'https://values.test/ready':{status:200,body:'ready'}},request:{method:'POST',path:'/',headers:[['content-type','application/json']],body:JSON.stringify(row)}});
   assert.equal(actual.response.status,200,mode);
   const expected={lt:row.left<row.right,le:row.left<=row.right,gt:row.left>row.right,ge:row.left>=row.right,length:row.text.length,first:true,second:true,stringKey:true,badStringKey:true,negative:true,fractional:true,pastEnd:true,bits:row.version.toString(2).padStart(53,'0'),remainder:Number.isFinite(row.dividend%row.divisor)?row.dividend%row.divisor:null};
   assert.deepEqual(JSON.parse(actual.response.body),expected,mode+' '+JSON.stringify(row));
  }
 }
 console.log('ok - Fastly '+kind+' D2 value parity: UTF-16 ordering/indexing and exact numeric remainder');
}
module.exports={main};if(require.main===module)main();
