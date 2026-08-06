import { describe, expect, it } from 'vitest';
import assetsDefault, { assets, lookup, respond } from '@pulse-compute/assets';

describe('@pulse-compute/assets package-root boundary', () => {
  it('exports the canonical portable API without a target-specific composition helper', () => {
    expect(assetsDefault).toBe(assets);
    expect(assets.lookup).toBe(lookup);
    expect(assets.respond).toBe(respond);
    expect(typeof assets.lookup).toBe('function');
    expect(typeof assets.respond).toBe('function');
    expect(Object.isFrozen(assets)).toBe(true);
  });
});
