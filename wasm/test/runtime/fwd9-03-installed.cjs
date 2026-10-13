#!/usr/bin/env node
'use strict';
const { installedAcceptanceReport } = require('../support/installed-acceptance-report.cjs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { packRelease, readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../release/read-only-npm-registry.cjs');
const root = path.resolve(__dirname, '../../..');
const target = 'native';
const selectedProfile = 'fastly-native';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-fwd9-03-installed-'));
assert.ok(!temporary.startsWith(root + path.sep), 'installed consumer must be outside the checkout');
const consumer = path.join(temporary, 'consumer');
const pack = path.join(temporary, 'packages');
const reportParent = path.join(root, 'wasm/.test-results');
fs.mkdirSync(reportParent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(reportParent, 'fwd9-03-installed-'));
const reportFile = installedAcceptanceReport(path.join(reportDir, 'fwd9-03-installed-acceptance.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sensitive = [];
const clean = text => sensitive.reduce((value, secret) => value.replaceAll(secret, '<redacted>'), text.replaceAll(temporary, '<acceptance>').replaceAll(root, '<checkout>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<token>'));
const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_cache: path.join(temporary, 'npm-cache'), npm_config_fetch_retries: '0' };
for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY'])
    delete env[key];
const report = { version: 'pulse.fwd9-03-installed-acceptance.v1', status: 'running',
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    workingDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })),
    acceptanceScriptSha256: hash(fs.readFileSync(__filename)),
    node: process.version, fixture: 'fwd9-03-installed-workflow', target, lifecycleScripts: false,
    providerRealityValidated: false, results: [],
    oracles: Object.fromEntries(['wasm/test/support/fastly-forwarding-qualification.cjs', 'wasm/test/support/fastly-forwarding-viceroy.cjs', 'packages/provider-fastly/src/testing/native-platform-capabilities-host.js'].map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) };
function saveReport() {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(reportFile + '.tmp', reportFile);
}
function run(command, args, { timeout = 120000, onOutput, allowFailure = false } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: consumer, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        let stdout = '', stderr = '', failure;
        const stop = error => {
            failure ||= error;
            try {
                process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL');
            }
            catch { }
        };
        const timer = setTimeout(() => stop(new Error(`command timed out after ${timeout}ms`)), timeout);
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (stdout.length + stderr.length > 8 * 1024 * 1024)
                stop(new Error('command output exceeded 8 MiB'));
            if (onOutput) {
                try {
                    onOutput(stdout);
                }
                catch (error) {
                    stop(error);
                }
            }
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            if (stdout.length + stderr.length > 8 * 1024 * 1024)
                stop(new Error('command output exceeded 8 MiB'));
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            const record = { command: path.basename(command), args: args.map(clean), code, signal, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
            report.results.push(record);
            saveReport();
            let diagnostic;
            try {
                const value = JSON.parse(stdout);
                diagnostic = JSON.stringify({ error: value.error, checks: value.checks?.filter(c => c.status === 'failed'), cases: value.cases?.filter(c => c.status === 'failed'), diagnostics: value.diagnostics });
            }
            catch {
                diagnostic = (stdout + stderr).slice(-6000);
            }
            if (failure || (!allowFailure && code !== 0) || signal)
                reject(new Error(`${failure?.message || 'command failed'}: ${JSON.stringify(record)} ${clean(diagnostic)}`));
            else
                resolve({ stdout, stderr, code });
        });
    });
}
function verifyInstalled(manifest) {
    const digests = [], packages = [];
    for (const name of fs.readdirSync(path.join(consumer, 'node_modules/@pulse-compute')).sort()) {
        const id = '@pulse-compute/' + name;
        const entry = manifest.packages.find(item => item.name === id);
        assert.ok(entry, `unexpected installed Pulse package ${id}`);
        const packageRoot = path.join(consumer, 'node_modules', id);
        assert.ok(fs.realpathSync(packageRoot).startsWith(consumer + path.sep), `workspace link: ${id}`);
        assert.equal(readJson(path.join(packageRoot, 'package.json')).version, entry.version);
        const tarball = path.join(pack, entry.tarball);
        assert.equal(hash(fs.readFileSync(tarball)), entry.sha256);
        for (const [file, bytes] of readTarEntries(tarball)) {
            if (!file.startsWith('package/') || file.endsWith('/'))
                continue;
            let installed = path.join(packageRoot, file.slice(8));
            if (!fs.existsSync(installed) && path.basename(installed) === '.gitignore')
                installed = path.join(path.dirname(installed), '.npmignore');
            assert.deepEqual(fs.readFileSync(installed), bytes, `${id}/${file} differs from candidate`);
            digests.push([id + '/' + file.slice(8), hash(bytes)]);
        }
        packages.push({ name: id, version: entry.version, sha256: entry.sha256 });
    }
    for (const name of ['pulse', 'cli', 'provider-fastly'])
        assert.ok(packages.some(entry => entry.name === '@pulse-compute/' + name));
    return { packages, files: digests.length, sha256: hash(JSON.stringify(digests.sort())) };
}
async function main() {
    const { qualifyAbi, config, source } = require('../support/fastly-forwarding-qualification.cjs');
    const { qualifyViceroy } = require('../support/fastly-forwarding-viceroy.cjs');
    try {
        assert.ok(process.env.PULSE_VICEROY_BIN, 'FWD9-03 installed qualification requires explicit PULSE_VICEROY_BIN');
        saveReport();
        console.log('fwd9-03-installed - pack and install exact candidates');
        const packed = packRelease({ repoRoot: root, outDir: pack });
        const version = packed.manifest.packages.find(p => p.name === '@pulse-compute/pulse').version;
        fs.mkdirSync(consumer, { recursive: true });
        fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'fwd9-03-consumer', private: true, type: 'module', dependencies: Object.fromEntries(['pulse', 'cli', 'provider-fastly'].map(name => ['@pulse-compute/' + name, version])) }));
        const registry = createReadOnlyRegistry(catalogFromTarballs(packed.manifest.packages.map(p => path.join(pack, p.tarball))));
        await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
        try {
            fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
            await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { timeout: 180000 });
            assert.equal(registry.requests.missing, 0);
            assert.equal(registry.requests.rejected, 0);
        }
        finally {
            await new Promise(resolve => registry.server.close(resolve));
        }
        report.installed = verifyInstalled(packed.manifest);
        saveReport();
        for (const name of ['src', '.pulse', 'tests'])
            fs.mkdirSync(path.join(consumer, name));
        fs.writeFileSync(path.join(consumer, 'src/index.ts'), source);
        fs.writeFileSync(path.join(consumer, 'tests/pulse.harness.ts'), 'export default ' + JSON.stringify([{ name: 'opaque-forward', request: { method: 'POST', path: '/', body: 'opaque' }, fetches: { 'https://origin.example/upload': { status: 200, text: 'received' } }, expect: { status: 200, text: 'received', bodyClass: 'opaque' } }, { name: 'precommit-denial', request: { method: 'POST', path: '/', headers: { 'content-length': '1048577' } }, expect: { status: 413, bodyClass: 'structured' } }]));
        const project = { pulse: { entry: 'src/index.ts', tests: 'tests/pulse.harness.ts', strict: false, defaultProfile: selectedProfile }, [selectedProfile]: { host: 'fastly', target: 'native', fastly: config } };
        const writeConfig = () => fs.writeFileSync(path.join(consumer, '.pulse/config.ts'), `import {defineConfig} from '@pulse-compute/pulse';export default defineConfig(_=>(${JSON.stringify(project)}));`);
        writeConfig();
        const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js');
        const command = async (name) => JSON.parse((await run(process.execPath, [cli, name, '--profile', selectedProfile, '--json'])).stdout);
        report.workflows = [];
        let wasmFile, test;
        for (const name of ['doctor', 'inspect', 'test', 'build', 'report']) {
            console.log('fwd9-03-installed - ' + name);
            const value = await command(name);
            if (name === 'doctor') {
                assert.equal(value.summary.failed, 0);
                report.doctorWarnings = value.checks.filter(x => x.status === 'warning').map(({ id, message }) => ({ id, message }));
            }
            else if (name === 'inspect')
                assert.equal(value.status, 'ok');
            else if (name === 'test') {
                assert.equal(value.status, 'passed');
                test = value;
            }
            else if (name === 'build') {
                assert.equal(value.status, 'built');
                wasmFile = path.join(value.outDir, 'bin/main.wasm');
                report.wasmSha256 = hash(fs.readFileSync(wasmFile));
                assert.equal(readJson(path.join(value.outDir, 'fastly-native-manifest.json')).wasm.sha256, report.wasmSha256);
                const imports=WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(wasmFile)));
                assert.ok(imports.some(x=>x.name==='send_async_streaming'));
                assert.ok(!imports.some(x=>x.module==='pulse_host'));
                report.nativeExecutions = test.cases.map(c => c.executionEvidence);
                assert.ok(test.cases.every(c => c.executionEvidence?.kind === 'fastly-native-fixture-abi' && c.executionEvidence.providerRealityValidated === false && c.executionEvidence.wasmSha256 === report.wasmSha256));
            }
            report.workflows.push({ command: name, status: value.status || value.eligibility, outputSha256: hash(JSON.stringify(value)) });
            saveReport();
        }
        report.abi = qualifyAbi(fs.readFileSync(wasmFile));
        saveReport();
        report.viceroy = await qualifyViceroy(wasmFile, consumer);
        saveReport();
        report.variants = [];
        for (const [name, fastly, limits] of [
            ['independent-caps', { ...config, bodyForwarding: { requestMaxBytes: 33, responseMaxBytes: 65 } }, { requestCap: 33, responseCap: 65 }],
            ['earlier-request-deadline', { ...config, maxDurationMs: 1000 }, { deadline: 1000 }]
        ]) {
            project[selectedProfile].fastly = fastly;
            writeConfig();
            const built = await command('build');
            assert.equal(built.status, 'built');
            report.variants.push({ name, ...qualifyAbi(fs.readFileSync(path.join(built.outDir, 'bin/main.wasm')), limits) });
            saveReport();
        }
        project[selectedProfile].fastly = config;
        writeConfig();
        const restored = await command('build');
        assert.equal(hash(fs.readFileSync(path.join(restored.outDir, 'bin/main.wasm'))), report.wasmSha256, 'restored build must emit identical bytes');
        report.rejections = [];
        for (const [name, mutate] of [
            ['missing-opt-in', () => { delete project[selectedProfile].fastly.bodyForwarding; }],
            ['javascript-target', () => { project[selectedProfile].target = 'javascript'; }],
            ['dynamic-backend', () => { project[selectedProfile].fastly.bindings = { ...config.bindings, dynamicBackends: true }; }]
        ]) {
            project[selectedProfile] = { host: 'fastly', target: 'native', fastly: JSON.parse(JSON.stringify(config)) };
            mutate();
            writeConfig();
            const rejected = await run(process.execPath, [cli, 'build', '--profile', selectedProfile, '--json'], { allowFailure: true });
            assert.notEqual(rejected.code, 0, name);
            const output = rejected.stdout + rejected.stderr;
            const expected = name === 'javascript-target' ? /PULSE_REQUEST_DURATION_UNSUPPORTED/ : /PULSE_FASTLY_BODY_FORWARDING_INVALID|PULSE_PROVIDER_CAPABILITY_UNSUPPORTED|fastly-incoming-body-forwarding-unavailable/;
            assert.match(output, expected);
            report.rejections.push({name, diagnostic:output.match(expected)[0]});
        }
        assert.deepEqual(verifyInstalled(packed.manifest), report.installed);
        report.installed.unchanged = true;
        report.status = 'passed';
        console.log('ok - FWD9-03 exact installed workflow, ABI matrix and pinned local Viceroy');
    }
    catch (error) {
        report.status = 'failed';
        report.error = clean(error.stack || String(error));
        throw error;
    }
    finally {
        saveReport();
        fs.rmSync(temporary, { recursive: true, force: true });
        console.log('acceptance report - ' + reportFile);
    }
}
main().catch(error => { console.error(clean(error.stack || String(error))); process.exitCode = 1; });
