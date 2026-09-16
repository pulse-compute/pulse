# @pulse-compute/wasm-compiler

<!-- pulse-package-status:start -->
> **Support tier:** Implementation/transitive surface<br>
> **Audience:** Pulse compiler and release maintainers.<br>
> **Install directly:** No for application projects; use the pulse CLI.<br>
> **Supported entry points:** `None for application authors.`<br>
> **Stability:** Internal compiler interface; no application-author compatibility guarantee.<br>
> **npm:** [`@pulse-compute/wasm-compiler`](https://www.npmjs.com/package/@pulse-compute/wasm-compiler)<br>
> **Canonical replacement:** `@pulse-compute/cli`<br>
> **Canonical documentation:** [Package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/implementation-packages/)
>
> This release-status block is generated from the synchronized `Pulse 1.0.0-beta.5` package policy.
<!-- pulse-package-status:end -->

Whole-project compiler implementation used by the `pulse` workflow. Application projects should use `@pulse-compute/cli`, not import this package directly.

## Responsibilities

- resolve and validate compiler inputs;
- compile canonical handler source into values, effects, continuations, and capability metadata;
- compile explicitly declared JSON schemas through the schema package;
- discover trusted package-owned manifests and invoke their owning builders;
- merge package effects with canonical operations;
- emit versioned canonical plans and build artifacts;
- expose implementation diagnostics to the product workflow.

## Boundaries

The compiler orchestrates contracts but does not own:

- product command parsing or project UX;
- provider execution;
- provider SDK behavior;
- package-specific AST rules for GRIP or assets;
- schema payload semantics;
- application runtime authority.

Package-specific lowering belongs to the package owning the facade. Provider realization belongs to provider packages. Shared protocol vocabulary belongs to `@pulse-compute/wasm-contracts`.

## Internal compiler spine

The compiler connects root extraction, surface recognition, normalization, classification, validation, canonical IR, native lowering, provider realization, and artifact verification through a fixed package-internal pipeline. The pipeline is not exported and is not a plugin framework. Compiler refactors must preserve checked-in metadata, diagnostics, native-plan, and generated-Wasm evidence unless an explicit contract migration authorizes a difference.

The canonical-source and Router frontends now share package-internal handler-surface recognition and compatibility diagnostic authorities. The shared surface authority consumes the contracts package vocabulary, retains frontend-specific syntax compatibility, records facts without changing compiler outputs, and does not enable async or widen source support by itself. Canonical IR generation remains behind legacy compatibility envelopes until the dedicated frontend migration phases.

## Exported implementation modules

The package exports its root implementation plus focused compiler, CLI, extractor, config resolver, diagnostics, build-manifest, canonical API compiler, and canonical project compiler modules. These are synchronized internal interfaces without an application-author compatibility guarantee.

## Validation

Compiler changes should be covered by focused static/lowering tests, canonical project inspection, provider-plan parity, packed-package discovery where relevant, and the release documentation gates.

See the installed [implementation package guide](https://pulsecompute.io/v1.0.0-beta.5/packages/implementation-packages/) and [compilation concepts](https://pulsecompute.io/v1.0.0-beta.5/concepts/compilation-and-lowering/).
