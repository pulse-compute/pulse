'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail, relativePath, sha256 } = require('./data');
const MAX_FILE_BYTES = 64 * 1024 * 1024;
function stamp(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'); }
const pathStamp = stat => stat.isDirectory() ? [stat.dev, stat.ino, stat.mode].map(String).join(':') : stamp(stat);
function contained(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}
function checkedPath(root, relative) {
  relativePath(relative);
  const base = path.resolve(root), file = path.resolve(base, relative);
  if (!contained(base, file)) fail('REPORT_PATH');
  const chain = [];
  let current = base;
  for (const part of ['', ...relative.split('/')]) {
    if (part) current = path.join(current, part);
    let stat; try { stat = fs.lstatSync(current, { bigint: true }); } catch { fail('REPORT_MISSING_ARTIFACT'); }
    if (stat.isSymbolicLink()) fail('REPORT_PATH');
    if (current !== file && !stat.isDirectory()) fail('REPORT_PATH');
    chain.push({ file: current, token: pathStamp(stat) });
  }
  return { file, chain };
}
function verifyChain(chain) {
  for (const row of chain) {
    let stat; try { stat = fs.lstatSync(row.file, { bigint: true }); } catch { fail('REPORT_CONCURRENT_CHANGE'); }
    if (stat.isSymbolicLink() || pathStamp(stat) !== row.token) fail('REPORT_CONCURRENT_CHANGE');
  }
}
function readFile(root, relative, maximum = MAX_FILE_BYTES) {
  const { file, chain } = checkedPath(root, relative);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) fail('REPORT_PATH');
    if (before.size > BigInt(maximum)) fail('REPORT_LIMIT');
    if (stamp(before) !== chain.at(-1).token) fail('REPORT_CONCURRENT_CHANGE');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) fail('REPORT_CONCURRENT_CHANGE');
      offset += count;
    }
    if (stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before)) fail('REPORT_CONCURRENT_CHANGE');
    verifyChain(chain);
    return { bytes, file: relative, size: bytes.length, sha256: sha256(bytes), token: stamp(before) };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function atomicWrite(root, relative, bytes) {
  relativePath(relative);
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('REPORT_PATH');
  const rootChain = [{ file: root, token: pathStamp(rootStat) }];
  const parent = path.posix.dirname(relative);
  if (parent !== '.') checkedPath(root, parent);
  const target = path.join(root, relative);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) fail('REPORT_PATH');
  const temporary = path.join(path.dirname(target), '.report-' + crypto.randomBytes(12).toString('hex'));
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    if (parent !== '.') checkedPath(root, parent);
    verifyChain(rootChain);
    fs.renameSync(temporary, target);
    syncDirectory(path.dirname(target));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}
function syncDirectory(directory) {
  // Directory fsync is supported on POSIX; Windows does not permit opening a
  // directory this way. Atomic rename still supplies visibility there.
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
module.exports = { MAX_FILE_BYTES, stamp, contained, checkedPath, readFile, atomicWrite, syncDirectory };
