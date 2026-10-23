'use strict';
// Deliberately small injected fixture: no Viceroy, Pushpin or network behavior.
function execute(native, { path = '/fanout', status = 0, trap = false, afterHandoff, beforeStart, onUri, clock, closeStatus = 0 } = {}) {
  let instance, next = 100;
  const trace = [];
  const resources = { acquired: [], closes: [] };
  const memory = () => new Uint8Array(instance.exports.memory.buffer);
  const write = (p, n) => new DataView(memory().buffer).setUint32(p, n, true);
  const text = (p, n) => Buffer.from(memory().subarray(p, p+n)).toString('utf8');
  const output = (value, p, max, written) => { const bytes = Buffer.from(value); if (bytes.length > max) throw Error('fixture buffer overflow'); memory().set(bytes,p); write(written, bytes.length); return 0; };
  const imports = {
    fastly_abi: { init: () => 0 },
    fastly_async_io: { select: () => { throw Error("terminal service must not wait on async handles"); } },
    wasi_snapshot_preview1: { clock_time_get: (_id,_precision,p) => { const sample = clock?.(instance) ?? 0n; new DataView(memory().buffer).setBigUint64(p, BigInt(sample), true); return 0; } },
    fastly_http_req: {
      close: handle => { resources.closes.push({kind:'request',handle,status:closeStatus}); return closeStatus; },
      body_downstream_get: (request, body) => { write(request,41); write(body,42); resources.acquired.push({request:41,body:42}); return 0; },
      method_get: (h,p,n,w) => output('GET',p,n,w),
      uri_get: (h,p,n,w) => { const result = output('https://example.test'+path,p,n,w); onUri?.(instance); return result; },
      redirect_to_grip_proxy_v2: (request,p,n) => {
        trace.push({ call: 'handoff', request, backend: text(p,n), length: n, status: trap ? 'trap' : status });
        if (trap) throw new WebAssembly.RuntimeError('injected ambiguous outcome');
        afterHandoff?.(instance);
        return status;
      }
    },
    fastly_http_resp: {
      new: p => { write(p,++next); return 0; },
      status_set: (handle,status) => { trace.push({call:'status',status}); return 0; },
      header_append: () => 0,
      send_downstream: (response,body) => { trace.push({call:'send',response,body}); return 0; }
    },
    fastly_http_body: {
      close: handle => { resources.closes.push({kind:'body',handle,status:closeStatus}); return closeStatus; },
      new: p => { write(p,++next); return 0; },
      write: (handle,p,n,end,w) => { trace.push({call:'write',body:text(p,n)}); write(w,n); return 0; }
    }
  };
  imports.fastly_http_req.redirect_to_websocket_proxy_v2 = imports.fastly_http_req.redirect_to_grip_proxy_v2;
  instance = new WebAssembly.Instance(new WebAssembly.Module(native.wasm), imports);
  let thrown;
  try { beforeStart?.(instance); instance.exports._start(); } catch (error) { thrown = error.message; }
  return { instance, trace, resources, thrown, state: instance.exports.pulse_extension_state?.(),
    status: instance.exports.pulse_extension_status?.(), error: instance.exports.pulse_fastly_last_error(),
    stage: instance.exports.pulse_fastly_error_stage() };
}
module.exports = { execute };
