import type { PulseContext, PulseParallelEffect } from '@pulse-compute/runtime';
import { pulseAssetsRuntime } from './internal/package-runtime.js';

export type AssetLookupMethod = 'GET' | 'HEAD';

export type AssetLookupOptions = {
  readonly method?: AssetLookupMethod | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly passThroughOn404?: boolean | undefined;
  readonly cacheControl?: string | undefined;
  /** Native lowering payload ownership selector. JavaScript providers may ignore it. */
  readonly payloadMode?: 'text-response-body' | 'stream-pass-through-response' | undefined;
};

export type AssetResponseOptions = {
  readonly status?: number | undefined;
  readonly headers?: HeadersInit | undefined;
};

export type AssetLookup = Response;
export type AssetLookupEffect = PulseParallelEffect<AssetLookup>;

function requireNonEmpty(label: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Pulse ${label} must be a non-empty string.`);
  }
  return value;
}

function normalizedHeaderPairs(headers: HeadersInit | undefined): readonly (readonly [string, string])[] | undefined {
  if (headers === undefined) return undefined;
  const pairs: Array<readonly [string, string]> = [];
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError('Pulse asset headers must be [name, value] pairs.');
      }
      pairs.push(Object.freeze([String(entry[0]), String(entry[1])]));
    }
  } else if (headers instanceof Headers) {
    for (const [name, value] of headers.entries()) pairs.push(Object.freeze([name, value]));
  } else {
    for (const [name, value] of Object.entries(headers)) pairs.push(Object.freeze([name, String(value)]));
  }
  return Object.freeze(pairs);
}

function normalizeLookupOptions(options: AssetLookupOptions | undefined): Readonly<Record<string, unknown>> {
  if (options === undefined) return Object.freeze({});
  const method = options.method === undefined ? 'GET' : String(options.method).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    throw new TypeError('Pulse asset lookup method must be GET or HEAD.');
  }
  return Object.freeze({
    method,
    ...(options.headers === undefined ? {} : { headers: normalizedHeaderPairs(options.headers) }),
    ...(options.passThroughOn404 === undefined ? {} : { passThroughOn404: Boolean(options.passThroughOn404) }),
    ...(options.cacheControl === undefined ? {} : { cacheControl: String(options.cacheControl) }),
    ...(options.payloadMode === undefined ? {} : { payloadMode: String(options.payloadMode) }),
  });
}

function normalizeAssetResult(value: unknown): AssetLookup {
  if (!(value instanceof Response)) {
    throw new TypeError('Pulse assets.lookup providers must return a Web Response.');
  }
  return value;
}

function responseBodyAllowed(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

/**
 * Request-bound, provider-owned asset lookup. The explicit context binds the
 * effect to the active Pulse request and makes the value safe for direct await
 * or keyed ctx.parallel({ ... }) execution.
 */
export function lookup(
  ctx: PulseContext,
  store: string,
  key: string,
  options?: AssetLookupOptions,
): AssetLookupEffect {
  const normalized = normalizeLookupOptions(options);
  return pulseAssetsRuntime.effect(ctx, 'lookup', {
    store: requireNonEmpty('asset store', store),
    key: requireNonEmpty('asset key', key),
    method: normalized.method ?? 'GET',
    ...(normalized.headers === undefined ? {} : { headers: normalized.headers }),
    ...(normalized.passThroughOn404 === undefined ? {} : { passThroughOn404: normalized.passThroughOn404 }),
    ...(normalized.cacheControl === undefined ? {} : { cacheControl: normalized.cacheControl }),
    ...(normalized.payloadMode === undefined ? {} : { payloadMode: normalized.payloadMode }),
  }, normalizeAssetResult);
}

/**
 * Pure response adoption/decorating helper. With no overrides, the provider
 * Response is returned by identity so a host-owned stream can pass through.
 */
export function respond(asset: AssetLookup, options?: AssetResponseOptions): Response {
  if (!(asset instanceof Response)) {
    throw new TypeError('Pulse assets.respond requires the Response produced by assets.lookup.');
  }
  if (options === undefined || (options.status === undefined && options.headers === undefined)) return asset;

  const headers = new Headers(asset.headers);
  if (options.headers !== undefined) {
    for (const [name, value] of normalizedHeaderPairs(options.headers) ?? []) headers.append(name, value);
  }
  const status = options.status === undefined ? asset.status : Number(options.status);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new TypeError('Pulse assets.respond status must be an integer from 200 through 599.');
  }
  return new Response(responseBodyAllowed(status) ? asset.body : null, {
    status,
    statusText: asset.statusText,
    headers,
  });
}

export const assets = Object.freeze({ lookup, respond });
export default assets;
