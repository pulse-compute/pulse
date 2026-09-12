// O2 Native read subset. PUT and JavaScript realization are reserved for O3.
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

// Binding must be a literal. Key may be a runtime string.
export declare const s3: {
  head(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3HeadResult>;
  getText(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3GetTextResult>;
};
