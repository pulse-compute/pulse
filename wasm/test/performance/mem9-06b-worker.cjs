'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), child = require('node:child_process');
const [runtime, count, arena, directory] = process.argv.slice(2);
const original = child.spawnSync, recipes = []; let build;
// Install before loading the provider, which captures spawnSync.
child.spawnSync = function(executable, args, options) {
  if (!args?.[0]?.endsWith('/assemblyscript/bin/asc.js')) return original(executable, args, options);
  assert(build); const name = `${build.strategy}-${build.mode}`;
  recipes.push({ ...build, executable, args, cwd: options.cwd });
  fs.copyFileSync(path.resolve(options.cwd, args[1]), path.join(directory, name + '.generated.ts'));
  const result = original(executable, build.mode === 'observed' ? [path.join(__dirname, 'mem9-06a-asc.mjs'), ...args] : args, { ...options, timeout: 180000 });
  fs.writeFileSync(path.join(directory, name + '.build.log'), (result.stdout || '') + (result.stderr || ''));
  return result;
};
try {
  const report = require('../provider/assert-fastly-numeric-runtimes.cjs').qualify({ runtime, iterations: Number(count), arena }, directory,
    { observed: true, onBuild: value => { build = value; } });
  assert.equal(recipes.length, runtime === 'schema-linked' ? 0 : 4);
  report.recipes = recipes; fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`ok - MEM9-06B ${runtime}/${count}/${arena}`);
} catch (e) { console.error(e.stack); process.exitCode = 1; }
finally { child.spawnSync = original; }
