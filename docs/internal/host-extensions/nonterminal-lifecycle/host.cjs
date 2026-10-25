'use strict';
const assert = require('node:assert/strict');

// Independent host ledger. Status/disposition combinations are fixture assumptions.
// Probe handles and core-fetch handles deliberately occupy separate namespaces.
function execute(wasm, options = {}) {
  let instance, nextCore = 100, nextProbe = options.probeStart ?? 10000;
  let now = 0n, status = 200, outputBody = false, attacked = false;
  const core = new Map(), probe = new Map(), trace = [], attempts = [], sent = [];
  const e = () => instance.exports;
  const memory = () => new Uint8Array(e().memory.buffer);
  const view = () => new DataView(e().memory.buffer);
  const put = (p, n) => view().setInt32(p, n, true);
  const read = (p, n) => Buffer.from(memory().subarray(p, p + n)).toString();
  const get = h => { const r = core.get(h); assert(r, 'live core handle ' + h); return r; };
  function snapshot() {
    return {authority: e().proof_authority?.() ?? null, ticket: e().proof_tickets?.(0) ?? null,
      closed: e().proof_closed?.() ?? null, charged: e().proof_query?.(0) ?? null,
      pending: e().pulse_pending_count?.() ?? null};
  }
  function event(call, data = {}) { trace.push({call, ...data, ...snapshot()}); }
  function fail(call) { return Array.isArray(options.fail) ? options.fail.includes(call) : options.fail === call; }
  function trap(call) { if (options.trap === call) throw new WebAssembly.RuntimeError('injected ' + call + ' trap'); }
  function allocate(map, kind) {
    const h = map === probe ? nextProbe++ : nextCore++;
    map.set(h, {kind, text: '', offset: 0});
    event(map === probe ? 'probe.acquire-resource' : 'core.acquire-resource', {h, kind});
    if (map === probe) assert(e().proof_query(0) >= probe.size, 'preregistered probe capacity');
    return h;
  }
  function release(map, h, action) {
    assert(map.has(h), 'release of live handle ' + h);
    const kind = map.get(h).kind; map.delete(h); event(action, {h, kind});
  }
  function output(text, p, n, out) {
    const b = Buffer.from(text); assert(b.length <= n); memory().set(b, p); put(out, b.length); return 0;
  }
  const imports = {
    nonterminal_proof: {
      acquire: out => {
        event('probe.acquire'); trap('probe.acquire');
        if (!fail('probe.acquire') || options.consumeFailure) put(out, allocate(probe, 'pending'));
        return fail('probe.acquire') ? 1 : 0;
      },
      complete: (h, out) => {
        assert.equal(probe.get(h)?.kind, 'pending'); event('probe.complete', {h}); trap('probe.complete');
        if (options.cancelAt === 'complete') e().proof_cancel();
        if (!fail('probe.complete') || options.consumeFailure) {
          release(probe, h, 'probe.consume'); put(out, allocate(probe, 'lease'));
        }
        return fail('probe.complete') ? 1 : 0;
      },
      read: h => {
        assert.equal(probe.get(h)?.kind, 'lease'); event('probe.read', {h}); trap('probe.read');
        return fail('probe.read') ? -1 : 42;
      },
      close: h => {
        assert.equal(probe.get(h)?.kind, 'lease'); event('probe.close', {h}); trap('probe.close');
        if (!fail('probe.close') || options.consumeFailure) release(probe, h, 'probe.release');
        return fail('probe.close') ? 1 : 0;
      },
      event: (code, a, b) => {
        event('hook', {code, a, b}); trap('hook.' + code);
        if (code === 3 && options.expireAt === 'ready') now = 1000000000n;
        if (((code === 3 && options.attack !== 'success-on-failure')
          || (code === 12 && options.attack === 'success-on-failure')) && options.attack && !attacked) {
          attacked = true; const before = e().proof_tickets(0);
          const result = options.attack === 'success-on-failure' ? e().proof_settle(e().proof_query(6), e().proof_forged_success())
            : options.attack === 'direct-result' ? e().pulse_set_effect_result(0, b)
            : e().proof_settle(options.attack === 'wrong-ticket' ? a + 1 : a,
              options.attack === 'wrong-result' ? b + 1000 : options.attack === 'undefined-success' ? e().proof_undefined() : b);
          event('attack', {attack: options.attack, result, before, after: e().proof_tickets(0)});
        }
      }
    },
    fastly_abi: {init: () => 0},
    fastly_config_store: {open: (_p, _n, out) => { put(out, 1); return 0; },
      get: (_h, _k, _kn, p, n, out) => output('42', p, n, out)},
    wasi_snapshot_preview1: {
      clock_time_get: (_id, _p, out) => { view().setBigUint64(out, now, true); return 0; },
      fd_write: (_fd, p, n, out) => { let size = 0; for (let i = 0; i < n; i++) size += view().getUint32(p + i * 8 + 4, true); put(out, size); return 0; }
    },
    fastly_async_io: {select: (p, n, timeout, out) => {
      const handles = Array.from({length: n}, (_, i) => view().getInt32(p + i * 4, true));
      const isProbe = handles.some(h => probe.has(h));
      for (const h of handles) assert(probe.has(h) || core.has(h));
      event('select', {handles, timeout, probe: isProbe});
      if (isProbe && options.probeDelayMs) now += BigInt(options.probeDelayMs) * 1000000n;
      if (isProbe && options.cancelAt === 'select') e().proof_cancel();
      if (options.timeout === (isProbe ? 'probe' : 'fetch')) { now += BigInt(timeout) * 1000000n; put(out, -1); }
      else put(out, 0);
      return 0;
    }},
    fastly_http_req: {
      body_downstream_get: (r, b) => { put(r, 41); put(b, 42); return 0; },
      method_get: (_h, p, n, out) => output('GET', p, n, out),
      uri_get: (_h, p, n, out) => output('https://proof.invalid/', p, n, out),
      header_value_get: () => 10,
      new: out => { put(out, allocate(core, 'request')); return 0; },
      method_set: () => 0, uri_set: () => 0, header_insert: () => 0,
      send_async: (r, b, _p, _n, out) => {
        event('fetch.send', {r, b}); release(core, r, 'core.transfer'); release(core, b, 'core.transfer');
        put(out, allocate(core, 'pending')); return 0;
      },
      pending_req_wait_v2: (h, _d, r, b) => {
        event('fetch.wait', {h}); trap('fetch.wait'); if (fail('fetch.wait')) return 1;
        release(core, h, 'core.consume'); put(r, allocate(core, 'fetch-response'));
        const body = allocate(core, 'fetch-body'); core.get(body).text = 'loaded'; put(b, body); return 0;
      },
      pending_req_poll_v2: (_h, _d, done) => { put(done, 0); return 0; },
      close: h => { release(core, h, 'core.close'); return 0; }
    },
    fastly_http_body: {
      new: out => { put(out, allocate(core, outputBody ? 'output-body' : 'request-body')); return 0; },
      read: (h, p, n, out) => {
        const r = get(h); event('fetch.read', {h}); trap('fetch.read'); if (fail('fetch.read')) return 1;
        const b = Buffer.from(r.text), size = Math.min(n, b.length - r.offset);
        memory().set(b.subarray(r.offset, r.offset + size), p); r.offset += size; put(out, size); return 0;
      },
      write: (h, p, n, _end, out) => { get(h).text += read(p, n); put(out, n); return 0; },
      close: h => { release(core, h, 'core.close'); return 0; },
      abandon: h => { release(core, h, 'core.abandon'); return 0; }
    },
    fastly_http_resp: {
      new: out => { outputBody = true; put(out, allocate(core, 'output-response')); return 0; },
      status_set: (_h, value) => { status = value; return 0; }, header_append: () => 0,
      status_get: (_h, out) => { put(out, 200); return 0; }, header_value_get: () => 10,
      close: h => { release(core, h, 'core.close'); return 0; },
      send_downstream: (r, b, streaming) => {
        event('send', {r, b, streaming}); trap('send.downstream');
        const response = {status, body: get(b).text}; attempts.push(response);
        if (!fail('send.downstream') || options.consumeFailure) {
          release(core, r, 'core.transfer'); if (!streaming) release(core, b, 'core.transfer');
        }
        if (fail('send.downstream')) return 1;
        sent.push(response); return 0;
      }
    }
  };
  let thrown = null;
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), imports);
    e().proof_control?.(options.short ? 1 : 0, options.rejectSettle ? 1 : 0, options.rejectResult ? 1 : 0);
    e()._start();
  } catch (error) { thrown = error.message; }
  const post = [];
  if (!thrown && options.late) {
    const pending = [...probe].find(([, r]) => r.kind === 'pending');
    assert(pending, 'late observation requires a pending operation');
    release(probe, pending[0], 'probe.late-consume');
    const handle = allocate(probe, 'lease'); e().proof_late(handle); e().proof_late(handle);
    post.push({kind: 'late', settle: e().proof_settle(e().proof_query(6), e().proof_query(7)),
      direct: e().pulse_set_effect_result(0, e().proof_query(7)), charged: e().proof_query(0)});
  }
  if (!thrown && options.repeatClose) { e().proof_close_again(); e().proof_close_again(); }
  if (!thrown && options.postResponders) { e().proof_error(); e().proof_timeout(); }
  if (!thrown && options.reenter) { e()._start(); e().pulse_resume(); }
  const exports = instance?.exports;
  const query = k => exports?.proof_query?.(k) ?? null;
  const accounting = {handles: query(0), records: query(1), cleanupAttempts: query(2), accepted: query(3),
    delivering: query(4), rejected: query(5), pendingState: query(8), leaseState: query(9), lateCount: query(10),
    businessSucceeded: query(11), outcome: query(12)};
  if (exports?.proof_query) assert(accounting.handles >= probe.size, 'retained claims cover possible probe resources');
  return {accounting, trace, attempts, sent, thrown, post,
    probeRemaining: [...probe].map(([h, r]) => ({h, kind: r.kind})),
    coreRemaining: [...core].map(([h, r]) => ({h, kind: r.kind})),
    authority: exports?.proof_authority?.() ?? null, closed: exports?.proof_closed?.() ?? null,
    error: exports?.pulse_fastly_last_error(), stage: exports?.pulse_fastly_error_stage()};
}
module.exports = {execute};
