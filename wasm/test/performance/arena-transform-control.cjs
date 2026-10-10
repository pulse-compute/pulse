'use strict';
const assert = require('node:assert/strict');
const child = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
// Isolated worker only. Production has no switch, patch or alternate compiler.
function install(variant) {
  assert(['unpatched', 'patched'].includes(variant));
  const original = child.spawnSync, invocations = [];
  child.spawnSync = function(executable, args, options) {
    const actual = []; let transformsAdded = 0;
    for (let i = 0; i < (args || []).length; i++) {
      actual.push(args[i]);
      if (variant === 'patched' && args[i] === '--transform' && /\/json-as\/transform\/lib\/index\.js$/.test(String(args[i + 1]).replace(/\\/g, '/'))) {
        actual.push(args[++i], '--transform', path.join(__dirname, 'schema-cache-arena-transform.cjs'));
        transformsAdded++;
      }
    }
    if (transformsAdded) assert.equal(transformsAdded, 1);
    const isAsc = args?.some(arg => String(arg).replace(/\\/g, '/').endsWith('/assemblyscript/bin/asc.js'));
    const result = original.call(this, executable, actual, options);
    if (isAsc) {
      const out = args[args.indexOf('--outFile') + 1];
      const wasm = result.status === 0 && fs.existsSync(out) ? fs.readFileSync(out) : null;
      invocations.push({ transformsAdded, artifactBytes: wasm?.length ?? null,
        artifactSha256: wasm ? createHash('sha256').update(wasm).digest('hex') : null });
    }
    return result;
  };
  return invocations;
}
module.exports = { install };
