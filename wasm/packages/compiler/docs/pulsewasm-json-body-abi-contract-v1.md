# PulseWasm JSON / Body ABI Contract v1

## Core rule

JSON is a payload feature, not a routing feature.

The routing core never reads or parses a request body during dispatch. Handlers must explicitly request body or JSON parsing through ABI helpers.

## Targets

```ts
type PulseJsonTarget = "generic" | "schema" | "none"
```

Default:

```ts
json: { target: "generic" }
```

If omitted, `generic` is selected and the build records `PULSEWASM_JSON_GENERIC_DEFAULT`.

## Body policy

- request body: lazy/deferred
- response body: text, empty, and JSON text helper
- binary: reserved

## ABI helpers

```ts
pulse_request_body_text(ctxRef) -> StringRef
pulse_request_body_len(ctxRef) -> i32
pulse_request_json_parse(ctxRef) -> JsonParseResultRef
pulse_json_result_ok(resultRef) -> i32
pulse_json_result_value(resultRef) -> JsonValueRef
pulse_json_result_error(resultRef) -> ErrorRef
pulse_result_json_text(ctxRef, statusCode, jsonPtr, jsonLen) -> void
```

## Parse errors

Invalid JSON:

```text
PULSEWASM_JSON_PARSE_ERROR
statusCode: 400
```

Too large:

```text
PULSEWASM_JSON_BODY_TOO_LARGE
statusCode: 413
```

Default max bytes:

```text
1,048,576
```

## Future schema lane

The schema lane is separate future tooling:

```bash
pulse json compile --source ./src/types.ts --type CreateUserBody
```

Phase 10F reserves this target and records it, but does not generate schema parsers.
