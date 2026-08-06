import type { PulseContext } from '@pulse-compute/runtime';
import { pulseAssetsRuntime } from './internal/package-runtime.js';

export type RouteNext = () => Promise<Response | void> | Response | void;

export type LegacyAssetBucketRouteContext = {
  request: Request;
  params?: Readonly<Record<string, string>> | undefined;
  state?: Record<string, unknown> | undefined;
  path?: {
    absolute?: string | undefined;
    relative?: string | undefined;
  } | undefined;
  raw?: {
    request?: unknown;
    response?: unknown;
    env?: unknown;
    [key: string]: unknown;
  } | undefined;
};

export type AssetBucketRouteContext = PulseContext | LegacyAssetBucketRouteContext;

export type AssetBucketContext = {
  request: Request;
  params: Readonly<Record<string, string>>;
  path: {
    absolute: string;
    relative: string;
  };
  raw: {
    request?: unknown;
    response?: unknown;
    env?: unknown;
    [key: string]: unknown;
  };
};

function isPulseContext(value: AssetBucketRouteContext): value is PulseContext {
  return Boolean(value && typeof value === 'object' && 'req' in value && 'state' in value);
}

export function normalizeAssetContext(ctx: AssetBucketRouteContext): AssetBucketContext {
  if (isPulseContext(ctx)) {
    const view = pulseAssetsRuntime.context(ctx);
    return {
      request: view.request,
      params: view.params,
      path: view.path,
      raw: {},
    };
  }
  if (!ctx || !(ctx.request instanceof Request)) {
    throw new TypeError('Pulse Assets middleware requires a PulseContext or legacy request context.');
  }
  const url = new URL(ctx.request.url);
  return {
    request: ctx.request,
    params: ctx.params ?? {},
    path: {
      absolute: ctx.path?.absolute ?? url.pathname,
      relative: ctx.path?.relative ?? url.pathname,
    },
    raw: ctx.raw ?? {},
  };
}
