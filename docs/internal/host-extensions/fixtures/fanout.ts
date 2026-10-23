import { grip } from '@pulse-compute/grip'
export default async function handler(ctx) {
  if (ctx.req.path === '/fanout') return grip.handoffFanout('fanout')
  return ctx.text('ordinary response')
}
