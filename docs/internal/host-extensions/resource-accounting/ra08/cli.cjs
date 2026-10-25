'use strict';
// Internal sidecar validation/compare only; not a pulse CLI command.
const fs = require('node:fs'), assert = require('node:assert/strict');
const {validate} = require('./schema.cjs'), {compare} = require('./report.cjs');
function read(file) {
  const fd = fs.openSync(file,'r');
  try {
    assert(fs.fstatSync(fd).size <= 2*1024*1024,'REPORT_SIZE');
    return validate(JSON.parse(fs.readFileSync(fd,'utf8')));
  } finally {fs.closeSync(fd);}
}
try {
  const [action,before,after] = process.argv.slice(2);
  assert(['validate','compare'].includes(action) && before && (action==='validate' ? !after : after),'usage: cli.cjs validate report.json | compare before.json after.json');
  const result = action==='validate' ? (read(before),{status:'valid'}) : compare(read(before),read(after));
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(error.message);process.exitCode=1;}
