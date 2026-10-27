import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
export type CacheTextResult = { readonly status: 'found'; readonly text: string } | { readonly status: 'miss' };
/** Private adoption API. Native keys, text and options must be literals.
 * Unqualified draft: pinned Viceroy can swallow incomplete-body errors in readiness.
 * Errors fail the invocation; incomplete reads are never misses.
 * A stored result acknowledges local writer completion, not global durability.
 */
export declare const cache: {
  getText(ctx: PulseContext, key: string, options: { readonly maxBytes: number }): PulseParallelEffect<CacheTextResult>;
  putText(ctx: PulseContext, key: string, text: string, options: { readonly ttlMs: number }): PulseParallelEffect<{ readonly status: 'stored' }>;
};
