# MCP resource-directory acceptance app

This private MCP-05 app composes the MCP adapter with an ordinary Pulse Entities
application. The named client is the official `@modelcontextprotocol/client`
2.2.0, pinned to MCP 2026-07-28 over finite Streamable HTTP. The measured target
is Node JavaScript. It does not advertise MCP Resources, prompts, streaming,
sessions or tasks. Native and Fastly MCP acceptance remain unclaimed.

| Tool | Scope | Behavior |
|---|---|---|
| `directory.search` | `directory:read` | Search resource titles; bounded result set |
| `directory.retrieve` | `directory:read` | Retrieve by ID; explicit `found: false` for missing records |
| `directory.propose-update` | `directory:propose` | Queue a proposed title and reason for human review; never edit a resource |

All requests also require `mcp:access`. Catalog and input/output schemas come
from the same installed build. The MCP listener cannot import or execute the
application's handlers; every admitted call crosses the fixed, protected HTTP
endpoint and the Entities boundary. Handlers use governed config/fetch effects.
Tool annotations describe behavior and do not grant permission.

## Reproduce acceptance

From a checkout with its pinned dependencies installed, run:

```sh
npm_config_ignore_scripts=true node wasm/scripts/run-wasm-tests.cjs --task mcp-installed --report .test-results/mcp05.json
```

The gate packages the current Pulse release candidates, the private MCP adapter,
and this app. It extracts the application outside the checkout and installs its
declared dependency graph using an exact-candidate read-only Pulse registry.
It verifies installed package bytes before and after execution, with no workspace
links or private runtime imports. The independent client is installed separately
from its existing frozen integrity lock, with lifecycle scripts disabled.

The replay runs `doctor`, `inspect`, `test`, `build`, and `dev`, then performs
OAuth discovery/PKCE, filtered listing, all three tool calls, denied operations,
invalid input, effect failure, backend unavailability, deadline expiry, client
cancellation, subsequent healthy execution and server shutdown. A controlled
local issuer and credential-checking backend proxy are test fixtures. The writer
grant is fixture-issued; the reader exercises the authorization-code flow.

The retained `wasm/.test-results/mcp-installed-*/mcp-installed-acceptance.json`
and `wire.json` identify the source, exact package hashes, client version,
completed checks and terminal status. Reports contain no bearer credentials.
Cancellation proves the MCP request closes its backend connection; it does not
claim rollback or durable delivery of proposals. The demo queue is process-local,
limited to 100 proposals, and disappears at restart.

## Local package and configuration

To retain the package set instead of running the disposable acceptance install:

```sh
npm_config_ignore_scripts=true node wasm/test/mcp/package-directory.cjs /tmp/pulse-mcp-directory-pack
mkdir /tmp/pulse-directory-app
cd /tmp/pulse-directory-app
tar -xzf /tmp/pulse-mcp-directory-pack/pulse-examples-13-mcp-resource-directory-0.0.0.tgz --strip-components=1
npm install --ignore-scripts --no-audit --no-fund /tmp/pulse-mcp-directory-pack/pulse-compute-*.tgz
npm run doctor
npm test
npm run build
```

This creates local archives, not a publication or new release membership.
`mcp-directory-pack.json` records their hashes. The already published beta.5
packages do not substitute for this exact candidate. Do not publish the private
adapter or app to satisfy the example's dependency declarations.

For local manual use, `npm run directory` starts the small directory on loopback
port 8790; `npm run dev -- --port 8787 --no-watch` starts the Pulse development
backend. The project configuration supplies the directory origin through
`ctx.config`; tools never accept a destination URL. `pulse dev` is a local
development server, not a production launcher.

`npm run mcp -- /absolute/path/to/mcp-config.json` starts the MCP listener on
loopback port 8791 after building. Supply a protected Entities endpoint and the
external issuer configuration, using a permissions-restricted file outside the
application archive:

```json
{
  "port": 8791,
  "endpoint": "https://private-backend.example/entities",
  "backendBearerToken": "REPLACE_WITH_SEPARATE_SERVICE_CREDENTIAL",
  "authorization": {
    "resource": "https://mcp.example/mcp",
    "issuer": "https://issuer.example",
    "introspectionEndpoint": "https://issuer.example/introspect",
    "clientId": "REPLACE_WITH_RESOURCE_CLIENT_ID",
    "clientSecret": "REPLACE_WITH_RESOURCE_CLIENT_SECRET",
    "scopes": ["mcp:access"]
  }
}
```

These are placeholders, not usable credentials. The app fixes operation scopes
from the table above; hosts cannot accidentally broaden them through this config.
Use the adapter README's exact introspection-claim and issuer requirements.

## Deployment handoff

1. Retain and verify the package manifest and build artifacts from the accepted
   source. Bind the directory origin through the host's config capability. Replace
   the ephemeral demo service with an explicitly protected, persistent service if
   durable proposals are required; the demo makes no such guarantee.
2. Run the governed Pulse artifact behind a private endpoint that validates the
   separate service credential. Prevent direct public access to the raw Entities
   endpoint. The acceptance proxy demonstrates this boundary locally; it is not
   deployment middleware. The supported production Node launcher is available through
   `@pulse-compute/provider-node/server`. OPS-01 rehearses this composition with
   exact installed artifacts; the credential-checking proxy and issuer in that
   rehearsal are still test fixtures, not production middleware.
3. Configure the external OAuth issuer, preregistered client, PKCE/resource support,
   confidential introspection client and exact audience. Assign read/propose grants
   deliberately. Do not reuse client access tokens as backend credentials.
4. Route public HTTPS `/mcp` and `/.well-known/oauth-protected-resource/mcp` to the
   loopback MCP listener. Set ingress header/body/time/concurrency limits and keep
   the protected backend private. This app provides no browser CORS integration.
5. With separate deployment authorization, rerun the named-client cases against
   the actual URL and record exact artifacts, issuer/client configuration excluding
   secrets, responses, lifecycle failures and rollback evidence. Until then,
   deployment, production issuer and provider-reality acceptance remain unclaimed.

## Operational qualification

Run `ops01-installed` through the repository test runner for the exact-artifact
Node production-launcher rehearsal alongside example 01 on Native. It preserves
baseline/candidate/rollback results, full artifact inventories and the pinned
client replay. The baseline is explicitly synthetic. See the repository's
`wasm/test/ops/OPS-01.md` for the live driver contract and remaining operator
inputs. Local passing results do not establish deployed acceptance or a
production issuer; OPS-01 remains open until that live evidence is recorded.
