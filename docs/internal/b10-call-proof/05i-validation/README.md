# 05I checkpoint evidence

Reports retain their original source identities and log paths. Complete task
transcripts are in `tasks/`; probes and standalone development attempts are in
`development/`. Documentation receipts identify large inventory logs by byte count
and SHA-256. Only the scope transcript's extra blank line at EOF was removed.

`focused-final` is the first clean runner attempt, retained as a timeout. The
four-tool test passed 3,330 executions and suite shape passed; the rebuild task
exceeded its inherited 60-second timeout. Only that task's time allowance changed
to 120 seconds. `focused-remainder` passed all eight selected tasks on clean
`7a82f92`, covering the interrupted and unrun checks plus suite shape. The completed
four-tool and baseline checks on clean `eaa0180` were not needlessly repeated;
their application/compiler/test bytes are unchanged by the timeout-only commit.

Development probes 1/2 exposed a generator brace error and unsupported early
return in a bounded pure loop. Probe 3 compiled the initial production graph.
Standalone tool attempts 1/2 exposed branded readonly Int32 TypeScript arithmetic
and unsupported Number conversion; the final local type assertion uses existing
runtime schema validation. Attempt 3 detected duplicate physical Native resource
backings. Attempt 4 corrected the test's discovery-order assumption. Attempt 5
required omitted terminal nextOffset rather than a present undefined field.
Attempt 6 exposed the complete MCP tool-result limit, including the text copy;
pagination now budgets both serialization layers. Attempt 7 removed an optional
field from a pure-helper argument whose Native kind was unknown. Attempt 8 passed
3,330 executions but began before the implementation commit, so it is development
evidence even though its end-of-run identity reports clean eaa0180. Some probe
console output is inspect-elided and retained exactly as captured.

These focused checks are not full-profile, installed-provider or release
qualification. Next: **06A (#451), sparse lexical search**.
