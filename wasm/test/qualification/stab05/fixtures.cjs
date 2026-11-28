'use strict';

// Generic reductions of application-shaped compiler failures. No application
// source, identifiers, credentials or dependency on a private repository.
const scalar = `export function check(value:string):boolean {return value.length>0;}`;
const decoded = `const input=ctx.decodeJson('{"value":"a","items":[{"value":"a"}]}','case.Input');`;
const input = `{value:string;optional?:string;items:{value:string}[]}`;
const result = expression => `return ctx.text(''+${expression});`;
module.exports = [
  {id:'scalar-control', helper:scalar, body:result("check('a')")},
  {id:'string-index', helper:`export function check(value:string):boolean {return value[0]==='a';}`, body:result("check('abc')")},
  {id:'schema-field', helper:scalar, schema:input, body:decoded+result('check(input.value)')},
  {id:'guarded-optional', helper:scalar, schema:input, body:decoded+`const value=input.optional;if(value===undefined)return ctx.text('absent');`+result('check(value)')},
  {id:'unguarded-optional', helper:scalar, schema:input, body:decoded+result('check(input.optional)')},
  {id:'record-spread', helper:scalar, schema:input, body:decoded+`const copy={...input,value:'b'};`+result('check(copy.value)')},
  {id:'scalar-record-spread', helper:scalar, body:`let input={value:'a',kind:'example'};input={...input,value:'b'};`+result('check(input.value)')},
  {id:'array-element-field', helper:scalar, schema:input, body:decoded+result('check(input.items[0].value)')},
  {id:'array-element-loop', helper:scalar, schema:input, body:decoded+`let ok=true;for(let i=0;i<4&&i<input.items.length;i++){const row=input.items[i];if(!check(row.value))ok=false;}`+result('ok')},
  {id:'string-array-parameter', helper:`export function check(values:string[]):boolean {return values.length>0;}`, body:result("check(['a'])")},
  {id:'record-array-parameter', helper:`export function check(values:{value:string}[]):boolean {return values.length>0;}`, body:result("check([{value:'a'}])")},
  {id:'nullable-record-parameter', helper:`export function check(value:{label:string|null}):boolean {return value.label!==null;}`, body:result("check({label:'a'})")},
  {id:'structured-return', helper:`export function check(value:string):{value:string} {return {value};}`, body:`const value=check('a');return ctx.text(value.value);`},
  {id:'pure-call-in-loop', helper:scalar, body:`let ok=true;for(let i=0;i<4;i++){if(!check('a'))ok=false;}`+result('ok')},
  {id:'combined-loop-limit', helper:`export function check(value:number):number {let result=value;for(let i=0;i<64;i++){for(let j=0;j<64;j++){result++;}}return result;}`, body:`let sum=0;for(let i=0;i<32;i++){sum+=check(i);}`+result('sum')},
  {id:'read-call-in-loop', helper:`export const check=async(ctx,key:string)=>{const row=await ctx.kv('records').getVersioned(key);return {found:row.status==='found'};};`, body:`let count=0;for(let i=0;i<4;i++){const row=await check(ctx,''+i);if(row.found)count++;}`+result('count')},
  {id:'write-call-in-loop', helper:`export const check=async(ctx,key:string)=>{await ctx.kv('records').put(key,'value');return {found:true};};`, body:`let count=0;for(let i=0;i<4;i++){const row=await check(ctx,''+i);if(row.found)count++;}`+result('count')},
  {id:'generic-record-schema', schema:'Record<string,unknown>', body:`const input=ctx.decodeJson('{}','case.Input');return ctx.text('decoded');`},
  {id:'index-signature-schema', schema:'{[key:string]:unknown}', body:`const input=ctx.decodeJson('{}','case.Input');return ctx.text('decoded');`},
  {id:'json-object-schema', schema:'JsonObject', body:`const input=ctx.decodeJson('{}','case.Input');return ctx.text('decoded');`},
  {id:'nested-json-object-schema', schema:'{properties:JsonObject}', body:`const input=ctx.decodeJson('{"properties":{}}','case.Input');return ctx.text('decoded');`},
];
