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

export interface S3ListOptions {
  readonly prefix?: string;
  readonly continuationToken?: string;
  /** 1–1000; default 100. One page per effect, no automatic traversal. */
  readonly maxKeys?: number;
}
export interface S3ListEntry { readonly key: string; readonly byteLength: number; readonly etag?: string }
export type S3ListResult =
  | { readonly status: 'listed'; readonly entries: readonly S3ListEntry[]; readonly isTruncated: false }
  | { readonly status: 'listed'; readonly entries: readonly S3ListEntry[]; readonly isTruncated: true; readonly nextContinuationToken: string }
  | { readonly status: 'failed'; readonly reason: S3ReadFailureReason | 'invalid-options'; readonly httpStatus?: number };
export type S3DeleteResult =
  | { readonly status: 'deleted' }
  | { readonly status: 'not-deleted'; readonly reason: 'invalid-key' | 'configuration' | 'credentials' | 'not-authorized' | 'rejected' | 'throttled' | 'transport' | 'timeout'; readonly httpStatus?: number }
  | { readonly status: 'unknown'; readonly reason: 'transport' | 'timeout' | 'unavailable' | 'protocol'; readonly httpStatus?: number };

// Binding and PUT/body options must be compiler-proven literals. Keys, text
// and LIST options may be runtime values. TypeScript cannot enforce lowering.
export interface S3GetBodyOptions {
  readonly method?: 'GET' | 'HEAD';
  /** One closed byte range, for example bytes=0-1023; GET only. */
  readonly range?: string;
  /** One entity tag or *, without a comma-separated list. */
  readonly ifNoneMatch?: string;
}

export declare const s3: {
  /** Runtime prefix/cursor/page size; bucket authority remains in the binding. */
  list(ctx: PulseContext, binding: string, options?: S3ListOptions): PulseParallelEffect<S3ListResult>;
  /** Complete 204 acknowledgement; does not prove prior existence or erase version history. */
  delete(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3DeleteResult>;
  /** Opaque binary response; capped by maxTextBytes. Return without decoding. */
  getBody(ctx: PulseContext, binding: string, key: string, options?: S3GetBodyOptions): PulseParallelEffect<Response>;
  head(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3HeadResult>;
  getText(ctx: PulseContext, binding: string, key: string): PulseParallelEffect<S3GetTextResult>;
  putText(ctx: PulseContext, binding: string, key: string, text: string,
    options?: S3PutTextOptions): PulseParallelEffect<S3PutTextResult>;
};
