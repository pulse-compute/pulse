'use strict';
// Read-only gate analysis. Usage: node analyze.cjs <diagnostic-directory>
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const out = path.resolve(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const round = n => Math.round(n * 1000) / 1000;
const provenance = read('result.json'), tasks = read('tasks.json');
assert.equal(provenance.status, 'completed'); assert.equal(tasks.status, 'passed');
const cleanup = provenance.terminalWorkingTree ? read('cleanup.json') : null;
if (cleanup) {
  assert.equal(cleanup.source, provenance.source);
  assert.equal(cleanup.beforeWorkingTree, provenance.terminalWorkingTree);
  assert.equal(cleanup.afterWorkingTree, ''); assert.equal(cleanup.manualCleanup, 'passed');
  assert(cleanup.beforeWorkingTree.split('\n').every(line => /^\?\? wasm\/test\/jwt\/\.rs-sign-[A-Za-z0-9]+\/$/.test(line)));
}
assert.deepEqual(tasks.selectedTasks, ['jwt-rs256', 'jwt-installed-workflow']);
assert.deepEqual(tasks.results.map(r => [r.name, r.status]), tasks.selectedTasks.map(name => [name, 'passed']));
const commands = new Set(['inspectProject', 'doctorProject', 'buildProject', 'runProjectTests', 'compileNativeProjectInMemory', 'prepareJavascriptApplication']);
const records = [], traces = [], problems = [], commandRows = [], binaryen = [];
for (const file of fs.readdirSync(path.join(out, 'phases')).sort()) {
  const bytes = fs.readFileSync(path.join(out, 'phases', file));
  const rows = bytes.toString().trim().split('\n').map(JSON.parse);
  const process = rows.find(r => r.event === 'process'), exit = rows.findLast(r => r.event === 'exit');
  assert(process, file);
  const starts = new Map(rows.filter(r => r.event === 'start').map(r => [r.id, r]));
  const ends = new Map(rows.filter(r => r.event === 'end').map(r => [r.id, r]));
  const calls = [...starts.values()].filter(r => r.label === 'guest.inspectWasmFile');
  const relevant = process.entry === 'pulse.js' || process.entry === 'assert-jwt-rs256.cjs';
  if (relevant) assert.equal(process.observerSha256, provenance.observerSha256);
  traces.push({ file, sha256: hash(bytes), bytes: bytes.length, pid: process.pid, entry: process.entry,
    origin: process.origin, begin: process.begin, end: exit?.end ?? null, inspections: calls.length, complete: Boolean(exit), dropped: exit?.dropped ?? null, observationErrors: exit?.observationErrors ?? null });
  if (relevant && (!exit || exit.dropped || exit.observationErrors)) problems.push(`${file}: incomplete command observation`);
  const ancestors = row => { const chain = []; let next = row; while (next) { chain.push(next); next = starts.get(next.parent); } return chain; };
  for (const s of starts.values()) {
    if (commands.has(s.label.split(':').at(-1)) && !ancestors(s).slice(1).some(r => commands.has(r.label.split(':').at(-1)))) {
      commandRows.push({ trace: file, id: s.id, start: s.start, end: ends.get(s.id)?.end ?? null, name: s.label.split(':').at(-1), status: ends.get(s.id)?.status || 'incomplete',
        durationMs: ends.has(s.id) ? round(ends.get(s.id).end - s.start) : null });
    }
    if (/^subprocess.wasm-(opt|dis|merge|as)$/.test(s.label)) binaryen.push({ trace: file, id: s.id, name: s.label.slice(11),
      durationMs: ends.has(s.id) ? round(ends.get(s.id).end - s.start) : null, ...s.metadata });
  }
  for (const call of calls) {
    const end = ends.get(call.id), chain = ancestors(call);
    assert(end, `${file}:${call.id}: unterminated inspection`);
    const owners = chain.filter(r => commands.has(r.label.split(':').at(-1)));
    const owner = owners.at(-1);
    assert(owner || process.entry === 'pulse.js', `${file}:${call.id}: no command owner`);
    assert(call.metadata, 'Missing input observation');
    const tools = [...starts.values()].filter(s => /^subprocess.wasm-(opt|dis)$/.test(s.label) && ancestors(s).some(r => r.id === call.id))
      .map(s => ({ name: s.label.slice(11), ...s.metadata, status: ends.get(s.id)?.artifact?.exitCode,
        durationMs: ends.has(s.id) ? round(ends.get(s.id).end - s.start) : null }));
    const eligible = end.status === 'returned' && (process.entry !== 'pulse.js' || exit?.exitCode === 0) && (!owner || ends.get(owner.id)?.status === 'returned') && call.metadata.kind === 'packaged-guest'
      && chain.some(r => r.label.endsWith(':materializePackagePrebuilt'));
    if (end.status === 'returned') {
      assert.equal(end.artifact.inputSha256, call.metadata.inputSha256, 'Input changed during inspection');
      assert.equal(end.artifact.inputBytes, call.metadata.inputBytes);
      assert.deepEqual(tools.map(t => [t.name, t.status]), [['wasm-opt', 0], ['wasm-dis', 0]]);
      assert(tools.every(t => t.toolSha256 && t.environmentSha256 && t.invocationSha256));
    }
    records.push({ trace: file, id: call.id, command: process.entry === 'pulse.js' ? `${file}:process` : `${file}:${owner.id}`,
      commandName: owner?.label.split(':').at(-1) || 'CLI process', eligible,
      status: end.status, start: call.start, end: end.end, durationMs: round(end.end - call.start), ...call.metadata, factsSha256: end.artifact?.factsSha256 || null, tools });
  }
}
// Missing process tails remain evidence gaps; they cannot authorize reuse.
// All observed inspection calls must still have complete input/tool/end records.
const eligible = records.filter(r => r.eligible);
const groups = new Map();
for (const r of eligible) { const key = `${r.command}:${r.inputSha256}`; const group = groups.get(key) || []; group.push(r); groups.set(key, group); }
const byteOnlyRepeats = [...groups.values()].reduce((n, group) => n + group.length - 1, 0);
const exactGroups = new Map();
for (const r of eligible) {
  const key = JSON.stringify([r.command, r.inputSha256, r.inputPathSha256, r.optionsSha256, r.implementationSha256,
    r.tools.map(t => [t.name, t.toolSha256, t.environmentSha256, t.invocationSha256])]);
  exactGroups.set(key, (exactGroups.get(key) || 0) + 1);
}
const exactRepeats = [...exactGroups.values()].reduce((n, count) => n + count - 1, 0);
const byteRepeatGroups = [...groups.values()].filter(g => g.length > 1).map(g => ({ command: g[0].command,
  calls: g.length, inputSha256: g[0].inputSha256, inputBytes: g[0].inputBytes,
  distinctOptions: new Set(g.map(r => r.optionsSha256)).size,
  distinctFacts: new Set(g.map(r => r.factsSha256)).size,
  laterInspectionMs: round(g.slice(1).reduce((n, r) => n + r.durationMs, 0)) }));
const installedFiles = fs.readdirSync(path.join(out, 'installed')).filter(f => f.endsWith('.json'));
assert.equal(installedFiles.length, 1);
const installed = read(`installed/${installedFiles[0]}`);
assert.equal(installed.status, 'passed'); assert.equal(installed.source, provenance.source);
assert.equal(installed.sourceTree, provenance.sourceTree);
if (installed.workingTree) assert(cleanup && installed.workingTree.split('\n').every(line => cleanup.beforeWorkingTree.split('\n').includes(line)), 'Unaccounted installed-start source changes');
assert.equal(installed.cells.length, 12); assert.equal(installed.installed.unchanged, true); assert.equal(installed.cleanup.status, 'passed');
const cliCommands = installed.results.filter(r => r.args.some(a => a.endsWith('/pulse.js')));
const cliTraces = traces.filter(r => r.entry === 'pulse.js').sort((a, b) => a.origin - b.origin);
assert.equal(cliTraces.length, cliCommands.length, 'Missing installed CLI trace');
const incompleteCommands = cliTraces.flatMap((trace, index) => trace.complete ? [] : [{
  trace: trace.file, command: cliCommands[index],
  disposition: 'Independent acceptance passed; phase tail absent. Do not count as complete observation or pool a retry into this trial.' }]);
assert.equal(traces.filter(r => r.entry === 'assert-jwt-rs256.cjs').length, 1);
assert.equal(installed.cells.reduce((n, c) => n + c.cases.passed, 0), 120);
assert(installed.cells.filter(c => c.profile.endsWith('native')).every(c => /^[a-f0-9]{64}$/.test(c.wasmSha256)));
const byTask = {};
for (const [name, entry] of [['workspace', 'assert-jwt-rs256.cjs'], ['installed', 'pulse.js']]) {
  const files = new Set(traces.filter(r => r.entry === entry).map(r => r.file));
  const selected = records.filter(r => files.has(r.trace)), possible = selected.filter(r => r.eligible);
  byTask[name] = { inspections: selected.length, successful: selected.filter(r => r.status === 'returned').length,
    eligibleCalls: possible.length, commandsWithEligibleCalls: new Set(possible.map(r => r.command)).size,
    inputHashes: [...new Set(possible.map(r => r.inputSha256))], inputByteSizes: [...new Set(possible.map(r => r.inputBytes))],
    eligibleInspectionMs: round(possible.reduce((n, r) => n + r.durationMs, 0)) };
}
const sampleTicksPerSecond = Number(require('node:child_process').execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }));
assert.equal(sampleTicksPerSecond, 100);
const samples = fs.readFileSync(path.join(out, 'resources/process-samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const controller = samples[0].processes.find(p => p.namespacePid === provenance.controllerPid);
assert(controller);
// Existing raw sampler includes itself despite its scope label. The sampler is
// the direct child present in every sample (other children enter/leave).
const samplerCandidates = samples[0].processes.filter(p => p.parent === controller.pid && samples.every(s => s.processes.some(q => q.key === p.key)));
assert.equal(samplerCandidates.length, 1);
const sampler = samplerCandidates[0], cpu = new Map();
for (const s of samples) for (const p of s.processes) if (p.key !== sampler.key) cpu.set(p.key, Math.max(cpu.get(p.key) || 0, p.cpuTicks));
const workspace = fs.readFileSync(path.join(out, 'tasks.log'), 'utf8').split('\n').filter(l => l.startsWith('{"status":"passed","bits":')).map(JSON.parse);
assert.deepEqual(workspace.map(r => r.bits), [2048, 3072, 4096]);
assert(workspace.every(r => r.executions === 146 && r.targets.length === 4));
const artifactFiles = [...(cleanup ? ['cleanup.json'] : []), 'result.json', 'tasks.json', 'tasks.log', `installed/${installedFiles[0]}`, 'resources/process-summary.json', 'resources/process-samples.jsonl'];
const report = { schema: 'pulse.b10-ci03-inspection-gate.v1', decision: exactRepeats === 0 ? 'defer-key-not-established' : 'requires-key-and-benefit-investigation',
  observationProblems: problems, completeCommandObservation: problems.length === 0,
  provenance, cleanup, incompleteCommands, installedStartWorkingTree: installed.workingTree, gate: { eligibleCalls: eligible.length, inputByteChecks: records.length,
    byteOnlyWithinCommandRepeatsUpperBound: byteOnlyRepeats, exactInvocationRepeats: exactRepeats, byteRepeatGroups, memoImplemented: false, actualHits: 0, retainedMemoBytes: 0,
    excludedInspections: records.length - eligible.length, byTask },
  workspace, commandRows,
  inspectionRecords: records.filter(r => r.kind === 'packaged-guest'),
  allInspectionRecordsSha256: hash(JSON.stringify(records)),
  inspectionKinds: Object.fromEntries([...new Set(records.map(r => r.kind))].map(kind => [kind, {
    calls: records.filter(r => r.kind === kind).length,
    durationMs: round(records.filter(r => r.kind === kind).reduce((n, r) => n + r.durationMs, 0)) }])), traces,
  binaryen: { calls: binaryen.length, durationMs: round(binaryen.reduce((n, r) => n + (r.durationMs || 0), 0)),
    toolIdentities: [...new Set(binaryen.map(r => `${r.name}:${r.toolSha256}`))] },
  installed: { cells: installed.cells, cleanup: installed.cleanup, installed: installed.installed, composition: installed.composition,
    cliCommands: cliCommands.length, commandFailures: cliCommands.filter(r => r.code !== 0).length },
  resources: { ...provenance.resources, correctedSamplerExcludedPeakRSSKiB: Math.max(...samples.map(s => s.processes.filter(p => p.key !== sampler.key).reduce((n, p) => n + p.rssKiB, 0))),
    correctedIntervalSampledCpuMs: ([...cpu.values()].reduce((a, b) => a + b, 0) - controller.cpuTicks) * 10,
    ticksPerSecond: 100, samplerKey: sampler.key,
    correction: 'Raw scope label incorrectly says sampler excluded; derived values exclude its identified process and subtract initial controller CPU. Sampled lower bounds, shared RSS counted repeatedly.' },
  artifacts: artifactFiles.map(file => { const b = fs.readFileSync(path.join(out, file)); return { file, bytes: b.length, sha256: hash(b) }; }) };
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
