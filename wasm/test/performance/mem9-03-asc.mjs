// In-memory diagnostic instrumentation only. No installed/product source edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [ascFile, ...args] = process.argv.slice(2);
const asc = await import(pathToFileURL(path.resolve(path.dirname(ascFile), '../dist/asc.js')));
const gc = args[args.indexOf('--runtime') + 1] !== 'stub';
const entry = path.resolve(args[0]);
let source = fs.readFileSync(entry, 'utf8');
assert(source.includes('function __pulse_drop(value: i32): void {}'));
assert(source.includes('@lazy const __pulse_fastly_values = new Array<__PulseFastlyValue>()'));
if (gc) {
  assert.equal(createHash('sha256').update(asc.libraryFiles['rt/itcms']).digest('hex'), '7ef783af8bc200fa9cd4acda183b8642166f0549ff82da1078ed612b7f1f6dea');
  const anchor = '      state = STATE_IDLE;\n      break;';
  assert.equal(asc.libraryFiles['rt/itcms'].split(anchor).length, 2);
  asc.libraryFiles['rt/itcms'] = asc.libraryFiles['rt/itcms'].replace(anchor, '      state = STATE_IDLE;\n      mem9Total = total;\n      break;') + '\nexport let mem9Total: usize = 0;\n';
  source += '\nimport {mem9Total} from "rt/itcms";\nexport function mem9_collect(): usize { __collect(); return mem9Total; }\n';
}
source += `
export function mem9_count(): i32 { return __pulse_fastly_values.length; }
export function mem9_kind(kind: i32): i32 {
  let count = 0;
  for (let i = 0; i < __pulse_fastly_values.length; i++) if (unchecked(__pulse_fastly_values[i]).kind == kind) count++;
  return count;
}
`;
const { error } = await asc.main(args, { stdout: process.stdout, stderr: process.stderr,
  readFile(name, baseDir) {
    const file = path.resolve(baseDir, name);
    if (file === entry) return source;
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  },
});
if (error) { console.error(error); process.exitCode = 1; }
