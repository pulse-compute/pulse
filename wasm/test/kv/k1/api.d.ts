// K1 design fixture only; K2 owns promotion into @pulse-compute/runtime.
import type { PulseContext, PulseKvNamespace, PulseParallelEffect } from '@pulse-compute/runtime';

// Opaque, bounded string. It is neither an application version nor a number.
export type PulseKvGeneration = string;
export type PulseKvReadFailureReason =
  | 'invalid-key' | 'configuration' | 'not-authorized' | 'throttled'
  | 'unavailable' | 'transport' | 'timeout' | 'protocol' | 'too-large' | 'invalid-value';
export type PulseKvVersionedResult<T> =
  | { readonly status: 'found'; readonly value: T; readonly generation: PulseKvGeneration }
  | { readonly status: 'not-found' }
  | { readonly status: 'failed'; readonly reason: PulseKvReadFailureReason };

export type PulseKvNotStoredReason =
  | 'invalid-key' | 'invalid-value' | 'invalid-generation' | 'too-large'
  | 'configuration' | 'not-authorized' | 'throttled' | 'rejected'
  | 'unavailable' | 'transport' | 'timeout' | 'protocol';
export type PulseKvConditionalResult =
  | { readonly status: 'stored' }
  | { readonly status: 'conflict' }
  | { readonly status: 'not-stored'; readonly reason: PulseKvNotStoredReason }
  | { readonly status: 'unknown'; readonly reason: 'transport' | 'timeout' | 'unavailable' | 'protocol' };

export interface PulseConditionalKvNamespace<T = unknown> extends PulseKvNamespace<T> {
  getVersioned(key: string): PulseParallelEffect<PulseKvVersionedResult<T>>;
  insertIfAbsent(key: string, value: T): PulseParallelEffect<PulseKvConditionalResult>;
  compareAndSwap(key: string, generation: PulseKvGeneration, value: T): PulseParallelEffect<PulseKvConditionalResult>;
}

// Typecheck-only context: no runtime shim or production module augmentation.
export type K1Context = Omit<PulseContext, 'kv'> & {
  kv<T = unknown>(name: string): PulseConditionalKvNamespace<T>;
};
