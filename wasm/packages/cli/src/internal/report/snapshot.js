'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { canonicalJson, sha256, fail, relativePath } = require('./data');
const { readFile, contained } = require('./files');
const RESOLUTIONS = new WeakMap();
const MAX_FILES = 20000, MAX_BYTES = 256 * 1024 * 1024;
const slash = file => file.split(path.sep).join('/');
const digest = value => sha256(canonicalJson(value));
function scan(root, { excluded = [], packageFiles = false } = {}) {
  const records = [], tokens = new Map(); let bytes = 0, files = 0, receipts = 0;
  const exclusions = excluded.map(file => path.resolve(root, file));
  function visit(directory) {
    const generated = packageFiles ? new Map() : require('./output-receipts').generatedOutputs(directory);
    receipts += generated.size;
    if (receipts > MAX_FILES) fail('REPORT_LIMIT');
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1);
    for (const entry of entries) {
      const file = path.join(directory, entry.name), relative = slash(path.relative(root, file));
      if (exclusions.some(exclude => file === exclude || contained(exclude, file))) continue;
      if (['node_modules', '.git'].includes(entry.name)) continue;
      if (entry.isDirectory() && (entry.name === 'dist' && !packageFiles || entry.name.startsWith('.pulse-')
        || packageFiles && ['docs', 'examples', 'test', 'tests', 'target', '.test-results'].includes(entry.name))) continue;
      if (entry.isSymbolicLink()) fail('REPORT_INPUT_SYMLINK');
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile()) fail('REPORT_PATH');
      const read = readFile(root, relative);
      bytes += read.size;
      if (++files > MAX_FILES || bytes > MAX_BYTES) fail('REPORT_LIMIT');
      if (generated.get(entry.name)?.includes(read.sha256)) continue;
      records.push({ file: relative, bytes: read.size, sha256: read.sha256 }); tokens.set(relative, read.token);
    }
  }
  visit(root);
  return { records, tokens };
}
function sameSnapshot(first, second) {
  if (canonicalJson(first.records) !== canonicalJson(second.records)) fail('REPORT_STALE_INPUTS');
  for (const [file, token] of first.tokens) if (second.tokens.get(file) !== token) fail('REPORT_CONCURRENT_CHANGE');
}
function workspaceControls(root) {
  const records = [], tokens = new Map(); let directory = path.resolve(root);
  for (let depth = 0; depth < 64; depth++) {
    let manifest = null, workspace = false;
    for (const file of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'tsconfig.json']) {
      if (!fs.existsSync(path.join(directory, file))) continue;
      const read = readFile(directory, file), key = depth + '/' + file;
      records.push({ file: key, bytes: read.size, sha256: read.sha256 }); tokens.set(key, read.token);
      if (file === 'package.json') manifest = JSON.parse(read.bytes);
      if (file === 'pnpm-workspace.yaml') workspace = true;
    }
    // This is the existing workspace boundary, read as data only. Record absent
    // ancestors too by rescanning, so insertion of a nearer owner is detected.
    if (workspace || manifest?.workspaces || path.dirname(directory) === directory) return { records, tokens };
    directory = path.dirname(directory);
  }
  fail('REPORT_LIMIT');
}
function resolutionStart(root, configFile, outDir) {
  try {
    const excluded = [outDir].filter(Boolean), snapshot = scan(root, { excluded });
    const config = snapshot.records.find(row => path.resolve(root, row.file) === configFile);
    if (!config) fail('REPORT_INPUT_UNBOUND');
    return { root, excluded, snapshot, workspace: workspaceControls(root) };
  } catch (error) { return { error: error.code || 'REPORT_INPUT_UNBOUND' }; }
}
function retainResolution(project, receipt) { RESOLUTIONS.set(project, receipt); return project; }
function packageRoot(name, from) {
  const resolve = createRequire(path.join(from, '__pulse_report__.cjs')).resolve;
  let entry;
  try { entry = resolve(name + '/package.json'); }
  catch { try { entry = resolve(name); } catch { return null; } }
  let directory = path.dirname(fs.realpathSync(entry));
  for (;;) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const manifest = JSON.parse(readFile(directory, 'package.json').bytes);
      if (manifest.name === name) return { root: directory, manifest };
    }
    const parent = path.dirname(directory); if (parent === directory) return null; directory = parent;
  }
}
function dependencyRoots(projectRoot, host) {
  const cliRoot = path.resolve(__dirname, '../../..');
  const release = JSON.parse(readFile(cliRoot, 'release-manifest.json').bytes);
  // The compiler's source-checkout lowerers need not be Node-resolvable. Bind
  // only exact catalog directories in a matching Pulse checkout; this reads
  // package data and never imports lowerer manifests or grants compiler trust.
  const checkout = path.resolve(cliRoot, '../../..');
  let sourcePackages = new Map();
  const cli = release.packages.find(pkg => pkg.name === '@pulse-compute/cli');
  if (cli && path.resolve(checkout, cli.dir) === cliRoot
    && fs.existsSync(path.join(checkout, 'release/pulse-release-manifest.json'))
    && digest(JSON.parse(readFile(checkout, 'release/pulse-release-manifest.json').bytes)) === digest(release)) {
    sourcePackages = new Map(release.packages.map(pkg => [pkg.name, pkg.dir]));
  }
  function sourcePackage(name) {
    const directory = sourcePackages.get(name); if (!directory) return null;
    relativePath(directory);
    const manifest = JSON.parse(readFile(checkout, directory + '/package.json').bytes);
    if (manifest.name !== name) fail('REPORT_INPUT_UNBOUND');
    return { root: path.join(checkout, directory), manifest };
  }
  const roots = new Map();
  function add(name, from) {
    const pkg = packageRoot(name, from) || sourcePackage(name); if (!pkg) return;
    const key = name + '@' + pkg.manifest.version;
    if (roots.has(key)) {
      if (roots.get(key).root !== pkg.root) fail('REPORT_INPUT_UNBOUND');
      return;
    }
    roots.set(key, { ...pkg, name, from: from === projectRoot ? 'project' : 'toolchain' });
    for (const dependency of Object.keys(pkg.manifest.dependencies || {}).sort()) add(dependency, pkg.root);
  }
  for (const pkg of release.packages) add(pkg.name, projectRoot);
  add('@pulse-compute/cli', cliRoot);
  // Exact configured provider resolution only; no provider discovery or loading.
  if (host) add(host.startsWith('@') ? host : '@pulse-compute/provider-' + host, projectRoot);
  return roots;
}
function toolchainSnapshot(projectRoot, host) {
  const roots = dependencyRoots(projectRoot, host), groups = [], snapshots = new Map();
  for (const [key, pkg] of [...roots].sort(([a], [b]) => a < b ? -1 : 1)) {
    const snapshot = scan(pkg.root, { packageFiles: true });
    groups.push({ key, name: pkg.name, version: pkg.manifest.version, records: snapshot.records });
    snapshots.set(key, { root: pkg.root, snapshot });
  }
  if (!groups.some(row => row.name === '@pulse-compute/wasm-compiler')) fail('REPORT_INPUT_UNBOUND');
  return { groups, snapshots };
}
function dependencyRecords(groups) {
  return groups.map(({ key, name, version, records }) => ({ key, name, version, files: records.length, sha256: digest(records) }));
}
function mode(options = {}) {
  const value = options.experimentalNativeBoundedSize ? 'experimental-native-bounded-size'
    : options.experimentalNativeSize ? 'experimental-native-size' : options.nativeOptimization?.mode || options.nativeOptimization || 'default';
  if (!['default', 'experimental-native-size', 'experimental-native-bounded-size'].includes(value)) fail('REPORT_INPUT_UNBOUND');
  return value;
}
function selectedProfile(project) { return project.selectedProfile?.name || project.profile?.name || 'native'; }
function profileDigest(plan) {
  // Selection source (CLI/env/default) does not change the chosen profile.
  const { profile, planHash, ...rest } = plan;
  const { source, ...selection } = profile;
  return digest({ ...rest, profile: selection });
}
function beginSnapshot(project, options, outDir) {
  const receipt = RESOLUTIONS.get(project);
  if (!receipt || receipt.error || options.compiled || !project.profilePlan) fail(receipt?.error || 'REPORT_INPUT_UNBOUND');
  const excluded = [...new Set([...receipt.excluded, outDir].map(file => path.resolve(project.root, file)))];
  // Resolution and build must describe the same output exclusion.
  if (!receipt.excluded.some(file => path.resolve(project.root, file) === outDir)) fail('REPORT_INPUT_UNBOUND');
  const current = scan(project.root, { excluded }); sameSnapshot(receipt.snapshot, current);
  const workspace = workspaceControls(project.root); sameSnapshot(receipt.workspace, workspace);
  const dependencies = toolchainSnapshot(project.root, project.providerSelector || project.provider);
  return { receipt, current, workspace, dependencies, excluded, optimization: mode(options),
    profileSha256: profileDigest(project.profilePlan) };
}
function finishSnapshot(project, attempt, compiled) {
  const current = scan(project.root, { excluded: attempt.excluded }); sameSnapshot(attempt.current, current);
  sameSnapshot(attempt.workspace, workspaceControls(project.root));
  const files = new Map(current.records.map(row => [path.resolve(project.root, row.file), row]));
  for (const { root, snapshot } of attempt.dependencies.snapshots.values()) {
    const after = scan(root, { packageFiles: true }); sameSnapshot(snapshot, after);
    for (const row of after.records) files.set(path.join(root, row.file), row);
  }
  for (const file of compiled.watchFiles || []) if (!files.has(fs.realpathSync(file))) fail('REPORT_INPUT_UNBOUND');
  for (const module of compiled.reachableGraph?.modules || []) if (module.kind === 'project') {
    const row = files.get(path.resolve(project.root, module.path));
    if (!row || row.sha256 !== module.contentHash) fail('REPORT_STALE_INPUTS');
  }
  const inputs = { kind: 'pulse.report-inputs', inputVersion: 1, excluded: attempt.excluded.map(file => {
    const relative = slash(path.relative(project.root, path.resolve(project.root, file))); relativePath(relative); return relative;
  }).sort(), files: current.records, workspace: attempt.workspace.records, dependencies: dependencyRecords(attempt.dependencies.groups) };
  const recipe = { optimization: attempt.optimization, node: process.versions.node,
    dependencies: attempt.dependencies.groups.map(({ key, records }) => ({ key, sha256: digest(records) })) };
  inputs.recipe = recipe;
  return { inputs, recipe, snapshot: { inputsSha256: digest(inputs), profileSha256: attempt.profileSha256, recipeSha256: digest(recipe) } };
}
module.exports = { scan, sameSnapshot, workspaceControls, resolutionStart, retainResolution, beginSnapshot, finishSnapshot,
  toolchainSnapshot, dependencyRecords, selectedProfile, profileDigest, digest, mode };
