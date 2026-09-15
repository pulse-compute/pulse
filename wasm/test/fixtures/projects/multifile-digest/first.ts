import {crypto} from '@pulse-compute/crypto'
import type {PulseContext} from '@pulse-compute/runtime'
const first=async(ctx:PulseContext)=>{const raw=await ctx.req.text();const result=await crypto.digestText(ctx,raw);return ctx.text(result.status)};export default first;
