'use strict';

// Independent ABI oracle shared by the two injected Fastly hosts. This is test
// infrastructure, not a network implementation or a hosted capability probe.
const assert = require('node:assert/strict');
function createDynamicBackendHost({ view, readUtf8, trace, options, beforeRegister = () => {} }) {
  const backends = new Map();
  function register(np, nl, tp, tl, mask, config) {
    beforeRegister();
    assert.equal(config % 4, 0);
    const words = Array.from({ length: 27 }, (_, i) => view().getUint32(config + i * 4, true));
    const text = i => readUtf8(words[i], words[i + 1]);
    const name = readUtf8(np, nl), target = readUtf8(tp, tl), host = text(0);
    const tls = (mask & 32) !== 0;
    assert.equal(mask, tls ? 2338 : 2, 'Only Host and URL-derived TLS settings are enabled');
    const used = new Set(tls ? [0, 1, 7, 8, 13, 14] : [0, 1]);
    words.forEach((word, i) => { if (!used.has(i)) assert.equal(word, 0, 'Unused ABI field ' + i); });
    const record = { name, target, host, tls, certificateHostname: tls ? text(7) : '', sni: tls ? text(13) : '' };
    if (tls) assert.equal(record.certificateHostname, record.sni);
    let status = Number(options.dynamicBackendStatus || 0);
    if (typeof options.onDynamicBackendRegistration === 'function') status = options.onDynamicBackendRegistration(record) ?? status;
    if (backends.has(name) || (options.staticBackendNames || []).includes(name)) status = 1;
    if (!status) backends.set(name, record);
    trace.push({ ...record, module: 'fastly_http_req', backendName: name, name: 'register_dynamic_backend', status });
    return status;
  }
  function route(name, request) {
    const backend = backends.get(name);
    if (!backend) return; // Statically configured names retain fixture routing.
    const url = new URL(request.url);
    assert.equal(backend.target, url.hostname + ':' + (url.port || (url.protocol === 'https:' ? '443' : '80')));
    assert.equal(backend.tls, url.protocol === 'https:');
    if (backend.tls) assert.equal(backend.sni, url.hostname);
    request.headers = request.headers.filter(([key]) => key.toLowerCase() !== 'host');
    request.headers.push(['host', backend.host]);
  }
  return { register, route };
}
module.exports = { createDynamicBackendHost };
