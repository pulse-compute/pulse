#!/usr/bin/env node
'use strict';
// Exercise installed public surfaces, using only the installed source catalog.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const [consumerArg, outputArg] = process.argv.slice(2);
assert(consumerArg && outputArg, 'Usage: node check-installed.cjs CONSUMER OUTPUT_JSON');
const root = path.resolve(consumerArg, 'node_modules/@pulse-compute/cli');
const cli = path.join(root, 'bin/pulse.js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { version } = JSON.parse(read('package.json'));
const specOwner = require(path.join(root, 'src/command-spec.js'));
const completion = require(path.join(root, 'src/completion.js'));
const env = { ...process.env, NO_COLOR: '1' };
for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'PULSE_PROFILE'])
    delete env[key];
const run = args => execFileSync(process.execPath, [cli, ...args], {
    cwd: path.resolve(consumerArg), env, encoding: 'utf8', timeout: 30000
});
const spec = specOwner.publicCommandSpecDocument({ version, completionShells: completion.COMPLETION_SHELLS });
for (const file of ['cli-spec.json', 'docs/reference/cli-spec.json']) {
    assert.deepEqual(JSON.parse(read(file)), JSON.parse(JSON.stringify(spec)));
}
const help = run(['report', '--help']);
assert.equal(help, specOwner.renderUsage({ version, configFiles: ['.pulse/config.ts'] }));
const reference = read('docs/reference/cli.md');
for (const signature of specOwner.COMMAND_SPECS.report.usage) {
    assert(help.includes(signature));
    assert(reference.includes(signature));
}
const completions = [];
for (const shell of completion.COMPLETION_SHELLS) {
    const text = run(['completion', shell]);
    assert.equal(text, completion.renderCompletion(shell));
    assert.equal(text, read('completions/' + completion.completionFile(shell)));
    assert(text.includes('report'));
    completions.push({ shell, sha256: hash(text) });
}
assert.equal(run(['--version']).trim(), version);
const result = {
    kind: 'pulse.report-installed-command-proof.v1', status: 'passed', version,
    checks: ['installed help equals source catalog', 'machine specs equal source catalog',
        'Report reference contains public invocations', 'three shell completions equal installed files and source catalog',
        'installed version matches candidate'],
    helpSha256: hash(help), specSha256: hash(read('cli-spec.json')), completions
};
fs.writeFileSync(path.resolve(outputArg), JSON.stringify(result, null, 2) + '\n');
console.log('Installed command/help/reference/spec/completions passed');
