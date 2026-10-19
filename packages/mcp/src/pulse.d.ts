import type { PulseContext } from '@pulse-compute/runtime';
import type { EntityRouter } from '@pulse-compute/entities';
export { EntityRouter, jsonRpc } from '@pulse-compute/entities';
export interface McpBindingOptions {
  readonly router: EntityRouter;
  readonly path?: string;
  readonly serverInfo?: { readonly name: string; readonly version: string };
  readonly legacyProtocol?: '2025-06-18';
  readonly allowedOrigins?: readonly [];
  readonly limits?: { readonly maxRequestBytes?: number; readonly maxResponseBytes?: number; readonly maxDepth?: number; readonly deadlineMs?: number };
}
/** Static, terminal binding. Entities owns local operation and schema execution. */
export declare function mcp(options: McpBindingOptions): { handle(ctx: PulseContext): Promise<Response> };
