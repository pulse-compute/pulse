'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function pulseS3AssemblyScriptSource() {
  const source = fs.readFileSync(path.join(__dirname, 'as/read.as.ts'), 'utf8');
  return Object.freeze({ id: 'pulse-s3-read-as', owner: '@pulse-compute/s3', version: 'pulse.s3-native-read.v1',
    source, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    cryptoRequirements: Object.freeze(['SHA-256', 'HMAC-SHA256']) });
}
module.exports = { pulseS3AssemblyScriptSource };
