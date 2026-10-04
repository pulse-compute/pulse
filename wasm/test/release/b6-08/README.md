# B6-08: exact-source seal attempt and packed read-loop fix

The user merged PR #185 into main and requested the release seal. The candidate
was clean commit `d8658906d30a9924c13ca2ad3ec5aec0e1c133b3`, tree
`fb60e72c65e466a1b1b661be5b08cda6201aa5f2`. Entry point: `release-seal`.
No version, product implementation, package composition, trust policy or
optimization default changed during the attempt.

## Seal attempt: failed, not sealed

`npm run release:seal -- --require-fastly` restored frozen dependencies with
lifecycle scripts disabled and passed maintainer/publication controls, the
TypeScript build, all ten documented size baselines, vulnerability/license
evidence, workspace unit tests and generated documentation checks.

The complete release profile selected 164 tasks: **160 passed, one failed and
three were not reached**. It stopped at `clean-machine-acceptance`, where the
packed read-loop consumer reported `PULSE_NATIVE_IMPORT_UNSUPPORTED` for S3 and
crypto. The original terminal seal/profile reports and diagnostic text are
retained in [seal-attempt-1.json](seal-attempt-1.json). No passing profile is
assembled from partial or later development runs.

Temporary directories left by completed tests were moved outside the checkout
and retained; tracked source bytes were unchanged. The machine record includes
that cleanup ledger. The toolchain was Node 24.19.0 (within the accepted release
range), pnpm 12.4.2, official Fastly CLI 16.1.0 and Viceroy 0.21.1.

## B6-08-F01: isolated fixture dependency boundary

The nested `read-loop-*` application directory had no local `node_modules`.
Ordinary Node resolution could find packages in the parent installed consumer,
but project-local Native contract discovery correctly stayed inside the nested
application boundary. The workspace version of this fixture did not expose
that installed-consumer setup error.

Fix commit `794daa03349edc4dd7f84c1a86b260364622c9dc`, tree
`c1ef62105356345619cd290fe92d1f0718c4ad36`, gives the fixture a local junction to
the existing, byte-verified isolated install. This is the same setup already used
by the packed multifile consumer. It does not link workspace product packages,
change compiler discovery, or relax any assertion. Package closure verification
before and after execution and the workspace-module exclusion remain intact.

Classification: test hardening. No exact implementation Entry Point covers this
fixture-only repair; ordinary root/Wasm instructions apply to
`wasm/test/runtime/bounded-read-loop-packed.cjs` and these release evidence files.
The seal attempt remains separate from the fix, as required by `release/AGENTS.md`.

On the clean fix commit:

- All 40 unit tasks passed.
- Complete clean-machine acceptance passed for all 19 packages and the ordinary
  Node/Fastly Native/JavaScript CLI workflows.
- The formerly failing installed read-loop corpus passed all 53 checks, with
  zero workspace product modules loaded and unchanged installed bytes.
- All 19 package/version/SHA-256 identities match the original seal attempt.
- Maintainer validation and the main release-PR check passed; the latter confirms
  no publishable product change and no additional version bump.

[f01-validation.json](f01-validation.json) records the terminal reports, exact
tarball identities and read-loop checks. This evidence-only follow-up does not
change tested fixture or product bytes.

## Next action

Human review/merge of the fixture fix precedes a fresh, complete seal on its
merged source. The remaining aggregate tasks, ten installed-feature gates,
Fastly local-host proof and separate local K4 gate must run on that candidate.
Nothing was tagged, published, deployed or promoted by this attempt.

The documented Viceroy missing-key CAS discrepancy remains explicitly
non-blocking; it did not cause this failure. Full deployed Pulse cross-location
K4 acceptance still requires the reviewed T2 service/store/probes, and B6-04's
historical populated beta.5 guest-cache qualification remains partial. Neither
is silently replaced by this fixture repair or the earlier standalone SDK proof.
