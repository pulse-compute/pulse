'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Also runs against an exact installed package. Faults use a separate copy;
// successful qualification never patches the candidate installation.
function runDocsLocatorCases(cliRoot, options = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse docs locator '));
  let checks = 0;
  try {
    const cwd = path.join(temporary, 'unrelated project with spaces');
    fs.mkdirSync(path.join(cwd, '.pulse'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'docs'));
    fs.writeFileSync(path.join(cwd, 'docs/README.md'), 'Wrong documentation');
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"version":"0.0.0-decoy"}');
    fs.writeFileSync(path.join(cwd, '.pulse/config.ts'), "throw new Error('PROJECT_MUST_NOT_LOAD');");
    const guard = path.join(temporary, 'offline guard.cjs');
    fs.writeFileSync(guard, `const M=require('node:module'),load=M._load,fs=require('node:fs');
M._load=function(id,...args){if(/project-config|project-execution|compiler|provider|typescript|child_process|^(node:)?(http|https|http2|net|tls|dns|dgram)$/.test(id))throw Error('FORBIDDEN_IMPORT:'+id);return load.call(this,id,...args);};
global.fetch=()=>{throw Error('FORBIDDEN_NETWORK');};
for(const name of ['writeFile','appendFile','mkdir','rename','rm','unlink','symlink','copyFile','truncate'])fs.promises[name]=()=>{throw Error('FORBIDDEN_WRITE:'+name);};
for(const name of ['writeFileSync','appendFileSync','mkdirSync','renameSync','rmSync','unlinkSync','symlinkSync','copyFileSync','truncateSync','writeFile','appendFile','mkdir','rename','rm','unlink','symlink','copyFile','truncate','watch'])fs[name]=()=>{throw Error('FORBIDDEN_WRITE:'+name);};`);
    const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, NODE_OPTIONS: '--require=' + JSON.stringify(guard), PULSE_PROFILE: 'must-not-select-a-profile' };
    delete env.NODE_PATH;
    function invoke(args, status = 0, root = cliRoot, workingDirectory = cwd) {
      const useBin = root === cliRoot && options.binary && process.platform !== 'win32';
      const child = spawnSync(useBin ? options.binary : process.execPath, useBin ? ['docs', ...args] : [path.join(root, 'bin/pulse.js'), 'docs', ...args], { cwd: workingDirectory, env, encoding: 'utf8', timeout: 10000 });
      assert.ifError(child.error); assert.equal(child.status, status, child.stderr);
      assert.equal(status ? child.stdout : child.stderr, ''); checks++;
      return status ? child.stderr : child.stdout;
    }
    const version = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'))).version;
    const root = fs.realpathSync(path.join(cliRoot, 'docs')), index = fs.realpathSync(path.join(root, 'README.md'));
    const expected = { status: 'ok', version, docs: { root, index } };
    assert.deepEqual(JSON.parse(invoke(['--json'])), expected);
    const empty = path.join(temporary, 'empty directory'); fs.mkdirSync(empty);
    assert.deepEqual(JSON.parse(invoke(['--json'], 0, cliRoot, empty)), expected);
    assert.equal(invoke([]), `Pulse CLI ${version}\n${index}\n`);
    assert(fs.statSync(index).isFile()); assert(path.isAbsolute(index));
    const envelope = JSON.parse(invoke(['--evidence-status']));
    assert.deepEqual(envelope.result, expected); assert.equal(envelope.evidence.state, 'not-collected');
    assert.equal(envelope.evidence.identity, null);
    for (const flag of ['--plan', '--dry-run']) {
      const planned = JSON.parse(invoke([flag, '--json']));
      assert.equal(planned.plan.mode, 'installed-documentation'); assert.equal(planned.plan.backgroundWork, false);
      assert.equal(planned.plan.docs, undefined);
    }
    assert(invoke(['--help']).includes('pulse docs [--json]'));
    for (const args of [['unexpected-directory'], ['--profile', 'other'], ['--out', 'elsewhere']]) {
      const failure = JSON.parse(invoke([...args, '--json'], 2)); assert.equal(failure.error.code, 'PULSE_ARGUMENT_UNEXPECTED');
    }
    // Index links may include the package's API.md, but never another package,
    // a checkout or a globally inferred npm path. Validate actual installed bytes.
    const links = [...fs.readFileSync(index, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
    let relativeLinks = 0;
    const packageRoot = fs.realpathSync(cliRoot);
    for (const target of links) {
      if (/^[a-z][a-z\d+.-]*:|^#|^\//i.test(target)) continue;
      const file = fs.realpathSync(path.resolve(path.dirname(index), decodeURIComponent(target.split('#')[0])));
      const relative = path.relative(packageRoot, file);
      assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
      assert(fs.statSync(file).isFile()); relativeLinks++;
    }
    assert(relativeLinks > 0);

    const broken = path.join(temporary, 'separate damaged CLI');
    fs.cpSync(cliRoot, broken, { recursive: true, filter: source => !path.relative(cliRoot, source).split(path.sep).includes('node_modules') });
    const brokenIndex = path.join(broken, 'docs/README.md'), original = fs.readFileSync(brokenIndex);
    function failure(code) {
      const value = JSON.parse(invoke(['--json'], 5, broken));
      assert.equal(value.error.code, code); assert.equal(value.error.scope, 'public');
      assert(value.error.docs.includes('#' + code.toLowerCase().replaceAll('_', '-')));
    }
    fs.renameSync(path.join(broken, 'docs'), path.join(broken, 'saved-docs'));
    failure('PULSE_DOCS_UNAVAILABLE');
    assert.equal(JSON.parse(invoke(['--plan', '--json'], 0, broken)).plan.command, 'docs');
    fs.renameSync(path.join(broken, 'saved-docs'), path.join(broken, 'docs'));
    fs.unlinkSync(brokenIndex); failure('PULSE_DOCS_UNAVAILABLE');
    fs.mkdirSync(brokenIndex); failure('PULSE_DOCS_INVALID'); fs.rmdirSync(brokenIndex);
    for (const bytes of [Buffer.from(' \n'), Buffer.from([255, 254]), Buffer.from('index\0binary')]) {
      fs.writeFileSync(brokenIndex, bytes); failure('PULSE_DOCS_INVALID');
    }
    fs.unlinkSync(brokenIndex);
    const outside = path.join(temporary, 'outside.md'); fs.writeFileSync(outside, '# Outside');
    fs.symlinkSync(outside, brokenIndex); failure('PULSE_DOCS_INVALID'); fs.unlinkSync(brokenIndex);
    fs.writeFileSync(brokenIndex, original);
    fs.renameSync(path.join(broken, 'docs'), path.join(broken, 'saved-docs'));
    fs.symlinkSync(path.dirname(outside), path.join(broken, 'docs'), 'dir'); failure('PULSE_DOCS_INVALID');
    return { status: 'passed', checks, relativeIndexLinks: relativeLinks, offlineGuard: true, hostileCwdIgnored: true, faultCopiesOnly: true, publicBin: Boolean(options.binary) && process.platform !== 'win32' };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

module.exports = { runDocsLocatorCases };
