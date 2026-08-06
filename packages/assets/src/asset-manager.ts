import {
  AssetBucket,
  type AssetBucketInstance,
  type AssetBucketMethod,
  type AssetBucketOptions,
  type AssetBucketRouteContext,
  type RouteNext,
} from './asset-bucket.js';
import type { PulseContext, RouterNext } from '@pulse-compute/runtime';
import { AssetBucketConfigError, AssetBucketFetchError } from './errors.js';
import { normalizeAssetContext, type LegacyAssetBucketRouteContext } from './asset-context.js';
import { cancelResponseBody } from './response-ownership.js';

export type AssetCacheOptions = {
  ttl?: number | false | undefined;
  immutable?: boolean | undefined;
  passThroughOn404?: boolean | undefined;
  passThroughOnError?: boolean | undefined;
  methods?: AssetBucketMethod[] | undefined;
};

export type LocalAssetsConfig = AssetCacheOptions & {
  mode: 'local';
  dir: string;
  prefix?: string | undefined;
  index?: string | false | undefined;
  fetch?: typeof fetch | undefined;
  contentTypes?: Record<string, string> | undefined;
};

export type HostedAssetsConfig = AssetCacheOptions & {
  mode: 'hosted';
  origin: string;
  prefix?: string | undefined;
  headers?: HeadersInit | undefined;
  fetch?: typeof fetch | undefined;
};

export type BucketAssetsConfig = AssetCacheOptions & AssetBucketOptions & {
  mode: 'bucket';
};

export type AssetsConfig = LocalAssetsConfig | HostedAssetsConfig | BucketAssetsConfig;

export type AssetManagerMiddleware =
  & ((ctx: PulseContext, next: RouterNext) => Promise<Response>)
  & ((ctx: LegacyAssetBucketRouteContext, next?: RouteNext) => Promise<Response | void>);

export type AssetManagerInstance = AssetManagerMiddleware & {
  readonly core: AssetManagerCore;
  handle: AssetManagerMiddleware;
  resolveKey(ctx: AssetBucketRouteContext): Promise<string>;
};

export interface AssetManagerConstructor {
  new (config: AssetsConfig): AssetManagerInstance;
  (config: AssetsConfig): AssetManagerInstance;
}

const DEFAULT_TTL = 3600;
const IMMUTABLE_TTL = 31536000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return '';
  const clean = trimSlashes(prefix);
  return clean ? `${clean}/` : '';
}

function normalizeKey(key: string): string {
  const pathOnly = key.split('?')[0] ?? '';
  return decodeURIComponent(pathOnly)
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function normalizeMethods(methods: AssetBucketMethod[] | undefined): ReadonlySet<AssetBucketMethod> {
  return new Set(methods ?? ['GET', 'HEAD']);
}

function requestRelativePath(ctx: AssetBucketRouteContext): string {
  return normalizeAssetContext(ctx).path.relative;
}

function cacheControl(config: AssetCacheOptions): string | undefined {
  const ttl = config.ttl ?? DEFAULT_TTL;
  const immutable = config.immutable ?? false;

  if (immutable) {
    const maxAge = ttl === false ? IMMUTABLE_TTL : ttl;
    return `public, max-age=${maxAge}, immutable`;
  }

  if (ttl === false) return undefined;
  return `public, max-age=${ttl}`;
}

function applyCache(headers: Headers, config: AssetCacheOptions): void {
  const value = cacheControl(config);
  if (value) headers.set('cache-control', value);
}

function mimeType(path: string, overrides?: Record<string, string>): string | undefined {
  const lower = path.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  if (overrides?.[ext]) return overrides[ext];

  switch (ext) {
    case 'html': return 'text/html; charset=utf-8';
    case 'css': return 'text/css; charset=utf-8';
    case 'js':
    case 'mjs': return 'text/javascript; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'ico': return 'image/x-icon';
    case 'txt': return 'text/plain; charset=utf-8';
    case 'wasm': return 'application/wasm';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    default: return undefined;
  }
}

async function importNodeModule(specifier: string): Promise<any> {
  return await import(specifier);
}

function validateMode(config: AssetsConfig): void {
  if (!isRecord(config)) {
    throw new AssetBucketConfigError('AssetManager requires an assets config object');
  }

  if (config.mode !== 'local' && config.mode !== 'hosted' && config.mode !== 'bucket') {
    throw new AssetBucketConfigError('AssetManager requires explicit mode: local, hosted, or bucket');
  }
}

export class AssetManagerCore {
  readonly config: AssetsConfig;
  private readonly bucket?: AssetBucketInstance | undefined;

  constructor(config: AssetsConfig) {
    validateMode(config);
    this.config = config;

    if (config.mode === 'bucket') {
      this.bucket = new AssetBucket(config);
    } else if (config.mode === 'local') {
      if (!config.dir) throw new AssetBucketConfigError('AssetManager local mode requires dir');
    } else if (config.mode === 'hosted') {
      if (!config.origin) throw new AssetBucketConfigError('AssetManager hosted mode requires origin');
      try {
        new URL(config.origin);
      } catch {
        throw new AssetBucketConfigError(`AssetManager hosted mode requires a valid origin URL: ${config.origin}`);
      }
    }
  }

  async handle(ctx: AssetBucketRouteContext, next?: RouteNext): Promise<Response | void> {
    switch (this.config.mode) {
      case 'local': return await this.handleLocal(ctx, next);
      case 'hosted': return await this.handleHosted(ctx, next);
      case 'bucket': return await this.bucket!.core.handle(ctx, next);
      default: return await this.pass(next);
    }
  }

  async resolveKey(ctx: AssetBucketRouteContext): Promise<string> {
    if (this.config.mode === 'bucket') {
      return await this.bucket!.resolveKey(ctx);
    }

    const key = normalizeKey(requestRelativePath(ctx));
    const prefix = normalizePrefix(this.config.prefix);
    const joined = `${prefix}${key}`;

    if (this.config.mode === 'local') {
      if ((joined === '' || joined.endsWith('/')) && this.config.index !== false) {
        return `${joined}${this.config.index ?? 'index.html'}`;
      }
    }

    return joined;
  }

  private allowed(method: string): boolean {
    return normalizeMethods(this.config.methods).has(method as AssetBucketMethod);
  }

  private async handleLocal(ctx: AssetBucketRouteContext, next?: RouteNext): Promise<Response | void> {
    const normalized = normalizeAssetContext(ctx);
    const method = normalized.request.method.toUpperCase();
    if (!this.allowed(method)) return await this.pass(next);

    try {
      const key = await this.resolveKey(ctx);
      if (!key) return await this.pass(next);

      const { default: fs } = await importNodeModule('node:fs/promises');
      const path = await importNodeModule('node:path');
      const root = path.resolve(this.config.mode === 'local' ? this.config.dir : '.');
      const target = path.resolve(root, key);
      const separator = path.sep ?? '/';

      if (target !== root && !target.startsWith(`${root}${separator}`)) {
        return new Response('Forbidden', { status: 403 });
      }

      try {
        const stat = await fs.stat(target);
        if (!stat.isFile()) return await this.handleMiss(next);
      } catch (cause) {
        if (isNodeNotFound(cause)) return await this.handleMiss(next);
        throw cause;
      }

      const body = method === 'HEAD' ? null : await fs.readFile(target);
      const headers = new Headers();
      const type = mimeType(target, this.config.mode === 'local' ? this.config.contentTypes : undefined);
      if (type) headers.set('content-type', type);
      applyCache(headers, this.config);

      return new Response(body, { status: 200, headers });
    } catch (cause) {
      if (this.config.passThroughOnError) return await this.pass(next);
      if (cause instanceof AssetBucketConfigError) throw cause;
      throw new AssetBucketFetchError('AssetManager failed to serve local asset', { cause });
    }
  }

  private async handleHosted(ctx: AssetBucketRouteContext, next?: RouteNext): Promise<Response | void> {
    const config = this.config;
    if (config.mode !== 'hosted') return await this.pass(next);

    const normalized = normalizeAssetContext(ctx);
    const method = normalized.request.method.toUpperCase();
    if (!this.allowed(method)) return await this.pass(next);

    try {
      const fetchImpl = config.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        throw new AssetBucketConfigError('AssetManager hosted mode requires a fetch implementation');
      }

      const key = await this.resolveKey(ctx);
      if (!key) return await this.pass(next);

      const url = new URL(config.origin.endsWith('/') ? config.origin : `${config.origin}/`);
      url.pathname = joinUrlPath(url.pathname, key);
      url.search = new URL(normalized.request.url).search;

      const headers = new Headers(config.headers);
      copyConditionalHeaders(normalized.request.headers, headers);

      const upstream = await fetchImpl(new Request(url, { method, headers }));
      if (upstream.status === 404 && (config.passThroughOn404 ?? true)) {
        await cancelResponseBody(upstream);
        return await this.pass(next);
      }

      const responseHeaders = new Headers(upstream.headers);
      applyCache(responseHeaders, this.config);
      if (method === 'HEAD') await cancelResponseBody(upstream);
      return new Response(method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (cause) {
      if (this.config.passThroughOnError) return await this.pass(next);
      if (cause instanceof AssetBucketConfigError) throw cause;
      throw new AssetBucketFetchError('AssetManager failed to fetch hosted asset', { cause });
    }
  }

  private async handleMiss(next?: RouteNext): Promise<Response | void> {
    if (this.config.passThroughOn404 ?? true) return await this.pass(next);
    return new Response('Not Found', { status: 404 });
  }

  private async pass(next?: RouteNext): Promise<Response | void> {
    return next ? await next() : undefined;
  }
}

function isNodeNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function joinUrlPath(...parts: string[]): string {
  return `/${parts.map((part) => trimSlashes(part)).filter(Boolean).join('/')}`;
}

function copyConditionalHeaders(source: Headers, target: Headers): void {
  for (const name of ['range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']) {
    const value = source.get(name);
    if (value !== null) target.set(name, value);
  }
}

function createAssetManager(config: AssetsConfig): AssetManagerInstance {
  const core = new AssetManagerCore(config);
  const middleware = core.handle.bind(core) as AssetManagerInstance;
  Object.defineProperties(middleware, {
    core: { value: core, enumerable: false },
    handle: { value: middleware, enumerable: false },
    resolveKey: { value: core.resolveKey.bind(core), enumerable: false },
  });
  return middleware;
}

export const AssetManager: AssetManagerConstructor = function AssetManager(
  this: unknown,
  config: AssetsConfig,
): AssetManagerInstance {
  return createAssetManager(config);
} as unknown as AssetManagerConstructor;

export function createAssets(config: AssetsConfig): AssetManagerInstance {
  return createAssetManager(config);
}
