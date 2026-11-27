'use strict';
// Research-only extension of the package bridge. No scheduler or public export
// is changed on disk. Must be installed before loading the Pulse runtime.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../../../../packages/runtime/src/internal/package-runtime.js');
function install() {
  if (require.cache[filename]) throw new Error('UPLOAD02 overlay must precede runtime loading');
  let source = fs.readFileSync(filename, 'utf8');
  const anchor = 'module.exports = Object.freeze({';
  if (source.split(anchor).length !== 2) throw new Error('Package bridge boundary drift');
  source = source.replace(anchor, `
function upload02(context, payload, marker) {
  const data = packageContextData(context);
  assertPackageContextActive(data);
  const metadata = clonePackageEffectPayload(payload);
  const owner = data.frame.executionOptions.incomingBody;
  if (!owner) throw new Error('UPLOAD02 owner missing');
  // Reserve synchronously, before any dispatch microtask. The descriptor holds
  // only detached metadata; the current host retains the owner out of band.
  owner.claim(marker, metadata);
  return data.effectExecution.dispatch({ kind: 's3.upload02', providerKind: 's3',
    operation: 'upload02', capability: 's3.upload02', package: '@pulse-compute/s3',
    contractId: 'pulse.s3.upload02-experiment', parallelEligible: false,
    payload: metadata });
}
module.exports = Object.freeze({ upload02,`);
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = loaded;
  try { loaded._compile(source, filename); loaded.loaded = true; } catch (error) { delete require.cache[filename]; throw error; }
  return { upload: loaded.exports.upload02, source };
}
module.exports = { install };
