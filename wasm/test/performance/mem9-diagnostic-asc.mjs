// Diagnostic-only compiler entry; never changes installed or product sources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [ascFile, mode, ...args] = process.argv.slice(2);
assert(['observed', 'reduced'].includes(mode));
const asc = await import(pathToFileURL(path.resolve(path.dirname(ascFile), '../dist/asc.js')));
assert.equal(createHash('sha256').update(asc.libraryFiles['rt/itcms']).digest('hex'),
  '7ef783af8bc200fa9cd4acda183b8642166f0549ff82da1078ed612b7f1f6dea');
const anchor = '      state = STATE_IDLE;\n      break;';
assert.equal(asc.libraryFiles['rt/itcms'].split(anchor).length, 2);
asc.libraryFiles['rt/itcms'] = asc.libraryFiles['rt/itcms'].replace(anchor,
  '      state = STATE_IDLE;\n      mem9Cycle(total);\n      break;');
asc.libraryFiles['rt/itcms'] += '\n@external("mem9", "cycle") declare function mem9Cycle(bytes: usize): void;\n';
const entry = path.resolve(args[0]);
let source = fs.readFileSync(entry, 'utf8');
assert(source.includes('function __pulse_drop(value: i32): void {}'));
assert(source.includes('@lazy const __pulse_fastly_values = new Array<__PulseFastlyValue>()'));
source += `
export function mem9_count(): i32 { return __pulse_fastly_values.length; }
export function mem9_numbers(): i32 {
  let count = 0;
  for (let i = 0; i < __pulse_fastly_values.length; i++) if (unchecked(__pulse_fastly_values[i]).kind == PULSE_VALUE_NUMBER) count++;
  return count;
}
// Existing behavior probes only: this is not a reclamation implementation.
export function mem9_ownership(): i32 {
  let checks = 0;
  const original = host_value_number(70000.0);
  let local = original;
  const alias = local;
  local = host_value_binary(8, local, host_value_number(1.0));
  __pulse_drop(local); // Assignment expression result is still the live local.
  if (__pulse_fastly_number(local) == 70001.0 && __pulse_fastly_number(alias) == 70000.0) checks |= 1;
  const array = host_value_array(); host_value_array_push(array, alias);
  const object = host_value_object(); const key = __pulse_string("snapshot"); host_value_object_set(object, key, alias);
  __pulse_drop(alias);
  if (__pulse_fastly_number(host_value_element(array, host_value_number(0.0))) == 70000.0 && __pulse_fastly_number(host_value_property(object, key)) == 70000.0) checks |= 2;
  const copied = host_value_object(); host_value_object_spread(copied, object);
  host_value_object_set(object, key, local);
  if (__pulse_fastly_number(host_value_property(copied, key)) == 70000.0) checks |= 4;
  const cached = host_value_number(7.0); __pulse_drop(cached);
  if (cached == host_value_number(7.0) && __pulse_fastly_number(cached) == 7.0) checks |= 8;
  const nz = host_value_number(-0.0), pz = host_value_number(0.0);
  if (nz != pz && 1.0 / __pulse_fastly_number(nz) == -Infinity && 1.0 / __pulse_fastly_number(pz) == Infinity) checks |= 16;
  const nan = host_value_number(NaN);
  if (isNaN(__pulse_fastly_number(nan)) && host_value_truthy(host_value_binary(0, nan, nan)) == 0) checks |= 32;
  if (__pulse_fastly_number(host_value_number(Infinity)) == Infinity && __pulse_fastly_number(host_value_number(-Infinity)) == -Infinity) checks |= 64;
  if (__pulse_fastly_number(host_value_number(1.25)) == 1.25) checks |= 128;
  if (host_value_binary(14, pz, local) == pz && host_value_binary(15, local, alias) == local) checks |= 256;
  return checks;
}
`;
if (mode === 'reduced') {
  const loop = '__pulse_iteration_0 < 256';
  assert.equal(source.split(loop).length, 2);
  source = source.replace(loop, '__pulse_iteration_0 < mem9Iterations');
  source += '\nlet mem9Iterations: i32 = 256;\nexport function mem9_iterations(n: i32): void { mem9Iterations = n; }\n';
}
const { error } = await asc.main(args, { stdout: process.stdout, stderr: process.stderr,
  readFile(name, baseDir) {
    const file = path.resolve(baseDir, name);
    if (file === entry) return source;
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
});
if (error) { console.error(error); process.exitCode = 1; }
