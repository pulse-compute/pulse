export default async function handler(ctx) {
  const mode = ctx.req.header('x-mode')
  if (mode === 'construct') {
    const resource = {id:'r1',owner:{type:'individual',label:'Owner'},locations:[{id:'main',kind:'docs',primary:false}]}
    return ctx.text(ctx.encodeJson(resource,'app.Resource'))
  }
  if (mode === 'undefined') {
    const resource = {id:'r1',notes:undefined,owner:{type:'individual',label:'Owner'},locations:[]}
    return ctx.text(ctx.encodeJson(resource,'app.Resource'))
  }
  if (mode === 'request') {
    const resource = await ctx.req.json('app.Resource')
    return ctx.json(resource,{schema:'app.Resource'})
  }
  const text = await ctx.req.text()
  const resource = ctx.decodeJson(text,'app.Resource')
  if (mode === 'presence') return ctx.text(resource.notes === undefined ? 'absent' : 'present')
  if (mode === 'expand') {
    const updated = {...resource,notes:resource.notes+resource.notes}
    const encoded = ctx.encodeJson(updated,'app.Resource')
    const sent = await ctx.fetch('https://objects.invalid/resource',{method:'POST',body:encoded})
    return ctx.text('sent')
  }
  if (mode === 'edit') {
    const updated = {...resource,notes:'Third accepted command'}
    return ctx.text(ctx.encodeJson(updated,'app.Resource'))
  }
  if (mode === 'preserve') {
    const updated = {...resource,id:'r2'}
    return ctx.text(ctx.encodeJson(updated,'app.Resource'))
  }
  if (mode === 'response') return ctx.json(resource,{schema:'app.Resource'})
  if (mode === 'outbound') {
    const sent = await ctx.fetch('https://objects.invalid/resource',{method:'POST',json:resource,schema:'app.Resource'})
    return ctx.text('sent')
  }
  return ctx.text(ctx.encodeJson(resource,'app.Resource'))
}
