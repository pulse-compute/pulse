'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const fastlyComputeRealityVersion = 'pulse.fastly-compute-reality.v3';
const maxCapturedLogBytes = 2 * 1024 * 1024;

class FastlyComputeRealityError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'FastlyComputeRealityError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function executable(file) {
  if (!file) return false;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

function pathCandidates(binaryName = 'fastly', env = process.env) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const extension = process.platform === 'win32' ? '.exe' : '';
  return String(env.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, `${binaryName}${extension}`));
}

function resolveFastlyCliBinary(options = {}) {
  const env = options.env || process.env;
  const candidates = [
    options.binary,
    env.PULSE_FASTLY_BIN,
    ...pathCandidates('fastly', env)
  ].filter(Boolean).map((entry) => path.resolve(String(entry)));
  const found = candidates.find(executable);
  if (!found) {
    throw new FastlyComputeRealityError(
      'PULSE_FASTLY_CLI_UNAVAILABLE',
      'The Fastly CLI is required for the Fastly Compute reality gate.',
      {
        searched: Object.freeze([...new Set(candidates)]),
        hint: 'Install the Fastly CLI with Homebrew, a supported package manager, or an official Fastly CLI release; then ensure `fastly` is on PATH. CI may set PULSE_FASTLY_BIN explicitly.'
      }
    );
  }
  return found;
}

function resolveViceroyBinary(options = {}) {
  const env = options.env || process.env;
  const candidates = [
    options.viceroyBinary,
    env.PULSE_VICEROY_BIN,
    ...pathCandidates('viceroy', env)
  ].filter(Boolean).map((entry) => path.resolve(String(entry)));
  const found = candidates.find(executable);
  if (!found) {
    throw new FastlyComputeRealityError(
      'PULSE_VICEROY_UNAVAILABLE',
      'The selected Viceroy override is unavailable.',
      {
        searched: Object.freeze([...new Set(candidates)]),
        hint: 'Point PULSE_VICEROY_BIN at an executable Viceroy binary, or unset it and provide the Fastly CLI through PULSE_FASTLY_BIN or PATH.'
      }
    );
  }
  return found;
}

function inspectViceroy(options = {}) {
  const binary = resolveViceroyBinary(options);
  const attempts = [['--version'], ['version']];
  const records = [];
  let selected;
  for (const args of attempts) {
    const result = spawnSync(binary, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      encoding: 'utf8',
      timeout: Number(options.timeoutMs || 10000),
      windowsHide: true
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    records.push(Object.freeze({ args: Object.freeze([...args]), status: result.status, output, message: result.error && result.error.message }));
    if (!result.error && result.status === 0) {
      selected = { args, output };
      break;
    }
  }
  if (!selected) {
    throw new FastlyComputeRealityError(
      'PULSE_VICEROY_INSPECTION_FAILED',
      `Unable to inspect Viceroy at ${binary}.`,
      { binary, attempts: Object.freeze(records) }
    );
  }
  const match = selected.output.match(/(?:viceroy(?:\s+version)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
  const env = options.env || process.env;
  return Object.freeze({
    binary,
    version: match ? match[1] : undefined,
    output: selected.output,
    args: Object.freeze([...selected.args]),
    source: options.viceroyBinary ? 'explicit' : env.PULSE_VICEROY_BIN ? 'environment' : 'path'
  });
}

function inspectFastlyCli(options = {}) {
  const binary = resolveFastlyCliBinary(options);
  const attempts = [['version'], ['--version']];
  const records = [];
  let selected;
  for (const args of attempts) {
    const result = spawnSync(binary, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      encoding: 'utf8',
      timeout: Number(options.timeoutMs || 10000),
      windowsHide: true
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    const match = output.match(/(?:fastly(?:\s+cli)?(?:\s+version)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i);
    const timedOutAfterCompleteOutput = result.error && result.error.code === 'ETIMEDOUT' && Boolean(match);
    records.push(Object.freeze({
      args: Object.freeze([...args]),
      status: result.status,
      output,
      message: result.error && result.error.message,
      completeVersionOutput: Boolean(match)
    }));
    if ((!result.error && result.status === 0) || timedOutAfterCompleteOutput) {
      selected = {
        args,
        output,
        version: match && match[1],
        termination: timedOutAfterCompleteOutput ? 'timeout-after-complete-version-output' : 'clean-exit'
      };
      break;
    }
  }
  if (!selected) {
    throw new FastlyComputeRealityError(
      'PULSE_FASTLY_CLI_INSPECTION_FAILED',
      `Unable to inspect the Fastly CLI at ${binary}.`,
      { binary, attempts: Object.freeze(records) }
    );
  }
  return Object.freeze({
    binary,
    version: selected.version,
    output: selected.output,
    args: Object.freeze([...selected.args]),
    termination: selected.termination,
    source: options.binary ? 'explicit' : (options.env || process.env).PULSE_FASTLY_BIN ? 'environment' : 'path'
  });
}

function inspectFastlyComputeLauncher(options = {}) {
  const env = options.env || process.env;
  const requestedKind = options.launcherKind;
  if (
    requestedKind !== undefined
    && requestedKind !== 'fastly-cli'
    && requestedKind !== 'viceroy-direct'
  ) {
    throw new FastlyComputeRealityError(
      'PULSE_FASTLY_LAUNCHER_INVALID',
      `Unknown Fastly Compute reality launcher: ${String(requestedKind)}.`,
      { launcherKind: requestedKind }
    );
  }

  const explicitFastly = Boolean(
    options.inspection
    || options.binary
    || env.PULSE_FASTLY_BIN
  );
  const explicitViceroy = Boolean(
    options.viceroyInspection
    || options.viceroyBinary
    || env.PULSE_VICEROY_BIN
  );
  const useDirectViceroy = requestedKind === 'viceroy-direct'
    || (!requestedKind && !explicitFastly && explicitViceroy);

  if (useDirectViceroy) {
    const inspection = options.viceroyInspection || inspectViceroy(options);
    return Object.freeze({
      kind: 'viceroy-direct',
      owner: 'pulse-test-harness',
      inspection,
      fastlyCliInspection: undefined,
      viceroyInspection: inspection
    });
  }

  if (requestedKind === 'fastly-cli' || explicitFastly) {
    const inspection = options.inspection || inspectFastlyCli(options);
    const viceroyRequested = Boolean(
      options.viceroyInspection
      || options.viceroyBinary
      || env.PULSE_VICEROY_BIN
      || options.requireViceroy
    );
    const viceroyInspection = viceroyRequested
      ? (options.viceroyInspection || inspectViceroy(options))
      : undefined;
    return Object.freeze({
      kind: 'fastly-cli',
      owner: 'fastly-cli',
      inspection,
      fastlyCliInspection: inspection,
      viceroyInspection
    });
  }

  try {
    const inspection = inspectFastlyCli(options);
    return Object.freeze({
      kind: 'fastly-cli',
      owner: 'fastly-cli',
      inspection,
      fastlyCliInspection: inspection,
      viceroyInspection: undefined
    });
  } catch (fastlyError) {
    if (fastlyError.code !== 'PULSE_FASTLY_CLI_UNAVAILABLE') throw fastlyError;
    try {
      const inspection = inspectViceroy(options);
      return Object.freeze({
        kind: 'viceroy-direct',
        owner: 'pulse-test-harness',
        inspection,
        fastlyCliInspection: undefined,
        viceroyInspection: inspection
      });
    } catch (viceroyError) {
      if (viceroyError.code !== 'PULSE_VICEROY_UNAVAILABLE') {
        throw viceroyError;
      }
      throw new FastlyComputeRealityError(
        'PULSE_FASTLY_REALITY_ENGINE_UNAVAILABLE',
        'The Fastly Compute reality gate requires either the Fastly CLI or Viceroy.',
        {
          fastlyCli: fastlyError.detail,
          viceroy: viceroyError.detail,
          hint: 'Set PULSE_VICEROY_BIN to an executable Viceroy release, set PULSE_FASTLY_BIN to the Fastly CLI, or place either tool on PATH.'
        }
      );
    }
  }
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlKey(value) {
  return JSON.stringify(String(value));
}

function kvData(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify({ __pulseKv: 1, value });
}

function renderFastlyLocalConfig(input = {}) {
  const lines = [
    'manifest_version = 3',
    `name = ${tomlString(input.name || 'pulse-fastly-compute-reality')}`,
    `description = ${tomlString(input.description || 'Pulse Fastly Compute reality fixture')}`,
    'authors = []',
    'language = "other"',
    ''
  ];

  for (const [name, backend] of Object.entries(input.backends || {})) {
    const value = typeof backend === 'string' ? { url: backend } : backend || {};
    lines.push(`[local_server.backends.${tomlKey(name)}]`);
    lines.push(`url = ${tomlString(value.url)}`);
    if (value.overrideHost !== undefined) lines.push(`override_host = ${tomlString(value.overrideHost)}`);
    if (value.useSni !== undefined) lines.push(`use_sni = ${value.useSni ? 'true' : 'false'}`);
    lines.push('');
  }

  for (const [name, contents] of Object.entries(input.configStores || {})) {
    lines.push(`[local_server.config_stores.${tomlKey(name)}]`);
    lines.push('format = "inline-toml"');
    lines.push(`[local_server.config_stores.${tomlKey(name)}.contents]`);
    for (const [key, value] of Object.entries(contents || {})) lines.push(`${tomlKey(key)} = ${tomlString(value)}`);
    lines.push('');
  }

  const secretStores = Object.entries(input.secretStores || {});
  if (secretStores.length > 0) {
    lines.push('[local_server.secret_stores]');
    for (const [name, contents] of secretStores) {
      const entries = Object.entries(contents || {}).map(([key, value]) => `{ key = ${tomlString(key)}, data = ${tomlString(value)} }`);
      lines.push(`${tomlKey(name)} = [${entries.join(', ')}]`);
    }
    lines.push('');
  }

  const kvStores = Object.entries(input.kvStores || {});
  if (kvStores.length > 0) {
    lines.push('[local_server.kv_stores]');
    for (const [name, contents] of kvStores) {
      const entries = Object.entries(contents || {}).map(([key, value]) => `{ key = ${tomlString(key)}, data = ${tomlString(kvData(value))} }`);
      lines.push(`${tomlKey(name)} = [${entries.join(', ')}]`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function reservePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForPort(host, port, child, logs, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      if (child.exitCode !== null) {
        reject(new FastlyComputeRealityError(
          'PULSE_FASTLY_SERVE_START_FAILED',
          `Fastly Compute serve exited before listening on ${host}:${port}.`,
          { exitCode: child.exitCode, signal: child.signalCode, stdout: logs.stdout, stderr: logs.stderr }
        ));
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new FastlyComputeRealityError(
          'PULSE_FASTLY_SERVE_START_TIMEOUT',
          `Fastly Compute serve did not listen on ${host}:${port} within ${timeoutMs}ms.`,
          { stdout: logs.stdout, stderr: logs.stderr }
        ));
        return;
      }
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        setTimeout(attempt, 75);
      });
    }
    attempt();
  });
}

function signalProcessTree(child, signal) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const args = ['/PID', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (_) {
    try { child.kill(signal); } catch (_) {}
  }
}

function terminate(child, timeoutMs = 3000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    let fallback;
    const done = () => {
      if (timer) clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      resolve();
    };
    child.once('exit', done);
    signalProcessTree(child, 'SIGTERM');
    timer = setTimeout(() => {
      if (child.exitCode === null) signalProcessTree(child, 'SIGKILL');
      fallback = setTimeout(done, 150);
    }, timeoutMs);
  });
}

function appendLog(logs, key, chunk) {
  const value = `${logs[key]}${chunk}`;
  logs[key] = value.length <= maxCapturedLogBytes ? value : value.slice(value.length - maxCapturedLogBytes);
}

async function startFastlyComputeServe(options = {}) {
  const launcher = options.launcher || inspectFastlyComputeLauncher(options);
  const inspection = launcher.inspection;
  const fastlyCliInspection = launcher.fastlyCliInspection;
  const viceroyInspection = launcher.viceroyInspection;
  const packageRoot = path.resolve(options.packageRoot || options.cwd || process.cwd());
  const wasmFile = path.resolve(options.wasmFile || path.join(packageRoot, 'bin', 'main.wasm'));
  const manifestFile = path.resolve(options.manifestFile || path.join(packageRoot, 'fastly.toml'));
  if (!fs.existsSync(wasmFile)) throw new FastlyComputeRealityError('PULSE_FASTLY_WASM_MISSING', `The native Fastly provider module is missing: ${wasmFile}`, { wasmFile });
  if (!fs.existsSync(manifestFile)) throw new FastlyComputeRealityError('PULSE_FASTLY_MANIFEST_MISSING', `Fastly manifest is missing: ${manifestFile}`, { manifestFile });
  if (path.dirname(manifestFile) !== packageRoot || path.basename(manifestFile) !== 'fastly.toml') {
    throw new FastlyComputeRealityError(
      'PULSE_FASTLY_MANIFEST_LOCATION_INVALID',
      'Fastly Compute serve requires fastly.toml at the generated package root.',
      { packageRoot, manifestFile }
    );
  }
  const host = String(options.host || '127.0.0.1');
  const port = Number(options.port || await reservePort(host));
  const extraArgs = options.extraArgs === undefined ? [] : options.extraArgs;
  if (!Array.isArray(extraArgs) || extraArgs.some((value) => typeof value !== 'string')) {
    throw new FastlyComputeRealityError('PULSE_FASTLY_SERVE_ARGS_INVALID', 'Fastly Compute serve extraArgs must be an array of strings.', { extraArgs });
  }
  const args = launcher.kind === 'viceroy-direct'
    ? [
        'serve',
        '--addr', `${host}:${port}`,
        '--config', manifestFile,
        ...extraArgs,
        wasmFile
      ]
    : [
        'compute', 'serve',
        '--dir', packageRoot,
        '--file', wasmFile,
        '--addr', `${host}:${port}`,
        ...(viceroyInspection ? ['--viceroy-path', viceroyInspection.binary] : []),
        ...extraArgs
      ];
  const logs = { stdout: '', stderr: '' };
  const child = spawn(inspection.binary, args, {
    cwd: packageRoot,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => appendLog(logs, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendLog(logs, 'stderr', chunk));
  try {
    await waitForPort(host, port, child, logs, Number(options.startTimeoutMs || 45000));
  } catch (error) {
    await terminate(child, Number(options.stopTimeoutMs || 3000));
    throw error;
  }
  return Object.freeze({
    version: fastlyComputeRealityVersion,
    launcher,
    inspection,
    fastlyCliInspection,
    viceroyInspection,
    child,
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    packageRoot,
    wasmFile,
    manifestFile,
    args: Object.freeze([...args]),
    logs,
    stop: () => terminate(child, Number(options.stopTimeoutMs || 3000))
  });
}

function rawHeaders(pairs) {
  const out = [];
  for (let index = 0; index < pairs.length; index += 2) out.push([String(pairs[index]), String(pairs[index + 1])]);
  return out;
}

function requestFastlyCompute(server, input = {}) {
  const body = input.body === undefined || input.body === null
    ? undefined
    : Buffer.isBuffer(input.body) ? input.body : Buffer.from(String(input.body));
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: server.host,
      port: server.port,
      method: String(input.method || 'GET').toUpperCase(),
      path: String(input.path || '/'),
      headers: { ...(input.headers || {}), ...(body ? { 'content-length': String(body.length) } : {}) }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => resolve(Object.freeze({
        status: Number(response.statusCode || 0),
        headers: Object.freeze(rawHeaders(response.rawHeaders || [])),
        body: Buffer.concat(chunks)
      })));
    });
    request.setTimeout(Number(input.timeoutMs || 30000), () => request.destroy(new FastlyComputeRealityError('PULSE_FASTLY_REQUEST_TIMEOUT', 'Fastly Compute request timed out.', { path: input.path })));
    request.once('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

module.exports = Object.freeze({
  fastlyComputeRealityVersion,
  FastlyComputeRealityError,
  resolveFastlyCliBinary,
  inspectFastlyCli,
  inspectFastlyComputeLauncher,
  resolveViceroyBinary,
  inspectViceroy,
  renderFastlyLocalConfig,
  reservePort,
  startFastlyComputeServe,
  requestFastlyCompute,
  terminate
});
