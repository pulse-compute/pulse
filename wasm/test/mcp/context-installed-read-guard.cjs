'use strict';
// Build-only audit guard for trusted tooling. Node's permission mode forbids
// fsync even with write grants, so it cannot run the normal atomic writer.
// Runtime qualification uses Node's permission model instead of this guard.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const Module = require('node:module');
const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json')));
const roots = [settings.consumer, __dirname];
const probe = path.join(settings.consumer, 'node_modules/typescript/lib/typescript.js').replace(/\w/g, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
function check(file) {
  if (typeof file === 'number') return; // descriptor provenance belongs to open()
  if (file instanceof URL) file = fileURLToPath(file);
  if (Buffer.isBuffer(file)) file = file.toString();
  if (typeof file !== 'string') return;
  const absolute = path.resolve(file);
  if (absolute === probe || roots.some(root => absolute === root || absolute.startsWith(root + path.sep))) return;
  const error = new Error('Installed build read outside consumer: ' + absolute);
  process.stderr.write(error.stack + '\n');
  error.code = 'ERR_ACCESS_DENIED'; error.resource = absolute; throw error;
}
// Ordinary package/workspace discovery probes ancestor metadata. Permit those
// existence/stat checks; restrict content reads, directory listings and resolved
// CommonJS code. This is explicit test instrumentation, not an OS sandbox.
const methods = ['readdir', 'readFile', 'open', 'opendir'];
for (const name of methods) {
  for (const key of [name, name + 'Sync']) if (typeof fs[key] === 'function') {
    const original = fs[key];
    const wrapped = function(file, ...args) { check(file); return original.call(this, file, ...args); };
    Object.assign(wrapped, original);
    if (original.native) wrapped.native = function(file, ...args) { check(file); return original.native.call(this, file, ...args); };
    fs[key] = wrapped;
  }
  if (typeof fs.promises[name] === 'function') {
    const original = fs.promises[name];
    fs.promises[name] = async function(file, ...args) { check(file); return original.call(this, file, ...args); };
  }
}
const stream = fs.createReadStream;
fs.createReadStream = function(file, ...args) { check(file); return stream.call(this, file, ...args); };
const resolve = Module._resolveFilename;
Module._resolveFilename = function(...args) {
  const result = resolve.apply(this, args);
  if (path.isAbsolute(result)) check(result);
  return result;
};
globalThis.__pulseInstalledBuildReadGuard = true;
