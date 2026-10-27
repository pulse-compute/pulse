# P04 — Bounded Native accounting kernel

Status: shared kernel integrated into the existing bounded Fastly Native
forwarding realization; see [P07](P07-forwarding-accounting.md) for its exact scope.
Foundation promotion, general fetch integration and P11B cost qualification remain
separate. This does not complete production RA.

## Human decision and scope

The owner answered **“I'm with 2.”** to approval of the P04 accounting policy and
P11A engineering cost targets for implementation and qualification. This approves
fixed invocation-owned banks, profile-derived capacity, checked representation,
generation retirement, conservative retained claims and protected cleanup. It does
not approve the separate foundation promotion decision, merge or release.

This change is stacked on PR #549's exact final tree. There is no exact named Entry
Point for a new private Native accounting core. The ordinary root/Wasm/docs/release
instruction chain applies. Owners are runtime-core-as (storage and transitions),
P05 resource-admission (existing calculation semantics), maintained runtime tests,
and test registration/evidence mapping. Classification: architecture. No provider
source, application API, export map, effect scheduler or default budget changes.

## Concrete storage and numeric representation

The canonical Native implementation is
`wasm/packages/runtime-core-as/src/compiler/resource-ledger.as.ts`. Its adjacent
JavaScript loader returns the source only for explicit selection. Merely loading
the package installs nothing. The kernel has no host imports or provider calls; the selected provider adapter owns those transitions.

One invocation owns a fixed-capacity active bank and equally bounded staging bank.
Each bank has eight unsigned 64-bit words per record. Together they use **128 × N
element bytes** for N logical slots. No record objects, ticket arrays, payload
buffers or growing collections are allocated by reservation or transition methods.

| Word | Active record | Representation |
| --- | --- | --- |
| 0 | Kind: handle, allocation family, service metadata | Bounded numeric tag |
| 1 | Resource namespace; zero for non-handle records | Checked by the trusted producer before u32 conversion |
| 2 | Slot generation | 1 through 2^32−1; zero is unissued |
| 3 | Owning operation/service instance | Nonzero u32 identity |
| 4 | Work, cleanup or exit partition | Bounded numeric tag |
| 5 | Ownership state | Free, reserved, acquiring, live, disposing, unknown, exhausted |
| 6 | Provider handle or allocation allowance | Handle is u32, including zero; allowance is a safe integer |
| 7 | Allocation consumption | Checked cumulative safe integer |

Staging uses the same fields. After commit, its generation/state words expose a
borrowed slot/generation result view in descriptor order, valid until the next
successful begin. The driver retains identities in its own bounded state and must
account for that state separately. These are not effect-completion tickets.

Invocation fields hold execution identity, capacity/limits, original deadline and
last clock sample, occupied handles/backing/records, cumulative step/effect
reservations, remaining cleanup/exit steps, exit-reservation flag, transaction
state, first failure marker and closure state. The compiled fixture measures the
class field size with `offsetof`; allocator headers, alignment, stacks, code and
engine memory are reported separately. The constructor budgets 1 KiB of fixed
headroom plus 128N element bytes and checks the supplied storage bound before
allocating either bank. Allocation failure can trap before any host acquisition.

All quantities entering the kernel's u64 counters are bounded to 2^53−1, matching
P05. Subtraction-based capacity checks precede addition. Slot indexes use the
nonnegative range of i32 for safe AS array indexing; capacity and its 8-word array
length must fit the supplied, at-most-signed-32-bit storage envelope. Invalid
construction yields a closed, unusable zero-capacity ledger. P07 must reject invalid
values before narrowing into u32/i32 ABI arguments; a Wasm cast is not validation.

The managed driver supplies and authenticates a unique, nonzero execution identity
and binds it to this ledger instance. A display name or reusable static site is
not that identity. Equality checks inside this trusted kernel do not make scalar
values unforgeable. Raw Wasm memory/ABI access remains trusted. Cross-instance and
host-boundary identity qualification belongs to each driver integration. P07
binds the first one-shot forwarding instance without exporting scalar identities.

## Reservation and lifetime rules

`begin → stageRecord* → commit` is a serialized transaction. Staging neither
acquires resources nor changes active charges. Commit rechecks the original clock,
all current dimensions and reusable slots, then installs the whole selection.
The commit loop contains no callbacks, host calls, allocation or remaining failure
checks. Abort drops staging only. Reentrant begins reject; foreign execution
attempts cannot consume or abort the current transaction.

The first successful transaction explicitly includes the invocation exit reserve,
even when its declared envelope is empty. Later transactions cannot charge it
again or silently replace it. The producer must stage every work/cleanup/exit
descriptor from its validated profile, including metadata records. The kernel
cannot infer an omitted host output, hidden allocation or invalid provider profile.
P07 owns that compiler/profile closure proof; P05 `admitted: true` is not authority.

Handle acquisition is fenced **before** the host call:

`reserved → acquiring → live`

A trap or absent outcome leaves the acquiring claim charged. Qualified proof that
nothing was acquired permits retirement; uncertainty changes it to unknown and
stops new work. A known handle arriving after failure, closure or deadline expiry
is still recorded, without reopening delivery or authorizing more work.

Disposal is also fenced before the host call and consumes a protected step:

`live → disposing → retired or unknown`

Only provider-qualified consumption permits retirement. Unknown disposal cannot
be retried. Qualified transfer retires a logical handle claim without claiming
physical reclamation, host quiescence or client delivery. Unused handle reservations
can be released; unused cleanup and exit handles remain protected until closure.

Retired slots advance generation on their next reservation. A slot used at
generation 2^32−1 becomes permanently exhausted for that invocation when retired.
Other reusable slots can still admit a complete cohort; insufficient reusable
slots deny the whole transaction. There is no wrap, force reuse or dynamic growth.

Allocation families retain their full allowance and logical record for the whole
invocation. Consumption is checked before allocation; close, lost aliases, handle
retirement and logical settlement refund no backing. Metadata records also remain
held in this first slice. Step and effect envelope reservations are cumulative and
not refunded. Capacity therefore must cover the declared invocation workload and
overlap, not merely the current parallel width.

## Failure, time and authority

Work cannot use a cleanup/exit record by relabeling its call. After failure or
closure, only appropriately partitioned protected acquisition/allocation and
qualified disposition remain available. Cleanup and exit step pools are distinct.
Cleanup does not consume fresh business effect tickets; its admitted profile must
provide its explicit resources/steps. No extra scheduler is introduced.

The driver samples its original monotonic deadline in consistent integer ticks.
Backward, invalid and expired samples deny further acquisition/consumption/disposal
attempts. There is no deadline setter, extension or automatic retry. Recording a
host outcome is allowed after expiry because it creates no new host operation.
Guest traps still offer no finalizer guarantee.

The first nonzero failure marker survives subsequent cleanup failures. The driver
retains the actual primary exception/result and records that failure before
cleanup; the kernel's scalar marker does not replace an error object. Internal
codes 1–10 identify invalid input, clock reversal, expiry, handle/backing/record/
step/effect shortage, generation exhaustion and uncertain outcome respectively.
These are private diagnostics, not new public CLI codes or compatibility promises.

`effects` is an admission-envelope reservation, not a second effect scheduler or
replacement invocation counter. P07 must synchronize it with the existing owner's
cumulative effect budget, ticket authentication and original deadline. Existing
value, body, page and request guards remain authoritative. This kernel alone does
not enforce production fetch memory or total process memory.

## Qualification and remaining gates

`resource-ledger` compiles the unmodified kernel and tests exact-capacity and five
shortage dimensions at widths 1/8/16/32 against P05 and independently authored
envelopes; stale/foreign/duplicate identities; handle zero; primary preservation;
unknown acquisition/disposal; cleanup/exit separation; late results; atomic expiry;
overflow; forced **actual u32 maximum** generation retirement; and cumulative
backing/effects. Test-only wrappers seed the real generation storage to reach the
boundary; no production hook or reduced-width counter is added.

Three compiled mutations must be rejected: weakened generation authentication,
backing refund on retirement, and primary-error replacement. Absent, disabled and
included-but-unused source variants must produce byte-identical Wasm with no added
host imports. This is kernel reachability evidence, not proof of P07 selection in
an application. Reservation methods also preserve bank addresses and memory size.
The task also performs a real pnpm pack of runtime-core-as, unpacks the private
kernel files outside the checkout, and repeats the compiled corpus with exact Wasm
byte equality. This checks packed kernel source, not installed dependency closure.

The accepted P11A targets remain review targets: 128 bytes per record plus 1 KiB
fixed state; zero accounting-only payload duplication and unused machinery;
incremental execution target `5 + 2 × width` microseconds; investigate distinguishable
growth above 2.5× from 16 to 32. Initialization scans and allocation, two-pass active
bank scanning per commit, observer/report costs and driver-owned ticket storage must
be measured separately. No timing threshold enters correctness CI. P11B must use
the same reader, ownership and compiler recipe on/off.

The first selected forwarding integration is documented in P07. It does not
complete foundation promotion, general P07 profiles/dispatch integration,
Node-host/JavaScript RA realization, P06 child graphs, P08 cache policy, P11B costs,
or RA application/local/hosted qualification. Historical report/retention causes
remain unresolved. Exact source/tree, failed development attempts and terminal
test coverage belong in the PR; nothing here approves merge or release.
