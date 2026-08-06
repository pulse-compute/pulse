import type { PulseContext, RouterNext } from '@pulse-compute/runtime';
import { AssetBucketConfigError, AssetBucketFetchError } from './errors.js';
import { encodeS3Key, signSigV4, type SecretValue, type SigV4Credentials } from './sigv4.js';
import { cancelResponseBody } from './response-ownership.js';
import {
  normalizeAssetContext,
  type AssetBucketContext,
  type AssetBucketRouteContext,
  type LegacyAssetBucketRouteContext,
  type RouteNext,
} from './asset-context.js';

export type {
  AssetBucketContext,
  AssetBucketRouteContext,
  LegacyAssetBucketRouteContext,
  RouteNext,
} from './asset-context.js';

export type AssetBucketMethod = 'GET' | 'HEAD';

export type AssetBucketResponseContext = {
  request: Request;
  key: string;
  upstream: Response;
};

export type AssetBucketSignerInput = {
  method: string;
  url: URL;
  headers: Headers;
  credentials: SigV4Credentials;
  region: string;
  service: string;
};

export type AssetBucketSigner = (input: AssetBucketSignerInput) => Promise<Request>;

export type AssetBucketOptions = {
  endpoint: string;
  bucket: string;
  credentials: {
    key: SecretValue;
    secret: SecretValue;
    token?: SecretValue | undefined;
  };

  region?: string | undefined;
  service?: string | undefined;
  prefix?: string | undefined;
  basePath?: string | undefined;
  ttl?: number | false | undefined;
  immutable?: boolean | undefined;
  pathStyle?: boolean | undefined;

  methods?: AssetBucketMethod[] | undefined;
  passThroughOn404?: boolean | undefined;
  passThroughOnError?: boolean | undefined;

  signer?: "sigv4" | AssetBucketSigner | undefined;
  fetch?: typeof fetch | undefined;

  mapKey?: ((ctx: AssetBucketContext) => string | Promise<string>) | undefined;
  setHeaders?:
    | ((ctx: AssetBucketResponseContext) => HeadersInit | void | Promise<HeadersInit | void>)
    | undefined;
};

export type AssetBucketMiddleware =
  & ((ctx: PulseContext, next: RouterNext) => Promise<Response>)
  & ((ctx: LegacyAssetBucketRouteContext, next?: RouteNext) => Promise<Response | void>);

export type AssetBucketInstance = AssetBucketMiddleware & {
  readonly core: AssetBucketCore;
  handle: AssetBucketMiddleware;
  resolveKey(ctx: AssetBucketRouteContext): Promise<string>;
};

export interface AssetBucketConstructor {
  new (options: AssetBucketOptions): AssetBucketInstance;
  (options: AssetBucketOptions): AssetBucketInstance;
}

const DEFAULT_TTL = 3600;
const IMMUTABLE_TTL = 31536000;
const FORWARDED_HEADERS = [
  "range",
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
] as const;

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  const clean = trimSlashes(prefix);
  return clean ? `${clean}/` : "";
}

function normalizeBasePath(basePath: string | undefined): string | undefined {
  if (!basePath) return undefined;
  const clean = `/${trimSlashes(basePath)}`;
  return clean === "/" ? undefined : clean;
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part) => trimSlashes(part))
    .filter(Boolean)
    .join("/");
}

function normalizeEndpoint(endpoint: string): URL {
  try {
    return new URL(endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
  } catch {
    throw new AssetBucketConfigError(`Invalid endpoint URL: ${endpoint}`);
  }
}

function normalizedContext(ctx: AssetBucketRouteContext): AssetBucketContext {
  return normalizeAssetContext(ctx);
}

function stripBasePath(pathname: string, basePath: string | undefined): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return pathname;
}

function applyHeaders(target: Headers, headers: HeadersInit | void): void {
  if (!headers) return;
  new Headers(headers).forEach((value, key) => target.set(key, value));
}

function makeCacheControl(options: Required<Pick<ResolvedOptions, "ttl" | "immutable">>): string | undefined {
  if (options.immutable) {
    const ttl = options.ttl === false ? IMMUTABLE_TTL : options.ttl;
    return `public, max-age=${ttl}, immutable`;
  }

  if (options.ttl === false) return undefined;
  return `public, max-age=${options.ttl}`;
}

type ResolvedOptions = {
  endpoint: URL;
  bucket: string;
  credentials: AssetBucketOptions["credentials"];
  region: string;
  service: string;
  prefix: string;
  basePath?: string | undefined;
  ttl: number | false;
  immutable: boolean;
  pathStyle: boolean;
  methods: ReadonlySet<AssetBucketMethod>;
  passThroughOn404: boolean;
  passThroughOnError: boolean;
  signer: "sigv4" | AssetBucketSigner;
  fetch: typeof fetch;
  mapKey?: AssetBucketOptions["mapKey"] | undefined;
  setHeaders?: AssetBucketOptions["setHeaders"] | undefined;
};

function resolveOptions(options: AssetBucketOptions): ResolvedOptions {
  if (!options.endpoint) throw new AssetBucketConfigError("AssetBucket requires endpoint");
  if (!options.bucket) throw new AssetBucketConfigError("AssetBucket requires bucket");
  if (!options.credentials?.key) throw new AssetBucketConfigError("AssetBucket requires credentials.key");
  if (!options.credentials?.secret) throw new AssetBucketConfigError("AssetBucket requires credentials.secret");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new AssetBucketConfigError("AssetBucket requires a fetch implementation");
  }

  return {
    endpoint: normalizeEndpoint(options.endpoint),
    bucket: options.bucket,
    credentials: options.credentials,
    region: options.region ?? "us-east-1",
    service: options.service ?? "s3",
    prefix: normalizePrefix(options.prefix),
    basePath: normalizeBasePath(options.basePath),
    ttl: options.ttl ?? DEFAULT_TTL,
    immutable: options.immutable ?? false,
    pathStyle: options.pathStyle ?? true,
    methods: new Set(options.methods ?? ["GET", "HEAD"]),
    passThroughOn404: options.passThroughOn404 ?? true,
    passThroughOnError: options.passThroughOnError ?? false,
    signer: options.signer ?? "sigv4",
    fetch: fetchImpl,
    mapKey: options.mapKey,
    setHeaders: options.setHeaders,
  };
}

export class AssetBucketCore {
  readonly options: ResolvedOptions;

  constructor(options: AssetBucketOptions) {
    this.options = resolveOptions(options);
  }

  async handle(ctx: AssetBucketRouteContext, next?: RouteNext): Promise<Response | void> {
    const normalized = normalizedContext(ctx);
    const method = normalized.request.method.toUpperCase();
    if (!this.options.methods.has(method as AssetBucketMethod)) {
      return this.pass(next);
    }

    try {
      const key = await this.resolveKey(ctx);
      if (!key) return this.pass(next);

      const upstream = await this.fetchObject(normalized.request, key, method);

      if (upstream.status === 404 && this.options.passThroughOn404) {
        await cancelResponseBody(upstream);
        return this.pass(next);
      }

      return await this.toResponse(normalized.request, key, upstream);
    } catch (cause) {
      if (this.options.passThroughOnError) return this.pass(next);

      if (cause instanceof AssetBucketConfigError) throw cause;
      throw new AssetBucketFetchError("AssetBucket failed to fetch asset", { cause });
    }
  }

  async resolveKey(ctx: AssetBucketRouteContext): Promise<string> {
    const normalized = normalizedContext(ctx);
    if (this.options.mapKey) {
      return normalizeObjectKey(await this.options.mapKey(normalized));
    }

    let relative = normalized.path.relative || new URL(normalized.request.url).pathname;
    relative = stripBasePath(relative, this.options.basePath);
    relative = relative.replace(/^\/+/, "");

    const key = `${this.options.prefix}${relative}`;
    return normalizeObjectKey(key);
  }

  private async fetchObject(request: Request, key: string, method: string): Promise<Response> {
    const url = this.objectUrl(key);
    const headers = this.forwardHeaders(request.headers);
    const signed = await this.sign({ method, url, headers });
    return await this.options.fetch(signed);
  }

  private objectUrl(key: string): URL {
    const endpoint = new URL(this.options.endpoint.toString());
    const encodedKey = encodeS3Key(key);

    if (this.options.pathStyle) {
      endpoint.pathname = joinPath(endpoint.pathname, this.options.bucket, encodedKey);
      return endpoint;
    }

    endpoint.hostname = `${this.options.bucket}.${endpoint.hostname}`;
    endpoint.pathname = joinPath(endpoint.pathname, encodedKey);
    return endpoint;
  }

  private forwardHeaders(source: Headers): Headers {
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = source.get(name);
      if (value !== null) headers.set(name, value);
    }
    return headers;
  }

  private async sign(input: { method: string; url: URL; headers: Headers }): Promise<Request> {
    if (typeof this.options.signer === "function") {
      return await this.options.signer({
        method: input.method,
        url: input.url,
        headers: input.headers,
        credentials: this.options.credentials,
        region: this.options.region,
        service: this.options.service,
      });
    }

    return await signSigV4({
      method: input.method,
      url: input.url,
      headers: input.headers,
      credentials: this.options.credentials,
      region: this.options.region,
      service: this.options.service,
    });
  }

  private async toResponse(request: Request, key: string, upstream: Response): Promise<Response> {
    const headers = new Headers(upstream.headers);
    const cacheControl = makeCacheControl({ ttl: this.options.ttl, immutable: this.options.immutable });
    if (cacheControl) headers.set("cache-control", cacheControl);

    const extraHeaders = await this.options.setHeaders?.({ request, key, upstream });
    applyHeaders(headers, extraHeaders);

    const isHead = request.method.toUpperCase() === "HEAD";
    if (isHead) await cancelResponseBody(upstream);
    return new Response(isHead ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  private async pass(next?: RouteNext): Promise<Response | void> {
    return next ? await next() : undefined;
  }
}

function normalizeObjectKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/\/+/g, "/");
}

function createAssetBucket(options: AssetBucketOptions): AssetBucketInstance {
  const core = new AssetBucketCore(options);
  const middleware = core.handle.bind(core) as AssetBucketInstance;
  Object.defineProperties(middleware, {
    core: { value: core, enumerable: false },
    handle: { value: middleware, enumerable: false },
    resolveKey: { value: core.resolveKey.bind(core), enumerable: false },
  });
  return middleware;
}

export const AssetBucket: AssetBucketConstructor = function AssetBucket(
  this: unknown,
  options: AssetBucketOptions,
): AssetBucketInstance {
  return createAssetBucket(options);
} as unknown as AssetBucketConstructor;
