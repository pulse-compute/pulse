'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { Writable } = require('node:stream');
const { finishLog, runTask } = require('../../scripts/run-wasm-tests.cjs');

function stall(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* bounded synchronous controller work */ }
}

async function verifyTaskLogClose(root, runDir) {
  const bytes = Buffer.from('complete log: stdout, stderr, unicode \u2603\n'.repeat(4096));
  for (const [index, blockMs] of [0, 1200, 1200, 1200].entries()) {
    const file = path.join(root, `close-${index}.log`);
    const stream = fs.createWriteStream(file);
    await new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.write(bytes, resolve);
    });
    const result = finishLog(stream);
    stall(blockMs);
    assert.equal(await result, undefined, `complete log must survive a ${blockMs}ms controller stall`);
    assert.equal(stream.writableFinished, true);
    assert.equal(stream.closed, true, 'finish alone is not closure');
    assert.deepEqual(fs.readFileSync(file), bytes, 'all bytes must survive log closure');
    assert.equal(await finishLog(stream), undefined, 'already-closed successful log must remain successful');
  }

  const premature = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const prematurelyClosed = once(premature, 'close');
  premature.destroy();
  await prematurelyClosed;
  assert.match(await finishLog(premature), /closed before all writes finished/);

  // Neither blocked writes nor a completed writer with a stuck close is proof
  // of success. Exercise the latter both with and without a controller stall.
  for (const [kind, blockMs] of [['write', 0], ['close', 0], ['close', 1200]]) {
    const stream = new Writable({
      write(chunk, encoding, callback) { if (kind !== 'write') callback(); },
      destroy(error, callback) { if (kind !== 'close') callback(error); }
    });
    stream.write('pending');
    const started = performance.now();
    const result = finishLog(stream);
    stall(blockMs);
    assert.match(await result, /task log close exceeded its deadline/);
    const elapsed = performance.now() - started;
    assert(elapsed >= 900 && elapsed < 3500, `${kind} deadline must remain bounded: ${elapsed}ms`);
    assert.equal(stream.destroyed, true);
    if (kind === 'close') {
      assert.equal(stream.writableFinished, true);
      assert.equal(stream.closed, false, 'a delayed timer cannot manufacture terminal closure');
    }
  }

  const failedWrite = new Writable({
    write(chunk, encoding, callback) { setImmediate(() => callback(new Error('fixture write failed'))); }
  });
  failedWrite.write('partial');
  assert.match(await finishLog(failedWrite), /fixture write failed/);
  const failedClose = new Writable({
    write(chunk, encoding, callback) { callback(); },
    destroy(error, callback) { setImmediate(() => callback(new Error('fixture close failed'))); }
  });
  assert.match(await finishLog(failedClose), /fixture close failed/);

  // Drive early real fs errors through runTask: they must become failed task
  // results with diagnostics, not crash the controller or qualify a pass.
  const createWriteStream = fs.createWriteStream;
  try {
    for (const kind of ['open', 'write']) {
      fs.createWriteStream = function(file, options) {
        if (String(file) !== path.join(runDir, 'tasks', `log-${kind}-failure.log`)) {
          return createWriteStream.call(this, file, options);
        }
        return kind === 'open'
          ? createWriteStream.call(this, root, options) // EISDIR, before task completion
          : createWriteStream.call(this, file, { ...options, fs: {
            open: fs.open, close: fs.close,
            write(fd, buffer, offset, length, position, callback) {
              setImmediate(() => callback(Object.assign(new Error('fixture log disk full'), { code: 'ENOSPC' })));
            }
          } });
      };
      const result = await runTask(`log-${kind}-failure`, {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("not a passing log\\n");setTimeout(()=>{},100)'],
        timeoutMs: 5000, evidence: 'unit', description: `early log ${kind} failure`
      }, { runDir });
      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, 1);
      assert.equal(result.cleanup.status, 'failed');
      assert.match(result.error, kind === 'open' ? /EISDIR/ : /fixture log disk full/);
      assert.deepEqual(result.remainingProcessTree, []);
    }
    const controller = new AbortController();
    fs.createWriteStream = function(file, ...args) {
      const stream = createWriteStream.call(this, file, ...args);
      if (String(file) === path.join(runDir, 'tasks', 'log-close-interruption.log')) {
        const end = stream.end;
        stream.end = function(...endArgs) {
          const result = end.apply(this, endArgs);
          controller.abort('SIGTERM');
          return result;
        };
      }
      return stream;
    };
    const interrupted = await runTask('log-close-interruption', {
      command: process.execPath, args: ['-e', 'process.stdout.write("complete before interruption\\n")'],
      timeoutMs: 5000, evidence: 'unit', description: 'interruption during log closure'
    }, { runDir, signal: controller.signal });
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.exitCode, 143);
    assert.equal(interrupted.cleanup.status, 'passed');
    assert.deepEqual(interrupted.remainingProcessTree, []);
    assert.equal(fs.readFileSync(path.join(runDir, 'tasks', 'log-close-interruption.log'), 'utf8'), 'complete before interruption\n');
  } finally { fs.createWriteStream = createWriteStream; }
  console.log('ok - task logs require complete writes and closure after controller stalls; early I/O errors and stuck streams fail boundedly');
}

module.exports = { verifyTaskLogClose };
