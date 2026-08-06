import type { PulseContext } from '@pulse-compute/runtime';
import packageRuntime from '@pulse-compute/runtime/package';
import type { DeepReadonly, EntityDeclaration } from '../types.js';

const entitiesSchemaRuntime = packageRuntime.createPackageSchemaCodecRuntime({
  package: '@pulse-compute/entities',
  contractId: 'pulse.entities',
});

export interface EntitySchemaCodecBridge<Input = unknown, Output = unknown> {
  decodeEmbeddedJson(schemaId: string, packageOwnedText: string): DeepReadonly<Input>;
  encodeEmbeddedJson(schemaId: string, packageOwnedValue: Output): string;
}

export function bindEntitySchemaCodecBridge<Input = unknown, Output = unknown>(
  ctx: PulseContext,
  declaration: EntityDeclaration,
): EntitySchemaCodecBridge<Input, Output> {
  return entitiesSchemaRuntime.bind(ctx, {
    input: declaration.input,
    output: declaration.output,
  }) as EntitySchemaCodecBridge<Input, Output>;
}
