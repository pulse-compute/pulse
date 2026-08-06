import type { UserView } from '../types/user.js'

export async function auditApi(ctx, next) {
  ctx.state.set('scope', 'api')
  return next()
}

export async function getUser(ctx) {
  const version = await ctx.config.get('APP_VERSION')
  const body: UserView = { id: ctx.param('id'), version }
  return ctx.json(body)
}

export async function listUsers(ctx) {
  return ctx.json({ scope: ctx.state.get('scope'), users: [] })
}
