'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { htmlPayload } = require('./capsule');
const { fail } = require('./data');
const read = name => fs.readFileSync(path.join(__dirname, 'viewer', name), 'utf8');
const digest = text => crypto.createHash('sha256').update(text).digest('base64');
function renderReport(capsule, options = {}) {
  const payload = htmlPayload(capsule), css = read('viewer.css'), script = read('model.js') + '\n' + read('viewer.js'), shell = read('shell.html');
  const snapshot = ['current', 'artifact', 'historical'].includes(options.snapshot) ? options.snapshot : 'historical';
  const policy = `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(css)}'; style-src-attr 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="pulse-report-viewer" content="1"><meta name="pulse-report-snapshot" content="${snapshot}"><title>Pulse Report</title><style>${css}</style></head><body>${shell}<script id="pulse-report-data" type="application/json">${payload}</script><script>${script}</script></body></html>\n`;
  // Match the bounded file reader used to verify generated-output receipts.
  if (Buffer.byteLength(html) > 64 * 1024 * 1024) fail('REPORT_LIMIT');
  return html;
}
module.exports = { renderReport };
