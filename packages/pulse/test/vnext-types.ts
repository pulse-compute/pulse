import { Pulse, defineConfig, type PulseConfigReference, type PulseSecretReference } from '../src/index.js'

const config = defineConfig((scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'dev',
    strict: true,
    reporting: 'info',
    crypto: ['HS256', 'ES256'],
  },
  dev: {
    host: 'node',
    target: 'native',
    reporting: 'debug',
    crypto: {
      HS256: { realization: 'guest-source:pulse-hmac-as' },
      ES256: { realization: 'guest-linked:pulse-es256-rustcrypto-p256' },
    },
    apiBase: scope.config('API_BASE'),
    token: scope.secret('API_TOKEN'),
  },
}))

const declaration = config({
  config: (name) => ({ $config: name }),
  secret: (name) => ({ $secret: name }),
})
const configRef: PulseConfigReference<'API_BASE'> = declaration.dev.apiBase
const secretRef: PulseSecretReference<'API_TOKEN'> = declaration.dev.token
void configRef
void secretRef


const app = new Pulse(config)
app.on<{ readonly id: string }>('user.created', { schema: 'events.UserCreated' }, async (ctx) => {
  ctx.log.info(ctx.event.type)
  ctx.state.set('user-id', ctx.event.payload.id)
})
app.on('system.tick', { schema: null }, async (ctx) => {
  const noPayload: null = ctx.event.payload
  void noPayload
})
app.get('/health', async (ctx) => {
  ctx.log.info('health check')
  return ctx.json({ ok: true })
})
const token = app.profile()
void token
