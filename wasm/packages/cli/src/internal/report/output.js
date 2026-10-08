'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PulseProjectError } = require('../project-error');
const { syncDirectory, contained } = require('./files');
function unsafe() { throw new PulseProjectError('PULSE_REPORT_OUTPUT_UNSAFE', 'Report output must be a contained regular .html file without symbolic links.'); }
function inspectChain(file) {
  const parsed = path.parse(file), chain = [];
  let current = parsed.root;
  for (const part of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink() || (current === file ? !stat.isFile() : !stat.isDirectory())) unsafe();
    chain.push({ file: current, dev: stat.dev, ino: stat.ino, mode: stat.mode });
  }
  return chain;
}
function verify(chain) {
  for (const before of chain) {
    const after = fs.lstatSync(before.file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || after.isSymbolicLink()) unsafe();
  }
}
function outputPath(root, requested) {
  const selected = requested ?? '.pulse/reports/pulse-report.html';
  if (typeof selected !== 'string' || !selected || selected.includes('\0') || path.sep !== '\\' && selected.includes('\\')
    || selected.split(/[\\/]/).includes('..')) unsafe();
  const file = path.resolve(root, selected);
  if (!contained(path.resolve(root), file) || path.extname(file).toLowerCase() !== '.html') unsafe();
  // Generated files must also be readable by the retained-input verifier.
  // Reject control/URL-escape characters before writing an unusable receipt.
  try { require('./data').relativePath(path.relative(root, file).split(path.sep).join('/')); }
  catch { unsafe(); }
  try { inspectChain(file); }
  catch (error) {
    if (error instanceof PulseProjectError) throw error;
    throw new PulseProjectError('PULSE_REPORT_OUTPUT_FAILED', 'The HTML output destination could not be inspected.');
  }
  return file;
}
function writeHtml(root, requested, html, options = {}) {
  const file = outputPath(root, requested);
  const relativeFile = path.relative(root, file).split(path.sep).join('/');
  if (options.inputFiles?.includes(relativeFile)) unsafe();
  if (typeof html !== 'string') throw new TypeError('Report renderer must return HTML text');
  let temporary, fd;
  try {
    const original = inspectChain(file);
    // Create only missing destination directories, checking each existing ancestor.
    const relative = path.relative(root, path.dirname(file));
    let parent = path.resolve(root);
    for (const part of relative.split(path.sep).filter(Boolean)) {
      verify(original);
      parent = path.join(parent, part);
      try { fs.mkdirSync(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      outputPath(root, file);
    }
    if (options.recordOutput) require('./output-receipts').prepareOutputReceipt(file, html);
    const chain = inspectChain(file);
    temporary = path.join(path.dirname(file), '.pulse-report-' + crypto.randomBytes(12).toString('hex'));
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, html); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    verify(chain); outputPath(root, file);
    fs.renameSync(temporary, file); temporary = undefined;
    syncDirectory(path.dirname(file));
    return file;
  } catch (error) {
    if (error instanceof PulseProjectError) throw error;
    throw new PulseProjectError('PULSE_REPORT_OUTPUT_FAILED', 'The HTML report could not be written atomically.');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (temporary) fs.rmSync(temporary, { force: true });
  }
}
module.exports = { outputPath, writeHtml };
