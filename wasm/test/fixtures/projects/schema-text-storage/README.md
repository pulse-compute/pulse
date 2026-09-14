# Decode stored schema text and preserve its exact bytes

Public Pulse/schema/S3 consumer for the application-text decode boundary.
It reads stored text, validates a registered schema, and writes the exact
original text to a separate fixture key. Reordered fields, whitespace, unknown
fields, escaping and Unicode remain in the copied bytes; both S3 digests must
match. Fixtures and credentials are synthetic. No acceptance transaction is
implemented.

Run against one exact local packed candidate set, including all Pulse dependencies:

```sh
pulse test --profile local --json
pulse test --profile javascript --json
pulse test --profile fastly --json
pulse build --profile local --json
pulse build --profile javascript --json
pulse build --profile fastly --json
```

Each profile must pass all three cases. Fastly tests use the local injected ABI
fixture and builds verify the Wasm artifact; neither proves deployed behavior.
The schema-codecs task additionally covers malformed, oversized and invalid text,
immutable results, compile-time schema admission and failure before effects.
