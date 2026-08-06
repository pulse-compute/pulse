import { describe, expect, it } from 'vitest';
import assetsDefault, {
  PulseWasmAssetsLoweringError,
  assets,
  lookup,
  respond,
  type AssetLookup,
} from '@pulse-compute/assets/pulsewasm';

describe('@pulse-compute/assets/pulsewasm', () => {
  it('keeps the Option C PulseWasm facade intentionally narrow', () => {
    expect(Object.keys(assets)).toEqual(['lookup', 'respond']);
    expect(assetsDefault).toBe(assets);
  });

  it('keeps the lowerable namespace intentionally narrow', () => {
    expect(Object.keys(assets)).toEqual(['lookup', 'respond']);
    expect(assets.lookup).toBe(lookup);
    expect(assets.respond).toBe(respond);
    expect(assetsDefault).toBe(assets);
  });

  it('throws clearly when lookup is called without PulseWasm lowering', () => {
    expect(() => lookup('public', '/app.js')).toThrow(PulseWasmAssetsLoweringError);
    expect(() => lookup('public', '/app.js')).toThrow(/assets\.lookup/);
  });

  it('throws clearly when respond is called without PulseWasm lowering', () => {
    const handle = {
      kind: 'pulse.assets.lookup',
      store: 'public',
      key: '/app.js',
    } satisfies AssetLookup;

    expect(() => respond(handle)).toThrow(PulseWasmAssetsLoweringError);
    expect(() => respond(handle)).toThrow(/assets\.respond/);
  });
});
