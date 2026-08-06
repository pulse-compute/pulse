# Fastly Compute reality fixture

This project is the external Fastly reality fixture. Its user code remains provider-neutral while the generated artifact crosses the complete native Fastly boundary:

- explicit JSON-schema request, origin, and response codecs;
- Config Store, Secret Store, and KV operations;
- a named Fastly backend;
- opaque binary response pass-through with repeated headers;
- package-owned `grip.channel`, `grip.hold`, and `grip.publish` lowering.

The strict reality test compiles `bin/main.wasm`, writes a Fastly `local_server` configuration, and makes real HTTP requests through an inspected local Compute engine. It accepts either the Fastly CLI on `PATH`/`PULSE_FASTLY_BIN` or a direct Viceroy executable selected with `PULSE_VICEROY_BIN`. The proof records which launcher and binary were used.

This fixture proves local host-ABI compatibility. It does not deploy or activate a Fastly service.
