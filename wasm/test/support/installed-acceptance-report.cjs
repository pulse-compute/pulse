'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The release feature replay assigns one fresh report per registered task.
// Ordinary focused runs retain their existing report locations.
function installedAcceptanceReport(defaultFile, env = process.env) {
  if (!env.PULSE_RELEASE_FEATURE_REPORT_DIR) return defaultFile;
  const task = env.PULSEWASM_SUITE_TASK;
  if (!/^[a-z0-9-]+-installed(?:-workflow)?$/.test(task || '')) {
    throw new Error('Installed acceptance requires a registered installed task identity');
  }
  const file = path.join(path.resolve(env.PULSE_RELEASE_FEATURE_REPORT_DIR), `${task}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

module.exports = { installedAcceptanceReport };
