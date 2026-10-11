// Diagnostic-only ASC entry. Modify in-memory pinned stdlib sources, never the installation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [ascFile, mode, ...args] = process.argv.slice(2);
assert(['trace', 'periodic', 'exact-growth', 'large-gc', 'reduced'].includes(mode));
const asc = await import(pathToFileURL(path.resolve(path.dirname(ascFile), '../dist/asc.js')));
const hashes = { 'rt/itcms': '7ef783af8bc200fa9cd4acda183b8642166f0549ff82da1078ed612b7f1f6dea', 'rt/tlsf': '4199f0fc9bd1faf5ca7df44a05931d7d1cbeff86255c0e845788024349c2f47b' };
for (const [key, expected] of Object.entries(hashes)) assert.equal(createHash('sha256').update(asc.libraryFiles[key]).digest('hex'), expected, key);
const replace = (key, before, after) => {
  assert.equal(asc.libraryFiles[key].split(before).length, 2, 'Unique source anchor: ' + before);
  asc.libraryFiles[key] = asc.libraryFiles[key].replace(before, after);
};
const declaration = '\n@external("perf806", "event") declare function perfEvent(kind: i32, a: usize, b: usize, c: usize, d: usize, e: usize): void;\n';
asc.libraryFiles['rt/itcms'] += declaration;
asc.libraryFiles['rt/tlsf'] += declaration;
replace('rt/itcms', '  if (total >= threshold) interrupt();', `  perfEvent(1, size, id, total, threshold, state);
${mode === 'periodic' ? '  if (++perfAllocations % 65536 == 0) __collect();' : ''}
${mode === 'large-gc' ? '  if (size >= 65536) __collect();' : ''}
  if (total >= threshold) interrupt();`);
if (mode === 'periodic') asc.libraryFiles['rt/itcms'] += '\n@lazy let perfAllocations: u32 = 0;\n';
replace('rt/itcms', '    total -= obj.size;', '    total -= obj.size;\n    perfEvent(5, obj.size, total, state, 0, 0);');
replace('rt/itcms', '      state = STATE_IDLE;\n      break;', '      state = STATE_IDLE;\n      perfEvent(4, total, threshold, memory.size(), 0, 0);\n      break;');
replace('rt/itcms', 'export function __collect(): void {', 'export function __collect(): void {\n  perfEvent(6, total, threshold, memory.size(), state, 0);');
replace('rt/tlsf', '  let pagesWanted = max(pagesBefore, pagesNeeded); // double memory', `  let pagesWanted = ${mode === 'exact-growth' ? 'pagesNeeded' : 'max(pagesBefore, pagesNeeded)'}; // diagnostic policy
  let freeTotal: usize = 0, largest: usize = 0, blocks: usize = 0;
  for (let fl: usize = 0; fl < FL_BITS; fl++) {
    for (let sl: u32 = 0; sl < SL_SIZE; sl++) {
      let block = GETHEAD(root, fl, sl);
      while (block) {
        let bytes = block.mmInfo & ~TAGS_MASK;
        freeTotal += bytes; largest = max(largest, bytes); blocks++;
        block = block.next;
      }
    }
  }
  perfEvent(3, freeTotal, largest, blocks, size, pagesBefore);
  perfEvent(2, size, pagesBefore, pagesNeeded, pagesWanted, 0);`);
const entry = path.resolve(args[0]);
let source = fs.readFileSync(entry, 'utf8');
assert(source.includes('class __PulseFastlyValue {') && source.includes('@lazy const __pulse_fastly_values = new Array<__PulseFastlyValue>()'));
source += `
export function perf_value_count(): i32 { return __pulse_fastly_values.length; }
export function perf_value_id(): u32 { return idof<__PulseFastlyValue>(); }
// Destructive root-release counterfactual only after response validation; never reuse this instance.
export function perf_release_values(): void { __pulse_fastly_values.length = 0; }
`;
if (mode === 'reduced') {
  const before = '__pulse_iteration_0 < 256';
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, '__pulse_iteration_0 < perfIterations');
  source += '\nlet perfIterations: i32 = 256;\nexport function perf_iterations(n: i32): void { perfIterations = n; }\n';
}
const { error } = await asc.main(args, { stdout: process.stdout, stderr: process.stderr,
  readFile(name, baseDir) {
    const file = path.resolve(baseDir, name);
    if (file === entry) return source;
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
});
if (error) { console.error(error); process.exitCode = 1; }
