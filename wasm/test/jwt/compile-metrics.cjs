'use strict';

// Test-only observation at the subprocess boundary. Count actual asc attempts,
// including rejected compilations, rather than assuming one compile per CLI verb.
// Do not record arguments, generated source, credentials or fixture paths.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { performance } = require('node:perf_hooks');

const totals = { invocations: 0, failed: 0, durationMs: 0 };
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (command, args, ...rest) {
  if (!Array.isArray(args) || !/[/\\]assemblyscript[/\\]bin[/\\]asc\.js$/.test(args[0] || '')) {
    return spawnSync.call(this, command, args, ...rest);
  }
  const started = performance.now();
  totals.invocations++;
  let result;
  try {
    result = spawnSync.call(this, command, args, ...rest);
    return result;
  } finally {
    if (!result || result.error || result.status !== 0) totals.failed++;
    totals.durationMs += performance.now() - started;
  }
};

function snapshot() {
  return { ...totals, durationMs: Math.round(totals.durationMs) };
}

function since(before) {
  const after = snapshot();
  return Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
}

// Installed CLI children preload a copy of this file outside the checkout.
function writeOnExit(file) {
  process.on('exit', () => fs.writeFileSync(path.resolve(file), JSON.stringify(snapshot()) + '\n'));
}

module.exports = { snapshot, since, writeOnExit };
