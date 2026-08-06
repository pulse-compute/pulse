/** Bare provider id or exact installed scoped package name exposing `./toolchain`. */
export type PulseProvider = string;
export interface PulseProviderConfig {
  readonly kind: PulseProvider;
}
export type HeaderPair = readonly [name: string, value: string];

export interface PulseProjectRequest {
  readonly method?: string;
  readonly url?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>> | readonly HeaderPair[];
  readonly body?: string;
}

export interface PulseProjectExpectedError {
  readonly name?: string;
  readonly code?: string;
  readonly category?: string;
  readonly message?: string;
}

export interface PulseProjectExpectation {
  readonly status?: number;
  readonly bodyClass?: 'structured' | 'opaque';
  readonly json?: unknown;
  readonly text?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[]>> | readonly (readonly [string, string | readonly string[]])[];
  readonly error?: string | PulseProjectExpectedError;
}

export type PulseProjectEventFrame =
  | { readonly type: string; readonly schema: null; readonly schemaId?: never; readonly payload?: never }
  | { readonly type: string; readonly schema: string; readonly schemaId?: never; readonly payload: unknown }
  | { readonly type: string; readonly schema?: never; readonly schemaId: null; readonly payload?: never }
  | { readonly type: string; readonly schema?: never; readonly schemaId: string; readonly payload: unknown };

export interface PulseProjectEventExpectation {
  readonly status?: 'completed' | 'failed';
  readonly emitted?: readonly PulseProjectEventFrame[];
  readonly error?: string | PulseProjectExpectedError;
}

export interface PulseProjectTestCaseFixtures {
  readonly name: string;
  readonly fetches?: Readonly<Record<string, unknown>>;
  readonly config?: Readonly<Record<string, string>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly kv?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Provider-local GRIP fixture inputs such as holdBody or holdChunks. */
  readonly grip?: Readonly<Record<string, unknown>>;
  readonly maxBodyBytes?: number;
  readonly continuationTtlMs?: number;
}

export interface PulseProjectHttpTestCase extends PulseProjectTestCaseFixtures {
  readonly kind?: 'http';
  readonly request?: PulseProjectRequest;
  readonly event?: never;
  readonly expect: PulseProjectExpectation;
}

export interface PulseProjectEventTestCase extends PulseProjectTestCaseFixtures {
  readonly kind: 'event';
  readonly event: PulseProjectEventFrame;
  readonly request?: never;
  readonly expect: PulseProjectEventExpectation;
}

export type PulseProjectTestCase = PulseProjectHttpTestCase | PulseProjectEventTestCase;

export interface PulseSchemaConfig {
  /** Schema declarations live exclusively in the module selected by pulse.schema. */
  readonly contentTypePolicy?: 'accept-json-or-missing' | 'require-json';
  readonly maxBytes?: number;
}

export interface PulseProjectDevConfig {
  readonly host?: string;
  readonly port?: number;
  readonly watch?: boolean;
  readonly maxBodyBytes?: number;
  readonly networkFetch?: boolean;
  readonly config?: Readonly<Record<string, string>>;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly kv?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly fetches?: Readonly<Record<string, unknown>>;
}

export interface PulseProjectConfig {
  readonly entry?: string;
  readonly provider?: PulseProvider | PulseProviderConfig;
  readonly outDir?: string;
  readonly schemas?: PulseSchemaConfig;
  readonly dev?: PulseProjectDevConfig;
}

export declare const PROJECT_CONFIG_VERSION: 'pulse.project-config.v4';
export declare function runPulseWorkflowCli(argv: readonly string[], io?: { cwd?: string; stdout?: NodeJS.WritableStream; stderr?: NodeJS.WritableStream }): Promise<{ status: number }>;

export interface PulseProjectConfigValidationIssue {
  readonly path: string;
  readonly message: string;
}

export declare const PROJECT_CONFIG_SCHEMA_VERSION: 'pulse.project-config-schema.v1';
export declare const projectConfigSchema: {
  readonly PROJECT_CONFIG_SCHEMA_VERSION: 'pulse.project-config-schema.v1';
  readonly PROJECT_CONFIG_JSON_SCHEMA: Readonly<Record<string, unknown>>;
  readonly validateProjectConfigStructure: (input: unknown) => readonly PulseProjectConfigValidationIssue[];
  readonly projectConfigSchemaDocument: () => Readonly<Record<string, unknown>>;
};


export interface PulseDiagnosticDescriptor {
  readonly version: 'pulse.cli-diagnostics.v1';
  readonly code?: string;
  readonly title: string;
  readonly summary: string;
  readonly category: 'usage' | 'project' | 'safety' | 'compile' | 'schema' | 'capability' | 'provider' | 'request' | 'runtime' | 'toolchain' | 'test' | 'internal';
  readonly exitCode: number;
  readonly httpStatus: number;
  readonly remediation: readonly string[];
  readonly stability: 'preview-stable' | 'internal-or-forward-compatible';
  readonly scope: 'public' | 'fallback';
  readonly docs: string;
}

export declare const diagnostics: {
  readonly describeDiagnostic: (code?: string) => PulseDiagnosticDescriptor;
  readonly exitCodeForDiagnostic: (code?: string, fallback?: number) => number;
  readonly httpStatusForDiagnostic: (code?: string, fallback?: number) => number;
};
