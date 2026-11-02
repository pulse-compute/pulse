# P10/P13 — Installed and ABI qualification

RC item 06; base `latest` at `0de37963b625143fb0227e8d449d5e95eda3ebb7`.
Human direction: “Implement 06”, with PRs against `latest` approved.
No single Entry Point covers the work. The ordinary root, Wasm and documentation
instructions apply. Additional release owner scope is the mandatory installed
feature list and its existing evidence task mapping. GitHub automation scope is
the credential-free Ubuntu local qualification workflow, using reviewed action pins. No package, ABI, import
permission, runtime placement, provider or support tier is added.

The implementation lives in `wasm/test/qualification/terminal`. `terminal-installed`
is a mandatory installed feature gate, separate from aggregate profiles. It
uses ordinary release build/pack and a temporary consumer outside the checkout.
Every candidate package is installed from its exact tarball through the existing
read-only registry fixture. The supervisor checks all installed package files
against those tarballs before and after replay. The worker resolves product code
from that installation and retains the exact Wasm and report capsules.

The separately packed `@independent/rc-terminal@91.7.3` uses ordinary reachable
package discovery and the frozen terminal service. Its name/version are not
registered in core. It exercises the Fanout ABI; it is not another capability.

| Fixture | Installed | Local transport | Scoped hosted transport |
| --- | --- | --- | --- |
| GRIP Fanout, plain handler | Build/report, injected outcomes | Ordinary branch, handoff, hold/publish | Same three checks |
| GRIP WebSocket, plain handler | Build/report, injected outcomes | Ordinary branch, handoff, upgrade and two echoed frames | Same three checks |
| Both GRIP operations, bounded Router | Build/report, injected outcomes | Same checks with ordinary sibling route | Same checks |
| Independent package | Build/report, exact npm version, injected outcomes | Ordinary branch, handoff, hold/publish | Same three checks |
| Absent / unused / existing generic GRIP | Build/report, no terminal imports | Not a terminal transport claim | Not a terminal transport claim |
| Unsupported placement / target | Rejection before artifact admission | Not executed | Not executed |

Injected success, nonzero status, dispatch trap and cleanup failure observations
are in `injected.json`. They never satisfy local or hosted transport coverage.
Existing lifecycle tests remain the authority for forged/stale tickets, deadline
fences and primary-error preservation. This task does not replace those tests.
Report runtime coverage remains unavailable: network replay does not rewrite the
build capsule to imply that a runtime observer was attached.

## Commands and retained evidence

Use the repository-pinned Node and pnpm versions and a clean committed checkout.
All evidence directories must be fresh; preserve failed attempts separately.

```sh
node wasm/test/qualification/terminal/installed.cjs /absolute/fresh/bundle
python3 wasm/test/qualification/terminal/install-engines.py /absolute/engines
node wasm/test/qualification/terminal/local.cjs /absolute/fresh/bundle /absolute/engines/viceroy/viceroy /absolute/engines/pushpin /absolute/fresh/local.json
node wasm/test/qualification/terminal/hosted.cjs /absolute/fresh/bundle /absolute/scoped-config.json /absolute/fresh/hosted.json
node wasm/test/qualification/terminal/verify.cjs /absolute/fresh/bundle /absolute/fresh/local.json /absolute/fresh/hosted.json /absolute/fresh/qualification.json
```

`engines.json` pins Viceroy 0.18.0 and Pushpin 1.42.0 by archive and executable
hash, with the extracted Ubuntu Noble Qt dependency archives. Other system
libraries are provided by the Linux amd64 runner. The installer extracts files;
it does not install or activate a system service. The local runner verifies all
four Pushpin executable hashes, starts isolated process groups on loopback,
uses random channels, requires all 15 cells, and cleans up processes and sockets.
Missing engines are a failure, never a reduced passing matrix. These pins qualify
these engines only, with no claim about newer engine behavior.

`installed.json` binds the clean Git revision/tree, candidate package hashes,
independent package hash, eight Wasm/report pairs and injected receipt. Local and
hosted receipts bind that installed receipt hash and each executed Wasm hash.
`verify.cjs` checks complete exact coverage, pins, cleanup and deployment package
identity. Tampered artifacts, mixed bundles, missing/duplicate cells and injected
receipts supplied as transport observations fail. Receipts are reproducible test
evidence, not signed attestations. Any candidate change requires affected replay
under the existing recovery/requalification rules; this is not a release seal.

## Scoped hosted prerequisites

Hosted execution requires operator-supplied **already active** test service
versions, each containing one of the five exact retained Wasm files, and an
existing backend named `terminal_origin`. An operator must prepare/activate those
services under separate deployment authority. The harness never uploads a
package, changes a backend, enables Fanout or activates a version.

The backend must reach the bounded `origin.cjs` fixture (loopback listener,
operator-owned ingress), which returns `terminal-origin`, echoes short WebSocket
frames, and uses the `x-pulse-terminal-hold` value as its GRIP hold channel.
Only random `pulse-terminal-` channels are published by this runner. Configure
`FASTLY_API_TOKEN` through the environment; never put it in the config or receipt.

The scoped JSON has version `pulse.terminal-hosted-config.v1`, a `cli` object
with `file`, exact `version` output and executable `sha256`, and `cases` with one
entry for each installed terminal fixture ID. Each entry supplies `id`, `url`
(an HTTPS origin), `serviceId`, integer `serviceVersion`, `package` (the exact
local Compute archive), and `filesHash` (Fastly SHA-512 files hash). The runner
checks the archive's `bin/main.wasm` against the installed artifact, derives the
files hash using the pinned Fastly CLI `compute hash-files --skip-build`, then
checks active version/package metadata before and after traffic. No service
credential is sent to fixture URLs. Preserve the configuration and CLI pin with
operator evidence; configuration hashes in receipts detect accidental mismatch.

Fastly references: [package metadata API](https://www.fastly.com/documentation/reference/api/services/package/),
[Compute files hash](https://www.fastly.com/documentation/reference/cli/compute/hash-files/),
and [Fanout publishing](https://www.fastly.com/documentation/reference/api/publishing/).

The implementation environment rejects Pushpin IPC startup (`Operation not
permitted`), and disallows `ptrace` diagnostics. That local attempt records failure
with zero transport cells and complete cleanup. The credential-free
`Terminal local qualification` workflow runs the same installed and transport
commands on Ubuntu 24.04 and uploads the complete bundle for subsequent hosted
replay. A workflow launch is not a passing receipt.

At implementation time this environment has no scoped Fastly configuration or
credential. Hosted acceptance is therefore **not run**. Item 06 cannot be marked
fully qualified until its hosted receipt passes against the same installed
bundle. Items 07 (independent review) and 08 (freeze/seal) remain separate.
