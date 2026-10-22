'use strict';

// Focused diagnostic check, not an additional release gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { parseStat, ownedRows, schedulingSnapshot, startObserver } = require('../../../scripts/release-resource-observer.cjs');

function stat(pid, parent, start, ticks, pages, name = 'a tricky ) name') {
  const f = Array(22).fill('0');
  Object.assign(f, { 0: 'S', 1: String(parent), 2: String(pid), 11: String(ticks), 12: '3', 19: String(start), 21: String(pages) });
  return `${pid} (${name}) ${f.join(' ')}`;
}
const a = parseStat(stat(10, 1, 100, 4, 2), 4096);
assert.equal(a.rssKiB, 8); assert.equal(a.cpuTicks, 7); assert.equal(a.key, '10:100');
assert.throws(() => parseStat('broken', 4096));
const b = parseStat(stat(11, 10, 101, 8, 3), 4096);
const c = parseStat(stat(12, 11, 102, 12, 4), 4096); // own detached process group
const foreign = parseStat(stat(20, 1, 200, 100, 100), 4096);
const known = new Set();
assert.deepEqual(ownedRows([a, b, c, foreign], a.key, known).map(r => r.pid), [10, 11, 12]);
assert.deepEqual(ownedRows([{ ...c, parent: 1 }, foreign], a.key, known).map(r => r.pid), [12], 'Retain a previously observed reparented child');
assert.deepEqual(ownedRows([{ ...c, key: '12:999', startTicks: '999', parent: 1 }, foreign], a.key, known), [], 'PID reuse cannot claim an unrelated process');
const tasks = { first: {}, next: {}, locked: {}, later: {} };
const hints = name => ({ compiler: true, priority: name === 'later' ? -1 : 0, resources: name === 'locked' ? ['socket'] : name === 'first' ? ['socket'] : [], after: [], exclusive: false });
const report = { runId: 'r', selectedTasks: Object.keys(tasks), currentTasks: ['first'], results: [], status: 'running', currentTaskPhases: { first: 'cleanup' } };
assert.deepEqual(schedulingSnapshot(report, tasks, hints, 1).compilerLimited, ['next']);
assert.deepEqual(schedulingSnapshot(report, tasks, hints, 2).compilerLimited, []);
assert.equal(schedulingSnapshot(report, {}, hints, 1), null);

(async () => {
  if (process.platform !== 'linux') { console.log('Proc parsing/ownership checks passed; Linux live sample unavailable'); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-process-observer-'));
  let child, observer;
  try {
    child = spawn(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const nested=spawn(process.execPath,['-e','const data=Buffer.alloc(32*1024*1024,7);setInterval(()=>{for(let i=0;i<data.length;i+=4096)data[i]++;},10)'],{detached:true,stdio:'ignore'});
      process.send({pid:nested.pid});
      process.on('SIGTERM',()=>{nested.kill('SIGTERM');nested.once('close',()=>process.exit(0));});
      setInterval(()=>{},100);
    `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const [nested] = await once(child, 'message');
    const attempt = path.join(root, '.pulse-seal/attempts/fixture');
    fs.mkdirSync(attempt, { recursive: true });
    fs.writeFileSync(path.join(root, '.pulse-seal/active.json'), JSON.stringify({ pid: child.pid, directory: attempt }));
    const taskReport = path.join(attempt, 'tasks.json');
    fs.writeFileSync(taskReport, JSON.stringify({ runId: 'fixture', status: 'running',
      selectedTasks: ['jwt-rs256', 'schema-codecs'], currentTasks: ['jwt-rs256'], results: [],
      currentTaskPhases: { 'jwt-rs256': 'execution' } }));
    fs.writeFileSync(path.join(attempt, 'report.json'), JSON.stringify({ currentStep: 'release',
      recovery: { artifacts: { taskReport }, context: { scheduling: { compilerWorkers: 1 } } } }));
    observer = startObserver(child.pid, root, root);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const closed = once(child, 'close'); child.kill('SIGTERM'); await closed;
    const summary = await observer.stop();
    assert.equal(summary.status, 'observed', JSON.stringify(summary));
    assert(summary.samples >= 3); assert(summary.peakProcessCount >= 2);
    assert(summary.peakSimultaneousProcessRSSKiB > 32768);
    assert(summary.sampledCpuMs > 0);
    assert.equal(summary.remainingObservedProcesses.length, 0);
    const samples = fs.readFileSync(path.join(root, 'process-samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(samples.some(r => r.processes.some(p => p.namespacePid === nested.pid && p.group === p.pid)), 'Detached descendant missed');
    assert(samples.every(r => r.processes.every(p => p.namespacePid !== process.pid)), 'Observer parent is not workload');
    assert(samples.every(r => r.rssKiB === r.processes.reduce((sum, p) => sum + p.rssKiB, 0)));
    assert(samples.some(r => r.stage === 'release' && r.schedule?.compilerLimited.includes('schema-codecs')));
    console.log('Release resource observer: PID identity, detached children, CPU/RSS, admission hints and terminal cleanup passed');
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    if (observer) await observer.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
