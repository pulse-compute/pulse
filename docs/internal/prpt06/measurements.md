# PRPT-06 measured Report costs

Measured 8 October 2026 with the packed beta.7 CLI on Node v24.19.0, Linux x64
(kernel 6.18.44), AMD EPYC 9V74, 9 visible logical CPUs. Three sequential fresh
CLI processes per mode; OS caches were **not** flushed. No build overlapped these
samples. Wall time includes process startup, imports, collection and rendering;
maximum RSS is the child process Linux high-water mark, converted from KiB to MiB.
It is not a heap-only allocation count or an estimate of incremental cost over an
already-running CLI. Three observations are not a percentile/throughput study.

Retained public fixture samples: [minimal](evidence/minimal.json).
Private consumer measurements are excluded from this repository.

## Actual report contents

| Corpus | Routes / entries | Schemas / bindings | Recorded resources | JSON bytes | HTML bytes | Physical Wasm bytes | Final handler / reachable coverage |
|---|---|---|---|---|---|---|---|
| minimal | 3 / 3 | 0 / 0 | 0 (partial) | 23,382 | 127,678 | final 2,353 | 3/3 / 3/3 |

The minimal fixture has partial resource coverage with an unknown expected count.
Own/Shared attribution remains unavailable because ownership roots are incomplete.
Prelink and final artifacts are distinct scopes and must not be summed or substituted.

## Report-only measurements

| Corpus | Mode | Wall ms, min / median / max | Peak RSS MiB, maximum | Samples |
|---|---|---|---|---|
| minimal | project-json | 771 / 786 / 801 | 228.9 | 3 |
| minimal | artifact-json | 117 / 140 / 142 | 51.9 | 3 |
| minimal | historical-json | 95 / 102 / 108 | 49.3 | 3 |
| minimal | project-html | 714 / 718 / 761 | 204.4 | 3 |
| minimal | historical-html | 97 / 101 / 108 | 49.5 | 3 |

`project-*` includes static profile resolution and current input/dependency
fingerprinting. `artifact-json` verifies a completed manifest and reads exact
retained Wasm/sidecars; it does not load project configuration. `historical-*`
validates/replays the saved capsule without recollection. HTML timing includes
rendering and atomic output/receipt writing. JSON byte counts are actual stdout;
HTML sizes are the written document, not the short success response on stdout.
The separately retained terminal and post-HTML freshness checks are correctness
checks, not extra benchmark samples.

Report collection left the minimal artifact hash unchanged, with physical section
bytes reconciling exactly. PRPT-03 supplies the separate passive-capture proof;
those fixture builds were not repeated. Total build overhead remains unmeasured.

## Suggested future review budgets

These are proposed **review triggers for this public fixture on a comparable
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

For output growth on unchanged semantic inputs, investigate canonical JSON size
changes and HTML growth beyond 10% of the corresponding measured bytes. There is
no universal per-route byte budget: schemas, bindings, evidence and physical
artifact stages materially affect output. Private consumer results are not
published as baselines or release promises here.
