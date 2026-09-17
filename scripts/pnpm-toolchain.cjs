#!/usr/bin/env node
'use strict';

// Release commands use the manifest pin; ordinary development uses engines.pnpm.
// Install without lifecycle scripts, then copy the platform package's executable.
// The resulting runner is self-contained and safe to carry in the offline bundle.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function exactVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid exact pnpm version: ${version}`);
  return version;
}

function pnpmInvocation(root, version = require('./package-support.cjs').PUBLICATION.pnpmVersion) {
  exactVersion(version);
  // Previous release tags retain their JavaScript pnpm and original lockfile.
  if (Number(version.split('.')[0]) < 12) return { command: 'corepack', prefix: [`pnpm@${version}`] };
  return { command: process.execPath, prefix: [__filename, '--root', root, '--version', version, '--'] };
}

function checkedRun(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 300000, shell: process.platform === 'win32' && command.endsWith('.cmd'), ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`pnpm toolchain command failed: ${command} ${args.join(' ')}\n${result.error?.message || result.stderr || result.status}`);
  }
  return result.stdout?.trim();
}

function binaryPath(root) {
  return path.join(root, '.validation-tools', 'pnpm', 'bin', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
}

function ensurePnpm(root, version) {
  exactVersion(version);
  const binary = binaryPath(root);
  if (fs.existsSync(binary)) {
    const actual = checkedRun(binary, ['--version']);
    if (actual !== version) throw new Error(`Bundled pnpm version mismatch: ${actual} !== ${version}; remove .validation-tools/pnpm and bootstrap again`);
    return binary;
  }
  if (process.env.COREPACK_ENABLE_NETWORK === '0' || process.env.npm_config_offline === 'true') {
    throw new Error(`pnpm ${version} is not bundled; offline execution cannot bootstrap it`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-pnpm-bootstrap-'));
  try {
    // npm verifies registry integrity and selects OS/CPU/libc optional packages.
    // No workspace dependencies or lifecycle scripts are installed here.
    checkedRun(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund',
      '--package-lock=false', '--include=optional', `pnpm@${version}`
    ]);
    const modules = path.join(temporary, 'node_modules');
    const manifest = JSON.parse(fs.readFileSync(path.join(modules, 'pnpm', 'package.json'), 'utf8'));
    const candidates = Object.keys(manifest.optionalDependencies || {})
      .filter((name) => name.startsWith('@pnpm/exe.'))
      .map((name) => path.join(modules, name, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'))
      .filter((file) => fs.existsSync(file));
    if (candidates.length !== 1) throw new Error(`Expected one native pnpm executable for ${process.platform}/${process.arch}, found ${candidates.length}`);
    if (checkedRun(candidates[0], ['--version']) !== version) throw new Error('Downloaded pnpm version does not match the release pin');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.copyFileSync(path.join(modules, 'pnpm', 'THIRD-PARTY-NOTICES.md'), path.join(root, '.validation-tools/pnpm/THIRD-PARTY-NOTICES.md'));
    const staged = `${binary}.${process.pid}.tmp`;
    try {
      fs.copyFileSync(candidates[0], staged);
      fs.chmodSync(staged, 0o755);
      fs.renameSync(staged, binary);
    } finally { fs.rmSync(staged, { force: true }); }
    return binary;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function main(argv = process.argv.slice(2)) {
  let root = path.resolve(__dirname, '..');
  let version;
  let install = false;
  let args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') { args = argv.slice(index + 1); break; }
    if (arg === '--install') install = true;
    else if (arg === '--root' && argv[index + 1]) root = path.resolve(argv[++index]);
    else if (arg === '--version' && argv[index + 1]) version = argv[++index];
    else throw new Error(`Unknown pnpm toolchain option: ${arg}`);
  }
  version ||= JSON.parse(fs.readFileSync(path.join(root, 'release/pulse-release-manifest.json'), 'utf8')).publication.pnpmVersion;
  const binary = ensurePnpm(root, version);
  if (install) { process.stderr.write(`pnpm ${version}: ${binary}\n`); return; }
  if (!args.length) throw new Error('Pass --install or -- followed by pnpm arguments');
  const result = spawnSync(binary, args, {
    stdio: 'inherit',
    env: { ...process.env, PATH: `${path.dirname(binary)}${path.delimiter}${process.env.PATH || ''}` }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { exactVersion, pnpmInvocation, binaryPath, ensurePnpm, main };
