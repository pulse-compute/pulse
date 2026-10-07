'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LIMITS, parseJson, canonicalJson, sha256, fail, freeze, relativePath } = require('./data');
const { readFile, checkedPath, atomicWrite, syncDirectory } = require('./files');
const { beginSnapshot, finishSnapshot, scan, workspaceControls, toolchainSnapshot, dependencyRecords, profileDigest, digest, mode } = require('./snapshot');
const { collectInventory } = require('./inventory');
const { artifactId, serializeCapsule, parseCapsule } = require('./capsule');
const { classifyInput, admitCompletedBuild } = require('./completion');
const { completionSchema, fileSchema } = require('./schema');
const { validate } = require('./validate');
const COMPLETION_FILE = 'pulse-report-completion.json';
const INVENTORY_FILE = 'pulse-report-inventory.json';
const INPUTS_FILE = 'pulse-report-inputs.json';
const UNAVAILABLE_SNAPSHOT = new Set(['REPORT_INPUT_UNBOUND', 'REPORT_INPUT_SYMLINK', 'REPORT_LIMIT', 'REPORT_STALE_INPUTS', 'REPORT_CONCURRENT_CHANGE']);
const ensure = (condition, code) => { if (!condition) fail(code); };
function invalidate(outDir) {
  if (!fs.existsSync(outDir)) return;
  // The caller has already resolved the physically contained output directory.
  const file = path.join(outDir, COMPLETION_FILE);
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('REPORT_PATH');
  fs.rmSync(file, { force: true });
}
function acquireBuildLock(project, outDir) {
  const directory = '.pulse-report-locks', relative = directory + '/' + sha256(path.relative(project.root, outDir)) + '.lock';
  const lockDir = path.join(project.root, directory);
  fs.mkdirSync(lockDir, { recursive: true }); checkedPath(project.root, directory);
  const file = path.join(project.root, relative), token = require('node:crypto').randomBytes(16).toString('hex');
  // A new attempt supersedes the previous generation, including an abandoned
  // process. Publication checks ownership twice; a superseded writer cannot
  // publish or invalidate another attempt's completion. Avoid PID-based stale
  // lock reclamation, which races new writers and is unsafe under PID reuse.
  atomicWrite(project.root, relative, Buffer.from(JSON.stringify({ token })));
  function release() {
    try { if (parseJson(readFile(project.root, relative, 4096).bytes).token === token) { fs.unlinkSync(file); syncDirectory(lockDir); } } catch { /* Never unlink another writer's lease. */ }
    process.removeListener('exit', release);
  }
  process.once('exit', release);
  release.verify = () => ensure(parseJson(readFile(project.root, relative, 4096).bytes).token === token, 'REPORT_CONCURRENT_BUILD');
  return release;
}
function beginBuild(project, options, outDir) {
  invalidate(outDir);
  if ((project.target || 'native') !== 'native' && options.operation !== 'compile') return { error: 'REPORT_UNSUPPORTED_TARGET' };
  try { return { snapshot: beginSnapshot(project, options, outDir) }; }
  catch (error) {
    return { error: error.code || 'REPORT_INPUT_UNBOUND' };
  }
}
function fileLink(file, bytes) { return { file, bytes: bytes.length, sha256: sha256(bytes) }; }
function artifactRecords(outDir, manifest) {
  const portable = manifest.native?.wasm || manifest.portable?.wasm;
  const target = manifest.status === 'compiled' ? portable : manifest.providerTarget?.wasm;
  const primary = target?.file ? target : target && portable && target.sha256 === portable.sha256 && target.bytes === portable.bytes ? portable : null;
  ensure(primary, 'REPORT_MISSING_ARTIFACT');
  const candidates = [{ ...primary, stage: 'final', target: manifest.providerTarget?.target || 'portable-native-wasm' }];
  if (portable && portable.sha256 !== primary.sha256) candidates.push({ ...portable, stage: 'prelink', target: 'portable-native-wasm' });
  return candidates.map(reference => {
    validate({ file: reference.file, bytes: reference.bytes, sha256: reference.sha256 }, fileSchema);
    const read = readFile(outDir, reference.file);
    ensure(read.size === reference.bytes && read.sha256 === reference.sha256 && WebAssembly.validate(read.bytes), 'REPORT_ARTIFACT_HASH');
    return { id: artifactId(read.sha256), file: reference.file, bytes: read.size, sha256: read.sha256, stage: reference.stage, target: reference.target };
  });
}
function publishBuild(project, prepared, manifest, manifestFile, outDir, attempt) {
  attempt.assertLease?.();
  if (attempt.error) {
    const result = Object.freeze({ ...manifest, reportEvidence: Object.freeze({ status: 'unavailable', reason: attempt.error }) });
    atomicWrite(outDir, path.basename(manifestFile), Buffer.from(JSON.stringify(result, null, 2) + '\n'));
    return result;
  }
  let retained;
  try { retained = finishSnapshot(project, attempt.snapshot, prepared.compiled); }
  catch (error) {
    if (!UNAVAILABLE_SNAPSHOT.has(error.code)) throw error;
    return publishBuild(project, prepared, manifest, manifestFile, outDir, { ...attempt, error: error.code });
  }
  const artifacts = artifactRecords(outDir, manifest);
  const capsule = collectInventory(project, prepared, artifacts, artifacts[0].id, attempt.snapshot.optimization);
  const inventory = Buffer.from(serializeCapsule(capsule)), inputs = Buffer.from(canonicalJson(retained.inputs) + '\n');
  const completion = { kind: 'pulse.report-completion', completionVersion: 1, status: 'complete',
    operation: manifest.status === 'compiled' ? 'compile' : 'native-build', manifestVersion: manifest.version,
    context: capsule.context, snapshot: retained.snapshot,
    artifacts: artifacts.map(({ target, ...row }) => row),
    sidecars: [{ ...fileLink(INVENTORY_FILE, inventory), kind: 'inventory', version: 1, required: true }] };
  const completionBytes = Buffer.from(canonicalJson(completion) + '\n');
  const result = Object.freeze({ ...manifest, reportInputs: Object.freeze(fileLink(INPUTS_FILE, inputs)),
    reportCompletion: Object.freeze(fileLink(COMPLETION_FILE, completionBytes)) });
  const files = new Map(artifacts.map(row => [row.file, readFile(outDir, row.file).bytes])); files.set(INVENTORY_FILE, inventory);
  // Existing execution manifests contain optional undefined properties in
  // memory. Admit their actual JSON wire representation, as replay will do.
  admitCompletedBuild(JSON.parse(JSON.stringify(result)), completionBytes, { files });
  atomicWrite(outDir, INVENTORY_FILE, inventory); atomicWrite(outDir, INPUTS_FILE, inputs);
  atomicWrite(outDir, path.basename(manifestFile), Buffer.from(JSON.stringify(result, null, 2) + '\n'));
  // Revalidate after every required write; marker publication is the commit.
  artifactRecords(outDir, result);
  try { finishSnapshot(project, attempt.snapshot, prepared.compiled); }
  catch (error) {
    if (!UNAVAILABLE_SNAPSHOT.has(error.code)) throw error;
    return publishBuild(project, prepared, manifest, manifestFile, outDir, { ...attempt, error: error.code });
  }
  attempt.assertLease?.();
  atomicWrite(outDir, COMPLETION_FILE, completionBytes);
  return result;
}
function readCompleted(manifestFile) {
  const root = path.dirname(path.resolve(manifestFile)), reads = new Map();
  function read(file, maximum) {
    if (reads.has(file)) return reads.get(file);
    const record = readFile(root, file, maximum); reads.set(file, record); return record;
  }
  const manifestRead = read(path.basename(manifestFile), LIMITS.bytes), candidate = classifyInput(manifestRead.bytes);
  if (candidate.kind === 'historical-capsule') return { kind: 'historical-capsule', capsule: candidate.capsule, currentSnapshotMatched: false };
  const manifest = candidate.manifest;
  ensure(manifest.reportCompletion, 'REPORT_MISSING_COMPLETION'); validate(manifest.reportCompletion, fileSchema);
  const completionBytes = read(manifest.reportCompletion.file, LIMITS.bytes).bytes, completion = parseJson(completionBytes);
  validate(completion, completionSchema);
  const files = new Map();
  for (const record of [...completion.artifacts, ...completion.sidecars]) {
    try { files.set(record.file, read(record.file, record.kind ? LIMITS.bytes : undefined).bytes); }
    catch (error) { if (record.required !== false || error.code !== 'REPORT_MISSING_ARTIFACT') throw error; }
  }
  const admitted = admitCompletedBuild(manifest, completionBytes, { files });
  const inventory = completion.sidecars.find(row => row.kind === 'inventory');
  const capsule = parseCapsule(files.get(inventory.file));
  function verifyReads() {
    for (const [file, expected] of reads) {
      const current = readFile(root, file);
      ensure(current.token === expected.token && current.sha256 === expected.sha256, 'REPORT_CONCURRENT_CHANGE');
    }
  }
  verifyReads();
  return { ...admitted, capsule, manifest, root, reads, read, verifyReads };
}
function collectArtifactReport(manifestFile) {
  const collected = readCompleted(manifestFile);
  return freeze({ kind: collected.kind, capsule: collected.capsule, currentSnapshotMatched: false,
    missingOptionalSidecars: collected.missingOptionalSidecars || [] });
}
function collectProjectReport(options = {}) {
  // These owners discover/parse data. They never evaluate config or application
  // modules, import a test harness, load providers or invoke a Native compiler.
  const workspace = require('../../workspace').resolveWorkspace(options);
  ensure(workspace, 'REPORT_INPUT_UNBOUND');
  const root = workspace.root, configRelative = path.relative(root, workspace.configFile).split(path.sep).join('/');
  const config = readFile(root, configRelative, LIMITS.bytes);
  const { compileProjectConfigSource } = require('@pulse-compute/wasm-compiler/project-config-compiler');
  const plan = compileProjectConfigSource(config.bytes.toString('utf8'), { file: workspace.configFile, source: configRelative,
    selection: { cliProfile: options.profile, environmentProfile: options.env?.PULSE_PROFILE ?? process.env.PULSE_PROFILE } }).plan;
  const outDir = path.resolve(root, options.outDir || plan.fragments.outDir || 'dist');
  const outRelative = path.relative(root, outDir).split(path.sep).join('/'); relativePath(outRelative); checkedPath(root, outRelative);
  const marker = readFile(outDir, COMPLETION_FILE, LIMITS.bytes), completion = parseJson(marker.bytes); validate(completion, completionSchema);
  const manifestFile = path.join(outDir, completion.operation === 'compile' ? 'pulse-compile.json' : 'pulse-build.json');
  const collected = readCompleted(manifestFile);
  ensure(collected.kind === 'completed-wasm' && collected.completion.context.profile === plan.profile.name, 'REPORT_IDENTITY');
  const link = collected.manifest.reportInputs; ensure(link, 'REPORT_MISSING_SIDECAR'); validate(link, fileSchema);
  const record = collected.read(link.file, LIMITS.bytes);
  ensure(record.size === link.bytes && record.sha256 === link.sha256, 'REPORT_ARTIFACT_HASH');
  const inputs = parseJson(record.bytes);
  ensure(inputs.kind === 'pulse.report-inputs' && inputs.inputVersion === 1, 'REPORT_INPUT_VERSION');
  ensure(Array.isArray(inputs.files) && Array.isArray(inputs.workspace) && Array.isArray(inputs.dependencies) && inputs.recipe
    && typeof inputs.recipe === 'object' && typeof inputs.recipe.optimization === 'string', 'REPORT_INPUT_VERSION');
  mode({ nativeOptimization: inputs.recipe.optimization });
  ensure(digest(inputs) === completion.snapshot.inputsSha256 && profileDigest(plan) === completion.snapshot.profileSha256, 'REPORT_STALE_INPUTS');
  ensure(canonicalJson(inputs.excluded) === canonicalJson([outRelative]), 'REPORT_INPUT_UNBOUND');
  const projectSnapshot = scan(root, { excluded: [outDir] });
  ensure(canonicalJson(projectSnapshot.records) === canonicalJson(inputs.files), 'REPORT_STALE_INPUTS');
  const workspaceSnapshot = workspaceControls(root);
  ensure(canonicalJson(workspaceSnapshot.records) === canonicalJson(inputs.workspace), 'REPORT_STALE_INPUTS');
  const dependencies = toolchainSnapshot(root, plan.profile.host);
  ensure(canonicalJson(dependencyRecords(dependencies.groups)) === canonicalJson(inputs.dependencies), 'REPORT_STALE_INPUTS');
  const recipe = { optimization: inputs.recipe.optimization, node: process.versions.node,
    dependencies: dependencies.groups.map(({ key, records }) => ({ key, sha256: digest(records) })) };
  if (options.optimization !== undefined) ensure(mode({ nativeOptimization: options.optimization }) === recipe.optimization, 'REPORT_STALE_INPUTS');
  ensure(digest(recipe) === completion.snapshot.recipeSha256, 'REPORT_STALE_INPUTS');
  ensure(config.token === readFile(root, configRelative).token, 'REPORT_CONCURRENT_CHANGE');
  // Detect changes during the collection itself, even if bytes were restored.
  const after = scan(root, { excluded: [outDir] }); require('./snapshot').sameSnapshot(projectSnapshot, after);
  require('./snapshot').sameSnapshot(workspaceSnapshot, workspaceControls(root));
  for (const { root: directory, snapshot } of dependencies.snapshots.values()) require('./snapshot').sameSnapshot(snapshot, scan(directory, { packageFiles: true }));
  ensure(marker.token === readFile(outDir, COMPLETION_FILE).token, 'REPORT_CONCURRENT_CHANGE');
  collected.verifyReads();
  return freeze({ kind: 'completed-wasm', capsule: collected.capsule, currentSnapshotMatched: true,
    missingOptionalSidecars: collected.missingOptionalSidecars });
}
module.exports = { COMPLETION_FILE, INVENTORY_FILE, INPUTS_FILE, invalidate, acquireBuildLock, beginBuild, publishBuild, collectArtifactReport, collectProjectReport };
