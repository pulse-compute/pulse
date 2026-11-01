'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Private Native kernel source owner. P07 must select this structurally and
// connect validated profiles, existing effect authority and the original clock.
// Loading this module does not install accounting in any driver.
function resourceLedgerSource(selected) {
  if (typeof selected !== 'boolean') throw new TypeError('Resource ledger selection must be explicit.');
  return selected ? fs.readFileSync(path.join(__dirname, 'resource-ledger.as.ts'), 'utf8') : '';
}

module.exports = Object.freeze({ resourceLedgerSource });
