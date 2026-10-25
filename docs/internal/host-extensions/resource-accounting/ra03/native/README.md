# RA-03 Native follow-up — fixed-profile proof

Status: **internal compiled experiment; no production integration**. Base:
`1349e16` (`hex-integration`, merged JS RA-03 #530). Human direction:
“we really need answers for native.” No exact named Entry Point covers this
internal cross-owner experiment; ordinary root/docs instructions apply. Change
class: evidence; scope: evidence-only; protected boundaries: none.

## What this answers

A fixed-profile AssemblyScript ledger compiles and preserves all 33 saved RA-02
trace outcomes, compared after every event. Another 15 standalone checks cover
pre-registered records, ownership, stale references, deadline/late output,
finite work steps with separate cleanup allowance, emergency overflow and 5,000
cycles without growing memory. **48 ledger checks and 15 generated-driver checks
pass.** The actual Wasm and generated sources are retained, not just estimates.

The driver fixture compiles canonical `ctx.parallel` time handlers with one fixed
keyed cohort through the existing Native plan and Fastly generator. It injects
checked investigation-only hooks into generated source. Existing invocation
tickets still count captured roots, and the existing sampled deadline clock is
reused. A shortage dispatches zero members. Unknown disposal stays charged after
return. Expiry after the first member preserves that claim and suppresses siblings.
The normal control and instrumented handler have identical responses and host-call
sequences, with no additional host imports. Production files and scheduler are
unchanged. Time effects carry **synthetic accounting claims**: they do not acquire
real resource handles or establish cache/fetch cleanup behavior.

## Storage, binary size and execution cost

| Cohort width | Fixed ledger bank bytes | Added handler Wasm bytes | Miss cycle µs | Full cleanup cycle µs |
| --- | ---: | ---: | ---: | ---: |
| 8 | 4,608 | 3,592 | 6.97 | 8.29 |
| 16 | 9,024 | 3,685 | 22.61 | 35.87 |
| 32 | 17,856 | 3,729 | 123.04 | 153.73 |

Banks use `2 × width` root slots, six claim records and three child tickets per
root, two emergency records and a 32-member cohort buffer. Their exact storage is
`552 × width + 192` bytes. This excludes Wasm globals, engine metadata, provider
buffers, application state and host resources. The generated-driver bridge adds
five raw bytes per member for its claim/done buffers. The standalone ledger uses
one 64 KiB linear-memory page at all widths; its compiled module has no imports
and no `memory.grow` instruction. Its hot operations use raw bounded banks, no GC
objects and no allocator calls. This is not a no-allocation claim for the handler.
Both complete driver variants ended with 1,310,720 bytes of Wasm linear memory in
this fixture; equal page totals do not mean zero accounting storage or equal RSS.

Timing columns are medians of nine local Node/WebAssembly samples, each containing
3,000 whole-cohort lifecycles after 1,000 warmups. Each batch runs within Wasm,
without a JS boundary per event. Cycles include reset/admission/acquisition,
qualified refund, finish and end; cleanup adds protected cleanup work after stop.
All wall and process-CPU samples, other scenarios and host details are retained.
These are narrow microbenchmarks, not Fastly latency or hardware qualification.
The native API and benchmark methodology differ from the JS prototype, so their
numbers do not support a direct language-efficiency ratio.

**Storage is linear; execution cost is not.** Admission, promise accounting and
handle uniqueness scan bounded banks. Cohort work can be quadratic in configured
width. The 32-member bound costs materially more than eight here; no universal
scaling curve, throughput claim or production default follows.

Matched whole-handler tests include fresh Wasm instantiation, injected host tracing
and response validation, with compilation cached and sample order alternated.
Enabled-minus-control median wall differences were +136, −29 and −199 µs.
The sign changes and spread prevent a credible overhead estimate; negative values
are not speedup evidence. Application-level overhead remains unresolved.

## Inclusion and ownership boundary

Selecting accounting out before source generation produces **byte-identical**
Wasm at every width. Merely appending unreachable ledger code leaves 119, 195 and
195 extra bytes. Adoption must therefore select the implementation by reachability
before generation; relying on dead-code elimination alone does not meet zero
unused-path cost. This fixture proves the selection mechanism, not a production
selection rule. The baseline compile at width eight is also byte-compared with
the actual provider compilation entry point.

The standalone ledger uses one fixed work vector `(3,192,4)`, cleanup vector
`(2,64,2)` and exit reserve `(2,64,2)` in handles/bytes/records. It offers cumulative
root/child admissions, protected physical cleanup records, generation tokens,
pre-registration/adoption, qualified released refunds, owner handoff, retained
unknown tails and two emergency records. Work and cleanup each have 10,000 step
limits. Deadlines stop further entry; observations can still record late reality.
Emergency overflow stops admission and explicitly loses accounting coverage;
it neither promises arbitrary output storage nor proves host reclamation.
Tokens authenticate stale/reused slots within a trusted provider API, not an
unforgeable capability boundary. Generations survive resets and reject at a finite
limit; input ranges are deliberately bounded to safe signed-i32 fixture arithmetic.

This is **not a feature-complete port of the JS service**. It lacks general profile
registration/demand derivation, the full action/exclusivity/borrow/pin contract,
qualified consumed/transferred partial-disposition proofs, dynamic collection
membership and async late-result wiring through a real provider. Standalone late
adoption is covered; the generated time fixture is synchronous. Neither arbitrary
nested plans nor a general Native hook ABI is established. The generated bridge
assumes one request per fresh instance and one statically checked keyed cohort.

## Evidence and reproduction

With the repository's lockfile-pinned dependency bundle available:

```sh
node docs/internal/host-extensions/resource-accounting/ra03/native/check.cjs /tmp/ra03-native-ledger
node docs/internal/host-extensions/resource-accounting/ra03/native/driver.cjs /tmp/ra03-native-driver
node docs/internal/host-extensions/resource-accounting/ra03/native/measure.cjs /tmp/ra03-native-ledger /tmp/ra03-native-driver /tmp/ra03-native-costs
```

The build uses pinned AssemblyScript 0.28.18, runtime stub, the existing optimization
argument helper and the provider abort binding. Source anchors fail closed when
the generator changes. [Ledger checks](checks.json), [driver checks](driver.json),
[measurements](measurements.json), [validation](validation.json) and the
[evidence index](evidence-index.json) retain exact inputs and terminal status.
The archive includes actual generated AssemblyScript, Wasm, plans, WAT, injected
host source and prior attempt receipts/logs. The first standalone attempt trapped
on exported optional-argument thunks; explicit parameter lists fixed it. The first
driver attempt lacked the provider abort binding; the second had incorrect harness
expectations for the existing 504 deadline response and retained cleanup reserve.
Those failures remain visible and are not counted as passing evidence.

This closes the narrow Native feasibility/storage/binary-cost question and supplies
bounded execution measurements. It does not close real host disposal or complete
Native integration. Structural production hooks and full profile parity remain
adoption work; RA-04 owns exclusive/in-flight-buffer pressure, RA-05/06 real
fetch/cache behavior, and RA-09 matched application/target cost qualification.
No deployment, full regression suite, merge, release or adoption is claimed.
