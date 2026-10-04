# PS3 Native read-loop memory evidence

PS3 uses cumulative accounting and request-lifetime handles. No collector or
guest ABI change is needed for the measured receipt traversal. This is
development evidence; packed consumers, provider engines and application
adoption remain PS4.

Run the permanent contract coverage with:

```sh
node wasm/scripts/run-wasm-tests.cjs --task bounded-read-loops
```

`bounded-read-loop-memory.cjs` covers exact byte/value boundaries, latched
failure, sparse container growth, cyclic aliases, oversized settlements,
pending-ticket invalidation, and a Router error handler that must not recover
into another effect. Complete KV-only artifacts have an encoded memory ceiling.
The receipt workload uses 64 pages of exactly 57,344 UTF-8 bytes. Each page has
64 receipts, an S3 read, digest verification, schema decoding and all receipt
field checks. An alias into the first decoded page survives every suspension
and appears in the response. A continuing chain returns HTTP 409, not absence.

## Capacity measurement

Measured on 2026-09-22 with Node 24.19.0, AssemblyScript 0.28.18 and json-as 1.5.0.
Counters describe conservative logical retention, not
Node RSS or live Wasm heap bytes. Linear memory is committed capacity/high-water;
it includes allocator, parser, codec and crypto temporaries.

| Artifact / workload | Node accounted bytes | Fastly accounted bytes | Fastly linear-memory bytes |
|---|---:|---:|---:|
| Receipt fixture, zero pages | 4,212 | 2,094 | 7,208,960 |
| Receipt fixture, 64 full pages | 56,585,316 | 27,610,110 | 57,671,680 |
| Full Catalog composition, zero pages | — | 2,094 | 6,029,312 |
| Full Catalog composition, 64 full pages | 56,585,316 | 27,610,110 | 96,468,992 |
| Runtime ceiling | 67,108,864 | 67,108,864 | 268,435,456 |

The 64-page workload used 238,426 Node value/edge units and 252,270 Fastly units,
below the 1,048,576 ceiling. Diagnostic execution labels can change Node byte
counts slightly. The final Wasm memory type declares maximum 4,096 pages;
attempting to grow beyond it fails. Linked guests keep their existing smaller
fixed-memory contract.

The full composition used the recovered Catalog API source, its complete
schema registry, and an isolated route built from the test's exported
`receiptHandler`, `receiptTypes` and `pages` fixtures. The route was inserted
before existing application routes; it measures the complete artifact's
baseline and the receipt workload, without claiming acceptance of the adopted
administration path or its authentication flow. Both Node Native and injected
Fastly execution returned `64:cmd-0`.

The composition contained 565 static effect sites, 4,926 locals and 93 schemas.
Its Fastly artifact was 2,441,759 bytes, SHA-256
`cf002df25ce850eab35c052b1b999c7a2bf360153b1edef58fefa6e447fecbd3`.
The SHA-256 of the sorted JSON source inventory (`path`, `sha256` for every file
under the composed `src`) was
`49e5ae817be47d7029b772cf2b7e7ced27435ce0872d161d0488a6390c811787`.
The standalone receipt artifact was 123,042 bytes, SHA-256
`716a8111b97f233caa90968d77477a00988f9f081e75f8d7d9b74e1e4bcca457`.

The full composition was compiled through `compileProject`,
`buildCanonicalNativePlan`, `compileCanonicalNativePlan` and
`compileFastlyNativePlatformCapabilitiesPlan`; memory limits were read from
the final binary with Binaryen. The existing provider fixture host supplied
the 64 object responses. No Catalog application source or credentials are
embedded in this repository fixture.

Earlier attempts retained during development exposed an unsupported return
inside a pure loop, the final Native manifest overwriting the generated policy,
and an unsuitable MVP-only inspection tool for this unlinked artifact. The final
contract tests and the final full-artifact measurement pass; earlier attempts
are not release evidence. No Viceroy, deployed provider, general collector, or
JavaScript process-memory containment is claimed.
