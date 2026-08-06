import type { PulseContext } from '@pulse-compute/runtime';

export type EntitySchemaId = string;

export type StaticJsonPrimitive = string | number | boolean | null;
export type StaticJsonValue = StaticJsonPrimitive | StaticJsonObject | readonly StaticJsonValue[];
export interface StaticJsonObject {
  readonly [key: string]: StaticJsonValue;
}

export type DeepReadonly<Value> =
  Value extends (...args: never[]) => unknown ? Value
    : Value extends readonly (infer Entry)[] ? readonly DeepReadonly<Entry>[]
      : Value extends object ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

export interface StaticEntityMetadata extends StaticJsonObject {}

export interface EntityDeclaration {
  readonly input: EntitySchemaId | null;
  readonly output: EntitySchemaId | null;
  readonly metadata?: StaticEntityMetadata;
}

export type EntityHandlerResult<Output> = Output | Promise<Output>;

export type EntityHandler<Input, Output> = (
  ctx: PulseContext,
  input: DeepReadonly<Input>,
) => EntityHandlerResult<Output>;

export interface JsonRpcOptions {
  readonly namedParamsOnly?: true;
  readonly acceptEmptyObjectForNoInput?: boolean;
}

export interface JsonRpcAdapter {
  readonly version: 'pulse.entities-adapter.v1';
  readonly id: 'json-rpc';
  readonly adapterVersion: 'pulse.entities-json-rpc-adapter.v1';
  readonly options: Readonly<{
    namedParamsOnly: true;
    acceptEmptyObjectForNoInput: boolean;
  }>;
  readonly limits: Readonly<{
    maxEnvelopeBytes: number;
    maxPayloadBytes: number;
    maxMethodBytes: number;
    maxEntities: number;
    maxMetadataBytesPerEntity: number;
    maxMetadataBytesPerRouter: number;
    maxMetadataDepth: number;
    maxMetadataEntries: number;
    maxJsonDepth: number;
    maxOutputBytes: number;
    maxErrorMessageBytes: number;
  }>;
}

export type EntityAdapter = JsonRpcAdapter;

export interface EntityRouterOptions {
  readonly adapter: EntityAdapter;
}
