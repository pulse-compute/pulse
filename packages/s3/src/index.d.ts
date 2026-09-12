// Bounded S3 contract. Provider/target eligibility remains explicit.
import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';

export type S3ReadFailureReason =
  | 'invalid-key' | 'configuration' | 'credentials' | 'not-authorized'
  | 'throttled' | 'unavailable' | 'transport' | 'timeout' | 'protocol'
  | 'too-large' | 'invalid-utf8';

export interface S3Metadata {
  readonly byteLength: number;
  readonly etag?: string;
  readonly contentType?: string;
}

export interface S3ReadFailure {
  readonly status: 'failed';
  readonly reason: S3ReadFailureReason;
  readonly httpStatus?: number;
}

export type S3HeadResult =
  | ({ readonly status: 'found' } & S3Metadata)
  | { readonly status: 'not-found' }
  | S3ReadFailure;

export type S3GetTextResult =
  | ({ readonly status: 'found'; readonly text: string; readonly sha256: string } & S3Metadata)
  | { readonly status: 'not-found' }
  | S3ReadFailure;

export type S3PutTextResult =
  | { readonly status: 'stored'; readonly byteLength: number; readonly sha256: string; readonly etag?: string }
  | { readonly status: 'not-stored'; readonly reason:
      'invalid-key' | 'invalid-text' | 'too-large' | 'configuration' | 'credentials'
      | 'not-authorized' | 'rejected' | 'throttled' | 'transport' | 'timeout';
      readonly httpStatus?: number }
  | { readonly status: 'unknown'; readonly reason: 'transport' | 'timeout' | 'unavailable' | 'protocol';
      readonly httpStatus?: number };

export interface S3PutTextOptions {
  readonly contentType?: string;
}

// Binding and options must be compiler-proven literals. Key and text may be
// runtime strings. TypeScript alone cannot enforce that lowering restriction.
export declare const s3: {
  head(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3HeadResult>;
  getText(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3GetTextResult>;
  putText(ctx: PulseContext, binding: string, key: string, text: string,
    options?: S3PutTextOptions): PulseParallelEffect<S3PutTextResult>;
};
