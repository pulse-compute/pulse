# B7-02: MCP npm-name bootstrap handoff

Repository-only preparation evidence, October 7, 2026 UTC (October 6 Denver).
Human direction: proceed with B7-02 after merging B7-01. Entry point:
`release-readiness`; this handoff and the readiness-ledger correction belong to
the documentation owner. No named bootstrap implementation change is needed:
the existing prepare-only script already constructs the required inert artifact.

Source inspected/prepared: `748e7e3066d3efabfc0934936c67acb9e9322a01`, tree
`29148769d5cfd540d54fde67911f5e362b0ed3a6`. The subsequent documentation PR changes
neither that script nor the legal/payload inputs. This is name-reservation
preparation, not the real beta.7 adapter or a release seal.

**Status: complete.** On October 7, 2026, the release owner reported "Bootstrap
is complete." A fresh read-only catalog audit confirms all 20 names satisfy
policy, and the published MCP tarball matches the reviewed preparation exactly.
B7-03 owns trusted-publisher setup next.

## Read-only registry observation

At `2026-10-07T04:18:30.152Z`, the catalog audit reported `bootstrap-required`:
19 existing/compliant names, one missing name (`@pulse-compute/mcp`), zero
indeterminate observations and zero tag remediation. None of the existing
packages needs re-bootstrap or a beta.6 tag change on this observation.

The full immutable observation is retained in the downloadable handoff as
`npm-catalog-audit-before.json`; its working copy is
`.pulse-release-preflight/b7-02/npm-catalog-audit-before.json`.
The canonical source preflight remains policy, not a mutable registry report.
Re-audit before acting if the observation is stale or registry state has changed.

## Prepared payload

```bash
scripts/npm_bootstrap.sh --prepare-only @pulse-compute/mcp .pulse-release-preflight/b7-02/mcp-bootstrap
```

The destination must not already exist. The actual local artifact is
`.pulse-release-preflight/b7-02/mcp-bootstrap/pulse-compute-mcp-0.0.0.tgz`.

| Property | Verified value |
| --- | --- |
| Package/version | `@pulse-compute/mcp@0.0.0` |
| Publication intent | Public access, `bootstrap` tag, `https://registry.npmjs.org/` |
| Compressed / unpacked size | 6,961 / 19,240 bytes |
| SHA-256 | `b6d9f67b8fe172f14ff6dc6ab33f898c7ad92bc2e9f698e91a94845081d17dc4` |
| npm SHA-1 | `91047fe74a3fb6dfd14d817596b42a32a86cb474` |
| Files | `package.json`, `README.md`, `LICENSE`, `NOTICE` only |
| Legal bytes | Exact repository root LICENSE/NOTICE |
| Runtime surface | No executable/import/type exports, scripts or dependencies |

The preparation receipt is `bootstrap-verification.json` in the handoff and
`.pulse-release-preflight/b7-02/` working directory. It retains the npm SHA-512
integrity, all four file sizes/hashes, source revision/tree and checked status.
Dry-run and actual local pack produced identical tarball identities. This
operation did not publish, change registry tags or configure npm accounts.

## Post-bootstrap verification

At `2026-10-07T19:32:35.576Z` (13:32 Denver), `release:audit-npm` reported
`ready`: 20 existing/bootstrap-compliant names, zero missing, zero indeterminate
and zero tag-remediation cases. MCP's `bootstrap` and `latest` both point to
`0.0.0`; the other 19 `latest` tags still point to beta.6. No beta.7 package is
published in this observation.

The audit is bound to release-manifest SHA-256
`389ffca6e6c6e0ad2612f8ddc42533179ed14935ee99a17f2546bb1fd1cd9e0f`.
Verification source: `latest` at `1dbc6c9623dca55f274715bdc8eca5e31652e5df`,
tree `6d055aaf3728f4311a672969055ae90210f779ba`. This completion record changes
only internal documentation; release policy and payload inputs remain intact.

Read-only registry packing with lifecycle scripts disabled retrieved
`@pulse-compute/mcp@0.0.0`. Its 6,961-byte tarball has the exact SHA-256,
npm SHA-1 and SHA-512 identities recorded above, the same four files, exact
root legal bytes and no runtime surface. The catalog validator also checked
manifest binding, ordered package coverage and the 24-hour freshness limit.

The downloadable completion receipt retains `npm-catalog-audit-after.json`,
`npm-pack.json`, `registry-verification.json` and the published tarball. These
are observations, not permanent release authority: refresh the catalog audit
for publication. B7-02 is closed; trusted-publisher/account/environment setup,
the real beta.7 release and its explicit human gates remain pending.

## Bootstrap procedure (reference)

The owner action below is complete. Retain this procedure for review; do not
repeat publication for the reserved name.

Use a human npm session with one-time 2FA authority for `pulse-compute`. Before
publication, reproduce the prepare-only artifact in a new directory and compare
its pack identity with the reviewed receipt above. If the inputs or packed bytes
differ, inspect and review the new payload first. From that reviewed checkout,
containing the unchanged script and legal inputs:

```bash
scripts/npm_bootstrap.sh @pulse-compute/mcp
npm run release:audit-npm
```

The publishing command reconstructs and inspects the same inert shape; it is
not a separate approval prompt. It verifies `bootstrap` points to `0.0.0` and
`latest` is absent or also points to that inert version for this new name. It
never publishes beta.7.

If the name/version already exists or publication returns an ambiguous failure,
stop and inspect registry state. Do not repeatedly attempt reservation or change
tags automatically. An existing exact inert payload can be verified through the
catalog audit; missing/incorrect bootstrap or unexpected tags require owner
remediation. Existing released package tags must remain intact.

Retain the actual publication receipt and a copied post-bootstrap catalog audit
alongside the before/prepare evidence. The completion audit must:

- be bound to the current release manifest and within its 24-hour freshness limit;
- report all 20 names existing and bootstrap-compliant, with zero missing,
  indeterminate or tag-remediation cases;
- show MCP's inert version and bootstrap tag, with `latest` satisfying policy.

An exit code alone is insufficient: inspect the audit's status/summary. A
prepare-only receipt cannot close the registry reservation row.

After successful reservation, proceed to B7-03: configure MCP's exact GitHub
repository/workflow/environment trusted publisher, confirm the existing 19
settings and remove/revoke the temporary bootstrap credential. First real
publication still requires the final tagged candidate and protected human gate.
See the [publishing procedure](../../maintainers/npm-publishing.md#one-time-package-bootstrap).

## Focused validation

The existing `assert-npm-bootstrap.cjs` passed with a wrapper that permits only
local npm packing. It verifies exact payload shape/legal bytes, absence of
runtime fields, refusal to overwrite prepared artifacts and rejection of invalid
names before any npm action. The actual prepared tarball was independently read
and hashed. Required maintainer/preflight/publication/documentation checks belong
to the preparation PR; no full seal or dependency/client campaign is added.
