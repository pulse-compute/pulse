'use strict';
// Receipts exclude only exact generated HTML bytes. They are not build authority:
// retained-input comparison and compiled watch-file binding still fail closed.
const fs = require('node:fs');
const path = require('node:path');
const { readFile, checkedPath, atomicWrite } = require('./files');
const { sha256, parseJson, fail } = require('./data');
const DIRECTORY = '.pulse-report-outputs';
const MAX_RECEIPTS = 256;
function receiptName(file) { return sha256(Buffer.from(file)) + '.json'; }
function valid(value, filename) {
  return value?.kind === 'pulse.report-output' && value.version === 1
    && typeof value.file === 'string' && path.basename(value.file) === value.file
    && !/[\\/\0]/.test(value.file) && path.extname(value.file).toLowerCase() === '.html'
    && receiptName(value.file) === filename && Array.isArray(value.hashes)
    && value.hashes.length >= 1 && value.hashes.length <= 2
    && value.hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash));
}
function readReceipt(directory, filename) {
  const data = parseJson(readFile(directory, DIRECTORY + '/' + filename, 4096).bytes);
  if (!valid(data, filename)) fail('REPORT_INPUT_UNBOUND');
  return data;
}
function generatedOutputs(directory) {
  const found = new Map(), marker = path.join(directory, DIRECTORY);
  // Missing registry is normal. A malformed or symlink registry is not a reason
  // to hide files or silently weaken freshness validation.
  try { fs.lstatSync(marker); } catch (error) { if (error.code === 'ENOENT') return found; throw error; }
  checkedPath(directory, DIRECTORY);
  const files = fs.readdirSync(marker);
  if (files.length > MAX_RECEIPTS) fail('REPORT_LIMIT');
  for (const filename of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) fail('REPORT_INPUT_UNBOUND');
    const receipt = readReceipt(directory, filename);
    found.set(receipt.file, receipt.hashes);
  }
  return found;
}
function prepareOutputReceipt(file, html) {
  const parent = path.dirname(file), name = path.basename(file), filename = receiptName(name);
  const marker = path.join(parent, DIRECTORY);
  try { fs.mkdirSync(marker, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  checkedPath(parent, DIRECTORY);
  if (fs.readdirSync(marker).length >= MAX_RECEIPTS && !fs.existsSync(path.join(marker, filename))) fail('REPORT_LIMIT');
  const hashes = [sha256(Buffer.from(html))];
  try {
    const previous = readReceipt(parent, filename), current = readFile(parent, name);
    if (previous.hashes.includes(current.sha256) && !hashes.includes(current.sha256)) hashes.push(current.sha256);
  } catch (error) { if (error.code !== 'REPORT_MISSING_ARTIFACT') throw error; }
  // Keep the previous verified bytes as well as the intended bytes, so a failed
  // HTML replacement does not invalidate a previously generated report.
  atomicWrite(parent, DIRECTORY + '/' + filename, JSON.stringify({kind:'pulse.report-output',version:1,file:name,hashes}) + '\n');
}
module.exports = { DIRECTORY, generatedOutputs, prepareOutputReceipt };
