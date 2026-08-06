'use strict';

const { normalizeJavascriptTargetDescriptor } = require('@pulse-compute/wasm-contracts/project/javascript-application');
const { defineCryptoTargetCapabilities } = require('@pulse-compute/wasm-contracts/crypto/contracts');

const FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR = normalizeJavascriptTargetDescriptor({
  provider: 'fastly',
  targetId: 'fastly-javascript',
  status: 'provider-runtime-ready',
  hostBridge: true,
  applicationLoader: true,
  requestAdapter: true,
  lifecycle: true,
  crypto: defineCryptoTargetCapabilities({
    target: 'javascript',
    algorithms: [{
      algorithm: 'HS256',
      realization: 'runtime-builtin',
      implemented: true,
      status: 'implemented-c2'
    }, {
      algorithm: 'ES256',
      realization: 'runtime-builtin',
      implemented: true,
      status: 'implemented-h4'
    }]
  }),
  capabilities: {
    version: 'pulse.javascript-capability-envelope.v1',
    provider: 'fastly',
    status: 'request-lifecycle-ready',
    core: {
      request: true,
      response: true,
      router: true,
      state: true,
      middleware: true,
      schemas: true,
      logging: true
    },
    effects: {
      fetch: true,
      config: true,
      secret: true,
      kv: true,
      parallel: true
    },
    packages: ['pulse.assets', 'pulse.grip', 'pulse.jwt'],
    restrictions: {
      fetch: 'origin-backend-map-or-dynamic-opt-in',
      kv: 'logical-store-map-required',
      assets: 'logical-store-to-kv-map-required',
      grip: 'publish-endpoint-and-backend-or-dynamic-opt-in'
    }
  },
  reporting: {
    supported: true,
    default: 'info',
    levels: ['off', 'error', 'warn', 'info', 'debug'],
    destination: 'provider-owned',
    betaDefault: 'stdio-log-tail'
  },
  commands: {
    compile: true,
    inspect: true,
    doctor: true,
    build: true,
    test: true,
    dev: true
  }
});

module.exports = Object.freeze({ FASTLY_JAVASCRIPT_TARGET_DESCRIPTOR });
