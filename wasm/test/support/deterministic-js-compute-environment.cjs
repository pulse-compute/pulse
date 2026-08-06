'use strict';

// @fastly/js-compute derives an inherited RUST_MIN_STACK value from live free
// memory before invoking Wizer. Freeze that test-only resource input. Wizer's
// initialized memory still contains runtime entropy, so I9 seals stable static
// Wasm sections and the exact application bundle instead of raw snapshot bytes.
const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

os.freemem = () => 20 * 1024 * 1024 * 1024;
syncBuiltinESMExports();
