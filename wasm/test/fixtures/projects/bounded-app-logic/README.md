# Bounded application logic

This public-package consumer processes variable collections with literal-capped
pure loops, trims string fields, scans each grant independently, and looks up a
retained result after a newer receipt. The original JSON text is sent unchanged
after validation. The supplied actor, grants and receipts test value processing;
they do not establish identity, authorization, acceptance or retention policy.

The focused task creates an isolated copy and uses the existing CLI suite's
workspace-package fixture pattern for public imports. It runs all three profiles
and builds, type-checks the source, and removes its temporary outputs. Run it
from the repository root:

```sh
node wasm/scripts/run-wasm-tests.cjs --task bounded-app-logic
```

The task additionally checks plain handlers, Router normalization,
Native event execution, zero/maximum/nested caps, short-circuiting, break and
continue, mutation/effect/callback rejection, forged plan rejection, ECMAScript
whitespace and non-whitespace code points, surrogate preservation, and no later
HTTP write after an observed value failure. It runs Node JavaScript, Node Native,
and both Fastly Native ABI fixtures. These are local development checks, not a
deployed provider or combined M2/M3 release acceptance gate.

`x-mode: wrong-type` deliberately bypasses the TypeScript string type for a
negative runtime fixture. It must fail before dispatching the post-loop write.
The event fixture is separately compiled by the focused task; Fastly event
ingress remains outside this HTTP consumer's target set.
