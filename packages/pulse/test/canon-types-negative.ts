import { Pulse } from '../src/index.js'
import { schema, type ScalarRecord, type JsonObject, type JsonValue } from '../src/schema.js'

// @ts-expect-error object-root dynamic fields do not admit arrays
const objectArray: JsonObject = []
// @ts-expect-error present undefined is not JSON
const undefinedJson: JsonValue = { value: undefined }
// @ts-expect-error functions are not JSON
const functionJson: JsonValue = { value: () => true }
const jsonObject: JsonObject = { nested: [true] }
// @ts-expect-error dynamic properties are immutable
jsonObject.nested = false
const jsonArray: JsonValue = [true]
// @ts-expect-error dynamic arrays are immutable
jsonArray.push(false)
// @ts-expect-error unknown schema limits are rejected
schema<{ data: JsonValue }>({ json: { maxKeys: 32 } })
// @ts-expect-error schema limit values must be numeric
schema<{ data: JsonValue }>({ json: { maxDepth: '32' } })

// @ts-expect-error scalar dictionaries cannot contain nested objects
const nestedAttributes: ScalarRecord = { nested: { value: true } }
// @ts-expect-error scalar dictionaries cannot contain arrays
const arrayAttributes: ScalarRecord = { values: [1] }
// @ts-expect-error present undefined is not a scalar value
const undefinedAttributes: ScalarRecord = { value: undefined }
const scalarAttributes: ScalarRecord = { value: true }
// @ts-expect-error decoded scalar dictionaries are immutable
scalarAttributes.value = false

const app = new Pulse({ auto: true })
// @ts-expect-error lifecycle remains provider-owned
app.listen()
// @ts-expect-error configured profile values are intentionally opaque
app.config()
// @ts-expect-error environment access is symbolic and tooling-owned
app.env
// @ts-expect-error no second public Router instance is exposed
app.router
// @ts-expect-error direct request handling belongs to future JavaScript realization/provider adapters
app.handle(new Request('https://example.test/'))
// @ts-expect-error emit belongs to execution contexts, not the application root
app.emit('system.tick', { schema: null })
// @ts-expect-error event declarations require schema
app.on('event.missing-schema', {}, async () => undefined)
// @ts-expect-error event declarations contain only schema
app.on('event.extra-declaration', { schema: null, extra: true }, async () => undefined)
// @ts-expect-error event declaration schemas are string or null
app.on('event.invalid-schema', { schema: 42 }, async () => undefined)
// @ts-expect-error event handlers are async-shaped
app.on('event.sync-handler', { schema: null }, () => undefined)
app.on('event.no-http-context', { schema: null }, async (ctx) => {
  // @ts-expect-error event contexts do not expose HTTP requests
  ctx.req
  // @ts-expect-error event contexts do not expose response helpers
  return ctx.text('invalid')
})
// @ts-expect-error the opaque token has no readable profile fields
app.profile().host
