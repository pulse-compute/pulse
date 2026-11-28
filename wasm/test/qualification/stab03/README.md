# STAB-03 composed installed consumer

This standalone qualification installs all exact candidate tarballs outside the
checkout and composes ingress HMAC proof, independent RS256 Bearer verification,
host-backed assets, conditional command acceptance, a projection worker, and
explicit replay after a committed write loses its acknowledgement. No application
or production credentials are used. Fresh test keys exist only in memory; the
public JWK is an application build input.

Run from a **clean committed checkout** with the lockfile-pinned toolchain:

```sh
node wasm/scripts/run-wasm-tests.cjs --task stab03-installed --no-report
```

Or select a fresh evidence directory outside the checkout:

```sh
node wasm/test/qualification/stab03/installed.cjs /tmp/stab03-evidence
```

The installer records candidate commit/tree, all package hashes, fixture hashes,
compiled artifacts and case results. It verifies the installed package closure
before and after execution. Only the Fastly ABI host and storage model may load
from the checkout; product code must resolve from the isolated installation. The harness uses the
installed Node KV reference implementation for fault injection; this does not
make that internal module a public export.
Failed attempts remain in their evidence directories. The task is separate from
aggregate release gates and does not change release policy.

## Composition matrix

Each target is selected explicitly. All three targets must build and execute
all 29 consumer cases; an old `PULSE_GUEST_UNIT_START_MISMATCH` rejection now
fails the task. JWT-02.3 replaces the historical blocked reductions with 20
required installed Native cells: RS256 baseline, MAC, schema-only and combined,
plus ES256 and RS256 signing/verification with each of SHA-256, HMAC and S3,
on both Node and Fastly. See [the installed matrix](../../jwt/jwt02/QUALIFICATION.md).
The original STAB-03 receipts remain historical observations, not current passes.

Fastly JavaScript is outside this consumer matrix because conditional KV and
request lifecycle capabilities differ; it is not substituted for Fastly Native.

The 29 cases per admitted target cover:

- Missing, altered, expired, future, wrong-target, wrong-scope and missing-secret
  proof; missing, malformed, expired and unauthorized Bearer identity. Rejection
  leaves application state unchanged and dispatches no mutation.
- Protected asset GET/HEAD responses with no Bearer requirement.
- Conditional command acceptance, identical replay and conflicting replay.
- A separately authenticated worker that reads command/config effects in parallel,
  inserts a projection once, and tolerates repeated delivery.
- A committed command with a lost acknowledgement, followed by explicit identical
  and conflicting replays and worker processing; preparation failure before
  dispatch followed by a successful explicit retry.

Request schemas validate command and worker bodies. Proof timestamps use a typed
JSON codec rather than unsupported Native numeric parsing. Proofs bind scope,
method, URL and issue time. This is a focused fixture, not a complete ingress
protocol: it does not bind body digests or provide nonce replay prevention.

The worker is a bounded HTTP-triggered step, not a scheduler or background daemon.
Node execution uses installed request/effect adapters; this is not a socket,
throughput, concurrency, cross-process durability or memory qualification.
Fastly execution uses compiled Wasm with injected ABI behavior;
it is not deployed Fastly or Viceroy evidence. Hosted qualification is always
false. A downstream application's integration and deployment readiness remain
separate work; this fixture neither patches nor certifies such an application.
