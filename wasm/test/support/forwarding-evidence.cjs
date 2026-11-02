'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

function provenanceFailure(stage, status) {
  const error = new Error(`Forwarding source provenance capture failed (${stage}${status === undefined ? '' : ', exit ' + status}); no forwarding success is established.`);
  error.code = 'FWD9_PROVENANCE_FAILED';
  error.stage = stage;
  return error;
}

// Preserve exactly the bytes from the original `git diff HEAD` command. No
// output buffering, truncation, or replacement with an empty/clean digest.
function hashWorkingDiff(root, options = {}) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let child, failure, timer, settled = false;
    const finish = (error, digest) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(digest);
    };
    const stop = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* close/error remains the terminal authority */ }
    };
    try {
      child = (options.spawn || spawn)('git', ['diff', 'HEAD'], {
        cwd: root, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32'
      });
    } catch { finish(provenanceFailure('spawn')); return; }
    timer = setTimeout(() => { failure = provenanceFailure('timeout'); stop(); }, options.timeoutMs || 30000);
    child.once('error', () => finish(provenanceFailure('spawn')));
    child.stdout.on('data', bytes => hash.update(bytes));
    child.stdout.once('error', () => { failure = provenanceFailure('read'); stop(); });
    child.once('close', (status, signal) => {
      if (failure) finish(failure);
      else if (status !== 0 || signal) finish(provenanceFailure('git-diff', status));
      else finish(null, hash.digest('hex'));
    });
  });
}

function writeReport(root, report) {
  const parent = path.join(root, 'wasm/.test-results');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'fwd9-03-workspace-'));
  const file = path.join(directory, 'proof.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log('qualification report - ' + file);
  return file;
}

async function withForwardingEvidence({ root, initialize, run, publish = writeReport,
  remove = dir => fs.rmSync(dir, { recursive: true, force: true }),
  secondary = stage => console.error(`forwarding evidence: ${stage} failed; preserving the primary failure`) }) {
  const report = { version: 'pulse.fwd9-03-proof.v1', status: 'running' };
  let dir, primary, reportFile, failed = false;
  try {
    dir = fs.mkdtempSync(path.join(root, '.fwd9-forwarding-'));
    await initialize(report);
    await run(dir, report);
    report.status = 'passed';
  } catch (error) {
    primary = error; failed = true; report.status = 'failed'; report.error = String(error?.stack || error);
  }
  // Cleanup is independent of provenance and reporting, and owns only the exact
  // directory allocated above. Never let a secondary failure replace the first.
  try {
    if (dir) remove(dir);
    report.cleanup = { status: 'passed' };
  } catch (error) {
    report.cleanup = { status: 'failed' };
    report.status = 'failed';
    if (!failed) { primary = error; failed = true; report.error = String(error?.stack || error); }
    else { try { secondary('cleanup'); } catch { /* preserve primary */ } }
  }
  try { reportFile = publish(root, report); }
  catch (error) {
    report.status = 'failed'; report.reporting = { status: 'failed' };
    if (!failed) { primary = error; failed = true; report.error = String(error?.stack || error); }
    else { try { secondary('reporting'); } catch { /* preserve primary */ } }
  }
  if (failed) throw primary;
  return { report, reportFile };
}
module.exports = { hashWorkingDiff, withForwardingEvidence };
