'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { binaryenVersion, diagnosticCodes } = require('./constants.js');
const { fail } = require('./errors.js');
const { sha256 } = require('./files.js');

const allowedTools = new Set(['wasm-as', 'wasm-dis', 'wasm-merge', 'wasm-opt']);

function binaryenPackage() {
  let manifestFile;
  let manifest;
  try {
    manifestFile = require.resolve('binaryen/package.json');
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    fail(diagnosticCodes.invalid, 'The direct pinned Binaryen dependency is not installed or has invalid metadata.');
  }
  if (manifest.name !== 'binaryen' || manifest.version !== binaryenVersion) {
    fail(diagnosticCodes.invalid, `Guest linking requires direct Binaryen ${binaryenVersion}.`, {
      observedName: manifest.name,
      observedVersion: manifest.version
    });
  }
  return Object.freeze({
    root: fs.realpathSync(path.dirname(manifestFile)),
    manifestFile: fs.realpathSync(manifestFile),
    version: manifest.version
  });
}

function resolveTool(name) {
  if (!allowedTools.has(name)) fail(diagnosticCodes.invalid, `Unknown Binaryen tool ${name}.`);
  const packageInfo = binaryenPackage();
  const candidate = path.join(packageInfo.root, 'bin', name);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    fail(diagnosticCodes.invalid, `Pinned Binaryen does not contain ${name}.`);
  }
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${packageInfo.root}${path.sep}`)) {
    fail(diagnosticCodes.invalid, `Pinned Binaryen tool ${name} escapes its package root.`);
  }
  return Object.freeze({
    name,
    file: real,
    version: packageInfo.version,
    sha256: sha256(fs.readFileSync(real))
  });
}

function restrictedEnvironment() {
  const result = {};
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR']) {
    if (process.env[name]) result[name] = process.env[name];
  }
  return result;
}

function sanitizedOutput(value, replacements) {
  let output = String(value || '');
  for (const [from, to] of replacements) {
    if (from) output = output.split(from).join(to);
  }
  return output.trim().slice(0, 4096);
}

function runTool(name, args, options = {}) {
  const tool = resolveTool(name);
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'string')) {
    fail(diagnosticCodes.invalid, `Arguments for ${name} must be a trusted normalized string array.`);
  }
  const cwd = options.cwd ? fs.realpathSync(options.cwd) : process.cwd();
  const result = spawnSync(tool.file, args, {
    cwd,
    encoding: 'utf8',
    env: restrictedEnvironment(),
    timeout: options.timeoutMs || 30000,
    maxBuffer: 16 * 1024 * 1024,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const replacements = [
      [cwd, '<work>'],
      [tool.file, `<binaryen>/${name}`],
      [path.dirname(tool.file), '<binaryen>'],
      ...args
        .filter((entry) => path.isAbsolute(entry))
        .map((entry) => [entry, `<input>/${path.basename(entry)}`])
    ];
    fail(options.failureCode || diagnosticCodes.invalid, options.failureMessage || `${name} failed.`, {
      tool: name,
      version: tool.version,
      status: result.status,
      stdout: sanitizedOutput(result.stdout, replacements),
      stderr: sanitizedOutput(result.stderr, replacements),
      cause: result.error && sanitizedOutput(result.error.message, replacements)
    });
  }
  return Object.freeze({
    tool: Object.freeze({ name, version: tool.version, sha256: tool.sha256 }),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  });
}

function binaryenIdentity() {
  const packageInfo = binaryenPackage();
  return Object.freeze({
    name: 'binaryen',
    version: packageInfo.version,
    tools: Object.freeze(['wasm-as', 'wasm-dis', 'wasm-merge', 'wasm-opt'].map((name) => {
      const tool = resolveTool(name);
      return Object.freeze({ name, sha256: tool.sha256 });
    }))
  });
}

module.exports = Object.freeze({
  binaryenPackage,
  resolveTool,
  runTool,
  binaryenIdentity
});
