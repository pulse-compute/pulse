# B6-04: upgrade and artifact qualification

This bounded pre-snapshot evidence compares the integrated candidate with pinned
pre-integration `latest` (`e9bf187d0de0ccc54248a29bca24937d6bed79a9`). It does not
widen product behavior or change optimization defaults, release versions, package sets,
release gates, or provider support. It fixes the guest validator's order-sensitive
JSON object comparison so emitted plans can be reloaded with exact values intact. Run after selected product changes settle.
Later product changes require refreshing the affected cells before B6-07/08.

## Reproduction

Use the release-pinned pnpm, frozen dependency install with lifecycle scripts
disabled, built workspace, supported Node, Python 3 and Linux. Run serially on an
otherwise idle host so installation/build load does not contaminate timing:

```sh
node wasm/scripts/run-wasm-tests.cjs --task beta6-upgrade --report .test-results/b6-04-upgrade-run.json
node wasm/scripts/run-wasm-tests.cjs --task beta6-measurements --report .test-results/b6-04-measure-run.json
```

Both tasks are deliberately outside all automatic profiles. Upgrade needs public
npm access to fetch immutable beta.5 tarballs. Measurements create an isolated
worktree at the pinned control and restore its own frozen dependencies. The
control and candidate retain their respective workspace package topology; all
external lockfile resolutions and installed compiler/tool versions must match.
No new production dependency or environment variable is introduced.

Every attempt writes a fresh report under `wasm/.test-results/b6-04-*`. Failures
and partial attempts remain identifiable. A partial upgrade report exits nonzero;
a passing subset is never substituted for the missing published-guest proof.
Transient consumers/worktrees are removed after completed qualification; failed
upgrade consumers are retained for diagnosis. Reports and measurement artifacts remain. Source commit, tree, working diff, oracle digest, fixture digests, package
hashes and observed toolchain are recorded. An uncommitted run is development
evidence, even when every cell passes.

## Upgrade cells

- Fetch all 19 published beta.5 packages with npm integrity verification; compare
  installed package bytes with each exact tarball.
- Build the finite Node app before replacement, preserving its source, config,
  application records, user state, and populated npm cache.
- Replace with exact candidate tarballs without deleting state, cache, or
  `node_modules`. Verify all 19 package versions and every installed candidate
  byte against the official pack before and after execution.
- Compare first/repeated Native builds and a separate fresh consumer with a new
  npm cache. Compare exact Wasm, plan and compiler/build identities.
- Materialize the package-owned ES256 guest, verify reuse, and exercise a
  manifest-only identity change with identical guest bytes in a copied test
  package. Both content-addressed entries must coexist unchanged.
- Reject an unsynchronized guest-owner version, a wrong build contract, and
  corrupted Native Wasm. The production launcher must serve the finite HTTP
  response, reject corruption, and never execute the planted JavaScript fallback.

The unsnapshotted candidate still carries beta.5 versions. Replacement therefore
uses distinct exact tarball paths and hashes, not an invented beta.6 publication.
The final beta.6 snapshot requires another version-transition replay. Immutable
published beta.5 artifacts are never replaced or patched by this test.

## Measurement cells and interpretation

Use identical application bytes on both revisions: the existing compact typed
partition validator (two calls), and the existing 16-route history helper app
with schema decoding, digest and S3 effects. Test `default`,
`experimental-native-bounded-size`, and `experimental-native-size` independently.

Each of the 12 revision/application/mode cells runs two fresh compilation workers.
Their artifact and plan hashes must match. A separate debug companion must match
every non-custom production Wasm section before using its symbols to count
retained helper bodies, body bytes, direct callers and export reachability.
Source function counts alone do not qualify reuse.

Compile wall time and Linux child-resource peak RSS are separate from runtime
process startup/module load, ten instantiations, and 30 request-lifecycle samples after ten
warmups. RSS is the largest-process high-water mark including descendants, not
the sum of simultaneous resident memory. Request lifecycle includes a fresh
instance; its cost is not falsely labeled request dispatch alone. The history
request exercises a successful digest/read with injected effects; this is not
network, production-launcher, Fastly engine or deployed throughput evidence.

Disposition rule: semantic, identity, package and retention failures block the
corresponding claim. Exact Wasm changes are reported, not accepted merely because
they shrink. Timing/RSS samples are descriptive on this host; a material increase
requires a bounded paired rerun and explicit disposition, not a compiler rewrite
or silently loosened threshold. All size modes remain opt-in.
