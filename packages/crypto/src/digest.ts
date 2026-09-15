import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
import packageRuntime from '@pulse-compute/runtime/package';
import digestProvider from '../src/provider.cjs';

/** Exact UTF-8 text bound, independent of HMAC and JWT limits. */
export const DIGEST_TEXT_MAX_BYTES = 2097152 as const;
export type TextDigestResult =
  | { readonly status: 'ok'; readonly sha256: string; readonly byteLength: number }
  | { readonly status: 'failed'; readonly reason: 'invalid-text' | 'too-large' | 'unavailable' | 'realization-failure' };

const runtime = packageRuntime.createPackageRuntime({
  package: '@pulse-compute/crypto', contractId: 'pulse.crypto', providerKind: 'crypto',
  operations: { digestText: { kind: 'crypto.digestText', capability: 'crypto.digestText', result: 'text-digest-result' } },
} as const);

/** Hash exact, well-formed text without normalization, parsing or uploading. */
export function digestText(ctx: PulseContext, text: string): PulseParallelEffect<TextDigestResult> {
  // Preserve the over-limit signal without copying unbounded text into the
  // shared effect envelope. This prefix is itself over the code-unit bound
  // and is rejected before UTF-8 encoding or hashing on every realization.
  const boundedText = typeof text === 'string' ? text.slice(0, DIGEST_TEXT_MAX_BYTES + 1) : null;
  return runtime.effect(ctx, 'digestText', { text: boundedText }, digestProvider.normalizeTextDigestResult);
}
