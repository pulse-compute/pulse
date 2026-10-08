#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..'), cli = path.join(root, 'wasm/packages/cli');
const f = require('./report-fixtures.cjs');
const { createCapsule, serializeCapsule } = require(path.join(f.reportRoot, 'capsule'));
const { writeHtml } = require(path.join(f.reportRoot, 'output'));
const { parseCommandRequest, normalizeCommandRequest } = require(path.join(cli, 'src/internal/command-request'));
const { planReport, executeReport, publicReportError } = require(path.join(f.reportRoot, 'command'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-report-cli-'));
let checks = 0;
function check(value, message) { checks++; assert.ok(value, message); }
function run(args, extra = {}) {
  const result = spawnSync(process.execPath, [path.join(cli, 'bin/pulse.js'), 'report', ...args], { cwd: directory, encoding: 'utf8', ...extra });
  assert.ifError(result.error); return result;
}
function reject(args, code, status = 3) {
  const result = run([...args, '--json']);
  assert.equal(result.status, status, result.stderr); assert.equal(result.stdout, '');
  const diagnostic = JSON.parse(result.stderr).error;
  assert.equal(diagnostic.code, code); assert.equal(diagnostic.scope, 'public');
  check(diagnostic.docs.endsWith('#' + code.toLowerCase().replaceAll('_', '-')), 'stable diagnostic anchor');
}
try {
  const value = f.fixture(); value.application.name = '<b>\x1b]52;c;PAYLOAD\x07\nFORGED\u202e';
  const capsule = createCapsule(value), text = serializeCapsule(capsule);
  fs.writeFileSync(path.join(directory, 'saved.json'), text);
  fs.mkdirSync(path.join(directory, '.pulse')); fs.mkdirSync(path.join(directory, 'src'));
  fs.writeFileSync(path.join(directory, '.pulse/config.ts'), "throw new Error('CONFIG_EXECUTED');");
  fs.writeFileSync(path.join(directory, 'src/index.ts'), "throw new Error('APP_EXECUTED');");
  const output = run(['--artifact', 'saved.json', '--json']);
  assert.equal(output.status, 0, output.stderr); assert.equal(output.stderr, ''); assert.equal(output.stdout, text);
  check(JSON.parse(output.stdout).evidenceHash.value === capsule.evidenceHash.value, 'historical identity');
  const human = run(['--artifact', 'saved.json']); assert.equal(human.status, 0, human.stderr);
  check(human.stdout.includes('historical replay; current project not checked'), 'historical disclosure');
  check(!/[\x00-\x09\x0b-\x1f\x7f-\x9f\u202e<>]/.test(human.stdout), 'terminal controls and markup escaped');
  check(human.stdout.split('\n').length <= 12, 'bounded overview');
  check(human.stdout.includes('36 bytes'), 'exact artifact bytes');
  const partial = f.fixture(false);
  for (const name of Object.keys(partial.coverage)) partial.coverage[name] = { status: 'unavailable', observed: 0, expected: null, reason: 'missing-evidence' };
  fs.writeFileSync(path.join(directory, 'partial.json'), serializeCapsule(createCapsule(partial)));
  const partialOutput = run(['--artifact', 'partial.json']); assert.equal(partialOutput.status, 0, partialOutput.stderr);
  check(partialOutput.stdout.includes('routes: unavailable | handlers: unavailable'), 'unknown inventory is not presented as zero');

  for (const flag of ['--plan', '--dry-run']) {
    const plan = run(['--artifact', 'absent.json', flag, '--json']); assert.equal(plan.status, 0, plan.stderr);
    check(JSON.parse(plan.stdout).plan.collectOnExecution, 'plan does not read artifact');
    const project = run([flag, '--json']); assert.equal(project.status, 0, project.stderr);
    check(JSON.parse(project.stdout).plan.profileSelection === 'on-collection', 'plan does not parse executable config');
    const html = run(['--artifact', 'saved.json', '--html', flag]); assert.equal(html.status, 0, html.stderr);
    check(html.stdout.includes('.pulse/reports/pulse-report.html'), 'default output intent');
    check(!fs.existsSync(path.join(directory, '.pulse/reports')), 'plan never writes');
  }
  for (const args of [['--json', '--html'], ['--out', 'report.html'], ['.', '--artifact', 'saved.json'], ['--artifact', 'saved.json', '--profile', 'native']]) reject(args, 'PULSE_ARGUMENT_UNEXPECTED', 2);
  assert.throws(() => normalizeCommandRequest({ kind: 'command', command: 'report', html: true, json: true }), { code: 'PULSE_ARGUMENT_UNEXPECTED' });
  reject(['--artifact', 'absent.json'], 'PULSE_REPORT_EVIDENCE_MISSING');
  fs.writeFileSync(path.join(directory, 'bad.json'), '{'); reject(['--artifact', 'bad.json'], 'PULSE_REPORT_INPUT_INVALID');
  fs.writeFileSync(path.join(directory, 'bare.wasm'), f.wasm); reject(['--artifact', 'bare.wasm'], 'PULSE_REPORT_INPUT_INVALID');
  const changed = JSON.parse(text); changed.application.name = 'tampered'; fs.writeFileSync(path.join(directory, 'bad.json'), JSON.stringify(changed)); reject(['--artifact', 'bad.json'], 'PULSE_REPORT_INPUT_INVALID');
  for (const [internal, stable] of [['REPORT_STALE_INPUTS', 'STALE'], ['REPORT_CONCURRENT_CHANGE', 'STALE'], ['REPORT_UNSUPPORTED_TARGET', 'INCOMPATIBLE'], ['REPORT_INPUT_VERSION', 'INCOMPATIBLE'], ['REPORT_MISSING_COMPLETION', 'EVIDENCE_MISSING'], ['REPORT_ARTIFACT_HASH', 'INPUT_INVALID']]) {
    assert.equal(publicReportError({ code: internal, message: 'SECRET' }).code, 'PULSE_REPORT_' + stable);
    check(!publicReportError({ code: internal, message: 'SECRET' }).message.includes('SECRET'), 'no internal diagnostic payload');
  }
  const html = run(['--artifact', 'saved.json', '--html']); assert.equal(html.status, 0, html.stderr);
  const htmlOutput = fs.readFileSync(path.join(directory, '.pulse/reports/pulse-report.html'), 'utf8');
  check(htmlOutput.includes('pulse-report-viewer'), 'production offline viewer emitted');
  assert.deepEqual(JSON.parse(htmlOutput.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]), capsule);
  const repeat = run(['--artifact', 'saved.json', '--html']); assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(fs.readFileSync(path.join(directory, '.pulse/reports/pulse-report.html'), 'utf8'), htmlOutput);
  for (const out of ['../escape.html', 'saved.json', 'bad.txt', 'bad%.html', 'bad:name.html', 'bad\nname.html', path.join(os.tmpdir(), 'escape.html')]) {
    const result = run(['--artifact', 'saved.json', '--html', '--out', out, '--plan']);
    assert.equal(result.status, 2, result.stderr); check(result.stderr.includes('PULSE_REPORT_OUTPUT_UNSAFE'), 'unsafe path rejected during plan');
  }
  fs.symlinkSync(path.join(directory, 'absent'), path.join(directory, 'dangling.html'));
  fs.symlinkSync(os.tmpdir(), path.join(directory, 'link'));
  fs.mkdirSync(path.join(directory, 'folder.html'));
  for (const out of ['dangling.html', 'link/escape.html', 'folder.html']) assert.throws(() => writeHtml(directory, out, '<!doctype html>test'), { code: 'PULSE_REPORT_OUTPUT_UNSAFE' });
  const request = parseCommandRequest(['report', '--artifact', 'saved.json', '--html', '--out', 'nested/view.html']);
  const plan = planReport(request, { cwd: directory });
  const rendered = executeReport(plan, request, { reportRenderer: c => '<!doctype html><title>' + c.evidenceHash.value + '</title>' });
  assert.equal(rendered.file, path.join(directory, 'nested/view.html'));
  check(fs.readFileSync(rendered.file, 'utf8').includes(capsule.evidenceHash.value), 'internal renderer consumes validated capsule');
  fs.writeFileSync(path.join(directory, 'nested/unrelated.txt'), 'keep');
  writeHtml(directory, 'nested/view.html', '<!doctype html>replacement');
  assert.equal(fs.readFileSync(rendered.file, 'utf8'), '<!doctype html>replacement');
  assert.deepEqual(fs.readdirSync(path.dirname(rendered.file)).sort(), ['.pulse-report-outputs', 'unrelated.txt', 'view.html']);
  // A failed commit leaves the old designated file intact and cleans only its temporary.
  const rename = fs.renameSync; fs.renameSync = () => { throw new Error('injected rename failure'); };
  try { assert.throws(() => writeHtml(directory, 'nested/view.html', 'new'), { code: 'PULSE_REPORT_OUTPUT_FAILED' }); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(rendered.file, 'utf8'), '<!doctype html>replacement');
  assert.deepEqual(fs.readdirSync(path.dirname(rendered.file)).sort(), ['.pulse-report-outputs', 'unrelated.txt', 'view.html']);
  const lstat = fs.lstatSync; fs.lstatSync = () => { const error = new Error('permission denied'); error.code = 'EACCES'; throw error; };
  try { assert.throws(() => writeHtml(directory, 'nested/view.html', 'new'), { code: 'PULSE_REPORT_OUTPUT_FAILED' }); } finally { fs.lstatSync = lstat; }
  // Guard the real binary process, including its startup imports, against toolchain loading.
  const guard = path.join(directory, 'guard.cjs');
  fs.writeFileSync(guard, `const Module=require('node:module'),load=Module._load;Module._load=function(id,...rest){if(/compiler|provider|project-config\\.js|project-execution|typescript|child_process|node:https|node:http$|node:net$/.test(id))throw Error('FORBIDDEN_IMPORT:'+id);return load.call(this,id,...rest)};`);
  const guarded = run(['--artifact', 'saved.json', '--json'], { env: { ...process.env, NODE_OPTIONS: '--require=' + guard } });
  assert.equal(guarded.status, 0, guarded.stderr); assert.equal(guarded.stdout, text);
  const guardedHtml = run(['--artifact', 'saved.json', '--html'], { env: { ...process.env, NODE_OPTIONS: '--require=' + guard } });
  assert.equal(guardedHtml.status, 0, guardedHtml.stderr);
  const guardedError = run(['--artifact', 'bad.json', '--json'], { env: { ...process.env, NODE_OPTIONS: '--require=' + guard } });
  assert.equal(guardedError.status, 3, guardedError.stderr); check(!guardedError.stderr.includes('FORBIDDEN_IMPORT'), 'diagnostics avoid executable imports too');
  console.log(`ok - PRPT-04/05 CLI replay, planning, diagnostics, hostile terminal text, guarded imports and atomic offline HTML (${checks} checks)`);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
