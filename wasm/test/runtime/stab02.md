# STAB-02 deadline and settlement investigation

The generic fixtures distinguish operation-budget exhaustion, whole-request
revocation, transport failure, and terminal hold expiry. They do not establish
the cause of a historical hosted timeout.

## Reproduced defect

Conditional KV checked the monotonic clock after fulfilled preparation and
acknowledgements, but its rejection handler classified errors without checking
the deadline. If a provider rejected after the clock reached the deadline while
the timer callback was delayed, preparation reported `unavailable` and dispatched
writes reported `transport`. The same timings with successful completions
correctly reported `timeout`.

The rejection path now applies the existing deadline fence. Before dispatch the
write remains `not-stored`; after dispatch it remains `unknown`. No automatic
retry, rollback, deadline extension, new capability, or provider policy is added.
This shared host repair covers Node JavaScript, compiled Node Native, and the
canonical reference runner. Fastly Native has its separate ABI realization;
the Node finding is not an explanation for a historical Fastly 504.

## Executable coverage

| Check | Evidence |
| --- | --- |
| `kv-conditional-conformance` | Preparation and committed-write acknowledgement at 9999/10000/10001 ms, fulfilled and rejected, with delayed timer callbacks; one lifecycle observation and no live timer after settlement. |
| Same corpus | Sixteen callers on one authority: fifteen conflicts and one committed winner whose acknowledgement times out; releasing the late acknowledgement leaves value and generation unchanged. |
| Same corpus | Cancellation during preparation or after commit, including late rejection; no retained source abort listeners or timers, and no pre-dispatch mutation. |
| Same corpus, Node targets | 5000/10000/15000 ms request budgets against the ten-second KV member limit: earlier/equal request expiry is fatal, a shorter member limit returns typed uncertainty. |
| `assert-fastly-request-budget.cjs` | Nine compiled-Wasm ABI cells around the earlier request/member deadline; one insert, at most one acknowledgement consumption, one terminal response, and retained authoritative writes after expiry. Registered through `fastly-native-platform-capabilities`. |
| `terminal-qualification-contract` | Five injected runner schedules: published response, HTTP 200 hold fallback, early response, publish failure, and disconnect. Phase evidence survives failures; success assertions and retry policy are unchanged. |

Run with the repository's pinned toolchain:

```sh
node wasm/scripts/run-wasm-tests.cjs --task kv-conditional-conformance --task fastly-native-platform-capabilities --task terminal-qualification-contract --no-report
```

## Remaining attribution limits

The retained [RC-H04 failed hold attempt](../release/rc-h04/live/terminal-hosted-3.json)
completed fourteen cells, then received HTTP 200 with the origin's `timed-out`
body instead of the published body. Its subsequent winning replay does not erase
that failure. The old receipt has no per-hold phase timeline. A fixed pending
interval is not a subscription acknowledgement, so these records cannot identify
whether subscription readiness, publish processing, or delivery caused the miss.
The updated runner captures client-observable ordering for a future exact-bundle
hosted replay; it does not infer gateway subscription state or retry a failure.

Likewise, a whole-request 504 after a dispatched conditional write does not prove
the write failed or identify which preceding operation exhausted the budget.
Reconciliation is separate from timeout attribution. The scoped ABI and reference
fixtures establish settlement and cleanup behavior, not production service latency,
global storage consistency, or a resolution of either historical observation.
No new hosted deployment or traffic is part of this change.
