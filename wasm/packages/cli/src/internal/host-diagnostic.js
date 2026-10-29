'use strict';
const path = require('node:path');
const isHost = value => typeof value?.code === 'string' && value.code.startsWith('PULSE_HOST_EXTENSION_');
// Public host errors carry identities and an authored location, never source,
// binding values, generated text, arbitrary provider detail, or exception stacks.
function project(value, descriptor, root) {
  const input = value?.detail || value || {}, detail = {};
  for (const key of ['package', 'contractId', 'operation']) if (typeof input[key] === 'string'
    && /^[A-Za-z0-9_@][A-Za-z0-9_@./:-]{0,255}$/.test(input[key])) detail[key] = input[key];
  if (['authored-entry', 'not-recorded'].includes(input.sourceBasis)) detail.sourceBasis = input.sourceBasis;
  const loc = input.loc || value?.loc || value?.source;
  if (loc && typeof loc === 'object' && typeof loc.file === 'string') {
    const file = path.isAbsolute(loc.file) ? root && path.relative(root, loc.file).split(path.sep).join('/') : loc.file;
    const point = loc.start || loc;
    try {
      require('./report/data').relativePath(file);
      if (Number.isInteger(point.line) && point.line > 0 && Number.isInteger(point.column) && point.column >= 0)
        detail.loc = { file, line: point.line, column: point.column };
    } catch { /* A missing or uncontained authored span remains unknown. */ }
  }
  return { code: value?.code, message: descriptor.summary, ...(['error', 'warning', 'info'].includes(value?.severity) ? { severity: value.severity } : {}), detail };
}
module.exports = { isHost, project };
