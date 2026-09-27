'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const proof = require('../runtime/compiler-efficiency/mem01-schema-materialization.cjs');
const { tokens } = require('../runtime/compiler-efficiency/o04-copy-chain.cjs');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');

const exportsSource = `
export function o05_parse(text: string): i32 { return __pulse_fastly_parse_json(text) }
export function o05_text(handle: i32): string { return __pulse_fastly_string(handle) }
`;
function instrument(source) {
  return proof.replaceExact(source,
    '    const output = new Uint16Array(end - start); let count = 0; this.index = start;',
    '    o05_scratch()\n    const output = new Uint16Array(end - start); let count = 0; this.index = start;') +
    '\n@external("o05", "scratch") declare function o05_scratch(): void\n' + exportsSource;
}
function cases() {
  const result = tokens();
  for (const value of ['a/b', '雪😀', '\ud800', '\udfff', 'a\ud800b', '\u2028\u2029', ' abc '])
    result.push({ name: 'raw-utf16-' + result.length, token: '"' + value + '"', expected: value });
  for (const value of ['"', '\\', '\\"', 'end\\', '\\\\', 'x\ty'])
    result.push({ name: 'escape-boundary-' + result.length, token: JSON.stringify(value), expected: value });
  for (let c = 0; c < 32; c++) {
    for (const prefix of ['', '\\n']) result.push({ name: `raw-control-${c}-${prefix.length}`,
      token: '"' + prefix + String.fromCharCode(c) + '"', invalid: true });
  }
  result.push({ name: 'whitespace', token: ' \r\n\t"ok" \n', expected: 'ok' });
  for (const token of ['"a""b"', '"a",', '"a"\\', '"\\u123"', '"\\u12345" trailing'])
    result.push({ name: 'invalid-boundary-' + result.length, token, invalid: true });
  return result;
}
function reproduce(wasm, fastPath = true) {
  const module = new WebAssembly.Module(wasm), rows = [];
  for (const test of cases()) {
    const probe = proof.observer(); let scratchCalls = 0;
    const imports = { ...probe.imports, o05: { scratch() { scratchCalls++; } } };
    for (const entry of WebAssembly.Module.imports(module)) {
      imports[entry.module] ||= {};
      imports[entry.module][entry.name] ||= () => { throw new Error('Unexpected parser hostcall: ' + entry.module + '.' + entry.name); };
    }
    const instance = new WebAssembly.Instance(module, imports), e = instance.exports;
    probe.attach(instance); e.__mem01_initialize();
    const bytes = Buffer.from(test.token, 'utf16le'), input = e.__pin(e.__new(bytes.length, 2));
    new Uint8Array(e.memory.buffer, input, bytes.length).set(bytes);
    const before = probe.metrics(), handle = e.o05_parse(input), after = probe.metrics();
    const summary = { handle, error: e.pulse_fastly_last_error(), stage: e.pulse_fastly_error_stage(),
      effect: e.pulse_fastly_error_effect(), chargeBytes: e.pulse_fastly_memory_bytes ? Number(e.pulse_fastly_memory_bytes()) : null,
      chargeValues: e.pulse_fastly_memory_values ? Number(e.pulse_fastly_memory_values()) : null };
    if (test.invalid) {
      assert.equal(handle, 0, test.name); assert.equal(summary.error, 1004, test.name); assert.equal(summary.stage, 3, test.name);
      e.__unpin(input);
    } else {
      assert.equal(summary.error, 0, test.name); assert.ok(handle > 0, test.name);
      const output = e.o05_text(handle), length = new DataView(e.memory.buffer).getUint32(output - 4, true);
      const decode = () => Buffer.from(e.memory.buffer, output, length).toString('utf16le');
      assert.equal(decode(), test.expected, test.name);
      // Retain the original handle across another parse, mutation and collection.
      const next = e.o05_parse(input);
      if (test.expected.length <= 1) assert.equal(next, handle, 'empty and single-unit scalar handles stay shared');
      else assert.notEqual(next, handle, 'longer parsed strings keep fresh value handles');
      new Uint8Array(e.memory.buffer, input, bytes.length).fill(0x78); e.__unpin(input); e.__collect();
      assert.equal(e.o05_text(handle), output, 'the earlier value handle remains valid');
      assert.equal(decode(), test.expected, test.name + ' owns storage after input mutation and collection');
      summary.text = decode(); summary.nextHandle = next;
      assert.equal(scratchCalls, fastPath && !test.token.includes('\\') ? 0 : 2, test.name + ' scratch path');
    }
    rows.push({ name: test.name, summary, allocatedBytes: after.allocatedBytes - before.allocatedBytes, scratchCalls });
  }
  return rows;
}
function main() {
  const dir = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'pulse-json-parser-'));
  try {
    const source = platform.generateFastlyNativePlatformCapabilitiesAssemblyScript(proof.planFor('text-only'),
      { canonicalBuild: true, requirePlatformCapability: false }).source;
    const rows = reproduce(proof.diagnosticCompile(instrument(source), 'parser', dir));
    console.log(`ok - O-05 ${rows.length} parser cases preserve text, errors, scalar identity and owned storage`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { main, instrument, reproduce };
if (require.main === module) main();
