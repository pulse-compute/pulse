# Private MCP authorization fixture

This directory is test support for `mcp-installed`, not a public example.
The canonical user-facing app is [Pulse context MCP](../../../../examples/12-pulse-context-mcp/).
Keep this fixture only for generic authorization and write-side negative coverage:
scoped discovery, reader-denied proposals before effects, revoked tokens, invalid
schemas and separation of client/backend credentials. Its temporary directory
service supplies deterministic HTTP effects; it is not a deployment template.

The three fixture operations are `directory.search`, `directory.retrieve` and
`directory.propose-update`. The proposal operation queues a title/reason for
review; it never edits a resource. Requests require `mcp:access` plus the exact
read/propose scope. Catalog and schema data come from the same candidate build.

From a checkout with the pinned dependencies restored, run the existing explicit
installed lane:

```bash
npm_config_ignore_scripts=true node wasm/scripts/run-wasm-tests.cjs --task mcp-installed
```

It installs exact candidates outside the checkout and uses the locked official
client against an isolated local issuer/backend. It adds no default PR campaign.
The context server's exact installed journey will reuse this lane in PMCP-07;
the required authorization/write negatives remain fixture evidence.
