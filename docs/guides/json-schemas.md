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

- an object root with required property signatures;
- `string`, `boolean`, and finite JSON `number`;
- `Int32` and `Uint32` marker types imported with `import type`;
- nested object types and arrays;
- string-literal enums such as `'admin' | 'member'`;
- one supported type unioned with `null`.

Optional fields, `undefined`, recursive or generic types, interface inheritance,
arbitrary unions, computed registry keys, runtime registry code, and public
`json-as` decorators or imports are not supported. Relative type-only imports
and re-exports can organize the type graph inside the project.

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
storage write. Encoding requires every declared field, omits unknown fields
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

JSON member names are unescaped before matching. As with the existing JSON
decoders, the last occurrence of a duplicate member wins before schema
validation. This API does not impose a duplicate-rejection policy or normalize
Unicode for a command fingerprint. Malformed JSON fails with
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
- unknown input fields are removed recursively;
- every declared field is required;
- response and fetch encoding emits declared fields only, in declaration order;
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
