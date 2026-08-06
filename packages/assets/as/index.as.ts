/**
 * PulseWasm assets AssemblyScript sidecar.
 *
 * This package-owned sidecar is intentionally tiny. User code lowers
 * assets.lookup/respond into these stable exports; the exports delegate to
 * host-owned provider imports. Keeping the AS surface explicit lets package-out
 * tests validate the link ABI without materializing JS asset objects in Wasm.
 */

export const PULSE_ASSETS_METHOD_GET: i32 = 1;
export const PULSE_ASSETS_METHOD_HEAD: i32 = 2;
export const PULSE_ASSETS_EFFECT_TERMINAL_RESPONSE: i32 = 1;

@external("pulse_assets_host", "lookup")
declare function __pulse_assets_host_lookup(
  storePtr: usize,
  storeLen: i32,
  keyPtr: usize,
  keyLen: i32,
  method: i32,
  optionsRef: i32
): i32;

@external("pulse_assets_host", "respond")
declare function __pulse_assets_host_respond(assetHandle: i32, optionsRef: i32): i32;

/**
 * Lowering target for assets.lookup(store, key, options).
 *
 * The generated caller passes string pointers/lengths and a static method code.
 * The host/provider owns the lookup result handle. Returning a handle keeps the
 * AS sidecar narrow and avoids materializing arbitrary JS objects in Wasm.
 */
export function pulse_assets_lookup(
  storePtr: usize,
  storeLen: i32,
  keyPtr: usize,
  keyLen: i32,
  method: i32,
  optionsRef: i32
): i32 {
  return __pulse_assets_host_lookup(storePtr, storeLen, keyPtr, keyLen, method, optionsRef);
}

/**
 * Lowering target for assets.respond(assetHandle, options).
 *
 * The first compiled path treats this as a terminal asset response effect, not a
 * continuation boundary. That keeps the assets lifecycle independent from
 * ctx.resolve resume semantics until a later pass deliberately adds it.
 */
export function pulse_assets_respond(assetHandle: i32, optionsRef: i32): i32 {
  return __pulse_assets_host_respond(assetHandle, optionsRef);
}
