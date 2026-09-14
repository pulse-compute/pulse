# Targets and host work

Pulse is centered on one application contract. A host is the explicit
realization layer for that contract, not an object application code imports or
branches on. The release distinguishes current execution proof from forward
host work so architectural direction does not become an accidental support
claim.

An explicit JavaScript profile can retain resolved static package imports and
project-relative helpers, including awaited calls into ordinary JavaScript
dependencies. Pulse checks the canonical application surface and packages its
original source graph. Native eligibility is reported separately and does not
block JavaScript execution. Unsupported dynamic module boundaries and missing
`await` on Pulse effects still fail validation. `pulse compile` continues to
require Native-compatible source; use `pulse build` for a JavaScript package.

## Current Beta targets

`1.0.0-beta.3` exercises four explicit modes through one conformance corpus:

| Host | Target | Current release status | Build shape |
|---|---|---|---|
| Node | Native | Beta candidate | Provider-neutral application Wasm with the Node host runtime. |
| Node | JavaScript | Beta candidate | Explicit Node JavaScript source package. |
| Fastly | Native | Beta candidate | Provider-neutral application Wasm plus deployable `bin/main.wasm`. |
| Fastly | JavaScript | Beta candidate | Explicit Fastly JavaScript package. |

Target selection is part of the active project profile. Pulse does not switch
targets automatically when source crosses a Native boundary. The
[compatibility matrix](../reference/compatibility-matrix.md) owns exact
capability differences, and [Beta scope](../preview-scope.md) owns the release
claim.

The `none` selector is compile-only: it can inspect and emit canonical Native
artifacts without claiming an executable host.

## Forward boundary witnesses

Forward hosts are useful because they pressure the contract in different ways.
They remain outside the Beta execution matrix until they have their own
adapter, lifecycle, conformance evidence, and package claim.

### ESP32

The [ESP32 reference host](https://github.com/pulsecompute/pulse-esp32-host)
tests whether the event/effect/continuation model remains useful without a
JavaScript fallback, abundant memory, or an HTTP-centered lifecycle. It is a
boundary witness, not a `1.0.0-beta.3` provider or compatibility promise. The
[architecture vision](../architecture/vision.md#esp32-as-a-boundary-witness)
describes the intended host-owned interrupt queue and non-reentrant Wasm entry.

### Browser event conformance

The browser is a forward event-conformance target: a future browser host should
accept the same canonical event frames, keep HTTP and event entries separate,
preserve invocation-local state, and report outbound frame acceptance through
the same bounded contract. Pulse does not currently claim a browser runtime,
provider package, listener, delivery service, or event transport.

This is deliberately narrower than saying “Pulse runs in the browser.” The
[events guide](../guides/events.md) defines the current Node reference boundary
and the evidence a new host must supply.

## Where provider details belong

Application docs lead with `ctx`, Router, schemas, and capabilities. Provider
details belong in project profiles, deployment guides, compatibility tables,
and package pages where build or runtime behavior actually differs. That keeps
the common surface readable while leaving each host’s authority and limits
explicit.
