'use strict';
const assert = require('node:assert/strict');

// Separate host ledger. Failure/consumption combinations are model assumptions.
function execute(wasm, options = {}) {
  let instance, next = options.startHandle ?? 0, response = 2000000, status = 200;
  let now = 0n, attacked = false, delayed = false;
  const trace = [], resources = new Map(), committed = [], output = [], calls = {};
  const e = () => instance.exports, memory = () => new Uint8Array(e().memory.buffer);
  const view = () => new DataView(e().memory.buffer), put = (p, n) => view().setInt32(p, n, true);
  const text = (p, n) => Buffer.from(memory().subarray(p, p + n)).toString();
  const query = (k, i = 0) => e().proof_query?.(k, i) ?? null;
  const snapshot = () => ({handles: query(0), bytes: query(1), records: query(2),
    closed: e().proof_closed?.() ?? null, ticket: e().proof_ticket?.(0) ?? null,
    authority: e().proof_authority?.() ?? null, pending: e().pulse_pending_count?.() ?? null});
  function event(call, detail = {}) { const row = {call, ...detail, ...snapshot()}; trace.push(row); calls[call] = (calls[call] || 0) + 1; }
  function fail(call) { return (Array.isArray(options.failAt) ? options.failAt.includes(call) : options.failAt === call)
    && (!options.failNth || calls[call] === options.failNth); }
  function trap(call) { if (options.trapAt === call) throw new WebAssembly.RuntimeError('injected ' + call + ' trap'); }
  function done(call) {
    if (options.expireAt === call) now = 1000000000n;
    if (options.delayAt === call && !delayed) { now += BigInt(options.delayMs ?? 37) * 1000000n; delayed = true; }
    if (options.cancelAt === call) e().proof_cancel();
  }
  function get(h, kind) { const r = resources.get(h); assert(r && (!kind || r.kind === kind), 'live ' + kind + ' handle ' + h); return r; }
  function alloc(kind, data) {
    const h = next++; resources.set(h, {kind, ...data}); event('acquire', {h, kind});
    if (query(0) !== null) assert(query(0) >= resources.size, 'pre-registered claims cover acquisition');
    return h;
  }
  function release(h, action) { const r = get(h); resources.delete(h); event('release', {h, kind: r.kind, action}); }
  function closeBody(h, abandon = false) {
    if (h >= 2000000) return 0;
    const r = get(h), call = abandon ? 'abandon' : r.kind === 'writer' ? 'commit' : 'reader.close';
    event(call, {h}); trap(call);
    if (!fail(call) || options.consumeOnFailure) {
      if (r.kind === 'writer' && !abandon) committed.push({key: r.key, value: r.value});
      release(h, call);
    }
    done(call); return fail(call) ? 3 : 0;
  }
  function stringOut(s, p, n, out) { const b = Buffer.from(s); assert(b.length <= n); memory().set(b, p); put(out, b.length); return 0; }
  const imports = {
    ra06_proof: {event: (code, index, value) => {
      event('hook', {code, index, value}); trap('hook.' + code);
      const when = options.attack === 'success-on-failure' || options.attack === 'failure-placeholder' ? 12 : 3;
      if (code === when && options.attack && !attacked) {
        attacked = true; const before = e().proof_ticket(index);
        const token = options.attack === 'undefined-success' || options.attack === 'failure-placeholder' ? e().proof_undefined()
          : options.attack === 'success-on-failure' || options.attack === 'wrong-result' ? e().proof_forged() : value;
        const result = options.attack === 'direct-result' ? e().pulse_set_effect_result(index, token)
          : e().proof_settle(index, before + (options.attack === 'wrong-ticket' ? 1 : 0), token);
        event('attack', {attack: options.attack, result, before, after: e().proof_ticket(index)});
      }
    }},
    fastly_abi: {init: () => 0},
    wasi_snapshot_preview1: {
      clock_time_get: (_id, _p, out) => { view().setBigUint64(out, now, true); return 0; },
      fd_write: (_fd, p, n, out) => { let len = 0; for (let i = 0; i < n; i++) len += view().getUint32(p + i * 8 + 4, true); put(out, len); return 0; }
    },
    fastly_async_io: {
      select: (p, n, timeout, out) => {
        const handles = Array.from({length: n}, (_, i) => view().getInt32(p + i * 4, true));
        handles.forEach(h => get(h)); event('select', {handles, timeout}); trap('select');
        if (options.timeoutSelect) { now += BigInt(timeout) * 1000000n; put(out, -1); return 0; }
        if (fail('select')) { put(out, -1); done('select'); return 3; }
        for (const h of handles) get(h).ready = true;
        put(out, 0); done('select'); return 0;
      },
      is_ready: (h, out) => {
        const r = get(h, 'cache'); event('is_ready', {h}); trap('is_ready');
        const ready = options.pendingOnCleanup ? false : options.readyOnCleanup ?? r.ready;
        put(out, ready ? 1 : 0); if (ready) r.ready = true;
        done('is_ready'); return fail('is_ready') ? 3 : 0;
      }
    },
    fastly_cache: {
      lookup: (p, n, mask, _opts, out) => {
        assert.equal(mask, 0); const key = text(p, n); event('lookup', {key}); trap('lookup');
        if (!fail('lookup') || options.allocateOnFailure) put(out, alloc('cache', {key, ready: false}));
        done('lookup'); return fail('lookup') ? 3 : 0;
      },
      insert: (p, n, mask, opts, out) => {
        assert.equal(mask, 0); const key = text(p, n); event('insert', {key, ttlNs: view().getBigUint64(opts, true).toString()}); trap('insert');
        if (!fail('insert') || options.allocateOnFailure) put(out, alloc('writer', {key, value: '', ready: false}));
        done('insert'); return fail('insert') ? 3 : 0;
      },
      get_state: (h, out) => {
        get(h, 'cache'); event('state', {h}); trap('state');
        if (!fail('state')) put(out, options.miss ? 0 : options.stale ? 7 : 3);
        done('state'); return fail('state') ? 3 : 0;
      },
      get_body: (h, mask, _opts, out) => {
        assert.equal(mask, 0); const r = get(h, 'cache'); event('body', {h}); trap('body');
        if (!fail('body') || options.allocateOnFailure) put(out, alloc('reader', {key: r.key, value: options.value ?? 'value:' + r.key, offset: 0, ready: true}));
        done('body'); return fail('body') ? 3 : 0;
      },
      close: h => {
        const r = get(h, 'cache'); event('cache.close', {h});
        assert(r.ready, 'never close an unready lookup'); trap('cache.close');
        if (!fail('cache.close') || options.consumeOnFailure) release(h, 'cache.close');
        done('cache.close'); return fail('cache.close') ? 3 : 0;
      }
    },
    fastly_http_body: {
      read: (h, p, n, out) => {
        const r = get(h, 'reader'); event('read', {h, n}); trap('read');
        if (!fail('read')) {
          const b = Buffer.from(r.value), size = Math.min(n, options.chunk ?? 8, b.length - r.offset);
          memory().set(b.subarray(r.offset, r.offset + size), p); r.offset += size;
          put(out, options.badLength ? n + 1 : size);
        }
        done('read'); return fail('read') ? 3 : 0;
      },
      write: (h, p, n, _end, out) => {
        if (h >= 2000000) { output.push(text(p, n)); put(out, n); return 0; }
        const r = get(h, 'writer'); event('write', {h, n}); trap('write');
        if (!fail('write')) {
          const size = options.zeroWrite ? 0 : Math.min(n, options.chunk ?? 8);
          r.value += text(p, size); put(out, options.badLength ? n + 1 : size);
        }
        done('write'); return fail('write') ? 3 : 0;
      },
      close: h => closeBody(h), abandon: h => closeBody(h, true), new: out => { put(out, ++response); return 0; }
    },
    fastly_http_req: {
      body_downstream_get: (r, b) => { put(r, 2000041); put(b, 2000042); return 0; },
      method_get: (_h, p, n, out) => stringOut('GET', p, n, out),
      uri_get: (_h, p, n, out) => stringOut('https://proof.invalid/', p, n, out),
      header_value_get: () => 10, close: () => 0
    },
    fastly_http_resp: {
      new: out => { put(out, ++response); return 0; }, status_set: (_h, s) => { status = s; return 0; },
      header_append: () => 0, close: () => 0,
      send_downstream: () => { event('send', {status}); trap('send'); done('send'); return fail('send') ? 3 : 0; }
    }
  };
  let thrown = null;
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), imports);
    e().proof_control?.(options.short ? 1 : 0); e()._start();
  } catch (error) { thrown = error.message; }
  const post = [];
  if (!thrown && options.lateReady) {
    for (const [h, r] of resources) { r.ready = true; event('late-ready', {h}); }
    post.push({settle: e().proof_settle(0, 1, e().proof_forged()), direct: e().pulse_set_effect_result(0, e().proof_forged())});
  }
  if (!thrown && options.repeatClose) { e().proof_close(); e().proof_close(); }
  if (!thrown && options.postResponders) e().proof_respond();
  const exports = instance?.exports, q = (k, i = 0) => exports?.proof_query?.(k, i) ?? null;
  const accounting = {handles: q(0), bytes: q(1), records: q(2), disposals: q(3), cleanupErrors: q(4),
    commitAttempts: q(5), rejected: q(6), delivery: q(7), captures: q(8), containment: q(9), committedCapacity: q(10)};
  if (exports?.proof_query && !accounting.containment) assert(accounting.handles >= resources.size, 'retained claims cover independent host resources');
  const body = output.join(''); let json; try { json = JSON.parse(body); } catch {}
  return {trace, body, json, status, thrown, committed, accounting, post,
    slots: Array.from({length: options.width ?? 1}, (_, i) => ({accepted: q(11,i), business: q(12,i), outcome: q(13,i), cacheState: q(14,i), bodyState: q(15,i)})),
    remaining: [...resources].map(([h,r]) => ({h,kind:r.kind})),
    error: exports?.pulse_fastly_last_error(), stage: exports?.pulse_fastly_error_stage(),
    authority: exports?.proof_authority?.(), closed: exports?.proof_closed?.()};
}
module.exports = {execute};
