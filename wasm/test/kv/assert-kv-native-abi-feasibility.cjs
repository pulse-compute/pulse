#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vectors = require('./k1/vectors.json');
const mapping = require('./k1/provider-mapping.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-k1-abi-'));
try {
  const output = path.join(temp, 'probe.wasm');
  const asc = require.resolve('assemblyscript/bin/asc.js');
  const compiled = spawnSync(process.execPath, [asc, path.join(__dirname, 'k1/native-abi.as.ts'), '--outFile', output, '--runtime', 'stub', '--exportRuntime'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
  let memory, generation = 0n, hostStatus = 0, kvError = 1;
  const sends = [];
  const module = new WebAssembly.Module(fs.readFileSync(output));
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('ABI probe trapped'); } },
    fastly_kv_store: {
      lookup_wait_v2(_pending, body, _metadata, capacity, written, token, error) {
        assert.equal(capacity, 2000);
        const view = new DataView(memory.buffer);
        view.setUint32(body, 7, true); view.setUint32(written, 0, true);
        view.setBigUint64(token, generation, true); view.setUint32(error, kvError, true);
        return hostStatus;
      },
      insert(_store, key, length, _body, mask, config, pending) {
        const view = new DataView(memory.buffer);
        assert.equal(Buffer.from(memory.buffer, key, length).toString(), 'key');
        sends.push({ mask, config: Buffer.from(new Uint8Array(memory.buffer, config, 32)) });
        view.setUint32(pending, 9, true); return 0;
      },
    },
  });
  const wasm = instance.exports; memory = wasm.memory;
  for (const row of vectors.tokens) {
    generation = BigInt(row.decimal);
    assert.equal(wasm.read_generation(), 1);
    const token = Buffer.from(memory.buffer, wasm.token_ptr(), wasm.token_len()).toString();
    assert.equal(token, row.token);
    Buffer.from(memory.buffer, wasm.input_ptr(), token.length).write(token);
    assert.equal(wasm.send_cas_token(token.length), 0);
    const sent = sends.at(-1);
    assert.equal(sent.mask, mapping.fastlyNative.insert.ifGenerationMatchMask);
    assert.equal(sent.config.readUInt32LE(0), 0);
    assert.equal(sent.config.subarray(24, 32).toString('hex'), row.littleEndian);
    assert.deepEqual(sent.config.subarray(0, 24), Buffer.alloc(24));
  }
  for (const [status, error] of [[1, 1], [0, 3], [0, 6]]) {
    hostStatus = status; kvError = error;
    assert.equal(wasm.read_generation(), 0); assert.equal(wasm.token_len(), 0);
  }
  for (const token of vectors.invalidFastlyTokens) {
    const before = sends.length;
    Buffer.from(memory.buffer, wasm.input_ptr(), token.length).write(token);
    assert.equal(wasm.send_cas_token(token.length), -1); assert.equal(sends.length, before);
  }
  assert.equal(wasm.send_add(), 0);
  assert.equal(sends.at(-1).mask, 0); assert.equal(sends.at(-1).config.readUInt32LE(0), 1);
  assert.deepEqual(sends.at(-1).config.subarray(4), Buffer.alloc(28));
  console.log(JSON.stringify({ status: 'passed', tokens: vectors.tokens.length, proof: 'compiled-wasm-abi-layout-and-lossless-round-trip', productionAdapter: false, providerReality: false }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
