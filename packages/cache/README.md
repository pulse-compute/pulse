# Private cache adoption candidate

This package is private and is not part of the published Pulse package set.
It is an unqualified draft: Viceroy 0.21.1 can consume an incomplete-body error
during readiness and allow a false empty hit. Do not use it in production until
that host-contract blocker and human review are resolved.
It defines bounded nontransactional `cache.getText(ctx, key, {maxBytes})` and
`cache.putText(ctx, key, text, {ttlMs})` effects for Fastly Native. Keys, text and
options must be literals. Reads return `{status: 'found', text}` or
`{status: 'miss'}`; writes return `{status: 'stored'}` only after writer close.
The required policy is that errors fail the invocation and incomplete reads
are errors, never misses; local-engine qualification currently violates it.
No automatic loader, retry, transaction, rollback or durability promise exists.
JavaScript and Node are unsupported. P06 owns cache/fetch composition; P13/P14
own broader host qualification and public promotion.
