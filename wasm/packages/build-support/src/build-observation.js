'use strict';

const fs = require('node:fs');
const path = require('node:path');
// Observe the invocation, never arbitrary CLI argv, environment or provider config.
// Filesystem arguments retain their role, not machine-specific or private paths.
function observeAssemblyScript(args, { version, compilerVersion, durationMs, jsonAsVersion, assemblyScriptRoot, timeoutMs }) {
  const switches = new Set(['--noAssert', '--optimize', '--converge', '--importMemory', '--noExportMemory', '--exportRuntime']);
  const values = new Set(['--optimizeLevel', '--shrinkLevel', '--maximumMemory', '--initialMemory', '--memoryBase', '--disable', '--runPasses', '--exportStart', '--use']);
  const roles = { '--outFile': '<wasm-output>', '--textFile': '<wat-output>', '--path': '<dependency-search-path>' };
  const flags = [];
  let complete = true;
  for (let i = 2; i < args.length; i++) {
    const name = args[i];
    if (switches.has(name)) flags.push({ name, value: null });
    else if (roles[name]) { i++; flags.push({ name, value: roles[name] }); }
    else if (name === '--runtime') {
      const value = args[++i];
      flags.push({ name, value: ['stub', 'incremental', 'minimal'].includes(value) ? value : '<provider-runtime>' });
    } else if (name === '--transform') {
      const file = args[++i], base = path.basename(file);
      const value = ['native-retention-transform.cjs', 'schema-cache-arena-transform.cjs', 'report-capture.cjs'].includes(base) ? base
        : jsonAsVersion && file.includes('json-as') ? 'json-as' : '<transform>';
      flags.push({ name, value });
    } else if (values.has(name)) flags.push({ name, value: String(args[++i]) });
    else complete = false;
  }
  const value = name => flags.find(row => row.name === name)?.value;
  // These are the defaults of the qualified asc version, not guessed defaults
  // for a future compiler. Explicit values remain observable for any version.
  const optimized = flags.some(row => row.name === '--optimize');
  const level = (name, fallback) => value(name) !== undefined ? Number(value(name)) : version === '0.28.18' ? fallback : null;
  const toolchain = [{ name: 'AssemblyScript', version }, { name: 'Node.js', version: process.versions.node },
    ...(jsonAsVersion ? [{ name: 'json-as', version: jsonAsVersion }] : [])];
  if (assemblyScriptRoot) {
    try {
      const binaryen = require.resolve('binaryen/package.json', { paths: [fs.realpathSync(assemblyScriptRoot)] });
      const metadata = JSON.parse(fs.readFileSync(binaryen, 'utf8'));
      if (typeof metadata.version === 'string') toolchain.push({ name: 'Binaryen (asc)', version: metadata.version });
    } catch { /* A version not exposed by the selected installation is not inferred. */ }
  }
  return Object.freeze({ compilerVersion, timeoutMs: timeoutMs ?? null, durationMs: Math.max(0, Math.round(durationMs)), flags, flagsComplete: complete,
    optimization: { optimizeLevel: level('--optimizeLevel', optimized ? 3 : 0), shrinkLevel: level('--shrinkLevel', 0),
      converge: flags.some(row => row.name === '--converge') },
    toolchain,
    cache: 'not-reused' });
}
module.exports = { observeAssemblyScript };
