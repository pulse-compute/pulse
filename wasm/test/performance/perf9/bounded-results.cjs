'use strict';
// Offline replay of one pinned campaign. No build, profiler or timing workload.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash, stats } = require('./measurement-protocol.cjs');
const { containedFile } = require('./results.cjs');
const { validate } = require('./bounded.cjs');
const pin = require('./bounded-baseline.json');
const names = ['default', 'bounded', 'rust'];
const start = '<!-- perf9-bounded-results:start -->', end = '<!-- perf9-bounded-results:end -->';

function loadEvidence(directory) {
  const root = fs.realpathSync(directory);
  const bytes = fs.readFileSync(containedFile(root, 'manifest.json'));
  assert.equal(hash(bytes), pin.manifestSha256, 'Frozen manifest hash mismatch');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schemaVersion, 'pulse.perf9-02-evidence-bundle.v1');
  assert.deepEqual(manifest.source, pin.source);
  const originals = new Map(), archives = new Map();
  for (const entry of manifest.files) {
    assert(!originals.has(entry.originalPath) && !archives.has(entry.archivePath), 'Duplicate mapping');
    const file = containedFile(root, entry.archivePath), data = fs.readFileSync(file);
    assert.equal(data.length, entry.bytes, 'Archived size mismatch');
    assert.equal(hash(data), entry.sha256, 'Archived hash mismatch: ' + entry.archivePath);
    originals.set(entry.originalPath, file); archives.set(entry.archivePath, file);
  }
  assert(archives.has(pin.measurement));
  const raw = fs.readFileSync(archives.get(pin.measurement));
  assert.equal(hash(raw), pin.measurementSha256, 'Frozen report hash mismatch');
  const report = JSON.parse(raw);
  assert.deepEqual(report.source, pin.source);
  // The measured validator is synchronous. Resolve only its raw evidence reads
  // through the verified manifest, preserving original receipt bytes and paths.
  // Never create files at old absolute paths or silently use an old live attempt.
  const read = fs.readFileSync, attemptRoot = path.dirname(report.output);
  fs.readFileSync = function(file, ...args) {
    if (typeof file === 'string' && file.startsWith(attemptRoot + path.sep)) {
      assert(originals.has(file), 'Missing archived artifact: ' + file);
      file = originals.get(file);
    }
    return read.call(this, file, ...args);
  };
  try { validate(report); } finally { fs.readFileSync = read; }
  return { report, manifest };
}

const num = (n, digits = 3) => n.toFixed(digits);
const signed = n => (n > 0 ? '+' : '') + num(n);
const range = a => a.map(signed).join(' to ');
const table = (heads, rows) => [heads, heads.map(() => '---'), ...rows].map(r => '| ' + r.join(' | ') + ' |').join('\n');
function render({ report: r }) {
  const cells = ['echo-1024-c4', 'echo-1048576-c1', 'echo-1048576-c4'].map(id => r.cells.find(c => c.id === id));
  const label = c => c.id.replace('echo-1024-', '1 KiB / ').replace('echo-1048576-', '1 MiB / ');
  const arm = (c, n) => n === 'rust' ? c.summary.defaultVsrust.rightSummary : c.summary.boundedVsdefault[n === 'bounded' ? 'leftSummary' : 'rightSummary'];
  const triple = (c, fn) => names.map(n => fn(arm(c, n))).join(' / ');
  const attempts = cells.flatMap(c => c.blocks.flatMap(b => names.flatMap(n => b[n].requests)));
  const lines = [start, '', '## Frozen campaign', '',
    `Measured requests: **${attempts.length}**; unexpected errors: **${attempts.filter(a => a.outcome !== 'ok').length}**. Excluded warmups: **72**. Separate profiled requests: **96**. Each cell has 30 three-arm blocks and 480 measured requests per artifact.`, '',
    `Attempt (UTC): ${r.createdAt} through ${r.completedAt}. Unprofiled sampling: ${r.measurementStartedAt} through ${r.measurementCompletedAt}.`, '',
    `Clean measured source: \`${r.source.sourceRevision}\`; tree \`${r.source.sourceTree}\`. Reporting/replay files were added afterward; measured scripts remain hash-identical.`, '',
    `Local ${r.environment.os.platform}/${r.environment.os.arch}, kernel ${r.environment.os.release}; ${r.environment.hardware.cpu}; ${r.environment.hardware.availableParallelism} available CPUs; cgroup CPU quota \`${r.environment.hardware.cgroupCpuMax}\`; memory limit ${num(Number(r.environment.hardware.cgroupMemoryMax)/1048576)} MiB. No other assistant build/test workload ran during sampling; unrelated shared-machine activity was not controlled.`, '',
    `Node ${r.environment.node}; Viceroy ${r.viceroy.version}; TypeScript ${r.dependencies.packages.typescript.version}; AssemblyScript ${r.dependencies.packages.assemblyscript.version}; json-as ${r.dependencies.packages['json-as'].version}; Rust/Cargo 1.90.0, wasm32-unknown-unknown. Exact identities and compiler recipes remain in the raw receipt.`, '',
    table(['Identity', 'SHA-256'], [['Raw report', pin.measurementSha256], ['Archive', pin.archiveSha256], ['Manifest', pin.manifestSha256], ['Viceroy', r.viceroy.sha256], ['Workspace lockfile', r.dependencies.lockfileSha256]]), '',
    '## Artifact and build domains', '',
    table(['Artifact', 'Wasm bytes', 'Wasm SHA-256', 'Guest linear memory bytes'], names.map(n => [n, r.artifacts[n].bytes, r.artifacts[n].sha256, r.artifacts[n].guestLinearMemoryBytes])), '',
    'Three fresh builds per artifact, Latin-square order; all repeat hashes match. Pulse default and bounded have identical generated AssemblyScript source hashes. Payload scratch is 16,384 bytes for every artifact. Qualification passed 268 ABI cases and 19 real Viceroy wire cases per artifact, plus 98 differential cases for each Pulse/Rust pairing.', '',
    table(['Artifact', 'Build wall ms: each observation', 'Median ms', 'Peak compiler RSS MiB: each observation'], names.map(n => { const b=r.builds.filter(b=>b.name===n);return [n,b.map(x=>num(x.buildMs,1)).join(' / '),num(stats(b.map(x=>x.buildMs)).p50,1),b.map(x=>num(x.compilerMemory.peakIndividualRssBytes/1048576,1)).join(' / ')]; })), '',
    'Build times are descriptive project-build observations (three per arm), not a compiler-speed significance test. Pulse RSS is the maximum individual ASC process including re-exec; Rust RSS is the maximum individual waited Cargo/rustc descendant. These are different process compositions, not simultaneous build-tree memory or a pure language-memory ratio.', '',
    '## Unprofiled latency and throughput', '',
    'Columns use **default Pulse / bounded Pulse / Rust**. Pooled request percentiles are descriptive and differ from the paired block estimator. Rates are arithmetic means of per-block rates; response MiB/s counts only the response direction.', '',
    table(['Cell', 'Completion p50 ms', 'Completion p95 ms', 'Headers p50 ms', 'Responses/s', 'Response MiB/s'], cells.map(c=>[label(c),triple(c,s=>num(s.successfulLatencyMs.p50)),triple(c,s=>num(s.successfulLatencyMs.p95)),triple(c,s=>num(s.timeToHeadersMs.p50)),triple(c,s=>num(s.requestsPerSecond.mean,2)),triple(c,s=>num(s.responseBytesPerSecond.mean/1048576,2))])), '',
    'All nine paired comparisons are retained. Delta means left minus right; positive favors right. Estimator: difference of mean block-p50s, 4,000 paired-block bootstrap resamples, exploratory unadjusted 95% intervals. Relative delta is the ratio of mean block-p50s minus one. Zero-crossing intervals do not establish equivalence.', '',
    table(['Cell', 'Left minus right', 'Delta ms [95% interval]', 'Delta % [95% interval]', 'Direction'], cells.flatMap(c=>Object.values(c.summary).map(s=>[label(c),s.left+' − '+s.right,`${signed(s.comparison.absoluteMs)} [${range(s.comparison.absoluteMs95)}]`,`${signed(s.comparison.relativePercent)} [${range(s.comparison.relativePercent95)}]`,s.comparison.direction]))), '',
    '## Unprofiled process resources', '',
    'CPU includes every Viceroy thread (guest + Wasmtime/runtime + host), excluding the Node client/origin. Windows include the original 20 ms settle; procfs resolution is 10 ms before block amortization. RSS maxima are sampled; HWM is a separate lifetime counter, including startup and prior cells. Neither is guest allocation.', '',
    table(['Cell', 'CPU ms/attempt D / B / R', 'Sampled RSS max MiB D / B / R', 'Lifetime HWM max MiB D / B / R'],cells.map(c=>[label(c),triple(c,s=>num(s.processCpuMsPerAttempt.mean)),triple(c,s=>num(s.sampledRssBytes.max/1048576)),triple(c,s=>num(s.lifetimeHwmBytes.max/1048576))])), '',
    'Process CPU differences use a paired-block bootstrap of CPU/attempt; intervals do not improve counter resolution or isolate guest execution.', '',
    table(['Cell', 'Left minus right', 'CPU ms/attempt delta [95% interval]'],cells.flatMap(c=>Object.values(c.summary).map(s=>[label(c),s.left+' − '+s.right,`${signed(s.processCpuDifference.meanMs)} [${range(s.processCpuDifference.ms95)}]`]))), '',
    '## Separate guest-profile coverage', '',
    'New servers after unprofiled sampling; 32 sequential 1 MiB requests per artifact, guest epoch sampling requested at 50 µs. Raw sample counts below describe retained profile coverage only. They are not comparable CPU costs, CPU shares, or calibrated CPU milliseconds.', '',
    table(['Artifact', 'Successful profiled requests / profiles', 'Guest-stack samples', 'Empty stacks'],r.profiles.map(p=>[p.name,`${p.requests.length} / ${p.profileCount}`,p.sampleCount,p.files.reduce((n,f)=>n+f.emptyStacks,0)])), '',
    'Guest CPU, host/runtime CPU, kernel CPU and unknown CPU shares: **unavailable**. The all-thread sampling denominator is absent; calibrated CPU milliseconds are unavailable.', '', end];
  return lines.join('\n');
}
function main(args) {
  assert(args.length===2 && ['--check','--write'].includes(args[0]),'Usage: bounded-results.cjs --check|--write /extracted/evidence');
  const e=loadEvidence(args[1]), file=path.join(__dirname,'BOUNDED-RESULTS.md'),old=fs.readFileSync(file,'utf8');
  assert.equal(old.split(start).length,2);assert.equal(old.split(end).length,2);assert(old.indexOf(end)>old.indexOf(start));
  const next=old.slice(0,old.indexOf(start))+render(e)+old.slice(old.indexOf(end)+end.length);
  if(args[0]==='--check')assert.equal(next,old,'Report tables differ from verified evidence');else fs.writeFileSync(file,next);
  console.log(`ok - PERF9-02: ${e.manifest.files.length} archived files, raw summaries, artifact qualification and report tables verified`);
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e);process.exitCode=1;}}
module.exports={loadEvidence,render};
