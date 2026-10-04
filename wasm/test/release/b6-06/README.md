# B6-06: support, notes and measured size freeze

This pre-snapshot cleanup follows the user's B6-06 direction and the explicit
October 4 decision that the known documented/reported Viceroy CAS issue should
not block. No single Entry Point covers release metadata, current documentation,
example-size evidence and the local K4 disposition; their ordinary root-to-owner
instructions apply. No product implementation or target capability is changed.
The version/date/channel snapshot remains B6-07 work.

## Support decisions

- S3's release summary now includes bounded opaque `getBody` on Node
  Native/JavaScript and Fastly Native; Fastly JavaScript remains ineligible.
- Node `/server` remains an explicitly supported finite HTTP integration inside
  the implementation-tier package. Its entry-point exception is stated without
  promoting the package's other exports. Forwarding, generated output,
  transforms, S3-body bindings and blob-specific production qualification remain
  separate from dev/test and installed feature evidence.
- General stream processing remains excluded. Node finite generated output and
  UTF-8 transforms remain explicit experimental opt-ins. Installed generated
  output acceptance is distinct from pending installed transform qualification.
- Embedded Assets preserves its different JavaScript middleware and Native
  lookup forms. Node JavaScript and both Native targets have their described
  proof; Fastly JavaScript embedded middleware is not newly qualified.
- Native signature-guest composition restrictions, explicit target rejection,
  no JavaScript fallback, and private MCP exclusion remain intact. MCP is private
  at 0.0.0 and is absent from the unchanged 19-package publication set.
- The reviewed npm `latest` dist-tag is retained. It does not rename a Git
  branch, remove the Beta suffix, publish packages or activate infrastructure.

The canonical compatibility matrix, scope/API/body guides, package summaries,
Unreleased notes and all generated installed references carry these distinctions.
The local K4 assertion corpus is unchanged. Its exact known failure on
evidence-backed Viceroy 0.21.0/0.21.1 retains raw `status: failed` and receives
`acceptance.status: accepted-with-known-viceroy-discrepancy`,
`acceptance.releaseBlocking: false`. Other failures, malformed evidence and
unrecognized versions still block. Required deployed Pulse cross-location proof
is not waived. See [K4](../../kv/K4.md) for the current release policy.

## Measured example baselines

The [machine record](sizes.json) identifies clean merged source
`35a0f96ffe6e9b89cd326dd17a48fe283446094d`, its tree, fixture hashes and every
Wasm SHA-256. All 10 examples built using ordinary CLI `build --out` commands:
nine Native examples in default and `--experimental-native-size` modes, and the
JavaScript Entities example with no application Wasm. Dependencies are the
restored frozen workspace; Node is 24.19.0. Generated measurement directories
were removed and source was clean before and after. These are uncompressed
artifact sizes, not runtime performance, transfer-size or deployment evidence.

| Artifact with a changed baseline | Default bytes | Experimental-size bytes |
| --- | ---: | ---: |
| Fastly capabilities `bin/main.wasm` | 47,214 | 39,329 |
| Opaque proxy `bin/main.wasm` | 34,747 | 30,021 |
| Router `canonical-native.wasm` | 9,157 | 8,753 |

The other measured Native size baselines and ES256 guest-link input sizes are
unchanged. Canonical READMEs, executable assertions and generated example copies
use these reproduced values. The earlier reported capabilities value 47,185 was
not used as a guessed snapshot. Reproduce the bounded size acceptance with:

```sh
node wasm/test/docs/assert-executable-documentation.cjs --section sizes
```

Later product changes require refreshing affected rows. Final clean installed
feature/provider proofs and the exact release seal belong to B6-08; these size
measurements and focused checks do not constitute that seal.

## Validation and handoff

[PR #184](https://github.com/pulse-compute/pulse/pull/184) targets `latest`.
The [validation record](validation.json) retains terminal reports, actual K4
consumer results, package/toolchain hashes and failed-attempt identity. Final
local K4 and all 40 unit tasks passed on clean commit
`727a398e386404d0b03ce9e408acfd0d1ca3b01e`, tree
`ba3e02a6148cd89a4a6ba5fcb5e9e17337efc5f7`. Evidence files are added afterwards;
these checks are development validation, not the final release seal.

| Check | Result |
| --- | --- |
| Ordinary measurement and documented size preflight | 19 builds across 10 examples; all baselines accepted |
| Final unit profile | 40/40 tasks passed |
| Focused documentation/K4/example workflows | 5/5 tasks passed during branch preparation |
| Final installed K4 disposition | Passed; raw CAS semantics retain the known Viceroy failure |
| Exact installed package closure and documentation | 19 packages verified; no workspace product modules; installed bytes unchanged |
| Maintainer, documentation, documentation-release, publication and scope checks | Passed on the tested clean source |
| TypeScript build and release preflight | Passed during branch preparation |

The first K4 replay failed at packed documentation validation. The new runtime
API/body/deployment links were corrected through canonical rewrite rules and
regenerated; the final replay passed that check. The earlier failed report is
retained separately and was not overwritten. Final Node Native and JavaScript
each passed 171 requests plus acknowledgement-fault checks. Real Fastly Compute
ran the same corpus and response-loss check; its sole missing-key CAS mismatch
receives the authorized non-blocking disposition while raw `status: failed`
remains visible.

B6-06 implementation is complete. The atomic beta.6 snapshot remains B6-07,
and B6-08 must run the complete exact-source release replay. Deployed Pulse
cross-location K4 proof still requires the reviewed T2 service/store/probes.
The earlier B6-04 historical populated beta.5 guest-cache transition remains
partially qualified as recorded in B6-05. No packages were published, services
activated or pull requests merged.
