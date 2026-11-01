# Beta.11 qualification evidence

Status: **in progress**, observed 2026-11-01T10:41:54.046Z. The full release seal is still required; no accepted qualification bundle has been captured.

- Release PR: [#591](https://github.com/pulse-compute/pulse/pull/591)
- Head: `bced139dc69c13cd0ab9140557eed1866640850b`
- Merge candidate: `ce29a1c8f7a5bb0a07d60edd3f3026bb3088fd8c`
- Tree: `eab588d09b914637dd8d7d01f5349bff7179f1a6`
- Main base: `e69e4b6f1381a05bf0ee0b9b4c6385d2acefb20c`
- [Full seal](https://github.com/pulse-compute/pulse/actions/runs/41298201566)
- [Portable validation](https://github.com/pulse-compute/pulse/actions/runs/41298201556)
- [Exact-source supplemental evidence](https://github.com/pulse-compute/pulse/actions/runs/41298242456): all four tasks and cleanup passed, with clean source. Fetch outcomes covered 100 cross-target cases. All 20 installed package hashes match candidate 5; this observation does not pool earlier reports into the seal.

See [machine-readable evidence](beta11-qualification.json) for raw K4 semantics, per-package hashes, artifact digests, failed/superseded attempts and source identities. GitHub artifact retention and expiry are preserved in their metadata.

## Concrete qualification repairs

Preparation synchronized the beta.11 version/date, dependency ranges, changelog, installed documentation and MCP corpus. Subsequent fixes synchronized the generated README snippet, repaired an installed guide link, raised one composite Fastly task's finite budget from 300s to 600s based on retained active-compiler evidence, refreshed exact canonical Wasm size baselines, pinned the lifecycle observer fixture clock, and separated real loopback fetch transport budgets from 20ms injected deadline probes. Exact assertions and product runtime behavior remain unchanged.

## Separate release obligations

Independent integrated review under #508/item07 remains pending. Current hosted-provider evidence or explicit support dispositions remain required, including deployed Pulse cross-location KV. Earlier hosted #571 evidence retains its original source identity. K4 task acceptance retains its raw **failed** missing-key CAS semantics on Viceroy 0.21.1 under the documented October 4 standing direction; it is not a semantic pass or deployed qualification.

#516 stays parked without a fresh product signal; #566 and #577 remain deferred. Merge, tag, publication and deployment remain release-owner actions.
