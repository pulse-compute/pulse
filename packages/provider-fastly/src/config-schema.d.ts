export interface PulseFastlyConfigSchemaRule {
  readonly kind: string;
  readonly default?: unknown;
}

export interface PulseFastlyConfigSchema {
  readonly schemaVersion: 'pulse.provider-fastly-config-schema.v1';
  readonly fields: Readonly<Record<string, PulseFastlyConfigSchemaRule>>;
}

export const FASTLY_CONFIG_SCHEMA: PulseFastlyConfigSchema;
export function fastlyConfigRule(path: string): PulseFastlyConfigSchemaRule;
export function fastlyConfigDefault(path: string): unknown;
