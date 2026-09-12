#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { deployed } = require('./k4/deployed.cjs');

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--driver') throw new Error('Usage: run-k4-deployed.cjs --driver <reviewed-T2-probe-driver.cjs>; explicitly invokes remote writes');
  const driver = require(path.resolve(process.argv[3]));
  // No discovery, credential lookup, provisioning or activation. The reviewed
  // T2 driver supplies only the selected isolated environment and probe agents.
  const options = await driver.createProbes();
  try { console.log(JSON.stringify(await deployed(options))); }
  finally { if (typeof options.close === 'function') await options.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
