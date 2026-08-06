/**
 * PulseWasm lowerable facade for @pulse-compute/assets.
 *
 * This module is the public package-owned lowering facade. PulseWasm compilers may recognize these symbols
 * statically and lower them to the internal `pulse.assets` library contract.
 * They are not a JavaScript asset runtime.
 */

export type AssetLookupMethod = 'GET' | 'HEAD';

export type AssetLookupOptions = {
  readonly method?: AssetLookupMethod | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly passThroughOn404?: boolean | undefined;
  readonly cacheControl?: string | undefined;
};

export type AssetLookup = {
  readonly kind: 'pulse.assets.lookup';
  readonly store: string;
  readonly key: string;
  readonly options?: AssetLookupOptions | undefined;
};

export type AssetResponseOptions = {
  readonly status?: number | undefined;
  readonly headers?: HeadersInit | undefined;
};

export class PulseWasmAssetsLoweringError extends Error {
  constructor(symbol: string) {
    super(
      `${symbol} is a PulseWasm lowerable facade and cannot run directly. ` +
        'Select a supported compiler/provider target; no direct JavaScript asset runtime is exported by this package.',
    );
    this.name = 'PulseWasmAssetsLoweringError';
  }
}

function lowerableOnly(symbol: 'assets.lookup' | 'assets.respond'): never {
  throw new PulseWasmAssetsLoweringError(symbol);
}

export function lookup(store: string, key: string, options?: AssetLookupOptions): AssetLookup {
  void store;
  void key;
  void options;
  return lowerableOnly('assets.lookup');
}

export function respond(asset: AssetLookup, options?: AssetResponseOptions): Response {
  void asset;
  void options;
  return lowerableOnly('assets.respond');
}

export const assets = Object.freeze({
  lookup,
  respond,
});

export default assets;
