# STAB-04 sustained operation and recovery

This evidence-only task measures the composed STAB-03 consumer on its admitted
Node JavaScript target. It makes no change to runtime behavior or release gates.
No single named Entry Point covers this installed measurement; the ordinary
root/wasm instruction chain applies, with the test registry as the additional
evidence owner.

From a clean committed checkout with the pinned toolchain:

```sh
node wasm/scripts/run-wasm-tests.cjs --task stab04-evidence-contract --no-report
node wasm/scripts/run-wasm-tests.cjs --task stab04-installed --no-report
```

The installer packs all candidate packages, installs outside the checkout and
checks installed bytes before and after execution. It first reruns the complete
STAB-03 proof on those same bytes, retaining Native blockers in a separate proof.
It then builds a composed consumer with authenticated read/delete routes for
verification and bounded data cleanup. The proof and campaign are distinct;
Native compilation rejection cannot count as sustained Native execution.

## Campaign

After warmup, three cycles each execute four ten-second phases:

| Phase | Controlled condition |
| --- | --- |
| Normal | Four command offers and two asset requests per 200 ms tick; two independent worker loops. |
| Contention | Four concurrent offers share an idempotency key; KV preparation waits 10 ms; shared HTTP admission remains bounded. |
| Outage | Projection inserts fail before dispatch; foreground command writes continue. Every eighth committed command loses its acknowledgement and requires explicit identical replay. |
| Recovery | Provider behavior returns to normal while new work continues; measure recovery of the pre-existing backlog. |

The controller bounds foreground requests at eight, worker loops at two and
pending jobs at 256. The measurement host admits eight concurrent requests.
Rejected admission returns 503; client retries are explicit and counted. Producer
scheduling lag, skipped asset offers and dropped command offers remain visible.
This is a finite paced experiment, not an unbounded capacity claim or a production
scheduler. The projection outage and waits are injected in the installed Node KV
reference implementation, not caused by a real remote service. The HTTP adapter
is installed product code; admission, fault controls and measurement are harness
code, not a qualification of the public production launcher.

Every confirmed command must produce the exact expected projection, which is read
through authenticated HTTP before both records are deleted. Commit counters must
equal unique accepted/projected jobs, including uncertain replay. All work must
drain within 20 seconds after offered load stops. Each cycle ends with zero
requests, sockets, pending effects, injected waits and retained application rows;
active resource counts must match the warm baseline. The report must cover all
twelve phases and exercise both outage and acknowledgement-loss controls.

## Measurement and attribution

The server runs in its own process, excluding the compiler, request generator and
retained result rows. It samples RSS, heap, external and array-buffer memory every
100 ms; these are sampled peaks, not hard peak bounds. Equal-state quiet points
force GC twice and record memory and active resource types. Report both the
post-warmup delta and fitted heap slope. A finite stable trend is not proof that
the runtime is leak-free, and RSS allocator retention is not itself a leak.

Client p50/p95/p99 include loopback HTTP. Reports separate successful and failed
responses. Server elapsed time is split into the **union** of observed effect
intervals and the residual; overlapping parallel work is not double counted.
Per-kind effect sums and injected provider wait are retained separately and must
not be added to union wall time. Residual time includes application, runtime,
transport, instrumentation and GC; it is not labeled runtime overhead.

A separate five-second window samples CPU leaf frames after the main memory
campaign. Categories distinguish generated application code, runtime, provider,
other Pulse packages, measurement host, platform/unattributed, idle and GC.
Sampling attribution is approximate; native crypto may appear under the platform
category. Profiling overhead and its retained samples are excluded from the quiet
memory trend. Timing values are observations, not invented RC latency SLOs.

`requests.json` retains request timings and producer/worker progress;
`campaign.json` contains phase statistics, recovery, resource and memory results.
The receipt binds those artifacts, harness source, candidate tree and package
hashes. Failed attempts retain partial observations. There is no hosted Fastly,
Native sustained-load, cross-process KV durability or downstream-application
qualification claim. Those gaps remain explicit.
