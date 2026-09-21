export type Int32 = number & { readonly __pulseInt32?: never };
export type Uint32 = number & { readonly __pulseUint32?: never };

/**
 * An immutable scalar dictionary: at most 32 own string keys, 64 UTF-16 units
 * per key, 1,024 per string value, and an 8 KiB conservative JSON byte budget.
 * Numbers must be finite. Nested containers and duplicate JSON keys are invalid.
 */
export type ScalarRecord = Readonly<Record<string, string | number | boolean | null>>;

/** Recursively immutable JSON. Compiled codecs reject non-finite numbers. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
/** Dynamic own string keys whose values are bounded, recursively nested JSON. */
export interface JsonObject { readonly [key: string]: JsonValue }
/**
 * Declared object fields keep their types and optionality; additional own keys
 * carry bounded JSON. All names at this object level must be unique in text.
 */
export type OpenObject<Type extends object> = Readonly<Type> & JsonObject;

export interface JsonLimits {
  readonly maxTextBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectMembers: number;
  readonly maxArrayItems: number;
  readonly maxKeyLength: number;
  readonly maxStringLength: number;
  readonly maxJsonBytes: number;
}

/** Supply a static object literal; each override must be a positive i32 literal. */
export interface SchemaOptions { readonly json?: Partial<JsonLimits> }

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
export declare function schema<Type>(options?: SchemaOptions): SchemaDeclaration<Type>;

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

export declare const SCHEMA_AUTHORING_VERSION: 'pulse.schema-authoring.v3';
