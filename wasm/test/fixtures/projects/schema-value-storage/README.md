# Schema encoding before object storage

Minimal consumer of public Pulse, schema and S3 package roots, derived from the
candidate preparation reproduction. Every JSON boundary uses a declared schema
with `pulse.strict: true`. No business routes or acceptance transaction are
implemented here. Credentials and the `.invalid` endpoint are fixtures only.

Run from a clean consumer containing these files and the exact candidate
release tarballs (including their Pulse dependency closure):

```sh
pulse test --profile local --json
pulse test --profile javascript --json
pulse test --profile fastly --json
pulse build --profile local --json
pulse build --profile javascript --json
pulse build --profile fastly --json
```

Each profile must pass all three cases with the expected text, UTF-8 byte length
and SHA-256. The Fastly test is injected-host evidence; its build verifies the
provider Wasm artifact. Neither constitutes deployed-provider acceptance.
