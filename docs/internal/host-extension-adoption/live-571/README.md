# PR 571 hosted qualification

Result: **passed** for clean source `81c9952e6cc13810957b0a5ade0a34b04ff5daa0`, tree `af365d231f4ee460c7418aaaada11d66e7742c52`.

The exact installed bundle passed 20-package closure verification, eight Wasm/report pairs, 15 negative admissions, 20 injected ABI cases, 15 pinned Viceroy/Pushpin transport cells and 15 hosted Fastly cells. The aggregate verifier passed against the same installed receipt `458948b6a19e6977a7a8570f2719dbb6176711d67518c7e9aa6a0dbd8497f5da`.

- [Hosted receipt](hosted.json): five active version-2 services; package/domain/version identity checked before and after traffic.
- [Local receipt](local.json), [installed identity](installed.json), [aggregate qualification](qualification.json), [cleanup](cleanup.json), [CI identities](ci.json).
- [Exact installed bundle and local replay](https://github.com/pulse-compute/pulse/actions/runs/41274512086/artifacts/13070651178); archive SHA-256 `fb3334b5cd002acdd1b27320a4fecb85de77492bd3ab9c4e2cd14339d95636be`. Referenced package and Wasm files live in this CI bundle.
- [Operator ledger](evidence-ledger.json) and [credential-free request tracer](fetch-trace.cjs). The tracer preserves actual fetch calls, responses, errors and cancellation signals and logs no headers/bodies/credentials.

Plain and Router Fanout ordinary/handoff/hold-publish checks passed. Plain and Router WebSocket passthrough upgraded and echoed two frames. The independently named `@independent/rc-terminal@91.7.3` passed the Fanout checks. All eight Wasm hashes match the original candidate; only test code and the dependency download base URL changed. Every engine/dependency byte hash remains pinned.

Prior failures are retained in the operator evidence archive and linked CI history: initial setup, an HTTP GET mistakenly used as a WebSocket positive probe, a duplicate local declaration in its first repair, stale PR base metadata, Ubuntu snapshot HTTP 504/503, and a nine-cell run interrupted by a Fastly API identity-read timeout. The winning attempt replayed the entire unchanged matrix; partial runs were not pooled.

The user explicitly approved five temporary Compute services, required per-service product enablement under existing entitlements, deployment/activation, bounded tests and cleanup. All five owned services were deactivated/deleted, both temporary origins stopped, and the original VCL service was not changed by this task. The temporary API token remains active by user direction and is excluded from all evidence.

These receipts qualify the terminal-package workstream only. Independent host-contract review and final integrated release qualification remain separate. This evidence branch is outside the tested candidate; it changes no qualified source or historical receipt.
