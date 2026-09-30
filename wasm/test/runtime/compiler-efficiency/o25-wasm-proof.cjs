'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { binarySections, functionNames } = require('./b03-handler-functions.cjs');
const { resolveAsc } = require('../../../packages/build-support/src/assemblyscript-compile');
const { appendAssemblyScriptOptimizationArgs } = require('../../../packages/build-support/src/native-optimization');
const { runTool } = require('../../../packages/wasm-guest-link/src/toolchain');
const root = path.resolve(__dirname, '../../../..');
const symbol = name => name.replace(/\\([a-f0-9]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)));

function inspect(built, target, directory) {
  const cwd = path.join(directory, target + '-named'); fs.mkdirSync(cwd);
  const entry = target === 'node' ? 'canonical-native.as' : 'fastly-native-platform-capabilities.as';
  fs.writeFileSync(path.join(cwd, entry + '.ts'), built.source);
  const asc = resolveAsc(path.join(root, 'wasm'));
  const args = [asc.script, entry + '.ts', '--outFile', 'named.wasm', '--runtime', built.manifest.schemaCodecs?.active ? 'incremental' : 'stub', '--noAssert', '--optimize', '--debug'];
  appendAssemblyScriptOptimizationArgs(args);
  args.push('--maximumMemory', '4096');
  if (built.manifest.schemaCodecs?.active) {
    const compiler = path.join(root, 'wasm/packages/compiler');
    const transform = require.resolve('json-as', { paths: [compiler] });
    args.push('--exportRuntime', '--transform', transform, '--path', path.join(compiler, 'node_modules'), '--path', path.dirname(path.resolve(transform, '../../..')));
  }
  if (target === 'fastly') args.push('--use', `abort=${entry}/__pulse_fastly_abort`);
  const result = spawnSync(asc.executable, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, JSON_STRICT: 'true', JSON_USE_FAST_PATH: '0', JSON_MODE: 'NAIVE' } });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const named = fs.readFileSync(path.join(cwd, 'named.wasm')), binary = binarySections(built.wasm);
  assert.deepEqual(binary.sections, binarySections(named).sections, 'every production non-custom section must match the named companion');
  runTool('wasm-dis', [path.join(cwd, 'named.wasm'), '--mvp-features', '--enable-mutable-globals', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-bulk-memory', '-o', path.join(cwd, 'named.wat')]);
  const wat = fs.readFileSync(path.join(cwd, 'named.wat'), 'utf8');
  const module = new WebAssembly.Module(named), names = functionNames(Buffer.from(WebAssembly.Module.customSections(module, 'name')[0]));
  const imported = WebAssembly.Module.imports(module).filter(item => item.kind === 'function').length;
  const functions = [...wat.matchAll(/^ \(func \$([^\s(]+)([\s\S]*?)^ \)/gm)].map((match, index) => ({ name: symbol(match[1]), bytes: binary.bodies[index], calls: [...new Set([...match[2].matchAll(/\bcall \$([^\s()]+)/g)].map(item => symbol(item[1])))] }));
  assert.equal(functions.length, binary.bodies.length);
  functions.forEach((fn, index) => assert.equal(fn.name, names.get(imported + index) ?? String(index)));
  const byName = new Map(functions.map(fn => [fn.name, fn]));
  function closure(roots) {
    const seen = new Set(), queue = [...roots];
    for (let i = 0; i < queue.length; i++) { const name = queue[i]; if (seen.has(name)) continue; seen.add(name); queue.push(...(byName.get(name)?.calls || [])); }
    return seen;
  }
  const reachable = closure([...wat.matchAll(/\(export "[^"]+" \(func \$([^\s()]+)/g)].map(match => symbol(match[1])));
  const roots = functions.filter(fn => /\/__pulse_shared_helper_\d+$/.test(fn.name));
  const sourceRoots = [...built.source.matchAll(/function (__pulse_shared_helper_\d+)\(/g)].map(match => match[1]);
  assert.ok(sourceRoots.length > 0 && sourceRoots.length <= 2, 'bounded helper partition');
  assert.equal(roots.length, sourceRoots.length, 'each shared body partition survives exactly once');
  for (const name of sourceRoots) assert.equal(roots.filter(fn => fn.name.endsWith('/' + name)).length, 1);
  assert.ok(roots.every(fn => reachable.has(fn.name)), 'shared helper is reachable from real exports');
  const callers = roots.map(fn => ({ name: fn.name, bytes: fn.bytes, callers: functions.filter(caller => caller.calls.includes(fn.name)).map(caller => caller.name) }));
  assert.ok(callers.every(fn => fn.callers.length > 0), 'no dead retained copies');
  const reached = closure(roots.map(fn => fn.name));
  const body = functions.filter(fn => reached.has(fn.name));
  assert.ok(roots.reduce((n, fn) => n + fn.bytes, 0) > 256, 'retain substantial executable state bodies');
  assert.ok(!/\b(?:call_indirect|call_ref|return_call)\b/.test(wat));
  return { namedCompanionSectionsByteExact: true, roots: callers, sharedBodyPartitions: roots.length,
    rootBytes: roots.reduce((n, fn) => n + fn.bytes, 0), reachableFunctions: body.length,
    largestReachableBodyBytes: Math.max(...body.map(fn => fn.bytes)) };
}
module.exports = { inspect };
