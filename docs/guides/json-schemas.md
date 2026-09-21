# Explicit JSON schemas

Schemas are static project declarations, not runtime reflection. The compiler does not execute the registry module. Pulse extracts the default export,
compiles deterministic JavaScript and Native codecs, and binds literal schema
IDs at every structured JSON boundary.

## Declare the registry

<!-- pulse-doc-source: examples/02-request-schema/src/schemas.ts -->
```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'

export interface CreateUserInput {
  name: string
  active: boolean
}

export interface CreateUserOutput {
  id: number
  name: string
  active: boolean
  sameReference: boolean
}

export default defineSchemaRegistry({
  schemas: {
    'app.CreateUserInput': schema<CreateUserInput>(),
    'app.CreateUserOutput': schema<CreateUserOutput>(),
  },
})
```
<!-- /pulse-doc-source -->

The string keys are the contract. TypeScript type names help authoring, but they
are not discovered automatically and do not become runtime schema IDs.

The schema subset is intentionally portable:

- an object root with required or question-mark optional property signatures;
- `string`, `boolean`, and finite JSON `number`;
- `Int32`, `Uint32`, `ScalarRecord`, `JsonValue`, `JsonObject`, and `OpenObject<T>` marker types imported with `import type`;
- nested object types and arrays;
- string-literal enums such as `'admin' | 'member'`;
- one supported type unioned with `null`.

Explicit `undefined` types/unions, recursive or user-defined generic types, interface inheritance,
arbitrary unions, computed registry keys, runtime registry code, and public
`json-as` decorators or imports are not supported. Relative type-only imports
and re-exports can organize the type graph inside the project.

## Optional fields

A question mark permits an absent own property at any object depth, including
objects inside arrays:

```ts
interface Resource {
  id: string
  notes?: string
  owner: { label: string; id?: string }
  locations: { id: string; url?: string; instructions?: string }[]
}
```

Encoding omits absent optional properties; decoding leaves them absent. It does
not insert defaults, empty strings, or nulls. Present empty strings, `false`, zero,
empty objects and arrays remain present when allowed by the declared type.
`notes?: string` rejects null; `notes?: string | null` admits both absence and a
present null, as distinct values. A present `undefined` value is rejected rather
than silently omitted. Inherited properties do not supply schema data, and
accessors are rejected without invoking their getters. Required properties retain
their existing validation. Decoded values remain deeply immutable.

Schema registry IR and codec inputs use v5 to record requiredness, scalar records,
nested JSON, typed open objects and effective JSON limits. Pulse generates Native value projections
for schemas containing optional fields, dynamic JSON or explicit JSON limits,
using its internal `json-as` backend. Other
required-only schemas retain their struct codec.
There is no application decorator, serializer hook, or JavaScript fallback.
The existing semantic cross-target and encoded-byte-bound contracts apply.

## Bounded scalar records

Use `ScalarRecord` for extensible properties inside an otherwise declared object:

```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { ScalarRecord } from '@pulse-compute/pulse/schema'

interface AnalyticsEvent {
  event: string
  context: { source: string }
  properties: ScalarRecord
}

export default defineSchemaRegistry({
  schemas: { 'app.AnalyticsEvent': schema<AnalyticsEvent>() },
})
```

`properties` preserves dynamic string keys. Each value must be a string, finite
number, boolean, or null. Objects, arrays, undefined, functions, and symbols are
invalid inside the record. The surrounding envelope and context retain their
declared-field validation and unknown-field removal. Existing array and nullable
syntax can contain records, for example `samples?: ScalarRecord[]` or
`properties: ScalarRecord | null`. A schema root must still be a declared object.

These fixed limits apply independently to every record on encode and decode:

| Constraint | Limit |
|---|---:|
| Own string keys | 32 |
| Key length | 64 UTF-16 code units |
| String value length | 1,024 UTF-16 code units |
| Conservative JSON byte budget | 8,192 bytes |

The byte budget includes braces, commas, colons, quoted keys and values, and JSON
escaping. It reserves 24 bytes per number and six per control code unit; other
characters use their UTF-8 JSON size, including surrogate escaping. This gives
the same admission rule across target codecs despite different number and escape
spellings. Some records whose actual encoding is under 8 KiB can therefore exceed
the budget. Whitespace in input is excluded from this record budget; the existing
`schemas.maxBytes` limit separately bounds the complete input and encoded output.
These limits are not generic type parameters or profile settings.

Decoding rejects duplicate record keys after JSON unescaping: `"x"` and
`"\u0078"` are the same key. Ordinary declared objects retain last-member-wins
semantics. Encoding a JavaScript object cannot recover duplicates already lost
by a prior `JSON.parse`; pass original text through `ctx.decodeJson` when duplicate
rejection matters.

Decoded records are immutable own data properties. Encoding accepts plain or
null-prototype objects, rejects accessors without invoking them, and rejects
symbol keys and custom prototypes. Keys such as `__proto__` remain data. Records
have deterministic encoding for a fixed target, but key order and number spelling
are not a portable byte-canonicalization contract. Construct a new record when
editing decoded values. TypeScript checks scalar value types and readonly access;
the compiled codecs enforce the numeric and size constraints at runtime.

## Typed open objects

Use `OpenObject<T>` to retain declared fields while admitting bounded extension
properties at the same object level:

```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { OpenObject, JsonObject } from '@pulse-compute/pulse/schema'

type Event = OpenObject<{
  event: string
  properties: JsonObject
  context: OpenObject<{ source: string; note?: string | null }>
  filters?: OpenObject<{ field: string; op: 'eq' | 'in' }>[]
}>

export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>(),
} })
```

The type argument must resolve to a finite declared object. Import aliases,
non-generic local aliases and relative type-only re-exports are supported.
Arrays, primitives, `JsonObject`, `ScalarRecord`, arbitrary index signatures and
recursive types are not valid type arguments. An open object may be the schema
root, a nested field, an array element, or the non-null part of a nullable field.
`OpenObject<{}>` admits an object containing only bounded extension properties.

Declared names always select their declared validators. A missing required
field, an invalid known value or a present `undefined` fails validation; none
can be reclassified as an extension. Optional absence, null and empty values
remain distinct. Extra keys carry `JsonValue`, including objects inside arrays,
and survive decode and encode. Values are detached and deeply immutable. Names
such as `__proto__`, `constructor`, the empty string and numeric-looking keys
are data. Closed nested objects still drop their own undeclared members.

Every name at an open object level must be unique after JSON unescaping,
including declared names and escaped aliases. Dynamic extension subtrees also
reject duplicates. Ordinary closed objects retain last-member-wins. Whole-input
admission counts all occurrences, including overwritten and discarded members,
before schema projection. Open objects use the same defaults, configurable
limits and Native depth ceiling as nested JSON below.

Declared properties are projected first and extras afterward. Cross-target
parity is semantic; property byte order is not a portability guarantee.

## Configurable nested JSON

`JsonValue` admits strings, finite numbers, booleans, null, arrays and objects
recursively. `JsonObject` requires an object at that field's root. Both preserve
admitted nested members and are immutable TypeScript types:

```ts
import { defineSchemaRegistry, schema } from '@pulse-compute/pulse/schema'
import type { JsonObject, JsonValue } from '@pulse-compute/pulse/schema'

interface Event {
  event: string
  context: { source: string }
  properties: JsonObject
  data?: JsonValue
}

export default defineSchemaRegistry({ schemas: {
  'app.Event': schema<Event>({ json: { maxDepth: 64, maxNodes: 8192 } }),
} })
```

The enclosing schema still has a declared object root. Its known fields retain
their validators, requiredness and optionality; undeclared fields in `context`
are dropped. `properties` can contain arbitrary admitted nesting. Arbitrary
recursive TypeScript types and `unknown` are unsupported. `ScalarRecord` keeps
its existing fixed limits.

Import aliases, local type aliases and relative type-only re-exports preserve
marker identity. Options and the nested `json` object must be literal objects;
each supplied limit must be a positive integer literal that fits i32. Spreads,
computed names, getters, variables, calls, unknown settings and overflowing
values are rejected during extraction. The compiler does not execute options.

A schema containing `JsonValue`, `JsonObject` or `OpenObject<T>` uses these defaults. Passing options to
a schema without a marker explicitly selects the same whole-document admission
policy. A schema without markers or options retains its prior admission policy.
Overrides replace individual defaults and become part of schema/codec identity.

| Setting | Default | Meaning |
|---|---:|---|
| `maxTextBytes` | 65,536 | Original input and encoded output UTF-8 bytes, including input whitespace. |
| `maxDepth` | 32 | Container depth across the entire document; its object root has depth one. |
| `maxNodes` | 4,096 | Containers and scalar values across the entire document; keys are not nodes. |
| `maxObjectMembers` | 256 | Members in each object. |
| `maxArrayItems` | 1,024 | Items in each array. |
| `maxKeyLength` | 256 | Decoded UTF-16 code units in each key. |
| `maxStringLength` | 16,384 | Decoded UTF-16 code units in each string value. |
| `maxJsonBytes` | 65,536 | Conservative JSON budget, independently of original text bytes. |

The effective text bound is the smaller of `maxTextBytes` and the profile's
existing `schemas.maxBytes`. Raise both when a larger body is intended. Native
currently supports `maxDepth` through 128 and rejects a larger setting during
compilation with `PULSE_SCHEMA_JSON_DEPTH_UNSUPPORTED`. Fastly generates parser
and serializer capacity to accommodate the selected policy, including depths
above its former 64-level implementation limit. Settings are never silently
clamped. An explicitly selected JavaScript target does not use that Native ceiling.

Admission scans complete text before eager parsing or Fastly value-handle
creation. Discarded fields and overwritten values still consume depth, node,
member, string and byte budgets. The conservative budget includes punctuation
and escaping, reserves 24 bytes per finite number and six per control code unit,
and uses UTF-8 size for other characters with surrogate escaping. It can reject
text whose actual wire encoding is smaller. Whitespace consumes `maxTextBytes`
but not `maxJsonBytes`.

Duplicate names are compared after JSON unescaping. Dynamic JSON rejects
duplicates at every nested depth. Open objects reject all duplicate names at
their own level. Closed declared objects retain last-member-wins:
only their selected final field values undergo the dynamic duplicate policy,
while every original occurrence consumes admission budget. JSON already parsed
by application code cannot reveal lost duplicates; use original text with
`ctx.decodeJson` when this matters. Keys such as `__proto__`, `constructor`, empty
strings and numeric-looking names remain ordinary JSON data.

The policy applies to request JSON, fetched JSON, application text decode,
responses, application text encode and outbound fetch JSON. JavaScript encode
accepts enumerable own data properties of plain/null-prototype objects and
dense ordinary arrays. It rejects cycles, present undefined, non-finite numbers,
accessors, serialization hooks, symbol keys and custom prototypes without
invoking getters or hooks. It returns detached, deeply frozen projections and
counts a shared reference at each occurrence. As with ordinary JavaScript,
own-key enumeration and arbitrary Proxy traps are not a VM allocation sandbox.

Invalid outbound JSON fails before a send on every supported lane. Node uses
the existing malformed-JSON, schema encode/decode and body-too-large error
categories; Fastly retains its JSON/schema error categories and stage details.
Native guest codec exports trap on invalid input. Field order, whitespace and
number spelling are not a portable byte-canonicalization contract.

## Add semantic response cases

A response case gives one stable ID both a status and an already registered
schema:

```ts
import {
  defineSchemaRegistry,
  response,
  schema,
} from '@pulse-compute/pulse/schema'
import type { ApiError, CreateUserInput, User } from './models.js'

export default defineSchemaRegistry({
  schemas: {
    'app.CreateUserInput': schema<CreateUserInput>(),
    'app.User': schema<User>(),
    'app.ApiError': schema<ApiError>(),
  },
  responses: {
    'user.created': response(201, 'app.User'),
    'user.failure': response(400, 'app.ApiError'),
  },
})
```

The response status and schema ID must be static literals. A response case
cannot refer to an undeclared schema.

## Point project configuration at the registry

<!-- pulse-doc-source: examples/02-request-schema/.pulse/config.ts -->
```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    schema: 'src/schemas.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    schemas: { contentTypePolicy: 'require-json', maxBytes: 1024 },
  },
}))
```
<!-- /pulse-doc-source -->

`pulse.schema` owns the registry module. Do not also declare schema identity
under a provider profile. Provider profiles own decode policy through
`schemas.contentTypePolicy` and `schemas.maxBytes`:

- `schemas.contentTypePolicy: 'accept-json-or-missing'` accepts JSON content
  types and absent content types; it is the default;
- `schemas.contentTypePolicy: 'require-json'` requires a JSON content type for
  request and fetched-body schema decode;
- `schemas.maxBytes` bounds structured schema decode and defaults to `65_536`
  bytes;
- `dev.maxBodyBytes` separately bounds incoming requests in the local
  development server and also defaults to `65_536` bytes.

Raise either byte limit deliberately. They are memory and request-amplification
boundaries, not convenience settings.

## Bind every JSON boundary

<!-- pulse-doc-source: examples/02-request-schema/src/index.ts -->
```ts
import { Pulse } from '@pulse-compute/pulse'
import type { CreateUserInput, CreateUserOutput } from './schemas.js'

const app = new Pulse({ auto: true })

app.post('/users', async (ctx) => {
  const first = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const second = await ctx.req.json<CreateUserInput>('app.CreateUserInput')
  const output: CreateUserOutput = {
    id: 7,
    name: first.name,
    active: first.active,
    sameReference: first === second,
  }
  return ctx.json(output, { status: 201, schema: 'app.CreateUserOutput' })
})

export default app
```
<!-- /pulse-doc-source -->

The schema-boundary forms are:

| Boundary | Authoring form | Operation |
|---|---|---|
| Incoming request | `await ctx.req.json<T>('app.Input')` | Decode |
| Fetched response | `await ctx.fetch(url).json<T>('app.Output')` | Decode |
| Outbound fetch body | `ctx.fetch(url, { json: value, schema: 'app.Input' })` | Encode |
| Application response | `ctx.json(value, { schema: 'app.Output' })` | Encode |
| Application-owned text | `ctx.encodeJson(value, 'app.Output')` | Encode |
| Application-owned text | `ctx.decodeJson<T>(text, 'app.Input')` | Decode |

A registered response case is shorthand for response status plus schema:

```ts
return ctx.json(user, 'user.created')
```

IDs must be string literals. An outbound `schema` property is valid only with
the semantic `json` property; a raw string `body` and `json` are mutually
exclusive.

## Encode application-owned text

`ctx.encodeJson(value, 'app.Candidate')` synchronously validates and projects a
value through a compiled schema and returns JSON text. The schema ID is required
and must be a declared string literal, including when `pulse.strict` is false.
This operation is available on the shared HTTP/event context; it does not
suspend, dispatch an effect, or construct an HTTP response.

```ts
const text = ctx.encodeJson(candidate, 'app.Candidate')
```

Use the returned string when an application must prepare exact bytes before a
storage write. Encoding requires every required field, preserves optional-property absence, omits unknown fields
recursively, preserves array order, and emits object fields in schema declaration
order. The returned string is detached from later changes to the source value.
Finite numbers, nullable fields and enums follow the existing schema contract.
No replacer, `toJSON` hook, runtime schema inference or generic serializer is
invoked through this API.

The UTF-8 size of the encoded output, including JSON escaping, must not exceed
`schemas.maxBytes` (default `65_536`). Oversized output fails with
`PULSE_BODY_TOO_LARGE`; invalid values fail with `PULSE_SCHEMA_ENCODE` before a
subsequent effect can dispatch. A Node semantic trace records `json.encode.value`
or `json.encode.error` at the `application-value` boundary. Fastly Native uses
its existing schema error category and stage diagnostics.

Encoding is deterministic for a fixed schema, value and target codec. The
cross-target contract is semantic equivalence; this is not an RFC 8785
canonicalization API, and numeric spellings can differ between codecs. For
content hashes, preserve and hash the returned bytes instead of decoding and
re-encoding them. An application needing a portable command fingerprint must
specify and version its own canonical representation.

## Decode application-owned text

`ctx.decodeJson<T>(text, 'app.Candidate')` synchronously decodes an existing
string through a compiled schema. Use it to validate an object read with
`s3.getText`, or another application-owned JSON string. The schema ID must be a
declared literal in both strict and non-strict mode; the TypeScript parameter
does not register or select a schema.

```ts
const stored = await s3.getText(ctx, 'objects', 'candidate.json')
if (stored.status !== 'found') return ctx.text('object unavailable', { status: 502 })
const candidate = ctx.decodeJson<Candidate>(stored.text, 'app.Candidate')
```

The input must be a string. Its complete UTF-8 length, including whitespace and
unknown fields, is bounded by `schemas.maxBytes` before parsing. There is no
HTTP content type at this boundary, so `schemas.contentTypePolicy` does not
apply. The operation is shared by HTTP and event contexts and dispatches no
effect. It returns a new, deeply immutable value on each call; unknown fields
are dropped recursively and required, nullable, enum and numeric rules are the
same as other schema boundaries.

JSON member names are unescaped before matching. In ordinary declared objects,
the last occurrence of a duplicate member wins before schema validation.
`ScalarRecord` and nested dynamic JSON instead reject duplicate keys after unescaping. This API
does not normalize Unicode for a command fingerprint. Malformed JSON fails with
`PULSE_SCHEMA_JSON_MALFORMED`, invalid values with `PULSE_SCHEMA_DECODE`, and
oversized input with `PULSE_BODY_TOO_LARGE` on Node. Node semantic traces use
`json.decode.text` or `json.decode.error` at `application-text`. Fastly Native
retains its JSON/schema error categories and stage diagnostics; application
error-response parity is separate work.

Preserve `stored.text` when checking a content hash, copying an immutable
artifact or retrying a prepared write. The decoder does not alter that string,
but encoding its returned value can change field order, whitespace, numeric
spelling and unknown fields. A valid schema proves the decoded shape; it does
not prove an object's authenticity, history linkage or acceptance by KV.

## Understand strict mode

`pulse.strict` defaults to `true`. When the project declares schemas, strict
mode requires a schema ID for request JSON, fetched-response JSON, outbound
fetch JSON, and application JSON responses. A response may use either a literal
`schema` descriptor or a registered response-case ID.

Setting `pulse.strict: false` allows schema-less generic JSON at reachable
request and fetch-response reads and at JSON encode boundaries. It does not
make an unknown ID valid: supplying an ID always requests that exact compiled
codec. Pulse does not try schemas in sequence, infer a codec from the value, or
fall back to generic JSON when an ID is missing from the registry.

Generic JSON remains bounded and appears as an explicit host-generic JSON
capability in Native inspection. It is a deliberate compatibility choice, not
automatic JavaScript fallback.

## Know the value semantics

Schema decoding and encoding are semantic boundaries, not thin calls to a
provider JSON object:

- input values are validated, normalized, deeply immutable, and owned by the
  request after decode;
- repeated request reads of the same schema reuse the request-local decoded
  value;
- unknown fields of closed declared objects are removed recursively; `OpenObject<T>`, `ScalarRecord`, `JsonObject` and `JsonValue` preserve their admitted dynamic keys;
- declared fields are required unless marked optional with `?`;
- response and fetch encoding projects declared object fields in declaration order, followed by admitted open-object extras;
- numeric values must be finite JSON numbers;
- JavaScript and Native use the same registry contract and semantic trace.

The provider never exposes an SDK request or response object to the handler.
Opaque bodies are not eligible for schema decode; see
[Structured and opaque bodies](../concepts/bodies.md).

## Inspect and diagnose the contract

The CLI compiles the registry and direct codecs with the handler. `doctor`,
`inspect`, `test`, `dev`, and `build` consume the same project output.

```bash
pulse inspect examples/02-request-schema --json
```

Check `schemas.authority`, `schemas.ids`, `schemas.responseCases`, and
`schemas.codecRealization`, then review the compiler’s schema references and
provider requirements. The packaged Native build carries the generated schema
registry and codecs; it does not execute TypeScript or a JavaScript schema
library at request time.

Dynamic IDs, missing declarations, duplicate IDs, unsupported field shapes,
invalid values, content-type violations, and oversized bodies fail explicitly.
Common diagnostics include:

- [`PULSE_SCHEMA_DECODE`](../reference/diagnostics.md#pulse-schema-decode);
- [`PULSE_SCHEMA_ENCODE`](../reference/diagnostics.md#pulse-schema-encode);
- [`PULSE_RESPONSE_ENCODE`](../reference/diagnostics.md#pulse-response-encode);
- [`PULSE_BODY_TOO_LARGE`](../reference/diagnostics.md#pulse-body-too-large);
- `PULSE_SCHEMA_REQUIRED`;
- `PULSE_CANONICAL_SCHEMA_MISSING`;
- `PULSE_RESPONSE_CASE_MISSING`.

## Related documentation

- [Structured and opaque bodies](../concepts/bodies.md)
- [Project configuration](../reference/project-config.md)
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Canonical API](../../API.md)
