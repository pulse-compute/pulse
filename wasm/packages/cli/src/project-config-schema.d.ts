export interface PulseProjectConfigValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface PulseProjectConfigSchemaDocument {
  readonly schemaVersion: 'pulse.project-config-schema.v1';
  readonly discovery: readonly string[];
  readonly precedence: readonly string[];
  readonly sections: readonly Readonly<Record<string, unknown>>[];
  readonly fields: readonly Readonly<Record<string, unknown>>[];
  readonly runtimeRules: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

export declare const PROJECT_CONFIG_SCHEMA_VERSION: 'pulse.project-config-schema.v1';
export declare const PROJECT_CONFIG_REFERENCE_VERSION: 'pulse.project-config-schema.v1';
export declare const PROJECT_CONFIG_JSON_SCHEMA: Readonly<Record<string, unknown>>;
export declare const CONFIG_DISCOVERY: readonly string[];
export declare const CONFIG_PRECEDENCE: readonly string[];
export declare const CONFIG_FIELDS: readonly Readonly<Record<string, unknown>>[];
export declare function validateProjectConfigStructure(input: unknown): readonly PulseProjectConfigValidationIssue[];
export declare function projectConfigSchemaDocument(): PulseProjectConfigSchemaDocument;
