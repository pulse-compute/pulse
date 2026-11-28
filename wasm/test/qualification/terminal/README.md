# Terminal transport qualification

`prepare.cjs` builds an installed candidate bundle outside the checkout. Local
and hosted transport checks consume those exact artifacts; injected ABI results
alone do not establish real transport behavior.

## Local transport

Use the pinned Node version from the release manifest and restore the workspace
build dependencies. On Ubuntu 24.04, the system-library list and exact engine
installer invocation are maintained in
[the terminal workflow](../../../../.github/workflows/terminal-qualification.yml).
The host must permit Pushpin's IPC and network sockets. Missing libraries or
socket permissions are environment failures, not skipped passing cells.

```sh
python3 wasm/test/qualification/terminal/install-engines.py /tmp/terminal-engines
node wasm/test/qualification/terminal/prepare.cjs /tmp/fresh-terminal-bundle
node wasm/test/qualification/terminal/local.cjs /tmp/fresh-terminal-bundle /tmp/terminal-engines/viceroy/viceroy /tmp/terminal-engines/pushpin /tmp/fresh-local.json
```

Use fresh output paths for each attempt and retain failed receipts. The matrix
checks ordinary response, terminal handoff and either bidirectional WebSocket
or GRIP hold/publish across five artifacts (15 cells), then checks cleanup.

## Hosted transport

`hosted.cjs` does not provision, enable products, upload packages or activate
services. Its explicit config supplies five isolated active fixture versions,
matching domains, package archives, verified Fastly files hashes and pinned CLI
identity. The controlled origin must implement `origin.cjs`: HTTP response,
WebSocket two-frame echo and GRIP hold/channel behavior. Bind it as
`terminal_origin` on each fixture service. Use existing authorized QA resources
or obtain the necessary deployment direction; never discover and mutate an
unrelated service automatically.

With `FASTLY_API_TOKEN` supplied privately, the runner performs read-only
identity checks and bounded traffic, including the scoped Fanout publish calls:

```sh
node wasm/test/qualification/terminal/hosted.cjs /tmp/fresh-terminal-bundle /private/hosted-config.json /tmp/fresh-hosted.json
node wasm/test/qualification/terminal/verify.cjs /tmp/fresh-terminal-bundle /tmp/fresh-local.json /tmp/fresh-hosted.json /tmp/qualification.json
```

Both receipts must reference the same installed bundle and pass complete
coverage. Hosted `cleanup: true` concerns runner-owned activity, not retirement
of externally provisioned services: retain a separate owner-scoped deployment
cleanup receipt. Do not reuse historical hosted results for a new source.

Hosted `holds` entries retain monotonic offsets for request settlement and publish
start/completion, the response classification, and publish HTTP status. A pending
client request does not prove the gateway has subscribed; publish HTTP success
does not prove delivery. A `hold-timeout` records the origin's HTTP 200
`timed-out` fallback separately from a rejected request or a request-deadline
504. The runner still publishes once after the existing one-second pending
check, requires the exact published body, and retains failed attempts. These
client-side phases cannot by themselves attribute delay to the provider.

The [RC-H04 checkpoint](../../release/rc-h04/README.md) records a concrete
sandbox socket failure and distinguishes the outstanding deployed inputs from
credential availability. The existing CI lane can run this local matrix on
its own exact candidate; it does not run hosted tests or waive deployed K4.
