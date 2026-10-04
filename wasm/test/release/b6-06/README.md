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
