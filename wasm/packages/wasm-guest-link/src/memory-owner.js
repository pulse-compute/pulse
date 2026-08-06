'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileRecord, writeAtomic } = require('./files.js');

// MVP core Wasm containing exactly `(memory 32 32)` exported as `memory`.
// Keeping these audited bytes in the link package avoids a shell/tool hook in
// the compiler and makes the memory owner independent of the contributing package.
const MEMORY_OWNER_BYTES = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x04, 0x01, 0x01, 0x20, 0x20,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00
]);

function writeMemoryOwnerModule(directory) {
  const target = path.resolve(directory);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, 'guest-memory-owner.wasm');
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(MEMORY_OWNER_BYTES)) {
    writeAtomic(file, MEMORY_OWNER_BYTES);
  }
  return Object.freeze({ file, ...fileRecord(file) });
}

module.exports = Object.freeze({
  MEMORY_OWNER_BYTES,
  writeMemoryOwnerModule
});
