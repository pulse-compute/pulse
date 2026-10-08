# PRPT-06 measured Report costs

Measured 8 October 2026 with the packed beta.7 CLI on Node v24.19.0, Linux x64
(kernel 6.18.44), AMD EPYC 9V74, 9 visible logical CPUs. Three sequential fresh
CLI processes per mode; OS caches were **not** flushed. No build overlapped these
samples. Wall time includes process startup, imports, collection and rendering;
maximum RSS is the child process Linux high-water mark, converted from KiB to MiB.
It is not a heap-only allocation count or an estimate of incremental cost over an
already-running CLI. Three observations are not a percentile/throughput study.

Raw samples and artifact hashes: [minimal](evidence/minimal.json),
[ARC](evidence/arc.json), [Catalog](evidence/catalog.json).

## Actual report contents

| Corpus | Routes / entries | Schemas / bindings | Recorded resources | JSON bytes | HTML bytes | Physical Wasm bytes | Final handler / reachable coverage |
|---|---|---|---|---|---|---|---|
| minimal | 3 / 3 | 0 / 0 | 0 (partial) | 23,382 | 127,678 | final 2,353 | 3/3 / 3/3 |
| arc | 18 / 23 | 17 / 4 | 0 (partial) | 347,222 | 451,668 | prelink 321,751, final 383,744 | 18/18 / 0/18 |
| catalog | 100 / 255 | 136 / 9 (partial) | 0 (partial) | 1,961,039 | 2,065,315 | final 3,315,675 | 12/100 / 0/100 |

Resource coverage is partial in all three reports, with expected count unknown. ARC
ships generated frontend literal bodies; the inventory does not map them as
resources. ARC final reachability is unavailable (`unsupported-call-graph`), not
zero reachable bytes. Own/Shared are unavailable in all three apps because the root
universe is incomplete. Prelink and final artifacts are distinct physical stages;
their sizes and mapping availability must not be summed or substituted.

## Report-only measurements

| Corpus | Mode | Wall ms, min / median / max | Peak RSS MiB, maximum | Samples |
|---|---|---|---|---|
| minimal | project-json | 771 / 786 / 801 | 228.9 | 3 |
| minimal | artifact-json | 117 / 140 / 142 | 51.9 | 3 |
| minimal | historical-json | 95 / 102 / 108 | 49.3 | 3 |
| minimal | project-html | 714 / 718 / 761 | 204.4 | 3 |
| minimal | historical-html | 97 / 101 / 108 | 49.5 | 3 |
| arc | project-json | 1065 / 1142 / 1160 | 215.7 | 3 |
| arc | artifact-json | 478 / 509 / 531 | 72.0 | 3 |
| arc | historical-json | 276 / 283 / 295 | 69.2 | 3 |
| arc | project-html | 1009 / 1115 / 1174 | 207.0 | 3 |
| arc | historical-html | 268 / 270 / 280 | 70.1 | 3 |
| catalog | project-json | 3478 / 3498 / 3540 | 369.9 | 3 |
| catalog | artifact-json | 2900 / 2943 / 2967 | 242.0 | 3 |
| catalog | historical-json | 1621 / 1623 / 1627 | 156.1 | 3 |
| catalog | project-html | 3544 / 3559 / 3591 | 369.2 | 3 |
| catalog | historical-html | 1529 / 1591 / 1595 | 161.6 | 3 |

`project-*` includes static profile resolution and current input/dependency
fingerprinting. `artifact-json` verifies a completed manifest and reads exact
retained Wasm/sidecars; it does not load project configuration. `historical-*`
validates/replays the saved capsule without recollection. HTML timing includes
rendering and atomic output/receipt writing. JSON byte counts are actual stdout;
HTML sizes are the written document, not the short success response on stdout.
The separately retained terminal and post-HTML freshness checks are correctness
checks, not extra benchmark samples.

Report collection left all four artifact hashes unchanged: minimal final, ARC
prelink/final and Catalog final. Physical section totals reconcile exactly. PRPT-03 supplies
the separate capture-enabled/disabled build proof (2,545-byte portable,
31,466-byte Fastly, 2,464-byte converging portable); those fixture builds were not
repeated. Full build-time overhead remains unmeasured by this packet.

## Suggested future review budgets

These are proposed **review triggers for these pinned corpora on a comparable
environment**, not default gates or universal performance promises. Each is twice
the observed maximum, rounded upward to 100 ms / 64 MiB. This explicit headroom
rule is a starting point, not statistical confidence from three samples. Rebaseline
on changed source/package identity, CPU/runtime or supported evidence shape.

| Corpus | Mode | Review above wall ms | Review above peak RSS MiB |
|---|---|---|---|
| minimal | project-json | 1700 | 512 |
| minimal | artifact-json | 300 | 128 |
| minimal | historical-json | 300 | 128 |
| minimal | project-html | 1600 | 448 |
| minimal | historical-html | 300 | 128 |
| arc | project-json | 2400 | 448 |
| arc | artifact-json | 1100 | 192 |
| arc | historical-json | 600 | 192 |
| arc | project-html | 2400 | 448 |
| arc | historical-html | 600 | 192 |
| catalog | project-json | 7100 | 768 |
| catalog | artifact-json | 6000 | 512 |
| catalog | historical-json | 3300 | 320 |
| catalog | project-html | 7200 | 768 |
| catalog | historical-html | 3200 | 384 |

For output growth on unchanged semantic inputs, investigate canonical JSON size
changes and HTML growth beyond 10% of the corresponding measured bytes. There is
no universal per-route byte budget: schemas, bindings, evidence and dual artifact
stages materially affect output. Catalog now has its own
measured baseline; it is not extrapolated from ARC.

## Catalog qualification

The pinned Catalog source compiled successfully for Node Native using the same
20-package installed candidate. The first attempt exited 3 with 132
`PULSE_NATIVE_IMPORT_UNSUPPORTED` diagnostics for crypto/S3 imports because the
qualification dependencies were above Catalog's explicit workspace boundary.
Contract discovery stops at that boundary. Copying the already installed
`node_modules` **inside** Catalog's workspace fixed the qualification setup; all
1,519 dependency files (including third-party dependencies) matched their original
bytes. This changed no authored source, package manifests, trust policy or compiler
behavior. The second build completed within the explicit 600-second attempt bound.

All 17 report commands passed with zero guard violations. Actual inventory is
100 routes, 255 entries, 136 schemas, 9 recorded bindings and 0 recorded resources.
Binding and resource coverage are partial with unknown expected counts. Handler
body coverage is **12/100**: 88 routes have `unsupported-mapping`; the 12 mapped
routes have `unsupported-call-graph` reachability. Own/Shared remain unavailable
for all routes because the ownership-root universe is incomplete. These are
producer/attribution limits in a valid report, not failed report generation or
permission to synthesize size values. The physical 3,315,675-byte final Wasm ledger
reconciles exactly and is unchanged by reporting.

The real JSON is 1,961,039 bytes and the HTML 2,065,315 bytes. Four literal S3
credential/endpoint/path canaries were absent from both exports. Raw private
source/build output/capsules remain outside the public packet; only aggregate
receipts, source pins and artifact/evidence hashes are retained. Only the selected
Node Native profile was qualified; no Catalog Fastly/all-profile sweep or live
application deployment was performed.

The initial report run exited successfully, but its saved progress receipt lacked
the final status despite successful terminal output. A sequential rerun produced
a complete terminal receipt and identical JSON/HTML bytes. This table uses only
the final rerun's three samples per mode; it does not mix the two runs.

