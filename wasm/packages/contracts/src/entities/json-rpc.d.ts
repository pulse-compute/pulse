import runtime = require('./runtime.js');

declare interface JsonRpcOptions {
  readonly namedParamsOnly?: true;
  readonly acceptEmptyObjectForNoInput?: boolean;
}

declare const jsonRpcContracts: {
  readonly ENTITIES_JSON_RPC_ADAPTER_VERSION: 'pulse.entities-json-rpc-adapter.v1';
  readonly ENTITIES_JSON_RPC_ADAPTER_ID: 'json-rpc';
  readonly ENTITIES_JSON_RPC_PROTOCOL: '2.0';
  readonly ENTITIES_JSON_RPC_OPTIONS: Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: false }>;
  readonly ENTITIES_JSON_RPC_ERROR_CODES: Readonly<Record<string, number>>;
  readonly ENTITIES_JSON_RPC_FAILURE_MAP: Readonly<Record<string, Readonly<{ code: number; message: string }>>>;
  normalizeJsonRpcOptions(input?: JsonRpcOptions): Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: boolean }>;
  createJsonRpcAdapter(input?: JsonRpcOptions, limits?: typeof runtime.ENTITIES_DEFAULT_LIMITS): Readonly<{
    version: string;
    id: 'json-rpc';
    adapterVersion: string;
    options: Readonly<{ namedParamsOnly: true; acceptEmptyObjectForNoInput: boolean }>;
    limits: typeof runtime.ENTITIES_DEFAULT_LIMITS;
  }>;
  normalizeJsonRpcId(value: unknown, present?: boolean): Readonly<{ kind: string; value: unknown }>;
  mapEntitiesFailureToJsonRpc(failure: unknown): Readonly<{ code: number; message: string }>;
};

export = jsonRpcContracts;
