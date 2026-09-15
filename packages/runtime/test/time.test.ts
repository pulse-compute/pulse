import { describe, expect, it } from 'vitest';
import { readWallTime, normalizeTimeResult, WALL_TIME_MAX_MS, executeApplication, createJavascriptEffectExecution } from '../src/host.js';

describe('provider-owned wall time', () => {
  it('formats one exact sample with a bounded UTC year', () => {
    let calls = 0;
    expect(readWallTime(() => { calls++; return 951827696789; })).toEqual({
      status: 'ok', unixEpochMs: 951827696789, iso8601: '2000-02-29T12:34:56.789Z'
    });
    expect(calls).toBe(1);
    expect(readWallTime(() => 0)).toEqual({ status: 'ok', unixEpochMs: 0, iso8601: '1970-01-01T00:00:00.000Z' });
    expect(readWallTime(() => WALL_TIME_MAX_MS)).toEqual({ status: 'ok', unixEpochMs: WALL_TIME_MAX_MS, iso8601: '9999-12-31T23:59:59.999Z' });
    expect(Object.isFrozen(readWallTime(() => 1))).toBe(true);
  });

  it('reports invalid or unavailable clocks without coercion or fabricated time', () => {
    for (const value of [-1, 0.1, NaN, Infinity, WALL_TIME_MAX_MS + 1, '123', null, undefined]) {
      expect(readWallTime(() => value as number)).toEqual({ status: 'failed', reason: 'invalid-clock' });
    }
    expect(readWallTime()).toEqual({ status: 'failed', reason: 'unavailable' });
    expect(readWallTime(() => { throw new Error('private provider failure'); })).toEqual({ status: 'failed', reason: 'unavailable' });
  });

  it('rejects malformed adapter results and never invokes result getters', () => {
    const valid = { status: 'ok', unixEpochMs: 0, iso8601: '1970-01-01T00:00:00.000Z' };
    expect(normalizeTimeResult(valid)).toEqual(valid);
    expect(normalizeTimeResult(valid)).not.toBe(valid);
    let getterCalls = 0;
    for (const value of [null, 123, { ...valid, extra: true }, { ...valid, iso8601: 'wrong' },
      { status: 'failed', reason: 'invalid-clock', unixEpochMs: 0 }, { status: 'failed', reason: 'other' },
      { get status() { getterCalls++; return 'ok'; }, unixEpochMs: 0, iso8601: valid.iso8601 }]) {
      expect(() => normalizeTimeResult(value)).toThrow(/invalid result/);
    }
    expect(getterCalls).toBe(0);
  });

  it('dispatches fresh samples, preserving regression and parallel ownership', async () => {
    const times = [2000, 1000, 3000];
    let samples = 0;
    const response = await executeApplication(async ctx => {
      const first = await ctx.time.now();
      const { second, third } = await ctx.parallel({ second: ctx.time.now(), third: ctx.time.now() });
      if (first.status !== 'ok' || second.status !== 'ok' || third.status !== 'ok') return ctx.text('failed');
      return ctx.text(`${first.unixEpochMs},${second.unixEpochMs},${third.unixEpochMs}`);
    }, new Request('https://time.test/'), { capabilities: { time: () => readWallTime(() => times[samples++]) } });
    expect(await response.text()).toBe('2000,1000,3000');
    expect(samples).toBe(3);
  });

  it('preserves cancellation and the execution effect budget', async () => {
    const controller = new AbortController();
    let release!: (value: unknown) => void;
    const deferred = new Promise(resolve => { release = resolve; });
    const execution = createJavascriptEffectExecution({ signal: controller.signal,
      effectAdapter: { dispatch: () => deferred } });
    const result = execution.dispatch({ kind: 'time.now', capability: 'time.wall-clock' });
    controller.abort();
    await expect(result).rejects.toThrow();
    release(readWallTime(() => 0));
    execution.close();
    const bounded = createJavascriptEffectExecution({ maxEffects: 1, capabilities: { time: () => readWallTime(() => 0) } });
    await bounded.dispatch({ kind: 'time.now' });
    expect(() => bounded.dispatch({ kind: 'time.now' })).toThrow(/maximum of 1/);
    bounded.close();
  });
});
