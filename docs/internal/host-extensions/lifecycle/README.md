# Driver lifecycle spike evidence

The [design and stopping point](../DESIGN-03-lifecycle-hooks.md) describe the
implemented scope. [Evidence index](evidence-index.json) binds changed source
inputs, final measurements and validation to [the retained bundle](evidence.tar.gz).
The bundle contains generated AssemblyScript/Wasm, authored RA-05 inputs/plans,
44 host/accounting traces, compiled mixed-service harness artifacts, forwarding
qualification, source snapshots, the implementation patch and validation logs.

| Matched fixture | Base Wasm | Spike Wasm | Delta |
| --- | ---: | ---: | ---: |
| Absent | 23,444 | 23,444 | 0 |
| Imported-unused | 23,444 | 23,444 | 0 |
| Generic GRIP | 25,268 | 25,268 | 0 |
| Fanout | 27,305 | 27,551 | +246 |
| WebSocket | 27,310 | 27,556 | +246 |
| Incoming forwarding | 35,147 | 35,296 | +149 |

All import sets and extension policies match. Selected builds reorder imports;
unused source and Wasm are byte-identical. Node v24.22.1, existing pinned workspace
compiler dependencies, identical recipe per row. These sizes exclude test-only
exports. They do not measure runtime cost or hosted behavior.

Passed: 28 composer cases; nine compiled composition cases; HEX-01/02 plus 66
HEX-03 lifecycle traces; existing forwarding qualification; 44 Native RA-05 cases;
six selected provider tasks; workspace build; maintenance and documentation checks.
The unit aggregate passed 30 tasks and failed `release-recovery` once. Its unchanged
isolated retry passed. Both logs are retained. The first documentation attempt
rejected a test environment switch; the final harness uses `--lifecycle` instead.
The first measurement attempt assumed import-order identity; the final receipt
records the changed order and asserts exact sorted import-set/policy identity.

The archive manifest hashes each retained entry. `implementation.patch` applies to
the RA-05 tree shared by local `25b3f96` and merged `41d9f6b`; source snapshots
identify uncommitted implementation bytes during measurement. No release or
platform acceptance claim is made. Full Native/JavaScript/conformance profiles,
packed consumers, Viceroy and hosted Fastly were not run.
