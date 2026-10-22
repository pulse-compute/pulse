'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { nativeStringAssembly, nativeStringFields } = require('../../../packages/provider-fastly/src/build/native-string-values');
const { resolveAsc } = require('../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../packages/build-support/src/native-optimization');

// Compile the canonical fragments themselves: identity and allocator assertions
// cannot be observed through JSON/digest effects, which allocate their own data.
function main() {
  const cwd = path.resolve(__dirname, '../..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-string-assembly-'));
  const asc = resolveAsc(cwd);
  assert.ok(asc, 'pinned AssemblyScript dependency');
  try {
    const entry = path.join(dir, 'strings.ts'), output = path.join(dir, 'strings.wasm');
    fs.writeFileSync(entry, String.raw`
const PULSE_ERROR_VALUE: i32 = 1004
let error: i32 = 0
function __pulse_fastly_fail(code: i32, stage: i32, effect: i32): void {
  assert(code == PULSE_ERROR_VALUE && stage == 57 && effect == -1)
  error = code
}
${nativeStringAssembly}
class __PulseFastlyValue { ${nativeStringFields} }
function leaf(text: string): __PulseFastlyValue { const value = new __PulseFastlyValue(); value.text = text; return value }
function pair(left: __PulseFastlyValue, right: __PulseFastlyValue): __PulseFastlyValue {
  const value = new __PulseFastlyValue(); value.textLeft = left; value.textRight = right;
  value.textLength = left.textLength + right.textLength; return value
}
export function semantics(): void {
  assert(__pulse_fastly_join_strings([]) == "")
  const part = "a\u0000\ud800b\udfff😀"
  assert(changetype<usize>(__pulse_fastly_join_strings([part])) == changetype<usize>(part))
  assert(__pulse_fastly_join_strings(["", part, "", "tail", ""]) == part + "tail")
  // Split a pair across fragments and preserve isolated code units, too.
  assert(__pulse_fastly_join_strings(["\ud83d", "\ude00", "\ud800", "x", "\udfff"]) == "😀\ud800x\udfff")
  const unit = leaf("x".repeat(512)); let rope = leaf(""); let saved = rope
  for (let i = 0; i < 1024; i++) { rope = pair(rope, unit); if (i == 511) saved = rope }
  const retained = saved.text; const flat = rope.text
  assert(retained.length == 512 * 512 && flat.length == 1024 * 512)
  const pages = memory.size()
  for (let i = 0; i < 128; i++) {
    assert(changetype<usize>(rope.text) == changetype<usize>(flat))
    assert(changetype<usize>(saved.text) == changetype<usize>(retained))
  }
  assert(memory.size() == pages)
  const extended = pair(rope, leaf("tail"))
  assert(extended.text.length == flat.length + 4 && extended.text.endsWith("tail"))
  assert(rope.text.length == flat.length && saved.text == retained)
  assert(rope.textLeft === null && saved.textLeft === null)
}
export function bounds(): void {
  assert(__pulse_fastly_string_bytes(0) == 0)
  assert(__pulse_fastly_string_bytes(i64(String.MAX_LENGTH)) == String.MAX_LENGTH * 2)
  assert(__pulse_fastly_string_bytes(i64(String.MAX_LENGTH) + 1) == -1)
  assert(__pulse_fastly_string_bytes(0x100000000) == -1)
  assert(__pulse_fastly_string_bytes(-1) == -1)
  // Reuse a small actual leaf, exceeding the aggregate limit without allocating
  // a giant string or forging managed-object lengths. Reject before allocation.
  const parts = new Array<string>(1048576).fill("x".repeat(512))
  const pages = memory.size(); error = 0
  assert(__pulse_fastly_join_strings(parts) == "")
  assert(error == PULSE_ERROR_VALUE && memory.size() == pages)
}
`);
    for (const mode of [undefined, 'native-shrink0', 'experimental-native-bounded-size', 'experimental-native-size']) {
      const args = [asc.script, entry, '--outFile', output, '--runtime', 'stub', '--maximumMemory', '512'];
      appendAssemblyScriptOptimizationArgs(args, mode);
      const result = spawnSync(asc.executable, args, { cwd, encoding: 'utf8', timeout: 180000 });
      assert.equal(result.status, 0, result.stderr);
      const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(output)), {
        env: { abort() { throw new Error('string assembly assertion failed'); } }
      });
      instance.exports.semantics();
      instance.exports.bounds();
      assert.ok(instance.exports.memory.buffer.byteLength <= 33554432);
    }
    console.log('ok - Fastly string assembly preserves UTF-16, cached aliases and checked size rejection in all four recipes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { main };
if (require.main === module) main();
