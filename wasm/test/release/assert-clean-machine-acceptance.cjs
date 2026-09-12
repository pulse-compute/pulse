#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { RELEASE_VERSION, packRelease } = require('../../../scripts/pack-release.cjs');
const { PUBLICATION } = require('../../../scripts/package-support.cjs');
const {
  REGISTRY_VERSION,
  READY_EVENT_VERSION
} = require('./read-only-npm-registry.cjs');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const testRoot = process.env.PULSEWASM_TEST_TMP_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-clean-acceptance-'));
const releaseDir = path.join(testRoot, 'release');
const homeDir = path.join(testRoot, 'home');
const npmCache = path.join(testRoot, 'npm-cache');
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(npmCache, { recursive: true });

const cleanEnv = { ...process.env };
delete cleanEnv.NODE_PATH;
delete cleanEnv.PNPM_HOME;
delete cleanEnv.PNPM_STORE_DIR;
delete cleanEnv.npm_config_registry;
delete cleanEnv.NPM_CONFIG_REGISTRY;
Object.assign(cleanEnv, {
  HOME: homeDir,
  USERPROFILE: homeDir,
  npm_config_cache: npmCache,
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_fetch_retries: '0',
  npm_config_fetch_retry_maxtimeout: '1000',
  npm_config_fetch_retry_mintimeout: '100',
  npm_config_update_notifier: 'false',
  NO_COLOR: '1',
  FORCE_COLOR: '0'
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || testRoot,
    env: { ...cleanEnv, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeoutMs || 300000,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== (options.expectedStatus ?? 0)) {
    throw new Error([
      `command failed: ${command} ${args.join(' ')}`,
      `cwd: ${options.cwd || testRoot}`,
      `status: ${result.status}`,
      `stdout:\n${result.stdout || ''}`,
      `stderr:\n${result.stderr || ''}`,
      result.error ? `error: ${result.error.message}` : ''
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function parseJson(result, stream = 'stdout') {
  const text = result[stream];
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`expected JSON on ${stream}: ${error.message}\n${text}`); }
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message())), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, filter: (entry) => !/(?:^|[\\/])(?:node_modules|dist|\.pulse-docs-build)(?:[\\/]|$)/.test(entry) });
}

function packageTarballs(manifest) {
  return manifest.packages.map((entry) => path.join(releaseDir, entry.tarball));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshotFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push([path.relative(root, file).replace(/\\/g, '/'), sha256File(file)]);
    }
  }
  visit(root);
  return files;
}

async function startPackedCandidateRegistry(tarballs) {
  console.log('acceptance - start loopback-only read-only registry for exact Pulse candidates');
  const registryScript = path.join(__dirname, 'read-only-npm-registry.cjs');
  const child = spawn(process.execPath, [registryScript, ...tarballs.flatMap((tarball) => ['--package', tarball])], {
    cwd: repoRoot,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exit = once(child, 'exit');
  let stdout = '';
  let stderr = '';
  let stdoutBuffer = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const ready = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`timed out waiting for the read-only registry; stdout=${stdout}; stderr=${stderr}`)), 30000);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      for (;;) {
        const index = stdoutBuffer.indexOf('\n');
        if (index < 0) break;
        const line = stdoutBuffer.slice(0, index).trim();
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); }
        catch (error) {
          finish(reject, new Error(`read-only registry emitted non-JSON output: ${line}`));
          return;
        }
        if (event.event === 'ready') {
          finish(resolve, event);
          return;
        }
      }
    });
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => finish(reject, new Error(`read-only registry exited before readiness: code=${code} signal=${signal}; stdout=${stdout}; stderr=${stderr}`)));
  });

  assert.equal(ready.version, READY_EVENT_VERSION);
  assert.equal(ready.registryVersion, REGISTRY_VERSION);
  assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(ready.packages.length, tarballs.length);
  assert.equal(new Set(ready.packages).size, tarballs.length);

  const registryUrl = `${ready.url}/`;
  const userConfig = path.join(homeDir, '.npmrc');
  fs.writeFileSync(userConfig, [
    `registry=${PUBLICATION.registry}/`,
    `@pulse-compute:registry=${registryUrl}`,
    'replace-registry-host=never',
    ''
  ].join('\n'));
  cleanEnv.NPM_CONFIG_USERCONFIG = userConfig;
  cleanEnv.NO_PROXY = [...new Set([cleanEnv.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',').split(',').filter(Boolean))].join(',');
  cleanEnv.no_proxy = cleanEnv.NO_PROXY;

  return Object.freeze({
    ready: Object.freeze({ ...ready, url: registryUrl }),
    async close() {
      if (child.exitCode !== null) throw new Error(`read-only registry exited unexpectedly with code ${child.exitCode}; stderr=${stderr}`);
      child.kill('SIGTERM');
      const [code, signal] = await withTimeout(
        exit,
        10000,
        () => `read-only registry did not stop; stderr=${stderr}`
      );
      assert.equal(signal, null, `read-only registry was killed by ${signal}`);
      assert.equal(code, 0, `read-only registry failed while closing: ${stderr}`);
      const closedLine = stderr.trim().split(/\r?\n/).filter(Boolean).reverse().find((line) => {
        try { return JSON.parse(line).event === 'closed'; }
        catch (_) { return false; }
      });
      assert.ok(closedLine, `read-only registry did not emit its close record: ${stderr}`);
      const closed = JSON.parse(closedLine);
      assert.equal(closed.version, REGISTRY_VERSION);
      assert.equal(closed.requests.rejected, 0, `read-only registry rejected unexpected mutating requests: ${closedLine}`);
      assert.equal(closed.requests.missingTarballs, 0, `read-only registry received unknown tarball requests: ${closedLine}`);
      assert.deepEqual(closed.requests.missingPackuments, {}, `read-only Pulse registry received an unknown package request: ${closedLine}`);
      assert.equal(closed.requests.missing, 0, `read-only Pulse registry received an unknown request: ${closedLine}`);
      return closed;
    }
  });
}

function installPackedPackages(projectRoot, tarballs) {
  const projectName = path.basename(projectRoot);
  console.log(`acceptance - install packed packages in ${projectName}`);
  const before = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  run('npm', ['install', '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', ...tarballs], { cwd: projectRoot, timeoutMs: 360000 });
  console.log(`acceptance - packed package install completed in ${projectName}`);
  const after = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.deepEqual(after.dependencies || {}, before.dependencies || {}, 'packed install must not rewrite declared dependencies');
  assert.deepEqual(after.devDependencies || {}, before.devDependencies || {}, 'packed install must not rewrite declared devDependencies');
  const cli = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'pulse.cmd' : 'pulse');
  assert.ok(fs.existsSync(cli), `packed install did not expose pulse in ${projectRoot}`);
  return cli;
}

function assertPackedInstallIsolated(projectRoot, packageNames) {
  for (const packageName of packageNames) {
    const packageRoot = path.join(projectRoot, 'node_modules', ...packageName.split('/'));
    assert.ok(fs.existsSync(packageRoot), `clean install is missing ${packageName}`);
    const real = fs.realpathSync(packageRoot);
    assert.equal(real.startsWith(repoRoot + path.sep), false, `${packageName} leaked a workspace link: ${real}`);
    const installed = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'));
    assert.equal(installed.name, packageName, `${packageName} installed with the wrong package identity`);
    assert.equal(installed.version, RELEASE_VERSION, `${packageName} installed from outside the exact Pulse candidate`);
  }
}

function importablePackageRoots(projectRoot, packageNames) {
  return packageNames.filter((packageName) => {
    const manifestFile = path.join(projectRoot, 'node_modules', ...packageName.split('/'), 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const packageExports = manifest.exports;
    if (packageExports === undefined || typeof packageExports === 'string' || Array.isArray(packageExports)) return true;
    if (!packageExports || typeof packageExports !== 'object') return false;
    const exportKeys = Object.keys(packageExports);
    return exportKeys.every((key) => !key.startsWith('.')) || Object.prototype.hasOwnProperty.call(packageExports, '.');
  });
}

function runPulse(cli, projectRoot, args, timeoutMs = 300000) {
  const result = run(cli, [...args, '--json'], { cwd: projectRoot, timeoutMs });
  return parseJson(result);
}

function runPulseFailure(cli, projectRoot, args, expectedStatus, timeoutMs = 300000) {
  const result = run(cli, [...args, '--json'], { cwd: projectRoot, timeoutMs, expectedStatus });
  return parseJson(result, result.stderr.trim() ? 'stderr' : 'stdout');
}

function request(urlPath, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const req = http.get(urlPath, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('aborted', () => finish(reject, new Error(`packed pulse dev response aborted for ${urlPath}`)));
      res.on('error', (error) => finish(reject, error));
      res.on('end', () => finish(resolve, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out requesting packed pulse dev at ${urlPath}`)));
    req.on('error', (error) => finish(reject, error));
  });
}

async function runDevOnce(cli, projectRoot) {
  const projectName = path.basename(projectRoot);
  console.log(`acceptance - start one-request dev lifecycle in ${projectName}`);
  const child = spawn(cli, ['dev', '--once', '--no-watch', '--port', '0', '--json'], {
    cwd: projectRoot,
    env: cleanEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const exit = once(child, 'exit');
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const ready = await new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => finish(reject, new Error(`timed out waiting for packed pulse dev; stdout=${stdout}; stderr=${stderr}`)), 30000);
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        buffer += text;
        for (;;) {
          const index = buffer.indexOf('\n');
          if (index < 0) break;
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); }
          catch (error) {
            finish(reject, new Error(`packed pulse dev emitted non-JSON output: ${line}`));
            return;
          }
          if (event.event === 'ready') {
            finish(resolve, event);
            return;
          }
        }
      });
      child.once('error', (error) => finish(reject, error));
      child.once('exit', (code, signal) => finish(reject, new Error(`packed pulse dev exited before readiness: code=${code} signal=${signal}; stderr=${stderr}`)));
    });
    console.log(`acceptance - packed pulse dev ready in ${projectName}`);
    const response = await request(`${ready.url}/health`, 30000);
    const [code, signal] = await withTimeout(
      exit,
      30000,
      () => `packed pulse dev did not exit after --once; stderr=${stderr}`
    );
    assert.equal(signal, null, `packed pulse dev terminated by ${signal}: ${stderr}`);
    assert.equal(code, 0, `packed pulse dev failed: ${stderr}`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body.toString('utf8')), { ok: true });
    console.log(`acceptance - one-request dev lifecycle completed in ${projectName}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      try {
        await withTimeout(exit, 5000, () => `packed pulse dev did not terminate after SIGTERM in ${projectName}`);
      } catch (_) {
        child.kill('SIGKILL');
      }
    }
  }
}

async function verifyInitializedProject(toolCli, provider, tarballs, packageNames) {
  console.log(`acceptance - initialize and verify ${provider} project`);
  const projectRoot = path.join(testRoot, `${provider}-project`);
  const initArgs = ['init', projectRoot, '--json'];
  const initialized = parseJson(run(toolCli, initArgs, { cwd: testRoot }));
  assert.equal(initialized.status, 'initialized');
  assert.equal(initialized.packageManager, 'npm');
  assert.ok(initialized.nextSteps.includes('npm install'));
  const generatedFile = path.join(projectRoot, 'package.json');
  const generated = JSON.parse(fs.readFileSync(generatedFile, 'utf8'));
  assert.equal(generated.dependencies['@pulse-compute/pulse'], RELEASE_VERSION);
  assert.equal(generated.dependencies['@pulse-compute/runtime'], undefined);
  assert.equal(generated.devDependencies['@pulse-compute/cli'], RELEASE_VERSION);
  assert.deepEqual(initialized.files, [
    '.gitignore',
    '.pulse/.gitignore',
    '.pulse/config.ts',
    'README.md',
    'package.json',
    'src/index.ts',
    'tests/pulse.harness.ts',
    'tsconfig.json'
  ]);
  assert.equal(fs.existsSync(path.join(projectRoot, 'pulse.config.ts')), false);
  assert.match(fs.readFileSync(path.join(projectRoot, 'src', 'index.ts'), 'utf8'), /new Pulse\(\{ auto: true \}\)/);
  assert.match(fs.readFileSync(path.join(projectRoot, 'src', 'index.ts'), 'utf8'), /async \(ctx\)/);
  assert.match(fs.readFileSync(path.join(projectRoot, '.pulse', 'config.ts'), 'utf8'), /defaultProfile: 'local'/);
  assert.match(fs.readFileSync(path.join(projectRoot, 'tests', 'pulse.harness.ts'), 'utf8'), /name: 'health'/);
  if (provider === 'fastly') {
    generated.dependencies['@pulse-compute/provider-fastly'] = RELEASE_VERSION;
    fs.writeFileSync(generatedFile, `${JSON.stringify(generated, null, 2)}\n`);
    fs.writeFileSync(path.join(projectRoot, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'local', strict: true },
  local: {
    host: 'fastly',
    target: 'native',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
    fastly: {
      bindings: { dynamicBackends: false },
      build: { name: 'packed-fastly' },
    },
  },
}));
`);
  }

  const cli = installPackedPackages(projectRoot, tarballs);
  assertPackedInstallIsolated(projectRoot, packageNames);
  console.log(`acceptance - verify ${provider} CLI version`);
  assert.equal(run(cli, ['--version'], { cwd: projectRoot }).stdout.trim(), RELEASE_VERSION);
  console.log(`acceptance - verify ${provider} doctor`);
  assert.equal(runPulse(cli, projectRoot, ['doctor']).status, 'passed');
  console.log(`acceptance - verify ${provider} inspect`);
  assert.equal(runPulse(cli, projectRoot, ['inspect']).status, 'ok');
  console.log(`acceptance - verify ${provider} test`);
  assert.equal(runPulse(cli, projectRoot, ['test']).status, 'passed');
  await runDevOnce(cli, projectRoot);
  const nativeOut = '.pulse-native';
  console.log(`acceptance - verify ${provider} provider-neutral compile`);
  const compiled = runPulse(cli, projectRoot, ['compile', '--out', nativeOut], 360000);
  assert.equal(compiled.status, 'compiled');
  assert.equal(compiled.provider, null);
  assert.equal(compiled.providerNeutral, true);
  assert.equal(compiled.configuredProvider, provider);
  const portableWasm = path.join(projectRoot, nativeOut, 'canonical-native.wasm');
  assert.ok(fs.existsSync(portableWasm), 'packed project did not produce canonical-native.wasm');
  const portableBytes = fs.readFileSync(portableWasm);
  assert.equal(WebAssembly.validate(portableBytes), true);
  assert.ok(portableBytes.length > 0 && portableBytes.length < 100000, `unexpected portable Wasm size ${portableBytes.length}`);
  const portableImports = WebAssembly.Module.imports(new WebAssembly.Module(portableBytes));
  assert.deepEqual([...new Set(portableImports.map((entry) => entry.module))].sort(), ['pulse_host']);
  console.log(`acceptance - verify ${provider} provider build`);
  const build = runPulse(cli, projectRoot, ['build'], 360000);
  assert.equal(build.status, 'built');
  assert.equal(build.provider, provider);
  if (provider === 'fastly') {
    const wasmFile = path.join(projectRoot, 'dist', 'bin', 'main.wasm');
    assert.ok(fs.existsSync(wasmFile), 'packed Fastly project did not produce bin/main.wasm');
    assert.equal(fs.readFileSync(wasmFile).subarray(0, 8).toString('hex'), '0061736d01000000');
  }
  return projectRoot;
}

async function verifyNodeJavascriptProject(toolCli, tarballs, packageNames) {
  console.log('acceptance - initialize and verify core Node JavaScript target project');
  const projectRoot = path.join(testRoot, 'node-javascript-project');
  const initialized = parseJson(run(toolCli, ['init', projectRoot, '--json'], { cwd: testRoot }));
  assert.equal(initialized.status, 'initialized');
  const configFile = path.join(projectRoot, '.pulse', 'config.ts');
  const nativeConfig = fs.readFileSync(configFile, 'utf8');
  assert.match(nativeConfig, /host:\s*'node'/);
  assert.match(nativeConfig, /target:\s*'native'/);
  const javascriptConfig = nativeConfig.replace(/target:\s*'native'/, "target: 'javascript'");
  assert.notEqual(javascriptConfig, nativeConfig, 'generated Node config must expose one native target selection');
  fs.writeFileSync(configFile, javascriptConfig);

  const cli = installPackedPackages(projectRoot, tarballs);
  assertPackedInstallIsolated(projectRoot, packageNames);

  const inspect = runPulse(cli, projectRoot, ['inspect']);
  assert.equal(inspect.status, 'ok');
  assert.equal(inspect.provider.selectedTarget, 'javascript');
  assert.equal(inspect.provider.selectedTargetDescriptor.status, 'source-packaging-ready');
  assert.equal(inspect.provider.selectedTargetDescriptor.commands.test, true);
  assert.equal(inspect.provider.selectedTargetDescriptor.commands.dev, true);
  assert.equal(inspect.provider.selectedTargetDescriptor.commands.build, true);
  assert.equal(inspect.provider.selectedTargetDescriptor.automaticFallback, false);
  const support = inspect.provider.targetSupport;
  assert.equal(support.version, 'pulse.target-support-evidence.v1');
  assert.equal(support.availability.definition, 'full-target-support');
  assert.equal(support.availability.coreExecutionReady, true);
  assert.equal(support.availability.fullTargetSupportReady, true);
  assert.equal(support.availability.generalAvailable, true);
  assert.equal(support.availability.automaticFallback, false);
  assert.deepEqual(support.availability.summary, { total: 12, satisfied: 12, pending: 0, blocked: 0 });
  assert.equal(support.project.status, 'eligible');
  assert.equal(support.loader.status, 'passed');
  assert.equal(support.loader.loaded, true);

  const doctor = runPulse(cli, projectRoot, ['doctor']);
  assert.equal(doctor.status, 'passed');
  assert.equal(doctor.summary.failed, 0);
  assert.equal(doctor.summary.warnings, 0);
  assert.equal(doctor.targetSupport.evidenceHash, support.evidenceHash);
  assert.equal(doctor.targetSupport.observationHash, support.observationHash);
  assert.equal(runPulse(cli, projectRoot, ['test']).status, 'passed');
  await runDevOnce(cli, projectRoot);

  const compiled = runPulse(cli, projectRoot, ['compile', '--out', '.pulse-native'], 360000);
  assert.equal(compiled.status, 'compiled');
  assert.equal(compiled.provider, null);
  assert.equal(compiled.providerNeutral, true);
  assert.equal(compiled.configuredProvider, 'node');
  assert.equal(compiled.configuredTarget, 'javascript');
  assert.equal(compiled.targetSupport.evidenceHash, support.evidenceHash);
  assert.notEqual(compiled.targetSupport.observationHash, support.observationHash);
  assert.equal(compiled.targetSupport.loader.status, 'skipped');
  assert.equal(compiled.targetSupport.loader.skippedReason, 'plan-only-evidence');
  assert.equal(compiled.targetSupport.availability.generalAvailable, true);
  assert.equal(compiled.targetSupport.availability.automaticFallback, false);

  const built = runPulse(cli, projectRoot, ['build'], 360000);
  assert.equal(built.status, 'built');
  assert.equal(built.buildMode, 'javascript-source-package');
  assert.equal(built.provider, 'node');
  assert.equal(built.configuredTarget, 'javascript');
  assert.equal(built.automaticFallback, false);
  assert.equal(built.manifest.providerTarget.nativeWasm, false);
  assert.equal(built.manifest.providerTarget.compiledWasmPresent, false);
  assert.equal(built.targetSupport.availability.generalAvailable, true);
  assert.equal(built.targetSupport.availability.automaticFallback, false);
  const configuredOutput = built.project.outDir || 'dist';
  const outputRoot = path.isAbsolute(configuredOutput)
    ? configuredOutput
    : path.join(projectRoot, configuredOutput);
  for (const file of [
    'index.cjs',
    'package.json',
    'pulse-build.json',
    'pulse-javascript-application-plan.json',
    'pulse-javascript-source-package.json'
  ]) assert.ok(fs.existsSync(path.join(outputRoot, file)), `JavaScript source package is missing ${file}`);
  const outputFiles = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else outputFiles.push(path.relative(outputRoot, file).replace(/\\/g, '/'));
    }
  };
  collect(outputRoot);
  assert.equal(outputFiles.some((file) => /\.(?:wasm|wat)$/.test(file)), false, 'JavaScript source package must not contain Native artifacts');
  assert.equal(outputFiles.some((file) => /native-plan|assemblyscript/i.test(file)), false, 'JavaScript source package must not contain Native planning artifacts');

  const standaloneRoot = path.join(testRoot, 'node-javascript-source-package');
  fs.cpSync(outputRoot, standaloneRoot, { recursive: true });
  installPackedPackages(standaloneRoot, tarballs);
  assertPackedInstallIsolated(standaloneRoot, packageNames);
  const sourcePackageSmoke = run(process.execPath, ['-e', `
    const http = require('node:http');
    const application = require('./index.cjs');
    const { createNodeJavascriptHandler } = require('@pulse-compute/provider-node/javascript/node-adapter');
    const server = http.createServer(createNodeJavascriptHandler(application));
    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address();
        const response = await fetch('http://127.0.0.1:' + address.port + '/health');
        const body = await response.text();
        if (response.status !== 200 || body !== '{"ok":true}') process.exitCode = 2;
        else process.stdout.write('ok');
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      } finally {
        server.close();
      }
    });
  `], { cwd: standaloneRoot, timeoutMs: 60000 });
  assert.equal(sourcePackageSmoke.stdout, 'ok');
}

async function verifyFastlyJavascriptProject(toolCli, tarballs, packageNames) {
  console.log('acceptance - initialize and verify core Fastly JavaScript target project');
  const projectRoot = path.join(testRoot, 'fastly-javascript-project');
  const initialized = parseJson(run(toolCli, ['init', projectRoot, '--json'], { cwd: testRoot }));
  assert.equal(initialized.status, 'initialized');

  const manifestFile = path.join(projectRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.dependencies['@pulse-compute/provider-fastly'] = RELEASE_VERSION;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(projectRoot, '.pulse', 'config.ts'), `import { defineConfig } from '@pulse-compute/pulse';
export default defineConfig((_scope) => ({
  pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', defaultProfile: 'local', strict: true },
  local: {
    host: 'fastly',
    target: 'javascript',
    outDir: 'dist',
    dev: { host: '127.0.0.1', port: 8787 },
    fastly: {
      bindings: { dynamicBackends: false },
      build: { name: 'packed-fastly-javascript' },
    },
  },
}));
`);

  const cli = installPackedPackages(projectRoot, tarballs);
  assertPackedInstallIsolated(projectRoot, packageNames);
  assert.equal(
    fs.existsSync(path.join(projectRoot, 'node_modules', '@fastly', 'js-compute')),
    false,
    'ordinary Pulse consumers must not install the downstream Fastly compiler'
  );
  const installedEsbuild = JSON.parse(fs.readFileSync(require.resolve('esbuild/package.json', { paths: [projectRoot] }), 'utf8'));
  assert.equal(installedEsbuild.version, '0.28.1');

  const inspect = runPulse(cli, projectRoot, ['inspect']);
  assert.equal(inspect.status, 'ok');
  assert.equal(inspect.project.provider, 'fastly');
  assert.equal(inspect.project.target, 'javascript');
  assert.equal(inspect.provider.selectedTarget, 'javascript');
  assert.equal(inspect.provider.selectedTargetDescriptor.status, 'provider-runtime-ready');
  assert.equal(inspect.provider.realization.javascriptRuntime, true);
  assert.equal(inspect.provider.realization.nativeWasm, false);
  assert.equal(inspect.provider.realization.automaticFallback, false);
  assert.equal(inspect.provider.realization.deploymentCandidate.status, 'structurally-deployable');
  assert.equal(inspect.provider.realization.deploymentCandidate.providerRealityValidated, false);
  assert.equal(inspect.provider.realization.deploymentCandidate.deployed, false);
  const support = inspect.provider.targetSupport;
  assert.equal(support.availability.definition, 'full-target-support');
  assert.equal(support.availability.generalAvailable, true);
  assert.equal(support.availability.automaticFallback, false);
  assert.deepEqual(support.availability.summary, { total: 6, satisfied: 6, pending: 0, blocked: 0 });
  assert.equal(support.project.status, 'eligible');
  assert.equal(support.loader.status, 'skipped');
  assert.equal(support.loader.skippedReason, 'provider-build-time-bundle-loader');

  const doctor = runPulse(cli, projectRoot, ['doctor']);
  assert.equal(doctor.status, 'passed');
  assert.equal(doctor.summary.failed, 0);
  assert.equal(doctor.summary.warnings, 0);
  assert.equal(doctor.targetSupport.evidenceHash, support.evidenceHash);
  assert.equal(doctor.targetSupport.availability.generalAvailable, true);

  const tested = runPulse(cli, projectRoot, ['test']);
  assert.equal(tested.status, 'passed');
  assert.equal(tested.provider, 'fastly');
  assert.equal(tested.target, 'javascript');
  assert.equal(tested.targetId, 'fastly-javascript');
  assert.equal(tested.automaticFallback, false);
  assert.equal(tested.metadata.localExecution.mode, 'provider-emulation');
  assert.equal(tested.metadata.localExecution.providerReality, false);
  await runDevOnce(cli, projectRoot);

  const compiled = runPulse(cli, projectRoot, ['compile', '--out', '.pulse-fastly-javascript-portable'], 360000);
  assert.equal(compiled.status, 'compiled');
  assert.equal(compiled.provider, null);
  assert.equal(compiled.providerNeutral, true);
  assert.equal(compiled.configuredProvider, 'fastly');
  assert.equal(compiled.configuredTarget, 'javascript');
  assert.equal(compiled.automaticFallback, false);
  assert.equal(compiled.targetSupport.availability.generalAvailable, true);

  const built = runPulse(cli, projectRoot, ['build'], 360000);
  assert.equal(built.status, 'built');
  assert.equal(built.buildMode, 'javascript-source-package');
  assert.equal(built.provider, 'fastly');
  assert.equal(built.configuredTarget, 'javascript');
  assert.equal(built.automaticFallback, false);
  assert.equal(built.manifest.providerTarget.status, 'provider-runtime-ready');
  assert.equal(built.manifest.providerTarget.deploymentCandidate, true);
  assert.equal(built.manifest.providerTarget.providerRealityValidated, false);
  assert.equal(built.manifest.providerTarget.nativeWasm, false);
  assert.equal(built.manifest.providerTarget.compiledWasmPresent, false);
  assert.equal(built.targetSupport.availability.generalAvailable, true);

  const outputRoot = built.outDir;
  for (const file of [
    'src/application.js',
    'src/index.js',
    'package.json',
    'fastly.toml',
    'pulse-esbuild.config.js',
    'pulse-build.json',
    'pulse-fastly-javascript-candidate.json',
    'pulse-fastly-javascript-deployment.json',
    'pulse-fastly-javascript-source-package.json'
  ]) assert.ok(fs.existsSync(path.join(outputRoot, file)), `Fastly JavaScript source package is missing ${file}`);

  const generatedPackage = JSON.parse(fs.readFileSync(path.join(outputRoot, 'package.json'), 'utf8'));
  assert.deepEqual(generatedPackage.dependencies, { '@fastly/js-compute': '3.43.1' });
  assert.deepEqual(generatedPackage.devDependencies, { esbuild: '0.28.1' });
  const candidate = JSON.parse(fs.readFileSync(path.join(outputRoot, 'pulse-fastly-javascript-candidate.json'), 'utf8'));
  const deployment = JSON.parse(fs.readFileSync(path.join(outputRoot, 'pulse-fastly-javascript-deployment.json'), 'utf8'));
  assert.equal(candidate.status, 'structurally-deployable');
  assert.equal(candidate.providerRealityValidated, false);
  assert.equal(candidate.deployed, false);
  assert.equal(candidate.validation.providerReality, 'not-executed');
  assert.equal(candidate.validation.deployment, 'not-executed');
  assert.equal(deployment.generalAvailable, true);
  assert.equal(deployment.candidate.providerRealityValidated, false);
  assert.equal(deployment.candidate.deployed, false);
  assert.equal(snapshotFiles(outputRoot).some(([file]) => /\.(?:wasm|wat)$/i.test(file)), false);

  const repeatedOut = '.pulse-fastly-javascript-repeat';
  const repeated = runPulse(cli, projectRoot, ['build', '--out', repeatedOut], 360000);
  assert.equal(repeated.status, 'built');
  assert.deepEqual(
    snapshotFiles(outputRoot),
    snapshotFiles(repeated.outDir),
    'clean Fastly JavaScript source-package builds must be byte-identical'
  );
}

async function verifyRouterProject(tarballs, packageNames) {
  console.log('acceptance - install and verify canonical Router project');
  const projectRoot = path.join(testRoot, 'router-project');
  copyTree(path.join(repoRoot, 'examples', '09-router-lowering'), projectRoot);
  const cli = installPackedPackages(projectRoot, tarballs);
  assertPackedInstallIsolated(projectRoot, packageNames);
  const runtimeSmoke = run(process.execPath, ['-e', `const runtime = require('@pulse-compute/runtime'); if (runtime.RUNTIME_API_VERSION !== 'pulse.runtime-authoring.v4' || runtime.ROUTER_API_VERSION !== 'pulse.router-authoring.v2' || typeof runtime.Router !== 'function' || Object.prototype.hasOwnProperty.call(runtime, 'defineHandler')) process.exit(1); process.stdout.write('ok');`], { cwd: projectRoot });
  assert.equal(runtimeSmoke.stdout, 'ok');
  assert.equal(runPulse(cli, projectRoot, ['doctor']).status, 'passed');
  const inspect = runPulse(cli, projectRoot, ['inspect']);
  assert.equal(inspect.compiler.authoring.kind, 'router');
  assert.equal(inspect.compiler.routing.routes.length, 7);
  assert.equal(inspect.compiler.routing.executionVersion, 'pulse.router-terminal-execution.v1');
  assert.equal(inspect.compiler.routing.semantics.nextIsTerminal, true);
  assert.equal(inspect.compiler.routing.semantics.onionResume, false);
  assert.ok(inspect.compiler.routing.entries.some((entry) => entry.kind === 'use'));
  assert.ok(inspect.compiler.routing.entries.some((entry) => entry.kind === 'error'));
  assert.ok(inspect.compiler.effects.every((entry) => entry.routerEntryStableId && inspect.compiler.routing.entries.some((routerEntry) => routerEntry.stableId === entry.routerEntryStableId)));
  assert.equal(runPulse(cli, projectRoot, ['test']).status, 'passed');
  const compiled = runPulse(cli, projectRoot, ['compile'], 360000);
  assert.equal(compiled.manifest.program.authoring.kind, 'router');
  assert.equal(compiled.manifest.program.routing.routes.length, 7);
  const build = runPulse(cli, projectRoot, ['build'], 360000);
  assert.equal(build.manifest.program.authoring.kind, 'router');
  assert.equal(build.manifest.program.routing.routes.length, 7);
}

async function verifyGripProject(tarballs, packageNames) {
  console.log('acceptance - install and verify canonical Fastly capabilities project');
  const projectRoot = path.join(testRoot, 'fastly-capabilities-project');
  copyTree(path.join(repoRoot, 'examples', '05-fastly-capabilities'), projectRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@pulse-compute/grip'], RELEASE_VERSION, 'GRIP example must request the release version');
  const cli = installPackedPackages(projectRoot, tarballs);
  assertPackedInstallIsolated(projectRoot, packageNames);
  assert.equal(runPulse(cli, projectRoot, ['doctor']).status, 'passed');
  const inspect = runPulse(cli, projectRoot, ['inspect']);
  const operations = [...(inspect.compiler.packageEffects || []), ...(inspect.compiler.providerOperations || [])]
    .map((entry) => entry.capability || (entry.kind && entry.operation ? `${entry.kind}.${entry.operation}` : entry.kind || entry.operation));
  for (const capability of ['config.get', 'secret.get', 'kv.get', 'kv.put', 'grip.broadcast']) {
    assert.ok(
      operations.includes(capability),
      `packed Fastly capabilities project is missing ${capability}`
    );
  }
  assert.equal(runPulse(cli, projectRoot, ['test']).status, 'passed');
  const build = runPulse(cli, projectRoot, ['build'], 360000);
  assert.equal(build.manifest.providerTarget.compiledWasmPresent, true);
}

async function main() {
  console.log('acceptance - pack release candidate');
  const packed = packRelease({ repoRoot, outDir: releaseDir, build: false });
  const pulseTarballs = packageTarballs(packed.manifest);
  const installTarballs = pulseTarballs;
  const packageNames = packed.manifest.packages.map((entry) => entry.name);
  const registry = await startPackedCandidateRegistry(pulseTarballs);
  let registryClosure;
  let acceptanceError;
  try {
    console.log('acceptance - install packed CLI toolchain');
    const toolRoot = path.join(testRoot, 'tool');
    fs.mkdirSync(toolRoot, { recursive: true });
    fs.writeFileSync(path.join(toolRoot, 'package.json'), `${JSON.stringify({ name: 'pulse-clean-tool', version: '0.0.0', private: true }, null, 2)}\n`);
    const toolCli = installPackedPackages(toolRoot, installTarballs);
    assertPackedInstallIsolated(toolRoot, packageNames);

    const rootImports = importablePackageRoots(toolRoot, packageNames);
    assert.equal(rootImports.includes('@pulse-compute/grip'), true, 'GRIP must expose its stateless JavaScript package root');
    assert.equal(rootImports.includes('@pulse-compute/assets'), true, 'Assets must expose its JavaScript and lowerable package root');
    const supportedImports = [...new Set([
      ...rootImports,
      '@pulse-compute/grip/pulsewasm',
      '@pulse-compute/assets/pulsewasm'
    ])];
    const smoke = run(process.execPath, ['-e', `
      const packages = ${JSON.stringify(supportedImports)};
      Promise.all(packages.map((name) => import(name)))
        .then(() => process.stdout.write('ok'))
        .catch((error) => { console.error(error); process.exit(1); });
    `], { cwd: toolRoot });
    assert.equal(smoke.stdout, 'ok');
    const packageRootSmoke = run(process.execPath, ['-e', `
      Promise.all([import('@pulse-compute/assets'), import('@pulse-compute/grip')])
        .then(([assetsPackage, gripPackage]) => {
          if (typeof assetsPackage.createAssets !== 'function' || typeof assetsPackage.assets.lookup !== 'function' || typeof assetsPackage.assets.respond !== 'function') process.exit(2);
          if (typeof gripPackage.grip.isWebSocket !== 'function' || typeof gripPackage.grip.subscribe !== 'function' || typeof gripPackage.grip.handoff !== 'function' || typeof gripPackage.grip.broadcast !== 'function') process.exit(3);
          process.stdout.write('ok');
        })
        .catch((error) => { console.error(error); process.exit(1); });
    `], { cwd: toolRoot });
    assert.equal(packageRootSmoke.stdout, 'ok');
    assert.equal(run(toolCli, ['--version'], { cwd: toolRoot }).stdout.trim(), RELEASE_VERSION);

    console.log('acceptance - replay S3 read/write failure corpus from exact installed tarballs');
    const s3 = parseJson(run(process.execPath, [path.join(repoRoot, 'wasm/test/s3/assert-packed-consumer.cjs'), toolRoot, releaseDir], {
      cwd: toolRoot, timeoutMs: 600000,
    }));
    assert.equal(s3.status, 'passed');
    assert.equal(s3.installedBytesUnchanged, true);
    assert.equal(s3.providerReality, false);
    fs.writeFileSync(path.join(testRoot, 's3-packed-acceptance.json'), `${JSON.stringify(s3, null, 2)}\n`);
    // The suite deletes temporary installs; keep artifact identities in its retained task log too.
    console.log(JSON.stringify(s3));

    console.log('acceptance - replay conditional KV from exact installed tarballs');
    const kv = parseJson(run(process.execPath, [path.join(repoRoot, 'wasm/test/kv/assert-packed-consumer.cjs'), toolRoot, releaseDir], {
      cwd: toolRoot, timeoutMs: 600000,
    }));
    assert.equal(kv.status, 'passed');
    assert.equal(kv.installedBytesUnchanged, true);
    assert.equal(kv.providerReality, false);
    fs.writeFileSync(path.join(testRoot, 'kv-packed-acceptance.json'), `${JSON.stringify(kv, null, 2)}\n`);
    console.log(JSON.stringify(kv));

    await verifyInitializedProject(toolCli, 'node', installTarballs, packageNames);
    await verifyNodeJavascriptProject(toolCli, installTarballs, packageNames);
    await verifyInitializedProject(toolCli, 'fastly', installTarballs, packageNames);
    await verifyFastlyJavascriptProject(toolCli, installTarballs, packageNames);
    await verifyGripProject(installTarballs, packageNames);
    await verifyRouterProject(installTarballs, packageNames);
  } catch (error) {
    acceptanceError = error;
  } finally {
    try { registryClosure = await registry.close(); }
    catch (registryError) {
      if (acceptanceError) throw new AggregateError([acceptanceError, registryError], 'clean-machine acceptance and registry shutdown both failed');
      throw registryError;
    }
  }
  if (acceptanceError) throw acceptanceError;

  console.log(`ok - all ${packageNames.length} packed Pulse ${RELEASE_VERSION} packages install at the exact candidate version without workspace links; the @pulse-compute scope remains fail-closed through ${REGISTRY_VERSION} while third-party dependencies resolve from ${PUBLICATION.registry}; ${registryClosure.requests.total} read-only Pulse registry requests served with no missing or mutating requests; clean projects drive Native and JavaScript Node/Fastly init, doctor, inspect, test, dev, portable compile, deterministic executable JavaScript source packaging, Native Node/Fastly build, GRIP build, and static Router compile/build`);
}

function formatError(error, indent = '') {
  const primary = error && error.stack ? error.stack : String(error);
  const nested = error && Array.isArray(error.errors)
    ? error.errors.map((entry, index) => `${indent}cause ${index + 1}:\n${formatError(entry, `${indent}  `)}`).join('\n')
    : '';
  return nested ? `${primary}\n${nested}` : primary;
}

main().catch((error) => { console.error(formatError(error)); process.exit(1); });
