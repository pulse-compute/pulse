'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cli = path.join(repoRoot, 'wasm', 'scripts', 'pulse.cjs');

function run(args, cwd, options = {}) {
  const captureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-capture-'));
  const stdoutFile = path.join(captureRoot, 'stdout.txt');
  const stderrFile = path.join(captureRoot, 'stderr.txt');
  const stdoutFd = fs.openSync(stdoutFile, 'w');
  const stderrFd = fs.openSync(stderrFile, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [cli, ...args], {
      cwd,
      timeout: options.timeout || 30000,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  const stdout = fs.readFileSync(stdoutFile, 'utf8');
  const stderr = fs.readFileSync(stderrFile, 'utf8');
  fs.rmSync(captureRoot, { recursive: true, force: true });
  return { ...result, stdout, stderr, output: [null, stdout, stderr] };
}

function parseJson(result, stream = 'stdout') {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result[stream]);
}

function parseError(result, expectedStatus = 2) {
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stderr);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.once('error', reject);
  });
}

function waitForJsonEvent(child, eventName, stderrText) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for pulse dev ${eventName}. stderr=${stderrText()}`)), 15000);
    function finish(error, value) {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      error ? reject(error) : resolve(value);
    }
    function onData(chunk) {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let value;
        try { value = JSON.parse(line); }
        catch (error) { finish(new Error(`Invalid JSON line from pulse dev: ${line}`)); return; }
        if (value.event === eventName) { finish(undefined, value); return; }
      }
    }
    function onError(error) { finish(error); }
    function onExit(code, signal) {
      if (code !== 0) finish(new Error(`pulse dev exited ${code} (${signal || 'no signal'}) before ${eventName}. stderr=${stderrText()}`));
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function waitForClose(child, stderrText) {
  if (child.exitCode !== null && child.stdout.destroyed && child.stderr.destroyed) {
    return child.exitCode === 0 ? Promise.resolve() : Promise.reject(new Error(`pulse dev exited ${child.exitCode}. stderr=${stderrText()}`));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pulse dev did not close. stderr=${stderrText()}`));
    }, 15000);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`pulse dev exited ${code} (${signal || 'no signal'}). stderr=${stderrText()}`));
    });
  });
}

function spawnDev(args, cwd, children) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return { child, stderrText: () => stderr };
}

async function closeServer(server, sockets = new Set()) {
  if (!server) return;
  const closed = new Promise((resolve) => server.close(resolve));
  for (const socket of sockets) socket.destroy();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  server.unref();
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
}

module.exports = {
  repoRoot,
  cli,
  run,
  parseJson,
  parseError,
  listen,
  request,
  waitForJsonEvent,
  waitForClose,
  spawnDev,
  closeServer
};
