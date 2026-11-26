# RC-H05 qualification evidence

Candidate: PR #616 merge source `7a3f513631e2f84c52e390ffd330c6ed6180ea6b`,
clean tree `b71499b6caa15954c4cb880d556791621efe0c9b`, version `1.0.0-rc.1`.
PR head `77ea6e193a2b5e7d4c749fdc3c988cf34a5a63c7`, main base
`dbad9e9b553d87999ae35a68c2f94335c99b3acc`. This evidence branch preserves the
qualified source as its parent; it is not a replacement release candidate.

## Exact provider binding for review

`provider-binding.json` verifies all eight terminal modules rebuilt from twenty
freshly packed RC packages against RC-H04's installed module hashes. The five
hosted terminal modules, instrumented KV module and S3/fetch module also match
the modules inside all seven retained Fastly deployment archives byte-for-byte.
The original KV consumer and instrumented sources match too. Installed package
file closure was checked before and after compilation, and K4's twenty package
hashes match the terminal/binding package set.

`package-file-delta.json` inventories every changed tarball file. Provider,
runtime and S3 implementations are unchanged. Implementation-file changes are
exact-version documentation strings plus guest-unit version/provenance metadata.
The guest build-script pin was regenerated with the versioned reconstruction
script; the existing guest artifact and source-tree identities remain unchanged.
Updated CLI context resources are covered by the final installed feature gates.

This is an explicit proposed exact-byte binding for release-owner review, not
new deployed traffic or self-approval. Original hosted receipts, their source
identities, cleanup and failed attempts remain under `wasm/test/release/rc-h04/live/`.
The previously unexplained held-response timeout is not waived or erased.
The binding makes no broader global consistency or durability claim.

## Fresh local acceptance

The current package set built and packed on Node 24.18.0, npm 11.15.0 and
pnpm 12.4.2. `terminal-installed.json` records eight artifacts and unchanged
installed closure. `k4-local.json` records 171 requests per Node Native,
Node JavaScript and actual Fastly/Viceroy target. Both Node targets pass.
Viceroy 0.21.1 retains raw semantic failure for missing-key CAS only, with the
existing October 4 non-blocking release disposition. It is not a semantic pass.

The first K4 pack stopped on pnpm's build-script approval request; its local
workspace-file mutation was restored. The failed terminal attempt rejected that
dirty state before execution. The fresh clean build used lifecycle scripts
disabled, then both complete gates consumed one hash-verified shared pack.
Other retained setup failures identify stale generation and the pre-existing
63-versus-65 dependency-count fixture corrected before freezing the candidate.

## Final gates

[Full CI](https://github.com/pulse-compute/pulse/actions/runs/45901154055) and
[aggregate qualification](https://github.com/pulse-compute/pulse/actions/runs/45901090332)
both completed successfully. The accepted artifact archive digest was verified,
then its source identity, seal, source-check and publication-manifest hashes were
verified. All twenty accepted tarball hashes equal the local proof package set.
The seal records twelve passing required installed feature gates, passing local
Fastly CLI qualification and successful cleanup. `seal-binding.json` records this
comparison; `sealed/` preserves the original terminal manifests and receipts.
CI artifacts retain the tarballs until December 26, 2026; release publication
must consume the accepted bundle under the repository release procedure.

Review the exact-byte provider binding and final qualification before merge.
Tagging, npm publication and website delivery remain separate human operations.
