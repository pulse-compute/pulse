'use strict';
// Test-only host setup through the trusted lifecycle seam. This runs BEFORE
// service admission and is excluded from the service's accounting claim.
// It creates actual complete/incomplete host entries without changing the
// production reader or adding a production fault-injection option.
module.exports = Object.freeze({point:'request.acquired',owner:'cache-wire-seed',order:1,body:`
const mode=__pulse_fastly_request_header_text('x-cache-seed');
if(mode.length==0)return;
const key=String.UTF8.encode('key'),output=new StaticArray<i32>(1),opts=new StaticArray<u64>(16);
opts[0]=60000000000;
if(__cache_insert(changetype<usize>(key),key.byteLength,0,changetype<usize>(opts),changetype<usize>(output))!=0)unreachable();
const writer=output[0];
const data=mode=='overflow'?'x'.repeat(65):mode=='exact'?'x'.repeat(64):mode=='empty'?'':'é雪😀';
const bytes=String.UTF8.encode(data);if(mode=='invalid')store<u8>(changetype<usize>(bytes),255);
let offset=0;while(offset<bytes.byteLength){if(fastly_http_body_write(writer,changetype<usize>(bytes)+offset,bytes.byteLength-offset,0,changetype<usize>(output))!=0||output[0]<=0||output[0]>bytes.byteLength-offset)unreachable();offset+=output[0];}
if(mode=='trap')unreachable();
if((mode=='abandon'?__cache_abandon(writer):__pulse_fetch_close_body(writer))!=0)unreachable();
`});
