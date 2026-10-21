# Published documentation sanity pass — 2026-10-21

Scope: the 83 Markdown sources selected by `release/documentation-sources.json`
on Pulse `latest` base `1b6d33e63addbcb86394c55fd015bbc4fa65c5af`, including
hidden maintainer pages. Website import/navigation owners were inspected at
`adbe1213d257df0987a1156fa49884f973a3d2e5` in `pulse-compute/website`.
The website production lock selects beta.9 commit
`fda16de1b3520c65cc62574878727e753ade850c`; this pass prepares current source
for a subsequent reviewed publication, without changing that pin or deploying.

## Method and limits

- Enumerate every website-eligible Markdown source; inspect headings, navigation,
  obsolete API spellings, unsupported/pending claims and publication instructions.
- Cross-check flagged claims against public types, current provider/toolchain
  implementations, canonical package guides and owning acceptance tests.
- Validate generated references, source/asset links and anchors, installed copies,
  package documentation, diagnostic prose and the compatibility matrix.
- Regenerate the exact context corpus and binary resources with pinned Node
  24.18.0 because changed source citations must not retain stale data.

This is a source sanity pass, not a fresh execution of every documented target,
external service, archived website, or sample command. Historical changelog facts,
release receipts and explicitly directional architecture remain historical or
directional. No deployment, cross-location KV acceptance or production log
acceptance is inferred. A screened page with no correction is not a proof of
exhaustive semantic correctness. Frontend layout and live external-link reachability
remain website concerns.

## Corrections

| Finding | Correction / authority |
| --- | --- |
| Ten transform summaries were objects and rendered `[object Object]` | Correct the CLI summary catalog; reject non-string summaries during documentation validation. Exit classes and remediation are unchanged. |
| Compatibility matrix lagged Entities lifecycle and Fastly forwarding | Align with installed Entities workflow and Fastly forwarding owners; retain fixture/local-vs-deployed boundaries. |
| Matrix omitted bounded collections, computation calls, static MCP, extended KV | Add supported target rows and explicit resource/workspace contract links. |
| Matrix's named check was stale and not invoked in documentation CI | Correct the matrix assertions and call them from the existing documentation regression lane; language execution remains with owning compiler/conformance tests. |
| Main API omitted KV list/delete and narrowed conditional KV to Node | Document bounded page/cursor and uncertain-delete semantics; link the detailed owner. |
| Scope page described generic call as unsupported and suggested CLI target override | Distinguish event calls from HTTP computation; select a named profile. |
| S3 introduction said `getBody` was Node-only | Match Node JS/Native and Fastly Native support. |
| Old `ctx.kv.get` spelling remained in concepts/vision | Use the bound-store API; label GPIO/ESP32 pseudocode explicitly directional. |
| Package index paths omitted MCP and S3; root summaries omitted current crypto/MCP surfaces | Add links and update short package descriptions without widening support. |
| Lowerer authoring table could be read as forbidding trusted external lowerers | Separate supported versioned builders from arbitrary compiler hooks. |
| MCP examples/contracts described implemented work as future work | Link current static MCP and compiled application workflows; retain compatibility-host and evidence distinctions. |
| Deployment/versioning docs still described removed writer, renderer, search format and future retirement | Align with current website ownership, immutable source lock, `/latest/` import, preview prefix and retained disabled/idle guard. |

## Coverage inventory

“Screened” means inventory/navigation/staleness screening plus shared source
validation; “corrected” identifies pages changed by this pass. Generated
mirrors are validated separately and are not counted again.

| Source | Disposition |
| --- | --- |
| `API.md` | Corrected |
| `CHANGELOG.md` | Screened; no correction in this pass |
| `README.md` | Corrected |
| `docs/README.md` | Corrected |
| `docs/architecture/current-contracts.md` | Corrected |
| `docs/architecture/overview.md` | Screened; no correction in this pass |
| `docs/architecture/vision.md` | Corrected |
| `docs/concepts/bodies.md` | Screened; no correction in this pass |
| `docs/concepts/compilation-and-lowering.md` | Corrected |
| `docs/concepts/contracts-and-providers.md` | Corrected |
| `docs/concepts/effects-and-continuations.md` | Screened; no correction in this pass |
| `docs/concepts/entities-and-adapters.md` | Screened; no correction in this pass |
| `docs/concepts/package-owned-lowering.md` | Screened; no correction in this pass |
| `docs/concepts/targets-and-hosts.md` | Screened; no correction in this pass |
| `docs/contributing/README.md` | Corrected |
| `docs/contributing/adding-core-provider.md` | Screened; no correction in this pass |
| `docs/contributing/adding-first-party-lowerer.md` | Screened; no correction in this pass |
| `docs/contributing/entities-lowering.md` | Screened; no correction in this pass |
| `docs/contributing/package-lowerer-contract.md` | Screened; no correction in this pass |
| `docs/contributing/pulse-aware-packages.md` | Corrected |
| `docs/examples.md` | Screened; no correction in this pass |
| `docs/getting-started.md` | Screened; no correction in this pass |
| `docs/guides/compatibility-imports.md` | Screened; no correction in this pass |
| `docs/guides/deploying-fastly.md` | Screened; no correction in this pass |
| `docs/guides/deploying-node.md` | Screened; no correction in this pass |
| `docs/guides/events.md` | Screened; no correction in this pass |
| `docs/guides/fastly-capabilities.md` | Screened; no correction in this pass |
| `docs/guides/fetching-and-composition.md` | Screened; no correction in this pass |
| `docs/guides/grip.md` | Screened; no correction in this pass |
| `docs/guides/json-schemas.md` | Screened; no correction in this pass |
| `docs/guides/migrating-from-express.md` | Screened; no correction in this pass |
| `docs/guides/project-lifecycle.md` | Screened; no correction in this pass |
| `docs/guides/routing.md` | Screened; no correction in this pass |
| `docs/guides/troubleshooting.md` | Screened; no correction in this pass |
| `docs/maintainers/README.md` | Screened; no correction in this pass |
| `docs/maintainers/codex-maintainer.md` | Screened; no correction in this pass |
| `docs/maintainers/documentation-deployment.md` | Corrected |
| `docs/maintainers/documentation-system.md` | Corrected |
| `docs/maintainers/documentation-versioning.md` | Corrected |
| `docs/maintainers/maintainer-charter.md` | Screened; no correction in this pass |
| `docs/maintainers/maintenance-policy.md` | Screened; no correction in this pass |
| `docs/maintainers/npm-publishing.md` | Corrected |
| `docs/maintainers/plugin-readiness.md` | Screened; no correction in this pass |
| `docs/maintainers/public-site.md` | Corrected |
| `docs/maintainers/release-acceptance.md` | Screened; no correction in this pass |
| `docs/maintainers/release-manifest.md` | Screened; no correction in this pass |
| `docs/maintainers/repository-setup.md` | Screened; no correction in this pass |
| `docs/maintainers/scope-policy.md` | Screened; no correction in this pass |
| `docs/maintainers/support-and-triage.md` | Screened; no correction in this pass |
| `docs/maintainers/testing.md` | Screened; no correction in this pass |
| `docs/packages/README.md` | Screened; no correction in this pass |
| `docs/packages/assets.md` | Screened; no correction in this pass |
| `docs/packages/cli.md` | Screened; no correction in this pass |
| `docs/packages/crypto.md` | Screened; no correction in this pass |
| `docs/packages/entities.md` | Screened; no correction in this pass |
| `docs/packages/grip.md` | Screened; no correction in this pass |
| `docs/packages/implementation-packages.md` | Screened; no correction in this pass |
| `docs/packages/jwt.md` | Screened; no correction in this pass |
| `docs/packages/mcp.md` | Screened; no correction in this pass |
| `docs/packages/provider-fastly.md` | Screened; no correction in this pass |
| `docs/packages/pulse.md` | Screened; no correction in this pass |
| `docs/packages/runtime.md` | Corrected |
| `docs/packages/s3.md` | Corrected |
| `docs/preview-scope.md` | Corrected |
| `docs/reference/README.md` | Screened; no correction in this pass |
| `docs/reference/cli.md` | Screened; no correction in this pass |
| `docs/reference/compatibility-matrix.md` | Corrected |
| `docs/reference/diagnostics.md` | Corrected |
| `docs/reference/environment.md` | Screened; no correction in this pass |
| `docs/reference/handler-authoring.md` | Corrected |
| `docs/reference/project-config.md` | Screened; no correction in this pass |
| `docs/reference/shell-completion.md` | Screened; no correction in this pass |
| `examples/01-hello-json/README.md` | Screened; no correction in this pass |
| `examples/02-request-schema/README.md` | Screened; no correction in this pass |
| `examples/03-fetch-composition/README.md` | Screened; no correction in this pass |
| `examples/03-fetch-composition/dynamic-probes/README.md` | Screened; no correction in this pass |
| `examples/05-fastly-capabilities/README.md` | Screened; no correction in this pass |
| `examples/07-opaque-proxy/README.md` | Screened; no correction in this pass |
| `examples/09-router-lowering/README.md` | Screened; no correction in this pass |
| `examples/10-entities-tools/README.md` | Corrected |
| `examples/11-events/README.md` | Screened; no correction in this pass |
| `examples/12-pulse-context-mcp/README.md` | Corrected |
| `examples/13-jwt-es256/README.md` | Screened; no correction in this pass |

## Handoff

Prepared on `codex/b10-published-docs-audit`. Local validation logs live in
`/tmp/b10-docs-audit/` for this checkout. The PR records final tested identity,
checks and remaining hosted CI. Website source-pin advancement remains a
separate reviewed release operation; there is no additional product scope decision
required for these documentation corrections.
