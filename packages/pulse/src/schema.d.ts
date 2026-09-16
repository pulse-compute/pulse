export type Int32 = number & { readonly __pulseInt32?: never };
export type Uint32 = number & { readonly __pulseUint32?: never };

declare const schemaDeclarationBrand: unique symbol;
declare const responseCaseDeclarationBrand: unique symbol;
declare const schemaRegistryBrand: unique symbol;

export interface SchemaDeclaration<Type> {
  readonly [schemaDeclarationBrand]: Type;
}

export interface ResponseCaseDeclaration<
  Status extends number = number,
  SchemaId extends string = string
> {
  readonly status: Status;
  readonly schemaId: SchemaId;
  readonly [responseCaseDeclarationBrand]: true;
}

export interface SchemaRegistryDeclaration<
  Schemas extends Readonly<Record<string, SchemaDeclaration<unknown>>>,
  Responses extends Readonly<Record<string, ResponseCaseDeclaration>>
> {
  readonly schemas: Schemas;
  readonly responses?: Responses;
  readonly [schemaRegistryBrand]: true;
}

/**
 * Declare one object-root schema. The stable string key is authoritative.
 * Question-mark properties preserve absence; present values must satisfy their
 * declared type. Nullable and absent are distinct; present undefined is invalid.
 */
export declare function schema<Type>(): SchemaDeclaration<Type>;

/** Map one semantic response-case ID to an HTTP status and registered schema ID. */
export declare function response<const Status extends number, const SchemaId extends string>(
  status: Status,
  schemaId: SchemaId
): ResponseCaseDeclaration<Status, SchemaId>;

/**
 * Preserve one static schema registry. Pulse extracts this default-exported call;
 * it does not execute application registry code during compilation.
 */
export declare function defineSchemaRegistry<
  const Schemas extends Readonly<Record<string, SchemaDeclaration<unknown>>>,
  const Responses extends Readonly<Record<string, ResponseCaseDeclaration>>
>(registry: {
  readonly schemas: Schemas;
  readonly responses?: Responses;
}): SchemaRegistryDeclaration<Schemas, Responses>;

export declare const SCHEMA_AUTHORING_VERSION: 'pulse.schema-authoring.v1';
