# PRPT-04: Report CLI integration

Implements the command portions of A06/A10–A12/A15 in the
[v2 plan](../prpt00/feature-spec-v2.md), using the [01 capsule contract](../prpt01/README.md),
[02 retained collector](../prpt02/README.md) and [03 size adapter](../prpt03/README.md).
The [locked ARC design fixtures](../prpt00/README.md#00a-exact-design-contract)
remain binding for PRPT-05, including expandable schema update views,
property/type/required rows, descriptor provenance and referencing routes.
No synthetic ARC values or generic JSON-dump viewer enter the CLI.

Entry point: none; ordinary root/wasm/CLI/docs instruction chain.
Human direction: implement PRPT-04 against `latest`, after PR #224 merged at
`f22d5a9`. Classification: scope-expansion. Sizing recommendation remains
**Sol / medium**. No delegation was used. Protected path touches are `configuration-contract` (shared discovery/error
owners) and `runtime-target-fluidity` (existing error serialization moved out of
project execution), plus current contracts; semantic changes
are the authorized Report command and lazy startup, with no provider discovery,
compiler trust, target selection, package exports or release authority changes.

## Implemented behavior

- `pulse report [directory] [--profile name]`: canonical workspace discovery,
  then the existing static collector checks selected profile and retained inputs.
  It does not evaluate config/app/harness modules or compile Wasm.
- `--json`: complete deterministic capsule plus newline on stdout; failures use
  the existing JSON diagnostic envelope on stderr with no success stdout.
- `--artifact file.json`: validated completed-Wasm manifest or historical capsule;
  no project/compiler/provider modules, process spawning or network imports are
  needed even during CLI startup and error handling. Historical identity is
  preserved without claiming current-input freshness.
- Default terminal overview: application/profile/host/Native target, evidence hash,
  revision and dirty/unknown state, inventory counts, exact primary Wasm bytes,
  mapping availability/coverage, observations and inventory/sidecar gaps. Text
  controls, bidi controls and markup are escaped, and long labels are bounded.
  Inventory counts describe retained records; coverage gaps stay visible.
- `--plan` / `--dry-run`: describe input/format/destination only. Project discovery
  reads directory metadata, but profile selection and evidence collection wait
  until execution. Artifact input need not exist to describe its plan.
- Format/selection exclusions are checked in parser and normalized-object paths.
  `--out` is HTML-only and resolves under the project root or artifact parent.
- Public diagnostics distinguish invalid/integrity inputs, missing evidence,
  stale/currently-changing evidence, incompatible representation/version,
  unsafe output, write failure and pending HTML. Internal source/config payloads
  are not echoed in report diagnostics. Optional gaps do not fail eligibility.
- The internal HTML writer creates only needed parent directories and atomically
  replaces a designated regular `.html` file through a private temporary file.
  It rejects traversal, escapes, symlink ancestors/targets (including dangling
  links), and nonregular targets. Failure cleanup touches only its temporary;
  existing output and unrelated files are retained. Ancestors are rechecked
  before replacement; this is not an OS sandbox against hostile filesystem races.

Common project errors and error serialization moved into lightweight internal
owners; the existing project modules re-export/use those same implementations.
All existing commands retain their operations through lazy delegation. Public
help, completions, CLI spec and diagnostics derive from canonical catalogs.

## Original handoff gates

The implementation and output-snapshot gaps below are addressed by the
[PRPT-05 implementation](../prpt05/README.md). This section preserves the PRPT-04
handoff state; see that packet for current browser qualification limits.

**At the PRPT-04 handoff, PRPT-05 had not landed.** The ticket graph requires it for final HTML integration.
At that handoff, `--html` returned `PULSE_REPORT_HTML_UNAVAILABLE` (exit 3), creates no file
and never opens a browser. Its plan and safe-output path are available. The writer
is exercised with a test-only renderer through an internal executor seam; this is
not a supported plugin API or proof of a production HTML report.

PRPT-05 must connect the actual capsule renderer, remove the pending diagnostic
path/catalog wording, and test terminal-to-HTML/JSON identity using real output.
It must also resolve output snapshot semantics before enabling writes: PRPT-02's
conservative input scan currently includes arbitrary HTML and `.pulse/reports`.
A newly written report can therefore stale the next current-project collection.
A reserved generated-output policy must preserve source/resource identity;
blanket exclusion of all HTML is not acceptable. Artifact replay is unaffected.

PRPT-05 owns offline/mobile/keyboard/hostile-HTML and expanded/collapsed schema
qualification against the exact v2 fixtures. PRPT-06 owns installed-package,
real ARC/Catalog, cost and acceptance-matrix closure. Those gates, runtime parity,
external provider reality, release sealing, publishing and deployment are not
claimed by this CLI packet. See [validation](validation.md) for bounded evidence.
