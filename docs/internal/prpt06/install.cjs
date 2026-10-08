#!/usr/bin/env node
'use strict';
// Explicit qualification helper, not a default test/release gate or publisher.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { readTarEntries } = require('../../../scripts/pack-release.cjs');
const { catalogFromTarballs, createReadOnlyRegistry } = require('../../../wasm/test/release/read-only-npm-registry.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
    const [packArg, workArg] = process.argv.slice(2);
    assert(packArg && workArg, 'Usage: node install.cjs PACK_DIRECTORY WORK_DIRECTORY');
    const pack = path.resolve(packArg), work = path.resolve(workArg), consumer = path.join(work, 'consumer');
    const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'pulse-release-manifest.json')));
    fs.mkdirSync(consumer, { recursive: true });
    assert(!fs.existsSync(path.join(consumer, 'node_modules')), 'Use a fresh consumer directory');
    const dependencies = Object.fromEntries(manifest.packages.map(p => [p.name, p.version]));
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'pulse-report-qualification', version: '1.0.0', private: true, dependencies }, null, 2) + '\n');
    const registry = createReadOnlyRegistry(catalogFromTarballs(manifest.packages.map(p => path.join(pack, p.tarball))));
    await new Promise((resolve, reject) => { registry.server.once('error', reject); registry.server.listen(0, '127.0.0.1', resolve); });
    const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_fetch_retries: '0', npm_config_cache: path.join(work, 'npm-cache') };
    for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'PULSE_PROFILE', 'npm_config_registry', 'NPM_CONFIG_REGISTRY'])
        delete env[key];
    fs.writeFileSync(path.join(consumer, '.npmrc'), `registry=https://registry.npmjs.org/\n@pulse-compute:registry=http://127.0.0.1:${registry.server.address().port}/\nreplace-registry-host=never\n`);
    try {
        await new Promise((resolve, reject) => {
            const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, env, stdio: 'inherit', detached: process.platform !== 'win32' });
            const timer = setTimeout(() => { try {
                process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL');
            }
            catch { } }, 180000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 && !signal ? resolve() : reject(Error('npm install failed: ' + code + ' ' + signal)); });
        });
    }
    finally {
        await new Promise(resolve => registry.server.close(resolve));
    }
    assert.equal(registry.requests.missing, 0);
    assert.equal(registry.requests.rejected, 0);
    const files = [], packages = [];
    for (const p of manifest.packages) {
        const tarball = path.join(pack, p.tarball), root = path.join(consumer, 'node_modules', p.name);
        assert.equal(hash(fs.readFileSync(tarball)), p.sha256);
        assert(fs.realpathSync(root).startsWith(consumer + path.sep), 'No workspace links');
        for (const [name, bytes] of readTarEntries(tarball)) {
            if (!name.startsWith('package/') || name.endsWith('/'))
                continue;
            let file = path.join(root, name.slice(8));
            if (!fs.existsSync(file) && path.basename(file) === '.gitignore')
                file = path.join(path.dirname(file), '.npmignore');
            assert.deepEqual(fs.readFileSync(file), bytes, p.name + '/' + name);
            files.push([p.name + '/' + name, hash(bytes)]);
        }
        packages.push({ name: p.name, version: p.version, sha256: p.sha256 });
    }
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli');
    for (const file of ['src/internal/report/viewer/shell.html', 'src/internal/report/viewer/viewer.js', 'src/internal/report/viewer/viewer.css', 'src/internal/report/capsule.schema.json'])
        assert(fs.statSync(path.join(cli, file)).size > 0, file);
    const result = { kind: 'pulse.report-installed-proof.v1', status: 'passed', node: process.version, lifecycleScripts: false, packages, installedFiles: files.length, installedFilesSha256: hash(JSON.stringify(files.sort())), registry: registry.requests };
    fs.writeFileSync(path.join(work, 'installed-proof.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('Installed and byte-verified ' + packages.length + ' packages / ' + files.length + ' files');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
