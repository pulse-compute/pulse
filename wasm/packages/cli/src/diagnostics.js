'use strict';

const CLI_DIAGNOSTICS_VERSION = 'pulse.cli-diagnostics.v1';
const { documentationUrl } = require('./documentation.js');
const DIAGNOSTICS_REFERENCE = documentationUrl('docs/reference/diagnostics.md');
const DIAGNOSTIC_STABILITY = 'preview-stable';

function entry(category, options = {}) {
  return Object.freeze({
    category,
    exitCode: options.exitCode,
    httpStatus: options.httpStatus,
    remediation: Object.freeze([...(options.remediation || [])])
  });
}

const DIAGNOSTIC_DEFINITIONS = Object.freeze({
  PULSE_COMMAND_UNKNOWN: entry('usage', { exitCode: 2, remediation: ['Run `pulse --help` and choose one of the documented commands.'] }),
  PULSE_ARGUMENT_MISSING: entry('usage', { exitCode: 2, remediation: ['Provide the missing flag value and rerun the command.', 'Run `pulse --help` for the command signature.'] }),
  PULSE_ARGUMENT_UNEXPECTED: entry('usage', { exitCode: 2, remediation: ['Remove the unsupported argument or use the documented flag.', 'Run `pulse --help` for the command signature.'] }),
  PULSE_PROVIDER_FLAG_REMOVED: entry('usage', { exitCode: 2, remediation: ['Select `host` and `target` in a `.pulse/config.ts` profile.', 'Use `pulse compile` for provider-neutral Wasm or `pulse build` for the configured deployment target.'] }),
  PULSE_SOURCE_ONLY_REMOVED: entry('usage', { exitCode: 2, remediation: ['Run `pulse build`; native builds emit generated source and provider Wasm together.'] }),

  PULSE_CONFIG_NOT_FOUND: entry('project', { exitCode: 2, remediation: ['Run `pulse init` to create `.pulse/config.ts`.', 'Ensure the command runs inside the intended project directory.'] }),
  PULSE_PROFILE_SELECTION_REQUIRED: entry('project', { exitCode: 2, remediation: ['Pass `--profile`, set `PULSE_PROFILE`, or configure `pulse.defaultProfile`.'] }),
  PULSE_PROFILE_UNKNOWN: entry('project', { exitCode: 2, remediation: ['Select one of the profiles declared next to the reserved `pulse` object.'] }),
  PULSE_CONFIG_PLAN_PARITY_FAILED: entry('project', { exitCode: 3, remediation: ['Keep the config factory within the sealed static grammar and report the divergent plan hashes.'] }),
  PULSE_TEST_HARNESS_NOT_FOUND: entry('test', { exitCode: 2, remediation: ['Create the workspace-relative file configured by `pulse.tests`.'] }),
  PULSE_TEST_HARNESS_EXPORT_INVALID: entry('test', { exitCode: 2, remediation: ['Export an ordered case array or an object containing a `cases` array.'] }),
  PULSE_TEST_EXPECT_INVALID: entry('test', { exitCode: 2, remediation: ['Use the documented expectation shape for the selected HTTP or event case.', 'Event emitted-frame expectations must be ordered arrays of canonical frames.'] }),
  PULSE_TEST_EVENT_INVALID: entry('test', { exitCode: 2, remediation: ['Use a discriminated `kind: "event"` case with one bounded type, schema or schemaId, and schema-dependent payload.', 'Inspect the event catalog with `pulse inspect --json`.'] }),
  PULSE_TARGET_IMPLEMENTATION_PENDING: entry('capability', { exitCode: 3, remediation: ['Select a native profile for build, test, or dev.', 'Use inspect or doctor to retain the JavaScript selection without fallback.'] }),
  PULSE_JAVASCRIPT_APPLICATION_PLAN_INVALID: entry('project', { exitCode: 3, remediation: ['Rebuild the JavaScript application plan from the configured entry and sealed reachable graph.'] }),
  PULSE_JAVASCRIPT_APPLICATION_GRAPH_FAILED: entry('compile', { exitCode: 3, remediation: ['Fix the first reachable-graph diagnostic before loading the JavaScript application.'] }),
  PULSE_JAVASCRIPT_APPLICATION_ENTRY_INVALID: entry('project', { exitCode: 3, remediation: ['Default-export a Router, Pulse application, or managed handler from a project-owned entry module.'] }),
  PULSE_JAVASCRIPT_APPLICATION_EXPORT_INVALID: entry('project', { exitCode: 3, remediation: ['Default-export a Router, Pulse application, or managed handler.'] }),
  PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE: entry('capability', { exitCode: 3, remediation: ['Inspect the application-plan blockers and select only explicitly realized package and provider capabilities.', 'Pulse will not fall back to native or another target automatically.'] }),
  PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE: entry('capability', { exitCode: 3, remediation: ['Use a package with an explicit JavaScript realization or select a native target.', 'Inspect package target support with `pulse inspect --json`.'] }),
  PULSE_PACKAGE_JAVASCRIPT_REALIZATION_NOT_IMPLEMENTED: entry('capability', { exitCode: 3, remediation: ['Select the native target for this package or wait for its declared JavaScript realization.', 'No automatic fallback occurs.'] }),
  PULSE_JAVASCRIPT_PACKAGE_PLAN_MISSING: entry('internal', { exitCode: 3, remediation: ['Rebuild the JavaScript plan and retain the graph and plan hashes when reporting the inconsistency.'] }),
  PULSE_JAVASCRIPT_PACKAGE_ESM_UNSUPPORTED: entry('capability', { exitCode: 3, remediation: ['Use a CommonJS-compatible package entry for the current Node loader or defer the package to a later JavaScript bundling contract.'] }),
  PULSE_JAVASCRIPT_PACKAGE_MODULE_UNAVAILABLE: entry('capability', { exitCode: 3, remediation: ['Install the exact package selected by the reachable graph in the application workspace.'] }),
  PULSE_JAVASCRIPT_GRAPH_EDGE_AMBIGUOUS: entry('internal', { exitCode: 3, remediation: ['Retain the graph manifest and report the duplicate runtime edge.'] }),
  PULSE_JAVASCRIPT_GRAPH_MODULE_MISSING: entry('internal', { exitCode: 3, remediation: ['Rebuild the JavaScript plan from the exact source tree and retain the graph manifest.'] }),
  PULSE_JAVASCRIPT_IMPORT_NOT_IN_GRAPH: entry('compile', { exitCode: 3, remediation: ['Keep runtime imports within the sealed reachable graph and avoid evaluation-time dynamic loading.'] }),
  PULSE_JAVASCRIPT_MODULE_NOT_FOUND: entry('project', { exitCode: 3, remediation: ['Restore the graph-owned project module or rebuild the plan after the source change.'] }),
  PULSE_JAVASCRIPT_MODULE_OUTSIDE_WORKSPACE: entry('safety', { exitCode: 3, remediation: ['Keep every graph-owned project module inside the authoritative Pulse workspace.'] }),
  PULSE_JAVASCRIPT_MODULE_SOURCE_CHANGED: entry('safety', { exitCode: 3, remediation: ['Rebuild the JavaScript application plan after changing a project module.'] }),
  PULSE_JAVASCRIPT_MODULE_COMPILE_FAILED: entry('compile', { exitCode: 3, remediation: ['Fix the TypeScript or JavaScript syntax in the graph-owned project module.'] }),
  PULSE_JAVASCRIPT_EXTERNAL_MODULE_UNAVAILABLE: entry('capability', { exitCode: 3, remediation: ['Install or explicitly declare the external module required by the JavaScript target.'] }),
  PULSE_JAVASCRIPT_MODULE_KIND_UNSUPPORTED: entry('internal', { exitCode: 3, remediation: ['Retain the application plan and report the unsupported module kind.'] }),
  PULSE_RUNTIME_APPLICATION_EXPORT_INVALID: entry('project', { exitCode: 3, remediation: ['Default-export a Router, Pulse application, or managed handler.'] }),
  PULSE_CONFIG_LOAD_FAILED: entry('project', { exitCode: 2, remediation: ['Fix the config import or runtime error.', 'Use `pulse doctor --json` to inspect the underlying cause.'] }),
  PULSE_ENTRY_NOT_FOUND: entry('project', { exitCode: 2, remediation: ['Create the configured entry file or correct `pulse.entry` in `.pulse/config.ts`.'] }),
  PULSE_PROJECT_ROOT_MISSING: entry('project', { exitCode: 2, remediation: ['Create or correct the positional project directory.'] }),
  PULSE_PROVIDER_UNSUPPORTED: entry('provider', { exitCode: 2, remediation: ['Select a bare provider id or an exact installed scoped provider package name.'] }),
  PULSE_PROVIDER_PACKAGE_NOT_FOUND: entry('provider', { exitCode: 2, remediation: ['Install the exact configured provider package in the project.', 'Confirm that its package manifest exports `./toolchain`.'] }),
  PULSE_PROVIDER_TOOLCHAIN_LOAD_FAILED: entry('provider', { exitCode: 3, remediation: ['Inspect the selected provider package and its dependency installation.', 'Treat provider toolchains as trusted project build code.'] }),
  PULSE_PROVIDER_TOOLCHAIN_INVALID: entry('provider', { exitCode: 3, remediation: ['Use a provider package implementing `pulse.provider-toolchain.v1` at `./toolchain`.', 'Confirm the declared package name, provider id, and driver shape.'] }),
  PULSE_INIT_NOT_EMPTY: entry('project', { exitCode: 2, remediation: ['Choose an empty directory or pass `--force` only when overwriting is intentional.'] }),
  PULSE_INIT_FILE_EXISTS: entry('project', { exitCode: 2, remediation: ['Remove the conflicting file or choose another target directory.'] }),
  PULSE_BUILD_OUT_UNSAFE: entry('safety', { exitCode: 2, remediation: ['Choose an output directory that is a real child of the project root.', 'Do not use `..`, external absolute paths, or symbolic-link traversal.'] }),
  PULSE_BUILD_PROVIDER_REQUIRED: entry('provider', { exitCode: 2, remediation: ['Select an executable host in the active `.pulse/config.ts` profile.', 'Use `pulse compile` when only provider-neutral Wasm is required.'] }),
  PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED: entry('capability', { exitCode: 2, remediation: ['Select a profile with `target: "native"` or use `pulse compile`.', 'Remove `--experimental-native-size` for JavaScript build output.'] }),
  PULSE_NODE_VERSION_UNSUPPORTED: entry('toolchain', { exitCode: 5, remediation: ['Use a Node.js version matching `^22.14.0 || ^24.0.0` and rerun `pulse doctor`.'] }),
  PULSE_CONFIG_IMPLICIT: entry('project', { exitCode: 2, remediation: ['Run `pulse init` or create `.pulse/config.ts` to make workspace ownership explicit.'] }),
  PULSE_PROVIDER_COMPILE_ONLY: entry('capability', { exitCode: 2, remediation: ['Select an executable provider before running `pulse dev` or `pulse test`.'] }),
  PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE: entry('toolchain', { exitCode: 5, remediation: ['Use a Node.js version matching `^22.14.0 || ^24.0.0`, or disable live network fetch and configure deterministic fetch fixtures.'] }),

  PULSE_HANDLER_ASYNC_REQUIRED: entry('compile', { exitCode: 3, remediation: ['Declare every managed handler, middleware function, and error handler with `async`.', 'Native lowering erases the wrapper; no Promise runtime or Asyncify support is added.'] }),
  PULSE_PROJECT_COMPILE_FAILED: entry('compile', { exitCode: 3, remediation: ['Read the nested diagnostics and fix the first reported source or schema error.', 'Run `pulse inspect --json` or `pulse doctor --json` for structured diagnostics.'] }),
  PULSE_CANONICAL_COMPILE_FAILED: entry('compile', { exitCode: 3, remediation: ['Rewrite the handler using the documented canonical API subset.', 'Run `pulse inspect --json` to see unsupported source forms.'] }),
  PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED: entry('compile', { exitCode: 3, remediation: ['Use a let counter starting at zero, a literal cap first, and an increment of one.', 'Keep the body within bounded pure value operations and move context operations outside the loop.', 'Respect the documented per-loop and nested iteration limits.'] }),
  PULSE_CANONICAL_NATIVE_PLAN_FAILED: entry('compile', { exitCode: 3, remediation: ['Inspect the native-plan diagnostics and rewrite unsupported canonical control flow.', 'Run `pulse inspect --json` to view the provider-neutral plan boundary.'] }),
  PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED: entry('compile', { exitCode: 3, remediation: ['Inspect the generated-native diagnostic and rewrite unsupported canonical expressions.', 'Retain the plan hash and diagnostic detail when reporting a compiler defect.'] }),
  PULSE_CANONICAL_NATIVE_COMPILE_FAILED: entry('toolchain', { exitCode: 5, remediation: ['Restore the lockfile-pinned AssemblyScript dependency and rerun `pulse doctor`.', 'Retain the generated diagnostic detail if AssemblyScript rejects valid Pulse output.'] }),
  PULSE_PACKAGE_LOWERING_FAILED: entry('compile', { exitCode: 3, remediation: ['Fix the package-owned API call shape reported in the nested diagnostic.', 'Keep package effects in the documented static positions.'] }),
  PULSE_NATIVE_IMPORT_UNSUPPORTED: entry('compile', { exitCode: 3, remediation: ['Remove or isolate the runtime dependency, use a trusted Pulse capability, or select an explicit JavaScript target when available.', 'Pulse will not change targets automatically.'] }),
  PULSE_PACKAGE_SUBPATH_UNSUPPORTED: entry('compile', { exitCode: 3, remediation: ['Import the package through its documented Pulse lowerable facade, or keep the package behind a JavaScript-only boundary.', 'Run `pulse inspect --json` to review package ownership and native eligibility.'] }),
  PULSE_PACKAGE_REEXPORT_LOWERING_DEFERRED: entry('compile', { exitCode: 3, remediation: ['Import the package-owned facade directly until helper/re-export lowering is enabled by the package contract.', 'The graph records the owning package; no fallback occurs.'] }),
  PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT: entry('compile', { exitCode: 3, remediation: ['Keep the configured application entry import-safe and move provider lifecycle startup to a separate runner.', 'Use the provider lifecycle through CLI delegation rather than starting infrastructure during application import.'] }),
  PULSE_PACKAGE_BINDING_OWNERSHIP_AMBIGUOUS: entry('compile', { exitCode: 3, remediation: ['Remove the ambiguous re-export or give each package-owned helper one unambiguous source owner.'] }),
  PULSE_PACKAGE_CONTRACT_NOT_RECOGNIZED: entry('compile', { exitCode: 3, remediation: ['Verify the trusted package manifest and direct facade import, then retain the graph and package diagnostics when reporting the issue.'] }),
  PULSE_SCHEMA_COMPILE_FAILED: entry('schema', { exitCode: 3, remediation: ['Fix the declared schema source, exported type, or supported field shape.', 'Run `pulse doctor --json` to inspect schema diagnostics.'] }),
  PULSE_CANONICAL_SCHEMA_MISSING: entry('schema', { exitCode: 3, remediation: ['Declare the referenced schema ID in the default-exported registry selected by pulse.schema.'] }),
  PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED: entry('schema', { exitCode: 2, remediation: ['Move schema declarations into a default-exported defineSchemaRegistry(...) module.', 'Point pulse.schema at that workspace-relative module.'] }),
  PULSE_SCHEMA_CODEC_REALIZATION_PENDING: entry('schema', { exitCode: 3, remediation: ['Rebuild from the authoritative pulse.schema registry with a compiler that realizes the declared shape on both targets.', 'Pulse will not fall back to generic JSON automatically.'] }),
  PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED: entry('schema', { exitCode: 3, remediation: ['Use a static string literal for the schema ID.'] }),
  PULSE_SCHEMA_ID_INVALID: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Use a non-empty schema ID declared by the authoritative pulse.schema registry.'] }),
  PULSE_SCHEMA_REQUIRED: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Supply a statically declared schema ID at every strict JSON boundary.'] }),
  PULSE_SCHEMA_REFERENCE: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Reference an ID declared by the authoritative pulse.schema registry.'] }),
  PULSE_SCHEMA_CODECS_UNAVAILABLE: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Rebuild or redeploy the application with its generated schema codec table.'] }),
  PULSE_SCHEMA_CONTENT_TYPE: entry('request', { exitCode: 4, httpStatus: 415, remediation: ['Send a JSON content type accepted by the configured schema policy.'] }),
  PULSE_SCHEMA_JSON_MALFORMED: entry('request', { exitCode: 4, httpStatus: 400, remediation: ['Send syntactically valid JSON before schema validation.'] }),
  PULSE_RESPONSE_CASE_MISSING: entry('schema', { exitCode: 3, remediation: ['Declare the referenced response case in pulse.schema.'] }),
  PULSE_RESPONSE_CASE_REFERENCE: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Use a response-case ID declared by pulse.schema.'] }),
  PULSE_RESPONSE_DESCRIPTOR_INVALID: entry('schema', { exitCode: 3, httpStatus: 500, remediation: ['Pass an object descriptor or a registered response-case string to ctx.json.'] }),
  PULSE_RESPONSE_DESCRIPTOR_LITERAL_REQUIRED: entry('schema', { exitCode: 3, remediation: ['Use an object literal or a registered response-case string literal as the ctx.json response descriptor.'] }),
  PULSE_FETCH_SCHEMA_WITHOUT_JSON: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Use schema only together with the outbound fetch json field.'] }),
  PULSE_SCHEMA_ID_DUPLICATE: entry('schema', { exitCode: 3, remediation: ['Give every declared schema a unique stable ID.'] }),
  PULSE_SCHEMA_SOURCE_REQUIRED: entry('schema', { exitCode: 3, remediation: ['Set the schema declaration `source` to a project-relative TypeScript file.'] }),
  PULSE_SCHEMA_TYPE_REQUIRED: entry('schema', { exitCode: 3, remediation: ['Set the schema declaration `type` to an exported TypeScript type name.'] }),

  PULSE_TEST_PROVIDER_REQUIRED: entry('capability', { exitCode: 2, remediation: ['Select an executable provider for `pulse test`.'] }),
  PULSE_DEV_PROVIDER_UNSUPPORTED: entry('capability', { exitCode: 2, remediation: ['Select an executable provider for `pulse dev`.'] }),
  PULSE_PROVIDER_CAPABILITY_MISSING: entry('capability', { exitCode: 3, httpStatus: 501, remediation: ['Configure the required provider binding or select a provider that implements the capability.', 'Run `pulse inspect --json` to view required capabilities and bindings.'] }),
  PULSE_PROVIDER_CAPABILITY_UNSUPPORTED: entry('capability', { exitCode: 3, httpStatus: 501, remediation: ['Remove the unsupported capability or select a compatible provider.'] }),
  PULSE_EVENT_TARGET_UNSUPPORTED: entry('capability', { exitCode: 3, httpStatus: 501, remediation: ['Select a target whose descriptor and provider event driver satisfy every reachable event requirement.', 'Use `pulse inspect --json` to review event target support; Pulse will not select another target automatically.'] }),
  PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED: entry('provider', { exitCode: 3, httpStatus: 501, remediation: ['Select Node JavaScript or Node Native for event execution, or use `none` for compile-only inspection.', 'Do not map event ingress through HTTP or GRIP.'] }),
  PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED: entry('provider', { exitCode: 3, httpStatus: 501, remediation: ['Remove the reachable event.emit requirement or select Node JavaScript or Node Native.', 'Pulse will not substitute logging, HTTP, GRIP, or another target.'] }),
  PULSE_FASTLY_BACKEND_REQUIRED: entry('provider', { exitCode: 3, remediation: ['Declare a static Fastly backend binding for the requested origin, or explicitly enable dynamic backends.'] }),
  PULSE_FASTLY_BACKEND_BINDINGS_INVALID: entry('provider', { exitCode: 2, remediation: ['Correct the Fastly `backends` map in the active `.pulse/config.ts` profile.'] }),
  PULSE_FASTLY_KV_BINDINGS_INVALID: entry('provider', { exitCode: 2, remediation: ['Correct the Fastly `kv` binding map in the active `.pulse/config.ts` profile.'] }),
  PULSE_FASTLY_GRIP_FANOUT_BACKEND_REQUIRED: entry('provider', { exitCode: 3, remediation: ['Configure the Fastly Fanout backend required by `grip.hold`.'] }),
  PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED: entry('provider', { exitCode: 3, remediation: ['Configure the Fastly GRIP publish backend and URL binding.'] }),

  PULSE_BODY_DECODE: entry('request', { exitCode: 4, httpStatus: 400, remediation: ['Send valid JSON or text matching the documented request shape.'] }),
  PULSE_SCHEMA_DECODE: entry('request', { exitCode: 4, httpStatus: 400, remediation: ['Send JSON with the required content type and schema fields.', 'Use `pulse test` with a failing case to reproduce the validation error locally.'] }),
  PULSE_BODY_TOO_LARGE: entry('request', { exitCode: 4, httpStatus: 413, remediation: ['Reduce the request payload or increase the configured structured-body limit deliberately.'] }),
  PULSE_REQUEST_DEADLINE_EXCEEDED: entry('request', { exitCode: 4, httpStatus: 504, remediation: ['Split the work into bounded invocations or deliberately adjust the provider maxDurationMs profile. A timeout does not prove rollback of dispatched writes.'] }),
  PULSE_REQUEST_CLOCK_INVALID: entry('request', { exitCode: 4, httpStatus: 504, remediation: ['Restore the provider monotonic clock before retrying. Reconcile any dispatched writes.'] }),
  PULSE_REQUEST_DURATION_INVALID: entry('project', { exitCode: 2, remediation: ['Set provider maxDurationMs to an integer from 1 through 30000, or omit it.'] }),
  PULSE_REQUEST_DURATION_UNSUPPORTED: entry('project', { exitCode: 2, remediation: ['Select Fastly Native for a provider-owned request deadline.'] }),
  PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH: entry('project', { exitCode: 2, remediation: ['Rebuild the Fastly Native artifact using the selected profile.'] }),
  PULSE_REQUEST_BODY_TOO_LARGE: entry('request', { exitCode: 4, httpStatus: 413, remediation: ['Reduce the request payload or increase `dev.maxBodyBytes` deliberately.'] }),
  PULSE_BODY_UNAVAILABLE: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Ensure the provider supplied a structured body snapshot before decoding it.'] }),
  PULSE_OPAQUE_BODY_INSPECTION: entry('runtime', { exitCode: 4, httpStatus: 400, remediation: ['Return or proxy the opaque response directly; do not call JSON, text, bytes, or transform helpers.'] }),
  PULSE_RESPONSE_ENCODE: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Return a value supported by the selected response or schema encoder.'] }),
  PULSE_SCHEMA_ENCODE: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Return a value that satisfies the declared response schema.'] }),
  PULSE_FETCH_TIMEOUT: entry('runtime', { exitCode: 4, httpStatus: 504, remediation: ['Check the origin and timeout policy, then retry.', 'Use a configured fetch fixture in tests for deterministic reproduction.'] }),
  PULSE_FETCH_NETWORK: entry('runtime', { exitCode: 4, httpStatus: 502, remediation: ['Check the origin URL, backend binding, and local network access.'] }),
  PULSE_FETCH_URL_INVALID: entry('runtime', { exitCode: 4, httpStatus: 400, remediation: ['Use an absolute supported URL or a correctly configured provider backend.'] }),
  PULSE_CONTINUATION_EXPIRED: entry('runtime', { exitCode: 4, httpStatus: 504, remediation: ['Increase the continuation TTL only if the provider operation is expected to take longer.'] }),
  PULSE_CONTINUATION_DOUBLE_RESUME: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Report this as a Pulse runtime/provider bug with the continuation trace.'] }),

  PULSE_FASTLY_CLI_UNAVAILABLE: entry('toolchain', { exitCode: 5, remediation: ['Install the Fastly CLI with Homebrew, a supported package manager, or an official release.', 'Ensure `fastly` is on PATH, or set `PULSE_FASTLY_BIN` in CI.'] }),
  PULSE_FASTLY_CLI_INSPECTION_FAILED: entry('toolchain', { exitCode: 5, remediation: ['Run `fastly version` directly and fix the Fastly CLI installation.'] }),
  PULSE_VICEROY_UNAVAILABLE: entry('toolchain', { exitCode: 5, remediation: ['Unset `PULSE_VICEROY_BIN` to let the Fastly CLI manage its local Compute engine.', 'If an override is required, point `PULSE_VICEROY_BIN` at an executable Viceroy binary.'] }),
  PULSE_VICEROY_INSPECTION_FAILED: entry('toolchain', { exitCode: 5, remediation: ['Inspect or replace the explicitly selected Viceroy override, or unset it to restore Fastly CLI ownership.'] }),
  PULSE_FASTLY_SERVE_START_FAILED: entry('toolchain', { exitCode: 5, remediation: ['Run `fastly compute serve` directly in the generated package and inspect its output.'] }),
  PULSE_FASTLY_SERVE_START_TIMEOUT: entry('toolchain', { exitCode: 5, remediation: ['Inspect Fastly CLI output and local port availability, then retry.'] }),
  PULSE_FASTLY_REQUEST_TIMEOUT: entry('toolchain', { exitCode: 5, httpStatus: 504, remediation: ['Inspect the local Fastly Compute service and backend fixture before retrying.'] })
 });

const DIAGNOSTIC_SUMMARIES = Object.freeze({
  PULSE_COMMAND_UNKNOWN: 'The requested pulse command is not part of the supported CLI.',
  PULSE_ARGUMENT_MISSING: 'A command-line option that requires a value was supplied without one.',
  PULSE_ARGUMENT_UNEXPECTED: 'The command received an option or positional argument it does not accept.',
  PULSE_PROVIDER_FLAG_REMOVED: 'Provider selection is project configuration, not a command-line override.',
  PULSE_SOURCE_ONLY_REMOVED: 'The former source-only JavaScript packaging mode is no longer part of native builds.',
  PULSE_CONFIG_NOT_FOUND: 'Project discovery did not find an explicit Pulse configuration file.',
  PULSE_PROFILE_SELECTION_REQUIRED: 'No project profile was selected by CLI, environment, or default configuration.',
  PULSE_PROFILE_UNKNOWN: 'The selected profile is absent from the project declaration.',
  PULSE_CONFIG_PLAN_PARITY_FAILED: 'Static and runtime configuration normalization produced different canonical plans.',
  PULSE_TEST_HARNESS_NOT_FOUND: 'The configured workspace-relative test harness does not exist.',
  PULSE_TEST_HARNESS_EXPORT_INVALID: 'The configured harness does not export the required ordered case collection.',
  PULSE_TEST_EXPECT_INVALID: 'A project test case uses an invalid expectation shape for its HTTP or event discriminant.',
  PULSE_TEST_EVENT_INVALID: 'A discriminated event test case is missing or violates the canonical bounded event-frame shape.',
  PULSE_TARGET_IMPLEMENTATION_PENDING: 'The selected execution target is explicit but not implemented for this command.',
  PULSE_JAVASCRIPT_APPLICATION_PLAN_INVALID: 'The JavaScript loader received a value outside the normalized application-plan contract.',
  PULSE_JAVASCRIPT_APPLICATION_GRAPH_FAILED: 'The sealed reachable graph could not be built for JavaScript application loading.',
  PULSE_JAVASCRIPT_APPLICATION_ENTRY_INVALID: 'The JavaScript plan entry is not a project-owned application module.',
  PULSE_JAVASCRIPT_APPLICATION_EXPORT_INVALID: 'The JavaScript entry does not export a managed Pulse application.',
  PULSE_JAVASCRIPT_APPLICATION_UNAVAILABLE: 'The selected JavaScript application has one or more explicit target blockers.',
  PULSE_JAVASCRIPT_PACKAGE_REALIZATION_UNAVAILABLE: 'A reachable Pulse-aware package has no JavaScript realization for the selected target.',
  PULSE_PACKAGE_JAVASCRIPT_REALIZATION_NOT_IMPLEMENTED: 'A reachable Pulse-aware package explicitly declares that its JavaScript realization is not implemented.',
  PULSE_JAVASCRIPT_PACKAGE_PLAN_MISSING: 'The graph selected a package module that is absent from the JavaScript application plan.',
  PULSE_JAVASCRIPT_PACKAGE_ESM_UNSUPPORTED: 'The current graph-backed Node loader cannot require the selected ESM-only package entry.',
  PULSE_JAVASCRIPT_PACKAGE_MODULE_UNAVAILABLE: 'The graph-selected JavaScript package module cannot be loaded from the application workspace.',
  PULSE_JAVASCRIPT_GRAPH_EDGE_AMBIGUOUS: 'The sealed JavaScript graph contains more than one runtime edge for the same import.',
  PULSE_JAVASCRIPT_GRAPH_MODULE_MISSING: 'A JavaScript graph edge or entry references a missing graph module.',
  PULSE_JAVASCRIPT_IMPORT_NOT_IN_GRAPH: 'Runtime evaluation requested an import absent from the sealed reachable graph.',
  PULSE_JAVASCRIPT_MODULE_NOT_FOUND: 'A graph-owned project module is absent at JavaScript load time.',
  PULSE_JAVASCRIPT_MODULE_OUTSIDE_WORKSPACE: 'A graph-owned project module escapes the authoritative workspace.',
  PULSE_JAVASCRIPT_MODULE_SOURCE_CHANGED: 'A graph-owned project module changed after the JavaScript plan was created.',
  PULSE_JAVASCRIPT_MODULE_COMPILE_FAILED: 'A graph-owned TypeScript or JavaScript module could not be transpiled for the Node loader.',
  PULSE_JAVASCRIPT_EXTERNAL_MODULE_UNAVAILABLE: 'A declared external module is unavailable to the JavaScript application loader.',
  PULSE_JAVASCRIPT_MODULE_KIND_UNSUPPORTED: 'The JavaScript loader encountered a module kind outside its sealed contract.',
  PULSE_RUNTIME_APPLICATION_EXPORT_INVALID: 'The application value is not a Router, Pulse application, or managed handler.',
  PULSE_CONFIG_LOAD_FAILED: 'The selected project configuration threw or failed while being loaded.',
  PULSE_ENTRY_NOT_FOUND: 'The configured canonical handler entry file does not exist.',
  PULSE_PROJECT_ROOT_MISSING: 'The selected project directory does not exist.',
  PULSE_PROVIDER_UNSUPPORTED: 'The selected provider value is not a supported shorthand or package selection.',
  PULSE_PROVIDER_PACKAGE_NOT_FOUND: 'The exact configured provider package does not expose a resolvable toolchain entry.',
  PULSE_PROVIDER_TOOLCHAIN_LOAD_FAILED: 'The selected provider package toolchain failed while loading.',
  PULSE_PROVIDER_TOOLCHAIN_INVALID: 'The selected provider package does not satisfy the versioned toolchain contract.',
  PULSE_INIT_NOT_EMPTY: 'Project initialization would write into a non-empty directory without explicit force.',
  PULSE_INIT_FILE_EXISTS: 'Project initialization would replace an existing file that is not safe to overwrite.',
  PULSE_BUILD_OUT_UNSAFE: 'The resolved build output can escape or alias outside the project root.',
  PULSE_BUILD_PROVIDER_REQUIRED: 'pulse build requires a configured deployment provider; provider-neutral output belongs to pulse compile.',
  PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED: 'The experimental Native size optimizer cannot be used for a JavaScript build target.',
  PULSE_NODE_VERSION_UNSUPPORTED: 'The active Node.js version is outside the supported release range.',
  PULSE_CONFIG_IMPLICIT: 'A command is relying on an implicit project shape instead of an explicit configuration.',
  PULSE_PROVIDER_COMPILE_ONLY: 'The none provider cannot execute development-server or project-test behavior.',
  PULSE_FETCH_IMPLEMENTATION_UNAVAILABLE: 'No supported local fetch implementation is available for the requested operation.',
  PULSE_HANDLER_ASYNC_REQUIRED: 'A managed handler in a conventional Pulse project is missing its required async wrapper.',
  PULSE_PROJECT_COMPILE_FAILED: 'Whole-project compilation failed and contains one or more nested diagnostics.',
  PULSE_CANONICAL_COMPILE_FAILED: 'The handler uses a source form outside the canonical Beta authoring subset.',
  PULSE_CANONICAL_PURE_LOOP_UNSUPPORTED: 'The loop does not satisfy the bounded pure-value control-flow contract.',
  PULSE_CANONICAL_NATIVE_PLAN_FAILED: 'The canonical handler could not be represented by the provider-neutral native execution-plan contract.',
  PULSE_CANONICAL_NATIVE_AS_GENERATION_FAILED: 'The validated native plan could not be rendered into the bounded AssemblyScript state-machine source.',
  PULSE_CANONICAL_NATIVE_COMPILE_FAILED: 'The provider-neutral native plan could not be compiled into Pulse-owned WebAssembly.',
  PULSE_PACKAGE_LOWERING_FAILED: 'A package-owned API call could not be lowered into its canonical effect contract.',
  PULSE_NATIVE_IMPORT_UNSUPPORTED: 'A reachable runtime import has no trusted Pulse native contract.',
  PULSE_PACKAGE_SUBPATH_UNSUPPORTED: 'A Pulse-aware package was imported through a subpath that is not native-lowerable.',
  PULSE_PACKAGE_REEXPORT_LOWERING_DEFERRED: 'A package-owned helper is graph-owned but reaches application code through a project re-export whose lowering remains deferred.',
  PULSE_APPLICATION_ENTRY_LIFECYCLE_SIDE_EFFECT: 'The configured application entry graph starts a known provider lifecycle during module evaluation.',
  PULSE_PACKAGE_BINDING_OWNERSHIP_AMBIGUOUS: 'A project binding or re-export resolves to more than one package-owned symbol.',
  PULSE_PACKAGE_CONTRACT_NOT_RECOGNIZED: 'The graph selected a trusted package contract that the package recognizer did not recover from its owning source module.',
  PULSE_SCHEMA_COMPILE_FAILED: 'An explicitly declared JSON schema could not be compiled.',
  PULSE_CANONICAL_SCHEMA_MISSING: 'The handler references a schema ID that is absent from project configuration.',
  PULSE_SCHEMA_JSON_DECLARATIONS_RETIRED: 'Legacy jsonSchemas declarations are no longer accepted as schema authority.',
  PULSE_SCHEMA_CODEC_REALIZATION_PENDING: 'The selected schema shape cannot be realized by every configured execution target.',
  PULSE_CANONICAL_SCHEMA_ID_LITERAL_REQUIRED: 'A schema operation uses a value that is not a static string literal ID.',
  PULSE_SCHEMA_ID_INVALID: 'A schema-bound operation received an invalid schema ID.',
  PULSE_SCHEMA_REQUIRED: 'Strict JSON operation omitted its required registered schema ID.',
  PULSE_SCHEMA_REFERENCE: 'A JSON operation references a schema absent from the compiled codec table.',
  PULSE_SCHEMA_CODECS_UNAVAILABLE: 'A schema-bound JSON operation has no compiled codec table.',
  PULSE_SCHEMA_CONTENT_TYPE: 'A schema-bound JSON input uses a content type rejected by policy.',
  PULSE_SCHEMA_JSON_MALFORMED: 'A schema-bound JSON input is not syntactically valid JSON.',
  PULSE_RESPONSE_CASE_MISSING: 'The handler references a response case absent from pulse.schema.',
  PULSE_RESPONSE_CASE_REFERENCE: 'A runtime JSON response references an unknown compiled response case.',
  PULSE_RESPONSE_DESCRIPTOR_INVALID: 'A runtime JSON response received an invalid descriptor.',
  PULSE_RESPONSE_DESCRIPTOR_LITERAL_REQUIRED: 'A JSON response descriptor cannot be resolved statically.',
  PULSE_FETCH_SCHEMA_WITHOUT_JSON: 'An outbound fetch schema was supplied without a semantic JSON payload.',
  PULSE_SCHEMA_ID_DUPLICATE: 'Two or more configured schema declarations use the same stable ID.',
  PULSE_SCHEMA_SOURCE_REQUIRED: 'A schema declaration is missing its project-relative TypeScript source file.',
  PULSE_SCHEMA_TYPE_REQUIRED: 'A schema declaration is missing its exported TypeScript type name.',
  PULSE_TEST_PROVIDER_REQUIRED: 'Project tests require an executable provider.',
  PULSE_DEV_PROVIDER_UNSUPPORTED: 'The development server requires an executable provider.',
  PULSE_PROVIDER_CAPABILITY_MISSING: 'The selected provider lacks a binding required by the compiled application.',
  PULSE_PROVIDER_CAPABILITY_UNSUPPORTED: 'The selected provider cannot realize a capability required by the application.',
  PULSE_EVENT_TARGET_UNSUPPORTED: 'The selected provider target cannot realize or test the reachable event plane.',
  PULSE_FASTLY_EVENT_INGRESS_UNSUPPORTED: 'Fastly does not expose the host-neutral event ingress required by the application.',
  PULSE_FASTLY_EVENT_EMIT_UNSUPPORTED: 'Fastly does not expose the host-neutral event acceptance operation required by the application.',
  PULSE_FASTLY_BACKEND_REQUIRED: 'A static Fastly outbound origin has no configured backend and dynamic backends are disabled.',
  PULSE_FASTLY_BACKEND_BINDINGS_INVALID: 'The Fastly backend binding map is not a valid string-to-string mapping.',
  PULSE_FASTLY_KV_BINDINGS_INVALID: 'The Fastly KV binding map is not a valid string-to-string mapping.',
  PULSE_FASTLY_GRIP_FANOUT_BACKEND_REQUIRED: 'A GRIP hold operation requires a configured Fastly Fanout backend.',
  PULSE_FASTLY_GRIP_PUBLISH_BINDING_REQUIRED: 'A GRIP publish operation requires configured Fastly publish URL and backend bindings.',
  PULSE_BODY_DECODE: 'A structured request body could not be decoded in the requested representation.',
  PULSE_SCHEMA_DECODE: 'JSON input did not satisfy the explicitly declared schema and content-type policy.',
  PULSE_BODY_TOO_LARGE: 'A structured body exceeded the configured bounded-body limit.',
  PULSE_REQUEST_DEADLINE_EXCEEDED: 'The provider-owned total request budget expired.',
  PULSE_REQUEST_CLOCK_INVALID: 'The provider monotonic request clock failed or regressed.',
  PULSE_REQUEST_DURATION_INVALID: 'The configured request duration is outside its supported range.',
  PULSE_REQUEST_DURATION_UNSUPPORTED: 'The selected target cannot enforce the configured request deadline.',
  PULSE_REQUEST_DURATION_ARTIFACT_MISMATCH: 'The Fastly artifact deadline differs from the selected profile.',
  PULSE_REQUEST_BODY_TOO_LARGE: 'An incoming development request exceeded dev.maxBodyBytes.',
  PULSE_BODY_UNAVAILABLE: 'A structured body was requested when the provider had not supplied one.',
  PULSE_OPAQUE_BODY_INSPECTION: 'Application code attempted to inspect or transform an opaque host-owned body.',
  PULSE_RESPONSE_ENCODE: 'The selected response encoder cannot represent the returned value.',
  PULSE_SCHEMA_ENCODE: 'The returned value does not satisfy its declared response schema.',
  PULSE_FETCH_TIMEOUT: 'An outbound fetch did not complete before its timeout.',
  PULSE_FETCH_NETWORK: 'An outbound fetch failed because the origin or network was unavailable.',
  PULSE_FETCH_URL_INVALID: 'An outbound fetch uses an invalid or unsupported URL.',
  PULSE_CONTINUATION_EXPIRED: 'A pending continuation exceeded its configured lifetime before resumption.',
  PULSE_CONTINUATION_DOUBLE_RESUME: 'A provider attempted to resume the same continuation more than once.',
  PULSE_FASTLY_CLI_UNAVAILABLE: 'The Fastly executable required for local target execution is unavailable.',
  PULSE_FASTLY_CLI_INSPECTION_FAILED: 'Pulse could not inspect the installed Fastly CLI version.',
  PULSE_VICEROY_UNAVAILABLE: 'The explicitly selected Viceroy override is unavailable.',
  PULSE_VICEROY_INSPECTION_FAILED: 'Pulse could not inspect the explicitly selected Viceroy override.',
  PULSE_FASTLY_SERVE_START_FAILED: 'The Fastly local Compute service failed before becoming ready.',
  PULSE_FASTLY_SERVE_START_TIMEOUT: 'The Fastly local Compute service did not become ready before its startup timeout.',
  PULSE_FASTLY_REQUEST_TIMEOUT: 'A request to the local Fastly Compute service exceeded its timeout.'
});

function titleForCode(code) {
  const acronyms = new Set(['API', 'CLI', 'GRIP', 'HTTP', 'JSON', 'KV', 'URL']);
  return String(code).replace(/^PULSE_/, '').split('_').map((part) => acronyms.has(part) ? part : part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

const DIAGNOSTIC_CATALOG = Object.freeze(Object.fromEntries(
  Object.entries(DIAGNOSTIC_DEFINITIONS).map(([code, descriptor]) => Object.freeze([code, Object.freeze({
    ...descriptor,
    title: titleForCode(code),
    summary: DIAGNOSTIC_SUMMARIES[code],
    stability: DIAGNOSTIC_STABILITY,
    scope: 'public'
  })]))
));

const FAMILY_DEFAULTS = Object.freeze([
  Object.freeze({ prefix: 'PULSE_CRYPTO_', descriptor: entry('capability', { exitCode: 3, remediation: ['Fix the effective profile crypto declaration or selected target realization.', 'Pulse will not detect or substitute another realization.'] }) }),
  Object.freeze({ prefix: 'PULSE_CANONICAL_', descriptor: entry('compile', { exitCode: 3, remediation: ['Rewrite the source using the documented canonical API subset.', 'Run `pulse inspect --json` for structured compiler diagnostics.'] }) }),
  Object.freeze({ prefix: 'PULSE_SCHEMA_', descriptor: entry('schema', { exitCode: 3, remediation: ['Fix the schema declaration or payload identified by the diagnostic.'] }) }),
  Object.freeze({ prefix: 'PULSE_FASTLY_', descriptor: entry('provider', { exitCode: 5, remediation: ['Run `pulse doctor --json` and inspect the configured provider realization.'] }) }),
  Object.freeze({ prefix: 'PULSE_PROFILE_', descriptor: entry('project', { exitCode: 2, remediation: ['Select a declared project profile explicitly.'] }) }),
  Object.freeze({ prefix: 'PULSE_PACKAGE_', descriptor: entry('compile', { exitCode: 3, remediation: ['Inspect package ownership and target-support details with `pulse inspect --json`.', 'Use only documented package facades and direct opaque app.profile() composition tokens.'] }) }),
  Object.freeze({ prefix: 'PULSE_WORKSPACE_', descriptor: entry('project', { exitCode: 2, remediation: ['Correct the authoritative workspace selection.'] }) }),
  Object.freeze({ prefix: 'PULSE_TARGET_', descriptor: entry('capability', { exitCode: 3, remediation: ['Select an implemented target or use inspection-only commands.'] }) }),
  Object.freeze({ prefix: 'PULSE_JAVASCRIPT_', descriptor: entry('capability', { exitCode: 3, remediation: ['Inspect the JavaScript application plan and its explicit target blockers.', 'Pulse will not change targets automatically.'] }) }),
  Object.freeze({ prefix: 'PULSE_CONFIG_', descriptor: entry('project', { exitCode: 2, remediation: ['Fix `.pulse/config.ts` and rerun `pulse doctor`.'] }) }),
  Object.freeze({ prefix: 'PULSE_TEST_', descriptor: entry('test', { exitCode: 4, remediation: ['Fix the configured test case or its expected result.'] }) }),
  Object.freeze({ prefix: 'PULSE_FETCH_', descriptor: entry('runtime', { exitCode: 4, httpStatus: 502, remediation: ['Inspect the origin URL, provider binding, and fetch diagnostic detail.'] }) }),
  Object.freeze({ prefix: 'PULSE_CONTINUATION_', descriptor: entry('runtime', { exitCode: 4, httpStatus: 500, remediation: ['Inspect the continuation trace and report unexpected lifecycle behavior.'] }) })
]);

function diagnosticAnchor(code) {
  return String(code || 'unknown').toLowerCase().replace(/_/g, '-');
}

function docsAnchor(code) {
  return `${DIAGNOSTICS_REFERENCE}#${diagnosticAnchor(code)}`;
}

function describeDiagnostic(code) {
  const normalized = code ? String(code) : undefined;
  const catalogued = normalized ? DIAGNOSTIC_CATALOG[normalized] : undefined;
  const found = catalogued
    || FAMILY_DEFAULTS.find((entryValue) => normalized && normalized.startsWith(entryValue.prefix))?.descriptor
    || entry('internal', { exitCode: 1, httpStatus: 500, remediation: ['Rerun with `--json` and retain the complete diagnostic for investigation.'] });
  return Object.freeze({
    version: CLI_DIAGNOSTICS_VERSION,
    code: normalized,
    title: catalogued ? catalogued.title : 'Uncatalogued Pulse diagnostic',
    summary: catalogued ? catalogued.summary : 'The diagnostic is not part of the stable public CLI catalog; inspect its structured detail.',
    category: found.category,
    exitCode: found.exitCode || 1,
    httpStatus: found.httpStatus || 500,
    remediation: found.remediation,
    stability: catalogued ? catalogued.stability : 'internal-or-forward-compatible',
    scope: catalogued ? catalogued.scope : 'fallback',
    docs: catalogued ? docsAnchor(normalized) : DIAGNOSTICS_REFERENCE
  });
}

function decorateDiagnostic(value) {
  if (!value || typeof value !== 'object') return value;
  const descriptor = describeDiagnostic(value.code);
  return Object.freeze({
    ...value,
    title: value.title || descriptor.title,
    summary: value.summary || descriptor.summary,
    category: value.category || descriptor.category,
    remediation: value.remediation || descriptor.remediation,
    stability: value.stability || descriptor.stability,
    scope: value.scope || descriptor.scope,
    docs: value.docs || descriptor.docs
  });
}

function exitCodeForDiagnostic(code, fallback = 1) {
  return code ? describeDiagnostic(code).exitCode : fallback;
}

function httpStatusForDiagnostic(code, fallback = 500) {
  return code ? describeDiagnostic(code).httpStatus : fallback;
}

module.exports = Object.freeze({
  CLI_DIAGNOSTICS_VERSION,
  DIAGNOSTICS_REFERENCE,
  DIAGNOSTIC_STABILITY,
  DIAGNOSTIC_CATALOG,
  diagnosticAnchor,
  docsAnchor,
  describeDiagnostic,
  decorateDiagnostic,
  exitCodeForDiagnostic,
  httpStatusForDiagnostic
});
