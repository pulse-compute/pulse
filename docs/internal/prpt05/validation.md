# PRPT-05 validation

Source: implementation working tree based on `246247a` (`latest`, PRPT-04 merge).
Final file hashes and completed checks are recorded in `validation.json`.
No pass is inferred from a started process or a missing dependency.

Final result: **79/79 unit + CLI tasks passed**, with terminal status and complete
selected-task coverage verified. Seven focused final task executions cover the
last renderer, output-path and catalog changes. Maintainer checks, declared scope,
workspace TypeScript build, docs sync/corpus/resync/check and documentation release
passed. The final docs check resolved **20,548 local links**. The canonical and
packaged context corpus match (228 records, 460,130 module bytes).

The pnpm build wrapper was not retried: this environment has pnpm 11.25.0 against
the repository’s ^12.4.2 requirement, already established in PRPT-04. The exact
installed TypeScript build script ran directly and passed. No release seal or
installed-package browser qualification is claimed.

## Portable scope

The registered `cli-report-viewer` task checks deterministic HTML, complete
capsule recovery/export, hostile closing-script/markup/control/URL-like strings,
fixed script/style CSP digests, lack of executable data sinks/external assets,
raw-byte ordering, combined route filters, schema search/ordering, unavailable
states, exact generated-file receipts, safe build-input rejection, symlink and
malformed receipts, edited-output freshness and atomic replacement failure.

`cli-report-workflow` runs the public binary, including production HTML rendering
and compiler/provider/subprocess/network import guards. `cli-report-retained-evidence`
uses real completed Wasm, checks repeated default/custom HTML against JSON, edited
output rejection, watch-input binding, and freshness after the existing recovery
build. It does not add a build merely to improve report content.

Initial focused attempt: viewer passed; workflow stopped on a duplicate variable
in the updated test. The test variable was renamed before retry. Preserve this
failed attempt alongside successful terminal receipts in the machine record.

A late review tightened duplicate-measurement handling: when a subject/metric has
multiple records for the primary artifact, the viewer leaves the size unavailable
and directs the reader to the full capsule instead of choosing one silently. A
focused final rerun identifies the final renderer and integration bytes. A final
output-path check also rejects filenames the retained reader cannot accept
(control, colon and percent characters), before a file or receipt is written.
The writer/CLI tasks were rerun for that change.

An exploratory TypeScript check of the two separate browser source files was not
a passing gate: it lacked DOM iterable types and treated the model file as a
CommonJS module, unlike the concatenated embedded script; tuple inference also
flagged the fixed previous/next list. The registered renderer task parses the
actual combined script. The required workspace TypeScript build is recorded
separately, without claiming that it type-checks the browser DOM code.

## Browser qualification checklist

**Pending; not passed.** The local browser executable was absent and the official
Playwright download returned invalid/truncated archives. Initial automatic approval
review blocked transfer to the remote browser. The user subsequently explicitly
authorized opening synthetic reports and the ARC design fixture there.

The authorized attempt on 2026-10-08 UTC exposed two environment limitations:

- The remote browser returned `net::ERR_CONNECTION_REFUSED` for the workspace's
  dedicated localhost server, which served only the authorized synthetic files.
- Following the documented shared-file mapping, direct `file://` navigation was
  rejected by the browser URL policy, which allows only HTTP/HTTPS and explicitly
  prohibited workarounds. No alternate transfer/control mechanism was attempted
  after that rejection. The temporary server was stopped.

Authorization is no longer missing. Browser execution requires an environment
that supports these local files; this session cannot establish the checklist
below. No report DOM, rendered screenshot, download, or browser interaction pass
was observed. Portable model assertions are not DOM/layout proof.

Use the exact locked design HTML and route/expanded-schema previews from the
[implementation packet](README.md#locked-design) as reference, plus minimal,
unknown, hostile-string and representative native Report capsules. Keep synthetic
data labeled synthetic. Perform these checks in a browser with outbound requests
blocked, including direct `file://` opening:

1. Desktop and narrow/mobile, light/dark: compact route-first layout, readable
   count/coverage labels, horizontal tables and full-width drawer without page
   overflow. Compare expanded and collapsed schemas to the locked preview.
2. Combine/reset each route filter, choose each size metric, sort both directions,
   verify unavailable last and visible/total counts. Duplicate registrations stay
   distinct; filters never change the exported capsule hash or record count.
3. Open/close the route drawer, use all three tabs and arrow/Home/End keys,
   previous/next, Tab/Shift-Tab, Escape and focus restoration. Navigate route →
   expanded schema → route and verify route filter preservation.
4. Search schema field names; sort name/keys/required/descriptor/routes; expand
   properties, normalized descriptor and source evidence. Check N/A/non-object,
   unavailable schema and required-state presentation.
5. Expand resources and inspect ledgers, bindings, observations and evidence.
   Raw JSON/download must byte-match `pulse report --json` including a trailing
   newline after interactions. Download must work without a server.
6. Hostile payload must stay inert: no injected elements, script/event execution,
   payload URL navigation or outbound requests. Capture browser console/CSP
   findings and screenshots, with source/fixture hashes and tested viewport sizes.

A09/A16 and browser portions of A10 remain open until those observations exist.
