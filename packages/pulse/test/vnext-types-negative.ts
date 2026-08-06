import { Pulse, defineConfig } from '../src/index.js'

const app = new Pulse({ auto: true })
// @ts-expect-error event handler completion is void
app.on('event.response', { schema: null }, async () => ({ status: 200 }))
// @ts-expect-error schema-bound event declarations require a string schema ID at the type surface
app.on('event.schema', { schema: undefined }, async () => undefined)
// @ts-expect-error Pulse shares Router's async-shaped route contract
app.get('/sync', (ctx) => ctx.json({ ok: false }))

// @ts-expect-error configuration factories are synchronous and return a project declaration directly
defineConfig(async (scope) => ({
  pulse: { defaultProfile: 'dev' },
  dev: { host: 'node', target: 'native', value: scope.config('VALUE') },
}))

// @ts-expect-error reporting is a fixed flat level
defineConfig(() => ({ pulse: { defaultProfile: 'dev', reporting: 'verbose' }, dev: { host: 'node', target: 'native' } }))

// @ts-expect-error crypto supports canonical algorithm identifiers only
defineConfig(() => ({ pulse: { defaultProfile: 'dev', crypto: ['hs256'] }, dev: { host: 'node', target: 'native' } }))

// @ts-expect-error realization pins must be exact known realization identifiers
defineConfig(() => ({ pulse: { defaultProfile: 'dev' }, dev: { host: 'node', target: 'native', crypto: { HS256: { realization: 'webcrypto' } } } }))
