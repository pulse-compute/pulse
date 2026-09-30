import {Pulse} from '@pulse-compute/pulse';
import {lookup} from './lookup';
const app=new Pulse({auto:true});
app.get('/lookup/0',async(ctx)=>{const result=await lookup(ctx,ctx.req.header('x-owner')||'owner',ctx.req.header('x-root')||'',0,ctx.req.header('x-key')||'key');if(result.code!=='')return ctx.text(result.code,{status:result.status});return ctx.text('after:'+result.value);});
export default app;
