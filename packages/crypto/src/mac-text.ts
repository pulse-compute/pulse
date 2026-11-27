import type { PulseContext } from '@pulse-compute/runtime';
import packageRuntime from '@pulse-compute/runtime/package';
import provider from '../src/provider.cjs';

export const MAC_TEXT_MAX_BYTES = 65536 as const;
export interface MacTextOptions {
  readonly algorithm: 'HS256';
  readonly key: { readonly type: 'secret'; readonly binding: string };
}
export type MacTextVerificationResult = Readonly<{ status:
  | 'valid' | 'invalid-authenticator' | 'invalid-input' | 'too-large'
  | 'unavailable' | 'invalid-key' | 'realization-failure'
}>;

const runtime = packageRuntime.createPackageRuntime({
  package: '@pulse-compute/crypto', contractId: 'pulse.crypto', providerKind: 'crypto',
  operations: { verifyMacText: { kind: 'crypto.verifyMacText', capability: 'crypto.verifyMacText', result: 'mac-text-verification' } },
} as const);

/** Direct-await authoring seam. Managed providers require explicit operation admission. */
export async function verifyMacText(ctx: PulseContext, message: string, tag: string, options: MacTextOptions): Promise<MacTextVerificationResult> {
  const context = runtime.context(ctx);
  context.signal?.throwIfAborted();
  const normalized = provider.normalizeMacTextOptions(options);
  if (!normalized) return Object.freeze({ status: 'invalid-input' });
  // Retain an unambiguously invalid/over-limit input without cloning or encoding
  // unbounded caller data. A prefix beyond the bound cannot become valid input.
  const boundedMessage = typeof message === 'string' ? message.slice(0, MAC_TEXT_MAX_BYTES + 1) : null;
  const boundedTag = typeof tag === 'string' ? tag.slice(0, 65) : null;
  return await runtime.effect(ctx, 'verifyMacText', { ...normalized, message: boundedMessage, tag: boundedTag }, provider.normalizeMacTextResult);
}
