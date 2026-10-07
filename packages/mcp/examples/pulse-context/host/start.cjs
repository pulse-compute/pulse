#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createContextHost } = require('./server.cjs');

async function main() {
  const options = { buildDir: path.resolve(__dirname, '../dist-node-javascript') };
  const args = process.argv.slice(2), seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key)) throw new Error('Duplicate host option.'); seen.add(key);
    if (key === '--help' && args.length === 1) {
      console.log('node host/start.cjs [--build-dir DIR] [--port 0..65535] [--codex]\nLoopback MCP at /mcp; readiness at /_pulse/ready. --codex explicitly enables 2025-06-18 framing.'); return;
    }
    if (key === '--codex') { options.legacyProtocol = '2025-06-18'; continue; }
    const value = args[++index];
    if (key === '--build-dir' && value && !value.startsWith('--')) options.buildDir = path.resolve(value);
    else if (key === '--port' && /^(0|[1-9]\d{0,4})$/.test(value || '') && Number(value) <= 65535) options.port = Number(value);
    else throw new Error('Invalid host option.');
  }
  const host = createContextHost(options);
  const stop = () => { void host.close(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  try {
    const ready = await host.start();
    console.log(JSON.stringify({ event: 'ready', endpoint: ready.endpoint, buildId: ready.buildId,
      identity: ready.identity, corpus: ready.corpus }));
    const result = await host.finished;
    if (result.forced || result.failed) process.exitCode = 1;
    console.log(JSON.stringify({ event: 'stopped', ...result }));
  } finally {
    await host.close();
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
  }
}
main().catch(() => { console.error('Pulse context MCP startup failed. Check the trusted build and local port.'); process.exitCode = 1; });
