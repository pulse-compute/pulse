# `@pulse-compute/cli`

**npm:** [`@pulse-compute/cli`](https://www.npmjs.com/package/@pulse-compute/cli)

`@pulse-compute/cli` owns the supported `pulse` command, project configuration types, project discovery, compilation workflow, local execution, and target builds.

## Install and initialize

The current repository CLI is a source candidate. Its conventional initializer
depends on the public `@pulse-compute/pulse` package and is validated from both
the checkout and the exact packed acceptance set:

```bash
pnpm pulse -- init ./my-app
cd ./my-app
npm install
pulse doctor
```

`pulse init` writes a conventional `.pulse/config.ts` workspace, an async
`Pulse` application root, a dedicated `tests/pulse.harness.ts`, strict
TypeScript configuration, and exact source-candidate package versions. It does
not run a package manager or perform hidden network work. Public npm
availability is defined by the synchronized [release manifest](../maintainers/release-manifest.md).

## Offline documentation

Run `pulse docs` from any directory to print the executing CLI's version and the
absolute path to its shipped Markdown index. It uses the installed package,
including local and global installations, rather than the current project or
website version. Paths containing spaces are returned intact.

```bash
pulse docs
pulse docs --json
```

The JSON result has the stable shape
`{ "status": "ok", "version": "<CLI version>", "docs": { "root": "<absolute directory>", "index": "<absolute README.md path>" } }`.
The paths are physical filesystem paths. Read the index with your editor or
Markdown viewer; the command does not open a browser, discover or load a project,
compile code, install dependencies, start a server or access the network.

An unavailable index reports `PULSE_DOCS_UNAVAILABLE`; an invalid index reports
`PULSE_DOCS_INVALID`. Both exit 5, with diagnostics on stderr (one JSON error
object with `--json`). The index must be a readable, nonempty UTF-8 file inside
the package's documentation directory. This check does not audit every document
or prove package integrity. `--plan` describes the locator without validating
the index. `--evidence-status` wraps the result without claiming report evidence.

## Daily workflow

```bash
pulse doctor
pulse inspect
pulse test
pulse dev
# Stop the foreground server with Ctrl-C before building.
pulse build
```

`build` realizes the provider and target selected by the active profile. A separate
`compile` step is not a prerequisite. Use the command overview to choose a task:

| Command | Use it to |
|---|---|
| [`init`](../reference/cli.md#pulse-init) | Create a conventional project without installing dependencies. |
| [`doctor`](../reference/cli.md#pulse-doctor) | Validate project, provider, dependencies and external toolchain readiness. |
| [`inspect`](../reference/cli.md#pulse-inspect) | Compile and report effects, continuations, schemas, event registrations/callsites, capabilities, target eligibility and provider lowering without executing cases. |
| [`test`](../reference/cli.md#pulse-test) | Execute configured request and explicit `kind: 'event'` cases through the provider-owned local conformance runtime. |
| [`dev`](../reference/cli.md#pulse-dev) | Run a foreground local server and watch the project by default. |
| [`build`](../reference/cli.md#pulse-build) | Write the configured Native or JavaScript target realization. |
| [`report`](../reference/cli.md#pulse-report) | Review retained Native build evidence; see [Reports](#reports). |
| [`compile`](../reference/cli.md#pulse-compile) | Produce provider-neutral Native Wasm for advanced inspection or integration; see [Compile-only output](#compile-only-output). |
| [`docs`](../reference/cli.md#pulse-docs) | Locate the offline documentation shipped with the executing CLI version. |

Native builds emit provider Wasm; JavaScript builds emit deterministic source
packages. Eligible event projects also emit `event-catalog.json` and
`event-inspection.json` beside the target output. Fastly JavaScript packages carry
exact downstream compiler pins and deployment-candidate metadata.

### Doctor observations

Doctor's `native-expansion` check ranks repeated HTTP owners using existing Router
body ranges and the Native plan already produced by doctor. It names source
locations, registration multiplicity, retained stages and per-registration body
instances. The source cost is UTF-8 bytes of lowered Router bodies before Native
factoring; it is not generated AssemblyScript, final Wasm size or a promised
saving. Repeated Native bodies with at least 1,024 additional source bytes raise
`PULSE_NATIVE_EXPANSION_REPEATED`; `--strict` treats that warning as a failed audit.
JavaScript selections receive advisory Native counts without this size warning.

Current retained HTTP stages require transfer-capable route or middleware
handlers with 1–64 bound, ungrouped text-fetch, `time.now` or `crypto.digestText`
effects and matching lowered bodies across their registrations. Existing bounded
pure loops are supported within stages. Error/event registrations, terminal
private bodies, helper calls, other effect shapes and effect loops keep ordinary
Native lowering. These observations
help locate missed sharing; declaring a source function alone does not retain a
compiled body.

Human output shows five owners; JSON retains up to twenty, three registration
examples each, and explicit omitted counts. Sharing stays unknown when Native
planning is unavailable. A completed plan remains inspectable if later Native
compilation fails. This check adds no second compilation, source census or Wasm
disassembly. Inspect the named owner and its observed registration/effect shapes
against the retained-stage contract, then measure a full target build before
adopting a generator rewrite for size.

For Native builds, `--experimental-native-bounded-size` selects AssemblyScript O3/shrink2 without convergence. The existing `--experimental-native-size` flag retains O3/shrink2 with convergence. Both are opt-in and mutually exclusive; build manifests record the chosen recipe.

See the generated [CLI reference](../reference/cli.md) for every option, positional form, output, side effect, and exit behavior.

## Compile-only output

`pulse compile` is an advanced provider-neutral Native compilation command, even
when the selected profile uses JavaScript. It requires Native-compatible source
and writes deterministic Pulse Wasm, its Native plan, generated AssemblyScript
and manifests. Diagnostic WAT is opt-in with `--emit-wat`. Use `pulse build` for
the ordinary lifecycle and configured provider realization.

## Reports

For agents, `--evidence-status` adds a JSON presentation of command outcome,
evidence identity, coverage, provenance and snapshot validity around the original
result. See the [interpretation contract](../guides/troubleshooting.md#agent-evidence-status).
`report --json` alone continues to emit the authoritative report v1 capsule.

`report` reviews retained evidence from a successful Native build: a compact overview by default, or one complete capsule with `--json`. `--artifact` replays a supported manifest or historical capsule without loading project code. `--html` writes a self-contained offline viewer with expandable schemas and full JSON export. It never opens a browser. `--out file.html` selects a contained destination; generated-output receipts beside the file preserve repeatable project matching. Reports contain build-review metadata; review before sharing.

Retained inventory and HTML data use lossless normalized storage when smaller.
Reports retain all identities, evidence and coverage. CLI `--json` and viewer
downloads still emit canonical Report v1 JSON, compatible with older readers
within their size limits;
new readers also accept normalized inventory files with `--artifact`. Older
readers reject normalized storage. Both stored and expanded data allow up to
64 MiB, with a two-million-value work budget. Comparison HTML keeps one data payload; its full
JSON disclosure and export require JavaScript, while summary/details remain
readable without it.

Route counts distinguish registrations from distinct method/path pairs. Fresh
compiler evidence labels registrations **terminal** or **continuing**: continuing
handlers can call `next()`, including conditional and error transfers, and may
also respond early. Older reports show **Behavior not recorded**. Attribution
details distinguish mixed dispatcher bodies from missing mappings; containing
dispatcher bytes are not isolated handler bytes or a complete endpoint size.
The registration drawer shows its own entry's containing bodies, known co-owner
registrations, and recorded helper/stage links. The route list shows containing
bytes separately and unions distinct physical bodies across the current filter;
overlapping route sizes must not be summed. Missing body mappings stay unknown.
Entry references use readable recorded names, kinds and method/path labels with
collision-safe shortened IDs. Follow a link to the searchable Entries view for
source locations, full canonical and handler IDs, recorded flow references and
related registrations. Missing names or source locations stay explicit; labels
and navigation never change the embedded capsule or exported JSON.
The compact route table separates handler measurements from containing-body
sizes and keeps coverage and non-additive qualifications beside those values.
Desktop route details use a wider panel; phones retain a full-width drawer and
scrollable table. Evidence is collapsed by kind and exact producer version,
with individual result counts visible and full record scopes available inside.

**Execution atlas** explores retained handler registrations, middleware and
subrouter mounts. Choose **Show graph** on narrow screens, search or focus a
subrouter, and follow an exact instance to its authored definition and source.
Graph curves show mount containment, not observed requests. The graph draws
at most 300 nodes; the paged routing table retains every matching registration.
**Bindings** in the atlas connects retained contextual consumers to logical
bindings and authored operations. Select a node for association evidence and
exact registration links; graph and evidence pages preserve larger inventories.
The **Bindings** tab shows application-wide consumers even when a route is
selected in Routing. Use a registration's **Explore bindings** action to narrow
the scope explicitly, then **All consumers** to return to application scope.
Missing or partial analytics remain explicit and never imply no dependencies
or effective permissions. **Expand workspace** gives the graph more room, with
optional details and width controls; Escape exits the expanded view. These
views use the same offline payload and leave full JSON exports unchanged.

The report's **Build** summary retains elapsed time through inventory capture,
AssemblyScript compilation time, target/profile, Pulse/compiler versions and
effective optimization settings. Expand **Build details** for stage timings,
compiler/toolchain versions and effective invocation flags. File arguments use
role placeholders; arbitrary environment values, secrets and provider binding
values are excluded. Compilation time sums the portable and provider asc
invocations, is included in stage timings, and excludes source planning and
guest linking. Total time excludes configuration resolution before build entry,
report serialization and final publication. These are observations from that
build, not benchmark results. Node's reuse of portable Wasm is recorded separately
from compiler cache reuse; unobserved caches and older metadata say **Not recorded**.
The optional metadata lives in the hash-bound inventory, never in executable Wasm.

## Project configuration

```ts
import { defineConfig } from '@pulse-compute/pulse'

export default defineConfig((_scope) => ({
  pulse: {
    entry: 'src/index.ts',
    tests: 'tests/pulse.harness.ts',
    defaultProfile: 'local',
    strict: true,
  },
  local: {
    host: 'node',
    target: 'native',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
  },
}))
```

The generated application imports `Pulse` from `@pulse-compute/pulse`, declares
managed handlers `async`, and keeps deterministic request cases in the separate
harness module. Workspace discovery starts from `.pulse/config.ts`.

Harness event cases require the explicit `kind: 'event'` discriminant, one
canonical input frame, and an ordered exact `expect.emitted` array. HTTP cases
retain their existing shape and default behavior. There is no public `pulse
event` command and `pulse dev` remains HTTP-only.

The complete event workflow, queue, artifact, target, and diagnostic boundary
is in [Static events and outbound emission](../guides/events.md).

## Machine-readable contracts and shell completion

The installed package exposes release-owned machine interfaces for editors, automation, validation, and documentation tooling:

| Export or command | Contract |
|---|---|
| `pulse completion bash` | Bash completion generated from the public command specification. |
| `pulse completion zsh` | Zsh completion generated from the same specification. |
| `pulse completion fish` | Fish completion generated from the same specification. |
| `@pulse-compute/cli/cli-spec.json` | Public commands, options, aliases, positional forms, provider restrictions, output modes, and completion metadata. |
| `@pulse-compute/cli/project-config.schema.json` | JSON Schema bundle plus discovery, precedence, defaults, runtime rules, and provider configuration schemas. |
| `@pulse-compute/cli/release-manifest.json` | Exact release, hosted-documentation routes, package tiers, supported entry points, and publication policy. |
| `@pulse-compute/cli/documentation-versions.json` | Available documentation versions and the current `latest` target. |
| `@pulse-compute/cli/project-config-schema` | Programmatic schema, defaults, structural validation, and reference metadata. |

These files are generated from the same modules used by the parser, runtime configuration loader, package packer, and documentation release gate. See [Shell completion](../reference/shell-completion.md), the [CLI specification](../reference/cli-spec.json), the [project configuration schema](../reference/project-config.schema.json), and the [release manifest reference](../maintainers/release-manifest.md).

## Public entry points

The supported package surface is:

| Entry point | Intended use |
|---|---|
| `pulse` binary | Application and CI workflow. |
| `@pulse-compute/cli` | `defineConfig`, project-config types, diagnostics helper, and programmatic workflow entry. |
| `@pulse-compute/cli/workflow` | CLI parsing and execution integration. |
| `@pulse-compute/cli/project-config` | Project discovery and normalization integration. |
| `@pulse-compute/cli/project-execution` | Canonical doctor/inspect/test/dev/compile/build orchestration. |
| `@pulse-compute/cli/diagnostics` | Stable public diagnostic descriptors and mappings. |

Other files present in the tarball are not automatically public APIs.

## JSON output

Completed commands emit one JSON object with a trailing newline when `--json` is used. `pulse dev --json` emits newline-delimited event objects instead of one enclosing document. Supported events include `compiled`, `ready`, `reloaded`, `request`, `compile-error`, and `request-error`.

Completed results normally use stdout; command-level diagnostic failures use
stderr and a nonzero exit status. Capture both streams separately. A completed
doctor audit can report failed checks on stdout and exit 1. Stable failures
include a public diagnostic code, remediation, exit class and exact-version
documentation URL. See [Reading command results](../guides/troubleshooting.md#reading-command-results)
and [Diagnostics and remediation](../reference/diagnostics.md).

## Provider behavior

The CLI supports `node`, `fastly`, and compile-only `none`. Node and Fastly each
accept an explicit `native` or `javascript` execution target:

- Node Native lowers to Pulse-owned Wasm and executes through the Node host.
- Node JavaScript loads the reachable application graph and runs the live runtime and package implementations.
- Fastly Native emits compact direct-host-ABI `bin/main.wasm`.
- Fastly JavaScript emits a deterministic source/deployment package and a structurally deployable downstream runtime candidate.
- `none` can inspect or compile canonical output but cannot serve or run tests.

For projects with reachable event registrations or `ctx.emit` callsites, Node
Native and Node JavaScript are eligible for the bounded reference workflow.
`inspect`, `doctor`, compile/build manifests, and event inspection artifacts
report the catalog, schema IDs, callsites, host requirements, and per-command
target support. `none` remains useful for compile-only catalog inspection.
Fastly Native and JavaScript fail closed with exact event-ingress or event-emit
diagnostics; Pulse does not translate that plane through HTTP or GRIP and never
changes targets automatically.

`pulse compile` is provider-neutral regardless of the configured provider. It produces the portable Pulse-owned Wasm boundary directly; `pulse build` continues to own provider realization.

Those provider IDs are configuration data, not command-layer implementation
branches. The CLI consumes a neutral facade over the compiler-owned fixed
registry; concrete provider imports, configuration policy, and target adapters
remain outside the CLI package. Node retains a deliberate reference/smoke role
for canonical Native behavior.

Both JavaScript declarations satisfy full-target-support and report general
availability. Project eligibility remains separate, and target selection never
falls back automatically. Fastly JavaScript `test` and `dev` identify their
execution mode as provider emulation; the offline candidate gate compiles a real
Fastly JavaScript runtime artifact but performs no deployment or publication.

Provider and target selection change realization, not handler APIs. See
[Contracts and providers](../concepts/contracts-and-providers.md).

## Installed documentation payload

The CLI npm package ships:

- this public documentation hierarchy;
- the canonical API reference;
- CLI, configuration, diagnostics, environment, release, and version references;
- generated command/config/release machine interfaces and shell completions;
- package and contributor guides;
- ten complete lifecycle example projects plus the focused Entities candidate,
  including static Router lowering and mixed HTTP/event authoring.

This makes diagnostic links and package README links usable from an installed exact-version release rather than depending on monorepo paths.

## Safety boundaries

- Build output must remain a real descendant of the project root.
- `--no-clean` does not disable traversal or symbolic-link safety checks.
- Raw configured secrets are redacted from public JSON and diagnostics.
- `dev` is a foreground process, not a hidden daemon.
- Repository-only fixture/profile/task flags are excluded from installed help and the public reference.
- Fastly external execution is delegated to the Fastly CLI; the reality gate may pass an inspected Viceroy path, but Pulse does not launch Viceroy directly.

## Related documentation

- [Getting started](../getting-started.md)
- [Project lifecycle](../guides/project-lifecycle.md)
- [Static events and outbound emission](../guides/events.md)
- [Provider and target compatibility](../reference/compatibility-matrix.md)
- [Managed handler TypeScript and JavaScript](../reference/handler-authoring.md)
- [Node build and execution](../guides/deploying-node.md)
- [Fastly deployment candidates](../guides/deploying-fastly.md)
- [CLI reference](../reference/cli.md)
- [Shell completion](../reference/shell-completion.md)
- [Project configuration](../reference/project-config.md)
- [Release manifest and package policy](../maintainers/release-manifest.md)
- [Documentation versioning](../maintainers/documentation-versioning.md)
- [Environment-variable reference](../reference/environment.md)
- [Release acceptance](../maintainers/release-acceptance.md)
