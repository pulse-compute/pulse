/**
 * Type-only documentation for the package-owned PulseWasm compiler builder.
 *
 * Normal @pulse-compute/assets users do not import this module. The CommonJS
 * builder entry lives at ../pulsewasm.compiler.cjs so package-out tooling can
 * load it without adding TypeScript to the runtime dependency graph.
 */

export type PulseWasmAssetsCompilerBuilderInput = {
  readonly sourceFile: unknown;
  readonly typescript: unknown;
  readonly manifest: unknown;
  readonly manifestRecords?: readonly unknown[] | undefined;
  readonly libraryContracts?: readonly unknown[] | undefined;
  readonly cwd?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly generatedBy?: string | undefined;
};

export type PulseWasmAssetsCompilerBuilderResult = {
  readonly artifact: unknown;
  readonly diagnostics: readonly unknown[];
  readonly unsupported: readonly unknown[];
  readonly entries: readonly unknown[];
  readonly payloadModes: unknown;
  readonly hasErrors: boolean;
};
