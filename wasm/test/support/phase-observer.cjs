'use strict';

// Opt-in diagnostic only. No source/argument/environment contents are retained.
// Copy this standalone helper into installed consumers; never load workspace
// product modules to observe an installed compiler.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const directory = process.env.PULSEWASM_TEST_PHASE_DIR;
const originalHash = crypto.createHash;
const originalRead = fs.readFileSync;
const write = fs.writeSync;
const close = fs.closeSync;
const context = new AsyncLocalStorage();
const begin = performance.now();
const origin = performance.timeOrigin;
const counts = Object.create(null);
const cache = new WeakMap();
let sequence = 0, dropped = 0, observationErrors = 0, busy = false, fd;
const sha = bytes => originalHash('sha256').update(bytes).digest('hex');
if (directory) {
  // Caller owns a fresh existing diagnostic directory. Exclusive file creation.
  fd = fs.openSync(path.join(path.resolve(directory), `${process.pid}-${crypto.randomBytes(8).toString('hex')}.jsonl`), 'wx', 0o600);
}
function emit(value) {
  if (fd === undefined) return;
  if (sequence > 100000 && value.event !== 'exit') { dropped++; return; }
  try { write(fd, JSON.stringify(value) + '\n'); } catch { observationErrors++; }
}
function safe(observe) {
  if (busy) return;
  busy = true;
  try { return observe(); } catch { observationErrors++; } finally { busy = false; }
}
function measure(label, operation, metadata, capture) {
  if (fd === undefined || busy) return operation();
  const span = { id: ++sequence, parent: context.getStore()?.id || null, label, start: performance.now(), metadata };
  emit({ event: 'start', ...span });
  const end = (status, value) => {
    const stop = performance.now();
    const artifact = capture ? safe(() => capture(value)) : undefined;
    emit({ event: 'end', id: span.id, end: stop, status, artifact });
  };
  return context.run(span, () => {
    try {
      const value = operation();
      if (value && typeof value.then === 'function') return value.then(
        result => { end('returned', result); return result; },
        error => { end('threw'); throw error; });
      end('returned', value); return value;
    } catch (error) { end('threw'); throw error; }
  });
}
function wrap(label, fn, capture) {
  if (fd === undefined) return fn;
  return function (...args) { return measure(label, () => Reflect.apply(fn, this, args), undefined, capture); };
}
function aggregate(label, fn) {
  return function (...args) {
    if (busy) return Reflect.apply(fn, this, args);
    const start = performance.now();
    try { return Reflect.apply(fn, this, args); }
    finally {
      const key = `${context.getStore()?.label || 'outside-span'}:${label}`;
      const row = counts[key] ||= { calls: 0, elapsedMs: 0 };
      row.calls++; row.elapsedMs += performance.now() - start;
    }
  };
}
function artifact(value) {
  const wasm = value?.wasm || value?.native?.wasm;
  return {
    ...(Buffer.isBuffer(wasm) || wasm instanceof Uint8Array ? { wasmSha256: sha(wasm), wasmBytes: wasm.length } : {}),
    ...(typeof value?.source === 'string' ? { sourceSha256: sha(value.source) } : {})
  };
}
function role(file) {
  const p = String(file).replaceAll('\\', '/');
  for (const marker of ['/src/', '/scripts/', '/test/support/']) {
    const i = p.lastIndexOf(marker);
    if (i >= 0) return p.slice(i + 1);
  }
  return path.basename(p);
}
const names = new Set([
  'compileCanonicalSource', 'compileCanonicalFile', 'compileCanonicalProject', 'buildCanonicalNativePlan',
  'compileCanonicalNativePlan', 'buildReachableProjectGraph', 'linkProjectRouterModules', 'linkProjectPlainHandler',
  'buildCanonicalSchemaBundle', 'buildSchemaJsonCompile', 'generateCanonicalNativeModule',
  'compileFastlyNativePlatformCapabilitiesPlan', 'materializeSelectedGuestUnits', 'realizeSelectedGuestUnits',
  'compileAssemblyScript', 'compileAssemblyScriptSource',
  'inspectProject', 'doctorProject', 'buildProject', 'runProjectTests', 'compileNativeProjectInMemory', 'prepareJavascriptApplication',
  'executeCanonicalNativeModule', 'executeNodeJavascriptApplication', 'executeFastlyJavascriptApplication',
  'executeFastlyNativePlatformCapabilities', 'packRelease', 'readTarEntries', 'copySharedPack',
  'inputIdentity', 'createContext', 'verifyWorker', 'cleanupWorker', 'prepareWorkspaces', 'cleanupWorkspaces',
  'cleanupTaskOutputs', 'cleanupRecordedWorkspacePackageBuilds',
  'buildSchemaCodecProof', 'assertSchemaCodecProof', 'assertSchemaAdmission', 'assertSchemaValueEncoding',
  'assertSchemaTextDecoding', 'assertSchemaOptionalProperties', 'assertSchemaScalarRecords', 'assertSchemaNestedJson'
]);
function instrument(exports, filename) {
  if (!exports || typeof exports !== 'object') return exports;
  if (cache.has(exports)) return cache.get(exports);
  const descriptors = Object.getOwnPropertyDescriptors(exports);
  let changed = false;
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.value !== 'function') continue;
    if (name === 'definePhaseAdapter' && /\/compiler\/src\/spine\/pipeline\.js$|\/wasm-compiler\/src\/spine\/pipeline\.js$/.test(filename)) {
      const define = descriptor.value;
      descriptor.value = function (definition) {
        return define({ ...definition, run: wrap(`spine.${definition.id}`, definition.run, artifact) });
      };
    } else if (names.has(name)) {
      descriptor.value = wrap(`${role(filename)}:${name}`, descriptor.value, artifact);
    } else continue;
    changed = true;
  }
  if (!changed) return exports;
  const copy = Object.create(Object.getPrototypeOf(exports), descriptors);
  if (Object.isFrozen(exports)) Object.freeze(copy);
  cache.set(exports, copy);
  return copy;
}
function install() {
  if (fd === undefined) return;
  emit({ event: 'process', pid: process.pid, ppid: process.ppid, origin, begin, node: process.version,
    task: process.env.PULSEWASM_SUITE_TASK || null, entry: path.basename(process.argv[1] || 'eval'),
    observerSha256: sha(originalRead(__filename)), schema: 'pulse.test-phase-observation.v1' });
  // Aggregate only: these are nested subsets, not additive wall-clock phases.
  for (const name of ['readFileSync', 'writeFileSync', 'readdirSync', 'statSync', 'lstatSync', 'realpathSync', 'existsSync', 'rmSync', 'cpSync', 'copyFileSync']) {
    const wrapped = aggregate(`fs.${name}`, fs[name]);
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(fs[name]));
    fs[name] = wrapped;
  }
  const assertions = require('node:assert/strict');
  for (const name of ['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual', 'ok', 'match', 'notEqual']) assertions[name] = aggregate(`assert.${name}`, assertions[name]);
  crypto.createHash = function (...args) {
    const hash = Reflect.apply(originalHash, this, args);
    for (const name of ['update', 'digest']) hash[name] = aggregate(`hash.${name}`, hash[name]);
    return hash;
  };
  for (const name of ['Module', 'Instance']) {
    const Original = WebAssembly[name];
    WebAssembly[name] = new Proxy(Original, { construct(target, args, newTarget) {
      return measure(`execution.WebAssembly.${name}`, () => Reflect.construct(target, args, newTarget));
    } });
  }
  for (const name of ['compile', 'instantiate']) WebAssembly[name] = wrap(`execution.WebAssembly.${name}`, WebAssembly[name]);
  const cp = require('node:child_process'), spawnSync = cp.spawnSync;
  cp.spawnSync = function (command, args, options) {
    const asc = Array.isArray(args) && args.some(value => /[/\\]assemblyscript[/\\]bin[/\\]asc\.js$/.test(value));
    let inputs;
    if (asc) inputs = safe(() => {
      const cwd = options?.cwd || process.cwd();
      const at = args.findIndex(value => /[/\\]assemblyscript[/\\]bin[/\\]asc\.js$/.test(value));
      const source = path.resolve(cwd, args[at + 1]);
      const outputIndex = args.indexOf('--outFile');
      const normalized = args.slice(at + 1).map((arg, i, all) =>
        ['--outFile', '--textFile'].includes(all[i - 1]) ? '<output>' : arg.replaceAll(cwd, '<cwd>'));
      return { sourceSha256: sha(originalRead(source)), optionsSha256: sha(JSON.stringify(normalized)),
        ascSha256: sha(originalRead(args[at])), output: outputIndex >= 0 ? path.resolve(cwd, args[outputIndex + 1]) : null };
    });
    const metadata = inputs && { sourceSha256: inputs.sourceSha256, optionsSha256: inputs.optionsSha256, ascSha256: inputs.ascSha256,
      scope: 'entry bytes and path-normalized argv only; transitive generated/imported inputs and environment not established' };
    return measure(asc ? 'preparation.asc' : `subprocess.${path.basename(String(command))}`,
      () => spawnSync.call(this, command, args, options), metadata, result => {
        const out = { exitCode: result?.status, signal: result?.signal || null };
        if (inputs?.output && result?.status === 0) { const bytes = originalRead(inputs.output); out.wasmSha256 = sha(bytes); out.wasmBytes = bytes.length; }
        return out;
      });
  };
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    // First loads only; repeated cache lookup cost is left in its owning phase.
    const filename = Module._resolveFilename(request, parent, isMain);
    const first = path.isAbsolute(filename) && !Module._cache[filename];
    const get = () => load.apply(this, arguments);
    const result = first ? measure('source.module-load', get) : get();
    return /[/\\](?:wasm[/\\]packages|packages|@pulse-compute|scripts|test[/\\]support)[/\\]/.test(filename)
      ? instrument(result, filename.replaceAll('\\', '/')) : result;
  };
  process.on('exit', code => {
    emit({ event: 'exit', end: performance.now(), exitCode: code, counts, dropped, observationErrors });
    close(fd);
  });
}
module.exports = { measure, wrap, install };
install();
