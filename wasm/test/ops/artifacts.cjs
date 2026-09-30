'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Seal the runnable closure, including installed dependencies. No symlinks or
// paths outside the retained candidate are allowed in an operational artifact.
function inventory(root) {
  assert.ok(fs.lstatSync(root).isDirectory(), 'Artifact root must be a real directory');
  const files = []; let bytes = 0;
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      assert.ok(!entry.name.includes('\\') && !entry.isSymbolicLink(), 'Artifact contains an unsupported path or symlink');
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(name);
      else {
        assert.ok(entry.isFile(), 'Artifact contains a non-regular file');
        const value = fs.readFileSync(path.join(root, name)); bytes += value.length;
        assert.ok(bytes <= 512 * 1024 * 1024 && files.length < 20000, 'Artifact exceeds evidence bounds');
        files.push({ path: name, bytes: value.length, sha256: hash(value) });
      }
    }
  }
  walk('');
  assert.ok(files.length > 0, 'Artifact is empty');
  return { files, bytes, sha256: hash(JSON.stringify(files)) };
}
function verify(root, expected) { assert.deepEqual(inventory(root), expected, 'Candidate bytes changed'); }
function materialize(source, destination) {
  const boundary = fs.realpathSync(source);
  function copy(from, to) {
    const resolved = fs.realpathSync(from);
    assert.ok(resolved === boundary || resolved.startsWith(boundary + path.sep), 'Dependency link escapes installed closure');
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(resolved)) copy(path.join(resolved, entry), path.join(to, entry));
    } else {
      assert.ok(stat.isFile(), 'Non-regular dependency');
      fs.writeFileSync(to, fs.readFileSync(resolved), { mode: stat.mode & 0o777 });
    }
  }
  copy(source, destination);
}
module.exports = { hash, inventory, verify, materialize };
