import { jwt } from '@pulse-compute/jwt'

export default async function handler(ctx) {
  const verified = await jwt.verify(ctx, jwt.bearer(ctx.req), {
    algorithms: ['ES256'],
    key: {
      type: 'jwk',
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: 'YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y',
        y: 'eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk',
        alg: 'ES256',
        use: 'sig',
        key_ops: ['verify'],
        kid: 'g3-key',
      },
    },
  })
  return ctx.text(verified.claims.sub + ':' + verified.protectedHeader.alg)
}
