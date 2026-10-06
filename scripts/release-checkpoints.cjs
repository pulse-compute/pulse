'use strict';

// Local seal recovery evidence. These receipts are neither signatures nor a
// cache across candidates: the caller supplies the complete candidate context.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'pulse.release-checkpoint.v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Checkpoint inputs must contain only JSON values');
}

function object(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} must be an object`);
  canonical(value);
  return value;
}

function below(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function ordinaryPath(filename, allowMissing = false) {
  const resolved = path.resolve(filename);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Non-ordinary checkpoint path: ${current}`);
  }
  return resolved;
}

function fileSet(root, requirePrivateCopies = false) {
  ordinaryPath(root);
  const entries = [];
  function visit(filename, relative) {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error(`Checkpoint artifact contains a symlink: ${filename}`);
    const entry = { path: relative, mode: stat.mode & 0o777 };
    if (stat.isDirectory()) {
      entries.push({ ...entry, type: 'directory' });
      for (const name of fs.readdirSync(filename).sort()) visit(path.join(filename, name), relative === '.' ? name : `${relative}/${name}`);
    } else if (stat.isFile()) {
      if (requirePrivateCopies && stat.nlink !== 1) throw new Error(`Checkpoint artifact is not a private copy: ${filename}`);
      const bytes = fs.readFileSync(filename);
      entries.push({ ...entry, type: 'file', size: bytes.length, sha256: hash(bytes) });
    } else throw new Error(`Checkpoint artifact is not a regular file or directory: ${filename}`);
  }
  visit(root, '.');
  return entries;
}

function copyOrdinary(source, destination) {
  ordinaryPath(source);
  ordinaryPath(destination, true);
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source).sort()) copyOrdinary(path.join(source, name), path.join(destination, name));
    fs.chmodSync(destination, stat.mode & 0o777);
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, stat.mode & 0o777);
  } else throw new Error(`Cannot copy non-ordinary artifact: ${source}`);
}

function reusableResult(result) {
  const empty = (value) => value == null || (Array.isArray(value) && value.length === 0);
  return result?.status === 'passed' && result.exitCode === 0 &&
    result.cleanup?.status === 'passed' && !result.cleanupFailure &&
    empty(result.cleanupFailures) && !result.timedOut && !result.cancelled && !result.interruptedBy && !result.forcedCompletion &&
    !result.signal && !result.retainedTaskRoot && !result.error &&
    !result.cleanup.error && !result.cleanup.retainedTaskRoot &&
    empty(result.remainingProcessTree) && empty(result.cleanup.remainingProcessTree);
}

const fingerprint = (value) => hash(canonical(value));

function readCheckpointReceipt({ receiptPath, context, definition, dependencies, requirePassed = true }) {
  object(context, 'Expected checkpoint context');
  if (typeof receiptPath !== 'string' || !path.isAbsolute(receiptPath)) throw new Error('Checkpoint receipt path must be absolute');
  ordinaryPath(receiptPath);
  const stat = fs.lstatSync(receiptPath);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Checkpoint receipt is not a private regular file');
  const envelope = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const receipt = envelope.receipt;
  if (!receipt || envelope.sha256 !== fingerprint(receipt)) throw new Error('Checkpoint receipt digest mismatch');
  if (receipt.schema !== SCHEMA) throw new Error('Checkpoint receipt schema mismatch');
  if (typeof receipt.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(receipt.id) || path.basename(receiptPath) !== `${hash(receipt.id)}.json`) throw new Error('Checkpoint receipt identity mismatch');
  if (typeof receipt.proofId !== 'string' || !receipt.proofId || typeof receipt.originDirectory !== 'string' || !path.isAbsolute(receipt.originDirectory)) throw new Error('Checkpoint proof identity missing');
  if (receipt.contextHash !== fingerprint(context) || fingerprint(receipt.context) !== receipt.contextHash) throw new Error('Checkpoint context changed');
  if (definition !== undefined && receipt.definitionHash !== fingerprint(definition)) throw new Error('Checkpoint task definition changed');
  if (dependencies !== undefined && canonical(receipt.dependencies) !== canonical(dependencies)) throw new Error('Checkpoint dependency proof changed');
  if (!['executed', 'reused'].includes(receipt.disposition) || (receipt.disposition === 'executed' && receipt.reusedFrom !== null) || (receipt.disposition === 'reused' && (!receipt.reusedFrom?.directory || !receipt.reusedFrom.receiptSha256))) throw new Error('Checkpoint provenance is invalid');
  if (receipt.disposition === 'executed' && receipt.originDirectory !== path.dirname(receiptPath)) throw new Error('Executed checkpoint moved outside its original attempt');
  if (receipt.disposition === 'reused' && (!path.isAbsolute(receipt.reusedFrom.directory) || receipt.reusedFrom.directory === path.dirname(receiptPath))) throw new Error('Reused checkpoint predecessor is invalid');
  if (requirePassed && !reusableResult(receipt.result)) throw new Error('Checkpoint did not pass with successful cleanup');
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > Date.now() || expires <= Date.now() || expires > created + RETENTION_MS) throw new Error('Checkpoint expired or has invalid retention');
  if (!Array.isArray(receipt.artifacts)) throw new Error('Checkpoint artifact set missing');
  const keys = new Set();
  for (const artifact of receipt.artifacts) {
    if (typeof artifact.key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(artifact.key) || keys.has(artifact.key)) throw new Error('Checkpoint artifact identity is invalid');
    keys.add(artifact.key);
    const source = path.join(path.dirname(receiptPath), hash(receipt.id), artifact.key);
    if (canonical(fileSet(source, true)) !== canonical(artifact.entries)) throw new Error(`Checkpoint artifact changed: ${artifact.key}`);
  }
  return { receipt, receiptPath, receiptSha256: envelope.sha256, proofId: receipt.proofId };
}

function createCheckpointStore({ directory, previousDirectory = null, context, expiresAt = null }) {
  object(context, 'Checkpoint context');
  if (Object.keys(context).length === 0) throw new Error('Checkpoint context cannot be empty');
  directory = ordinaryPath(directory, true);
  previousDirectory = previousDirectory ? ordinaryPath(previousDirectory, true) : null;
  if (previousDirectory && (below(directory, previousDirectory) || below(previousDirectory, directory))) {
    throw new Error('Checkpoint attempts must have separate directories');
  }
  fs.mkdirSync(directory, { recursive: true });
  const contextHash = hash(canonical(context));
  const expiryLimit = expiresAt === null ? Infinity : Date.parse(expiresAt);
  if (Number.isNaN(expiryLimit)) throw new Error('Invalid checkpoint expiry');

  function inputs({ id, definition, dependencies = {}, artifacts = {} }) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) throw new Error('Invalid checkpoint id');
    if (definition === undefined) throw new Error('A checkpoint requires its task definition');
    object(dependencies, 'Checkpoint dependencies');
    for (const value of Object.values(dependencies)) if (typeof value !== 'string' || !value) throw new Error('Dependencies must name exact proof identities');
    object(artifacts, 'Checkpoint artifacts');
    const destinations = Object.entries(artifacts).map(([key, target]) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key)) throw new Error(`Invalid artifact key: ${key}`);
      if (typeof target !== 'string' || !path.isAbsolute(target) || path.resolve(target) === path.parse(target).root) throw new Error(`Artifact ${key} needs an absolute non-root target`);
      const resolved = ordinaryPath(target, true);
      for (const store of [directory, previousDirectory].filter(Boolean)) {
        if (below(resolved, store) || below(store, resolved)) throw new Error(`Artifact ${key} overlaps checkpoint storage`);
      }
      return [key, resolved];
    });
    for (let index = 0; index < destinations.length; index++) {
      for (const [, other] of destinations.slice(index + 1)) {
        if (below(destinations[index][1], other) || below(other, destinations[index][1])) throw new Error('Artifact targets must not overlap');
      }
    }
    return { id, definitionHash: hash(canonical(definition)), dependencies: JSON.parse(canonical(dependencies)), artifacts: Object.fromEntries(destinations), key: hash(id) };
  }

  function load(base, key) {
    const filename = path.join(base, `${key}.json`);
    const validated = readCheckpointReceipt({ receiptPath: filename, context, requirePassed: false });
    return { receipt: validated.receipt, sha256: validated.receiptSha256 };
  }

  function write(receipt, key, snapshotFrom) {
    const filename = path.join(directory, `${key}.json`);
    if (fs.existsSync(filename) || fs.existsSync(path.join(directory, key))) throw new Error(`Checkpoint ${receipt.id} already recorded in this attempt`);
    const temporary = fs.mkdtempSync(path.join(directory, '.checkpoint-'));
    try {
      for (const artifact of receipt.artifacts) {
        const destination = path.join(temporary, artifact.key);
        copyOrdinary(snapshotFrom(artifact), destination);
        if (canonical(fileSet(destination, true)) !== canonical(artifact.entries)) throw new Error(`Artifact changed while checkpointing: ${artifact.key}`);
      }
      fs.renameSync(temporary, path.join(directory, key));
      const envelope = { receipt, sha256: hash(canonical(receipt)) };
      const tempReceipt = `${filename}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(tempReceipt, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(tempReceipt, filename);
      return { proofId: receipt.proofId, receipt, receiptPath: filename, receiptSha256: envelope.sha256 };
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  function record(options) {
    object(options.result, 'Checkpoint result');
    const passed = reusableResult(options.result);
    // A task failure must remain recordable even when its incomplete outputs
    // are missing or unsafe. Failed receipts carry metadata only and never hit.
    const input = inputs(passed ? options : { ...options, artifacts: {} });
    const artifacts = passed ? Object.entries(input.artifacts).sort(([left], [right]) => left.localeCompare(right)).map(([key, target]) => ({ key, entries: fileSet(target) })) : [];
    const createdAt = new Date().toISOString();
    const receipt = {
      schema: SCHEMA,
      id: input.id,
      proofId: crypto.randomUUID(),
      context: JSON.parse(canonical(context)),
      contextHash,
      definitionHash: input.definitionHash,
      dependencies: input.dependencies,
      createdAt,
      expiresAt: new Date(Math.min(Date.parse(createdAt) + RETENTION_MS, expiryLimit)).toISOString(),
      originDirectory: directory,
      disposition: 'executed',
      reusedFrom: null,
      result: JSON.parse(canonical(options.result)),
      artifacts,
    };
    return write(receipt, input.key, (artifact) => input.artifacts[artifact.key]);
  }

  function tryReuse(options) {
    let input;
    try { input = inputs(options); } catch (error) { return { reused: false, reason: `unsafe-input: ${error.message}` }; }
    if (!previousDirectory) return { reused: false, reason: 'no-previous-attempt' };
    try {
      if (fs.existsSync(path.join(directory, `${input.key}.json`)) || fs.existsSync(path.join(directory, input.key))) throw new Error(`Checkpoint ${input.id} already recorded in this attempt`);
      const envelope = load(previousDirectory, input.key);
      const prior = envelope.receipt;
      if (prior.id !== input.id || !prior.proofId || !prior.originDirectory) throw new Error('Checkpoint identity mismatch');
      if (prior.contextHash !== contextHash || hash(canonical(prior.context)) !== contextHash) throw new Error('Checkpoint context changed');
      if (prior.definitionHash !== input.definitionHash) throw new Error('Checkpoint task definition changed');
      if (canonical(prior.dependencies) !== canonical(input.dependencies)) throw new Error('Checkpoint dependency proof changed');
      if (!reusableResult(prior.result)) throw new Error('Checkpoint did not pass with successful cleanup');
      const created = Date.parse(prior.createdAt);
      const expires = Date.parse(prior.expiresAt);
      if (!Number.isFinite(created) || !Number.isFinite(expires) || created > Date.now() || expires <= Date.now() || expires > created + RETENTION_MS) throw new Error('Checkpoint expired or has invalid retention');
      if (!Array.isArray(prior.artifacts) || canonical(prior.artifacts.map((artifact) => artifact.key).sort()) !== canonical(Object.keys(input.artifacts).sort())) throw new Error('Checkpoint artifact set changed');
      const validatedSources = new Map();
      for (const artifact of prior.artifacts) {
        const source = path.join(previousDirectory, input.key, artifact.key);
        validatedSources.set(artifact.key, source);
      }
      // Verify the entire receipt and output set before replacing any output.
      // Destinations are caller-owned outputs; parent/symlink checks above apply
      // again immediately before replacement. Copies never share mutable inodes.
      const stages = [];
      try {
        for (const artifact of prior.artifacts) {
          const target = input.artifacts[artifact.key];
          ordinaryPath(target, true);
          if (fs.existsSync(target)) fileSet(target);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const staging = fs.mkdtempSync(path.join(path.dirname(target), '.checkpoint-restore-'));
          stages.push({ staging, target, source: path.join(staging, 'output') });
          copyOrdinary(validatedSources.get(artifact.key), path.join(staging, 'output'));
          if (canonical(fileSet(path.join(staging, 'output'), true)) !== canonical(artifact.entries)) throw new Error(`Checkpoint artifact changed during restore: ${artifact.key}`);
        }
        for (const stage of stages) {
          ordinaryPath(stage.target, true);
          fs.rmSync(stage.target, { force: true, recursive: true });
          fs.renameSync(stage.source, stage.target);
        }
      } finally { for (const stage of stages) fs.rmSync(stage.staging, { force: true, recursive: true }); }
      const receipt = { ...prior, disposition: 'reused', reusedFrom: { directory: previousDirectory, receiptSha256: envelope.sha256 } };
      const written = write(receipt, input.key, (artifact) => validatedSources.get(artifact.key));
      return { reused: true, reason: 'verified-checkpoint', ...written, result: receipt.result };
    } catch (error) {
      return { reused: false, reason: error.code === 'ENOENT' ? 'missing-checkpoint-or-artifact' : error.message };
    }
  }

  function describe(id) {
    try { return load(directory, hash(id)).receipt; } catch { return null; }
  }

  return { record, tryReuse, describe };
}

module.exports = { createCheckpointStore, readCheckpointReceipt, fingerprint, RETENTION_MS };
