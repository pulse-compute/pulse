import entitiesRuntime from '@pulse-compute/wasm-contracts/entities/runtime';
import type { JsonRpcAdapter, JsonRpcOptions } from '../types.js';

export function jsonRpc(options: JsonRpcOptions = {}): JsonRpcAdapter {
  return entitiesRuntime.createJsonRpcAdapter(options) as JsonRpcAdapter;
}
