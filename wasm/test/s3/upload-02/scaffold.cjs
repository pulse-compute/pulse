'use strict';
// Existing putText only supplies a compiler/continuation scaffold, not upload admission.
const source = `import {Pulse} from '@pulse-compute/pulse'; import {s3} from '@pulse-compute/s3';
const app=new Pulse({auto:true}); app.post('/',async ctx=>{
  const permission=await ctx.secret.get('AUTHORIZE');
  if(permission!=='allowed') return ctx.text('denied',{status:403});
  const key=ctx.req.header('x-object-key');
  const result=await s3.putText(ctx,'objects',key,'',{contentType:'application/octet-stream'});
  if(result.status==='stored') return ctx.text('stored:'+result.byteLength);
  return ctx.text(result.status);
}); export default app;`;
module.exports={source};
