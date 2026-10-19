'use strict';
const crypto = require('node:crypto');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
module.exports = { hash: value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') };
