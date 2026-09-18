'use strict';

const { normalizeJavascriptTargetDescriptor } = require('@pulse-compute/wasm-contracts/project/javascript-application');
const { defineCryptoTargetCapabilities } = require('@pulse-compute/wasm-contracts/crypto/contracts');

const NODE_JAVASCRIPT_TARGET_DESCRIPTOR = normalizeJavascriptTargetDescriptor({
  provider: 'node', targetId: 'node-javascript', status: 'source-packaging-ready',
  hostBridge: true, applicationLoader: true, requestAdapter: true, lifecycle: true,
  capabilities: {
    version: 'pulse.javascript-capability-envelope.v1',
    provider: 'node',
    status: 'request-and-event-lifecycle-ready',
    core: { request: true, response: true, state: true, eventIngress: true },
    effects: { fetch: true, config: true, secret: true, kv: true, eventEmit: true },
    events: { ingress: true, emit: true, automaticLoopback: false },
    packages: []
  },
  crypto: defineCryptoTargetCapabilities({
    target: 'javascript',
    algorithms: [...['SHA-256', 'HMAC-SHA256'].map((algorithm) => ({ algorithm, realization: 'runtime-builtin', implemented: true, status: 'implemented-o3' })), {
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implemented: true,
      status: 'implemented-c2'
    }, {
      algorithm: 'ES256',
      realization: 'runtime-builtin',
      implemented: true,
      status: 'implemented-g3'
    }, {
      algorithm: 'RS256',
      realization: 'runtime-builtin',
      implemented: true,
      status: 'implemented-rs256'
    }]
  }),
  commands: { compile: true, inspect: true, doctor: true, build: true, test: true, dev: true }
});

module.exports = Object.freeze({
  NODE_JAVASCRIPT_TARGET_DESCRIPTOR
});
