#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCapsule, htmlPayload } = require('../../wasm/packages/cli/src/internal/report/capsule');
const asset = name => fs.readFileSync(path.join(__dirname, 'graph', name), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('base64');
function render(capsule) {
  const css = asset('style.css'), js = asset('model.cjs') + '\n' + asset('app.js');
  const csp = `default-src 'none'; script-src 'sha256-${hash(js)}'; style-src 'sha256-${hash(css)}'; style-src-attr 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Pulse · Execution atlas</title><style>${css}</style></head><body>${asset('shell.html')}<script type="application/json" id="report-data">${htmlPayload(capsule)}</script><script>${js}</script></body></html>`;
}
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) throw Error('Usage: node scripts/spikes/report-graph-html.cjs <capsule.json> <output.html>');
  const capsule = parseCapsule(fs.readFileSync(input));
  fs.writeFileSync(output, render(capsule), { flag: 'wx' });
  console.log(JSON.stringify({ output, capsuleHash: capsule.evidenceHash.value, analytics: !!capsule.analytics }));
}
module.exports = { render };
