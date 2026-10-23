'use strict';
// Deliberately small injected fixture: no Viceroy, Pushpin or network behavior.
function execute(native, { path = '/fanout', status = 0, trap = false, afterHandoff } = {}) {
  let instance, next = 100;
  const trace = [];
  const memory = () => new Uint8Array(instance.exports.memory.buffer);
  const write = (p, n) => new DataView(memory().buffer).setUint32(p, n, true);
  const text = (p, n) => Buffer.from(memory().subarray(p, p+n)).toString('utf8');
  const output = (value, p, max, written) => { const bytes = Buffer.from(value); if (bytes.length > max) throw Error('fixture buffer overflow'); memory().set(bytes,p); write(written, bytes.length); return 0; };
  const imports = {
    fastly_abi: { init: () => 0 },
    fastly_http_req: {
      body_downstream_get: (request, body) => { write(request,41); write(body,42); return 0; },
      method_get: (h,p,n,w) => output('GET',p,n,w),
      uri_get: (h,p,n,w) => output('https://example.test'+path,p,n,w),
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
      new: p => { write(p,++next); return 0; },
      write: (handle,p,n,end,w) => { trace.push({call:'write',body:text(p,n)}); write(w,n); return 0; }
    }
  };
  instance = new WebAssembly.Instance(new WebAssembly.Module(native.wasm), imports);
  let thrown;
  try { instance.exports._start(); } catch (error) { thrown = error.message; }
  return { instance, trace, thrown, state: instance.exports.pulse_extension_state?.(),
    status: instance.exports.pulse_extension_status?.(), error: instance.exports.pulse_fastly_last_error(),
    stage: instance.exports.pulse_fastly_error_stage() };
}
module.exports = { execute };
