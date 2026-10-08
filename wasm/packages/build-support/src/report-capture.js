'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Internal build helper exposed only through the existing implementation module.
function prepareReportCapture(args, directory, ownership, ascVersion, prefix) {
  if (ascVersion !== '0.28.18') return () => null;
  const file = path.join(directory, 'report-capture.json'), transform = path.join(directory, 'report-capture.cjs');
  try {
    const config = { file, ownership, prefix };
    fs.writeFileSync(transform, `const Capture = require(${JSON.stringify(path.join(__dirname, 'report-capture-transform.cjs'))});module.exports = class extends Capture { constructor(){super(${JSON.stringify(config)});} };\n`);
    args.push('--transform', transform);
  } catch { return () => null; }
  return wasm => {
    try {
      if (fs.statSync(file).size > 16 * 1024 * 1024) return null;
      const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (capture.artifactSha256 !== createHash('sha256').update(wasm).digest('hex')) return null;
      return capture;
    } catch { return null; }
  };
}
module.exports = { prepareReportCapture };
