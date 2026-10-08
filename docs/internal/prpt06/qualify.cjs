#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function main() {
    const [consumerArg, projectArg, profile, manifestArg, outArg] = process.argv.slice(2);
    assert(outArg, 'Usage: node qualify.cjs CONSUMER PROJECT PROFILE MANIFEST OUTPUT');
    const consumer = path.resolve(consumerArg), project = path.resolve(projectArg), manifestFile = path.resolve(manifestArg), out = path.resolve(outArg);
    assert(out !== project && !out.startsWith(project + path.sep), 'Qualification receipts belong outside project inputs');
    fs.mkdirSync(out, { recursive: true });
    const cli = path.join(consumer, 'node_modules/@pulse-compute/cli/bin/pulse.js'), cliRoot = path.dirname(path.dirname(cli));
    const { parseCapsule, serializeCapsule } = require(path.join(cliRoot, 'src/internal/report/capsule.js'));
    const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
    for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'PULSE_PROFILE'])
        delete env[k];
    const result = { kind: 'pulse.report-qualification.v1', status: 'running', environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length }, profile, samples: [], checks: [], costMethod: 'Three sequential fresh CLI processes per mode; OS caches are not flushed. Elapsed includes CLI startup/import/collection/rendering; Linux maxRSS is KiB. Build time is excluded.' };
    const save = () => fs.writeFileSync(path.join(out, 'qualification.json'), JSON.stringify(result, null, 2) + '\n');
    save();
    let counter = 0;
    function run(label, args, mode = 'artifact', cwd = project) {
        const receipt = path.join(out, 'worker-' + (++counter) + '.json'), start = process.hrtime.bigint();
        fs.rmSync(receipt, { force: true });
        const p = spawnSync(process.execPath, [path.join(__dirname, 'measure-worker.cjs'), receipt, cli, mode, ...args], { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 72 * 1024 * 1024 });
        const cost = fs.existsSync(receipt) ? read(receipt) : null;
        result.samples.push({ label, ...cost, wallMs: Number(process.hrtime.bigint() - start) / 1e6, stdoutBytes: Buffer.byteLength(p.stdout || ''), stdoutSha256: hash(p.stdout || ''), stderrSha256: hash(p.stderr || '') });
        save();
        assert.ifError(p.error);
        assert.equal(p.status, 0, label + ': ' + p.stderr);
        assert.equal(cost?.exitCode, 0);
        assert.deepEqual(cost.blocked, []);
        return p.stdout;
    }
    try {
        const manifest = read(manifestFile), completion = read(path.resolve(path.dirname(manifestFile), manifest.reportCompletion.file));
        const physical = completion.artifacts.map(a => {
            const file = path.resolve(path.dirname(manifestFile), a.file);
            assert(file.startsWith(path.dirname(manifestFile) + path.sep));
            const bytes = fs.readFileSync(file);
            assert.equal(hash(bytes), a.sha256);
            return { ...a, file };
        });
        const json = run('project-json', ['report', '--profile', profile, '--json'], 'project'), capsule = parseCapsule(json);
        assert.equal(serializeCapsule(capsule), json);
        fs.writeFileSync(path.join(out, 'capsule.json'), json);
        for (let i = 0; i < 2; i++)
            assert.equal(run('project-json', ['report', '--profile', profile, '--json'], 'project'), json);
        for (let i = 0; i < 3; i++)
            assert.equal(run('artifact-json', ['report', '--artifact', manifestFile, '--json']), json);
        for (let i = 0; i < 3; i++)
            assert.equal(run('historical-json', ['report', '--artifact', path.join(out, 'capsule.json'), '--json']), json);
        const primary = capsule.artifacts.find(a => a.id === capsule.context.primaryArtifactId);
        const terminal = run('terminal', ['report', '--artifact', manifestFile]);
        assert(terminal.includes(primary.bytes + ' bytes'));
        assert(terminal.includes(capsule.evidenceHash.value.slice(0, 12)));
        fs.writeFileSync(path.join(out, 'terminal.txt'), terminal);
        // Project output receipts must preserve freshness after repeated HTML writes.
        const relative = '.pulse/reports/prpt06.html';
        let html;
        for (let i = 0; i < 3; i++) {
            run('project-html', ['report', '--profile', profile, '--html', '--out', relative], 'project');
            const bytes = fs.readFileSync(path.join(project, relative), 'utf8');
            if (html)
                assert.equal(bytes, html);
            html = bytes;
        }
        const payload = html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
        assert.equal(serializeCapsule(JSON.parse(payload)), json);
        fs.writeFileSync(path.join(out, 'report.html'), html);
        assert.equal(run('project-after-html', ['report', '--profile', profile, '--json'], 'project'), json);
        // Artifact mode must work without project code/config, and render replay costs
        // separately. The canary project must never be executed.
        const replay = path.join(out, 'replay');
        fs.mkdirSync(path.join(replay, '.pulse'), { recursive: true });
        fs.writeFileSync(path.join(replay, '.pulse/config.ts'), "throw new Error('PRPT06_CONFIG_EXECUTED');\n");
        for (let i = 0; i < 3; i++)
            run('historical-html', ['report', '--artifact', path.join(out, 'capsule.json'), '--html', '--out', 'replay/report.html'], 'artifact', replay);
        const replayHtml = fs.readFileSync(path.join(replay, 'report.html'), 'utf8');
        assert.equal(serializeCapsule(JSON.parse(replayHtml.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1])), json);
        for (const a of physical)
            assert.equal(hash(fs.readFileSync(a.file)), a.sha256);
        const names = ['routes', 'entries', 'schemas', 'bindings', 'resources'];
        result.capsule = { sha256: hash(json), evidenceHash: capsule.evidenceHash.value, jsonBytes: Buffer.byteLength(json), htmlBytes: Buffer.byteLength(html), counts: Object.fromEntries(names.map(n => [n, capsule[n].length])), coverage: capsule.coverage, artifacts: capsule.artifacts.map(a => ({ id: a.id, stage: a.stage, bytes: a.bytes, sha256: a.sha256, sectionBytes: 8 + a.sections.reduce((n, s) => n + s.bytes, 0) })), mappedRoutes: capsule.routes.filter(r => capsule.measurements.some(m => m.subjectId === r.id && m.artifactId === primary.id && m.metric === 'handler-body' && m.fact.state === 'available')).length, reachableRoutes: capsule.routes.filter(r => capsule.measurements.some(m => m.subjectId === r.id && m.artifactId === primary.id && m.metric === 'reachable' && m.fact.state === 'available')).length };
        assert(result.capsule.artifacts.every(a => a.bytes === a.sectionBytes));
        result.checks = ['canonical JSON equals HTML payload', 'project/artifact/historical JSON byte-identical', 'repeat generation deterministic', 'project remains fresh after HTML writes', 'terminal artifact size and evidence identity agree', 'canary config not executed in historical replay', 'native compiler/provider/subprocess/network imports blocked; project static config parser allowed', 'exact guest hashes unchanged by reporting', 'physical sections reconcile'];
        result.status = 'passed';
        save();
        console.log(JSON.stringify({ status: result.status, ...result.capsule }));
    }
    catch (error) {
        result.status = 'failed';
        result.failure = { name: error.name, code: error.code || null, message: String(error.message).slice(0, 500) };
        save();
        throw error;
    }
}
try {
    main();
}
catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
}
