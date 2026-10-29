'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
module.exports = function build(projectRoot, dependencyRoot, installed) {
  for (const name of ['pulse', 'provider-fastly', 'provider-node']) {
    const location = path.join(projectRoot, 'node_modules/@pulse-compute', name);
    fs.mkdirSync(path.dirname(location), { recursive: true });
    if (!fs.existsSync(location)) fs.symlinkSync(path.join(dependencyRoot, installed ? 'node_modules/@pulse-compute' : 'packages', name), location);
  }
  fs.mkdirSync(path.join(projectRoot, '.pulse'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.pulse/config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((scope) => ({pulse:{entry:'app.ts',defaultProfile:'local',strict:true},local:{host:'fastly',target:'native',outDir:'cli-out',fastly:{bindings:{backends:{edge:'edge_backend'}},build:{name:'terminal-proof'}}}}));`);
  const cli = installed ? path.join(dependencyRoot, 'node_modules/@pulse-compute/cli/bin/pulse.js') : path.join(dependencyRoot, 'wasm/scripts/pulse.cjs');
  const stdout = execFileSync(process.execPath, [cli, 'build', '--json'], {
    cwd: projectRoot, env: { ...process.env, NODE_PATH: '', npm_config_ignore_scripts: 'true' }, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024
  });
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'built');
  return fs.readFileSync(path.join(projectRoot, 'cli-out/bin/main.wasm'));
};
