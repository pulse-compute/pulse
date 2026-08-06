<!-- pulse-doc-meta:start
owner: docs-platform
status: active
last-reviewed: 2026-07-25
review-by: 2027-01-25
pulse-doc-meta:end -->

# Add a provider toolchain

> **Current boundary:** Provider selection is explicit, not discovered. A bare
> host ID such as `node`, `fastly`, or `esp32` resolves to
> `@pulse-compute/provider-<id>`, `none` remains internal, and a scoped package
> name is loaded exactly from the project. The selected package must export the
> versioned `./toolchain` contract.
> No dependency scanning, package-keyword registration, or target fallback
> occurs.

A core provider realizes canonical compiler operations without changing the application handler API. It normally owns a capability descriptor, a local conformance runtime, binding normalization, and—when deployable—a target builder and toolchain boundary.

This is separate from package-root lowering. A provider implements canonical
capabilities and target realization; a Pulse-aware package may contribute a
bounded first-party package effect. See [Pulse-aware package
authoring](./pulse-aware-packages.md) before choosing either boundary.

## Provider invariants

Every provider must preserve:

```json
{
  "providerSpecificUserland": false,
  "providerSdkUserland": false,
  "capabilityDiscoveryFromUserland": false
}
```

Canonical source imports `@pulse-compute/runtime` and supported package facades. Provider SDK objects, request types, storage clients, and deployment resources do not enter handler scope.

## Integration map

| Concern | Current owner/location |
|---|---|
| Capability vocabulary and provider plan | `wasm/packages/contracts/src/provider/canonical-provider.js` |
| Node descriptor/runtime | `packages/provider-node/src/runtime/canonical-api-runtime.js` |
| Fastly descriptor | `packages/provider-fastly/src/provider-contract.js` |
| Fastly local runtime | `packages/provider-fastly/src/runtime/canonical-api-runtime.js` |
| Fastly target writer/toolchain | `packages/provider-fastly/src/build/` |
| Deterministic package bootstrap | `wasm/packages/compiler/src/provider-toolchain.js` |
| Versioned bootstrap contract | `wasm/packages/contracts/src/provider/toolchain.js` |
| Provider driver and config normalization | Provider-owned `./toolchain` export |
| Command execution | `wasm/packages/cli/src/project-execution.js` |
| Public config reference | Provider-owned reference contribution, aggregated by `wasm/packages/cli/src/project-config-schema.js` |
| Package policy | `release/pulse-release-manifest.json` |

## 1. Define provider identity and scope

Choose:

- stable provider ID;
- package owner and version;
- runtime identity;
- build target identity;
- whether it supports local execution;
- whether it emits a deployable target;
- its exact canonical capabilities;
- required resource bindings;
- toolchain and external CLI dependencies.

Do not claim a capability because a provider SDK happens to contain something similar. The provider must implement the canonical semantics and failure behavior.

## 2. Build a canonical provider descriptor

Descriptors are normalized by the shared provider contract. A conceptual descriptor looks like:

```js
const EXAMPLE_PROVIDER_DESCRIPTOR = createProviderDescriptor({
  id: 'example',
  providerVersion: '1.0.0-beta.1',
  package: '@pulse-compute/provider-example',
  runtime: 'pulse.canonical-example-runtime.v1',
  buildTarget: 'example-edge',
  deployable: true,
  localExecution: true,
  capabilities: [
    'request.method',
    'request.path',
    'response.json',
    'response.text',
    'fetch',
  ],
  lowering: {
    'request.method': 'example.request.method',
    'request.path': 'example.request.path',
    'response.json': 'example.response.json',
    'response.text': 'example.response.text',
    fetch: 'example.fetch.dispatch',
  },
})
```

The shared contract verifies that every declared capability has a lowering and that every compiled requirement is supported.

When a package-owned operation requires an additional result capability—such as opaque pass-through—the descriptor must implement both the operation and result capability.

## 3. Normalize bindings separately from source

Canonical effects refer to logical resources: an origin URL, KV namespace, config store, secret store, or package resource. Provider configuration maps those to deployment bindings.

A binding normalizer should:

- accept only documented project fields;
- produce deterministic normalized values;
- reject duplicate, invalid, or missing mappings;
- keep raw secret values out of the plan;
- make dynamic-resource behavior explicit;
- distinguish local fixture values from deployment resource names.

Do not discover bindings by scanning provider-specific imports in handler source.

## 4. Implement the local conformance runtime

The local runtime executes canonical programs for `pulse test` and `pulse dev`. It should use shared host-runtime primitives where possible and implement each descriptor capability with normalized results.

Required behavior includes:

- bounded request-body access;
- deterministic response construction;
- effect dispatch and continuation resumption;
- timeout and failure normalization;
- config/secret/KV fixture isolation;
- structured versus opaque body rules;
- request completion and cleanup;
- secret redaction.

Local behavior should match canonical semantics, not emulate every incidental detail of a provider SDK.

## 5. Implement target generation when deployable

A deployable provider needs a target writer that consumes:

- the canonical program;
- provider lowering plan;
- normalized bindings;
- schema bundle and package effects;
- project metadata;
- output-safety options.

It should emit a deterministic source package and validate the final artifact. For Wasm targets, verify at least the expected file, magic/version bytes, and compiler result metadata.

Keep external toolchain discovery in a narrow adapter. Return stable diagnostics for unavailable binaries, version mismatch, timeout, compile failure, or invalid output.

## 6. Export the formal toolchain

The provider package exports `./toolchain`. Its module declares package
identity and creates the provider-owned driver:

```js
module.exports = defineProviderToolchain({
  version: 'pulse.provider-toolchain.v1',
  id: 'example',
  packageName: '@example/pulse-provider',
  packageVersion: require('../package.json').version,
  createDriver() {
    return defineProviderDriver({
      version: 'pulse.provider-driver.v1',
      id: 'example',
      descriptor: EXAMPLE_PROVIDER_DESCRIPTOR,
      executable: true,
      localExecution: true,
      deployable: true,
      normalizeConfig,
      projectConfigDocument,
      initTemplate,
      targets,
      execute: executeCanonicalProgram,
      createLoweringPlan,
      writeTarget,
    })
  },
})
```

`createDriver()` receives no compiler service or caller option bag. Use the
shared provider contract helpers for the exact planning input, target
invocation, Native artifact, JavaScript package result, and provider target
result shapes. A supported Native descriptor must include a valid
`finalWasmPolicy`, and every command advertised by a target must have the
required callable surface on the driver.

`createLoweringPlan` consumes the versioned provider-plan projection rather
than compiler metadata. `writeTarget` and `inspectRealization` consume the
versioned target invocation rather than `{ compiled, metadata, plan, native,
...options }`. Return normalized versioned data; do not return a compiler
object, provider implementation, mutable manifest, or unaudited Wasm bytes.

Keep concrete implementation, configuration normalization, reference fields,
and target policy in the provider package. A project selects either a bare host
ID or an exact scoped package name as its profile `host`; Pulse resolves only
that package's `./toolchain` export. Adding a first-party bare host to the
built-in support catalog still requires an architecture-reviewed release
dependency, documentation, and acceptance change. A project-owned scoped
provider does not.

The selected toolchain executes as trusted build code in the Pulse process.
Do not run Pulse commands against an untrusted project or dependency tree.

## 7. Extend project configuration

Update the public TypeScript types, config loader, normalization, and CLI override behavior. Decide whether the provider is selected by a string or a typed helper object.

Document every field in the machine-readable project configuration catalog. The release gate compares that catalog with exported TypeScript interfaces, including optionality, so a field cannot be added only in code or only in prose.

Cover:

- defaults;
- allowed values;
- command-line precedence;
- local versus deployment meaning;
- secret and path safety;
- related diagnostics.

## 8. Extend CLI behavior and help

For each command, decide and test:

| Command | Provider question |
|---|---|
| `doctor` | What dependencies, bindings, and external tools are checked? |
| `inspect` | What provider plan and readiness detail is emitted? |
| `test` | Is local execution supported? |
| `dev` | Can it serve locally and watch safely? |
| `build` | What files are emitted, cleaned, and validated? |

Update the declarative command specification when provider choices or option behavior change. Installed help and the generated CLI reference must remain in parity.

## 9. Add public diagnostics

Provider failures reaching the supported workflow need stable `PULSE_*` codes in the public diagnostic catalog. Typical classes include:

- unsupported provider or command;
- missing capability;
- invalid binding map;
- missing deployment resource mapping;
- unavailable compiler or external CLI;
- version mismatch;
- target compile/serve timeout;
- target compile/serve failure.

Each public code needs summary, remediation, exit class, optional development HTTP mapping, and a generated exact-version documentation anchor.

Internal proof diagnostics may remain `PULSEWASM_*`, but they must not leak as undocumented public links.

## 10. Publish and classify the package

When the provider is a published package:

- add it to the synchronized release manifest and version set;
- declare the support tier, audience, direct-install guidance, supported entry points, and stability in `release/pulse-release-manifest.json`;
- ensure repository/homepage/bugs metadata is generated;
- add a concise package README and a canonical package guide;
- add required files to `package.json.files`;
- verify packed relative and exact-version links;
- test from packed tarballs without workspace links.

An exported subpath is not automatically supported. List only entry points that carry an intentional compatibility promise.

## 11. Test equivalence and isolation

A provider is not complete after one successful request. Cover:

```text
request metadata and headers
JSON/text/custom responses
schema decode and encode
single, grouped, and dependent fetch
fetch timeout/network failure
config and secret reads
KV get/put
opaque pass-through
supported package-owned effects
missing capability and binding failures
continuation expiry/double-resume protection
secret redaction
local dev request behavior
build output and output-path safety
packed-package installation
external target execution where available
```

Compare provider plans and observable canonical results with the Node conformance path where the capabilities overlap. Provider-specific target details may differ; application-visible semantics should not.

## 12. Release checklist

Before adding the provider to the public matrix:

- The descriptor lists only implemented capabilities.
- Every capability has local behavior and, when claimed, target behavior.
- All required bindings fail early and clearly.
- The driver is wired into all relevant commands.
- Config types, normalization, generated reference, and examples agree.
- Public diagnostics have resolvable anchors.
- Handler source remains provider-neutral.
- Packed-package and clean-machine tests pass.
- External reality checks are separated from deterministic conformance tests.
- The docs do not imply a public plugin API.

## Related documentation

- [Pulse-aware package authoring](./pulse-aware-packages.md)
- [Contracts and providers](../concepts/contracts-and-providers.md)
- [Fastly package guide](../packages/provider-fastly.md)
- [Project configuration](../reference/project-config.md)
- [Diagnostics](../reference/diagnostics.md)
- [Release acceptance](../maintainers/release-acceptance.md)
- [Package support policy](../packages/README.md)
