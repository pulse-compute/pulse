'use strict';
// Copied into the unrelated consumer. This file has no repository imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const [mode, settingsFile] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsFile));
const local = createRequire(path.join(settings.consumer, 'package.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.throws(() => fs.readFileSync(settings.checkoutProbe), { code: 'ERR_ACCESS_DENIED' });
  if (mode === 'guard') { assert.equal(globalThis.__pulseInstalledBuildReadGuard, true); console.log('ok - build guard denies checkout reads'); return; }
  assert(process.permission, 'runtime filesystem permission enforcement must be active');
  assert.equal(process.permission.has('fs.read', settings.checkoutProbe), false);
  assert.equal(mode, 'runtime');
  const { createNodeLauncher } = local('@pulse-compute/provider-node/server');
  for (const file of settings.removedSources) {
    assert.equal(process.permission.has('fs.read', file), false, file);
    assert.throws(() => fs.readFileSync(file), { code: 'ERR_ACCESS_DENIED' });
  }
  const build = JSON.parse(fs.readFileSync(path.join(settings.buildDir, 'pulse-build.json')));
  const artifactFiles = [build.portable.plan, build.portable.wasm.file, build.portable.packageRealizationArtifacts.file].filter(Boolean);
  const inventory = artifactFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(settings.buildDir, file))) }));
  const failures = [];
  // Admission must fail before a server starts, including an otherwise valid
  // Wasm from a different identity. Never rewrite the authoritative build receipt.
  for (const file of artifactFiles) {
    const target = path.join(settings.buildDir, file), original = fs.readFileSync(target);
    for (const fault of ['missing', 'truncated', 'corrupt', ...(file === build.portable.wasm.file ? ['mixed-identity'] : [])]) {
      try {
        if (fault === 'missing') fs.unlinkSync(target);
        else if (fault === 'truncated') fs.writeFileSync(target, original.subarray(0, Math.floor(original.length / 2)));
        else if (fault === 'mixed-identity' && file === build.portable.wasm.file) fs.writeFileSync(target, Buffer.from('0061736d01000000', 'hex'));
        else { const bytes = Buffer.from(original); bytes[Math.floor(bytes.length / 2)] ^= 1; fs.writeFileSync(target, bytes); }
        assert.throws(() => createNodeLauncher({ buildDir: settings.buildDir, target: 'native', networkFetch: false }), undefined, `${file}: ${fault}`);
        failures.push({ file, fault, rejectedBeforeListening: true });
      } finally {
        fs.writeFileSync(target, original);
        assert.equal(hash(fs.readFileSync(target)), hash(original), `restored ${file}: ${fault}`);
      }
    }
  }
  const launcher = createNodeLauncher({ buildDir: settings.buildDir, target: 'native', host: '127.0.0.1', port: 0, networkFetch: false, maxDurationMs: 5000 });
  let calls = 0;
  try {
    const started = await launcher.start();
    const endpoint = `http://127.0.0.1:${started.address.port}/mcp`;
    async function rpc(method, params) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++calls, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } }) });
      const text = await response.text(); assert.equal(response.status, 200, text); assert(Buffer.byteLength(text) <= 131072);
      const reply = JSON.parse(text); assert(!reply.error, text); return reply.result;
    }
    const listed = await rpc('tools/list', {});
    assert.deepEqual(listed.tools.map(t => t.name), ['pulse.diagnostic', 'pulse.example', 'pulse.read', 'pulse.search', 'pulse.start']);
    const cases = JSON.parse(fs.readFileSync(settings.expected));
    for (const item of cases) {
      const result = await rpc('tools/call', { name: item.tool, arguments: item.input });
      assert.equal(result.isError, false, JSON.stringify(item.input));
      assert(Buffer.byteLength(JSON.stringify(result)) <= 24576);
      assert.deepEqual(result.structuredContent, item.expected, `${item.tool} ${JSON.stringify(item.input)}`);
      assert.deepEqual(JSON.parse(result.content[0].text), item.expected);
    }
    for (const item of inventory) assert.equal(hash(fs.readFileSync(path.join(settings.buildDir, item.file))), item.sha256);
    fs.writeFileSync(settings.result, JSON.stringify({ status: 'passed', calls, tools: listed.tools.map(t => t.name), failures, artifacts: inventory, checkoutReadsDenied: true, authoredSourceReadsDenied: true, sourceFree: true, networkFetch: false }, null, 2));
    console.log(`ok - ${calls} source-free installed Native MCP requests`);
  } finally { await launcher.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
