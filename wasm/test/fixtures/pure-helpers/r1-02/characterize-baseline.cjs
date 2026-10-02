'use strict';

// Run the same characterization against frozen product modules. The surrounding
// Native plan validator and the new test remain identical; only the declared
// R1-02 product variable changes. This is development evidence, not a compiler.
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../../..');
const base = 'afce9f129d5c8e80099178261cbce0da6e3bb263';
for (const relative of ['wasm/packages/compiler/src/pure-helper-values.js', 'wasm/packages/compiler/src/source-helper-plan.js']) {
  const file = path.join(root, relative);
  const frozen = new Module(file, module);
  frozen.filename = file;
  frozen.paths = Module._nodeModulePaths(path.dirname(file));
  require.cache[file] = frozen;
  frozen._compile(execFileSync('git', ['show', `${base}:${relative}`], { cwd: root, encoding: 'utf8' }), file);
  frozen.loaded = true;
}
require('../../../lowering/assert-pure-helper-vocabulary.cjs');
