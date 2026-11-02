'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

module.exports = function assertInstalledFetchMethodTypes(repoRoot) {
  const root = fs.mkdtempSync(path.join(process.env.PULSEWASM_TEST_TMP_ROOT || os.tmpdir(), 'fetch-types-'));
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const options = { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 };
    const [packed] = JSON.parse(execFileSync(npm, ['pack', path.join(repoRoot, 'packages/runtime'),
      '--offline', '--ignore-scripts', '--json', '--pack-destination', root], options));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fetch-types-consumer', private: true }));
    execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      '--package-lock=false', path.join(root, packed.filename)], options);
    const installed = path.join(root, 'node_modules/@pulse-compute/runtime');
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
    assert.deepEqual(fs.readFileSync(path.join(installed, 'src/index.d.ts')),
      fs.readFileSync(path.join(repoRoot, 'packages/runtime/src/index.d.ts')));
    const file = path.join(root, 'consumer.ts');
    fs.copyFileSync(path.join(repoRoot, 'packages/runtime/test/fetch-method-types.ts'), file);
    const program = ts.createProgram([file], {
      noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true, types: [],
    });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(entry =>
      ts.flattenDiagnosticMessageText(entry.messageText, '\n')), [], 'installed runtime fetch method types');
    assert.ok(program.getSourceFiles().some(source => source.fileName === path.join(installed, 'src/index.d.ts')),
      'consumer must resolve the installed declaration without workspace aliases');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
