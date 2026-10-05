'use strict';

const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

function canInspectDescendants() {
  if (process.platform !== 'linux') return process.platform !== 'win32';
  try { return Number(fs.readFileSync('/proc/self/stat', 'utf8').split(' ')[0]) === process.pid; }
  catch (_) { return false; }
}

// Capture descendants before TERM, including nested detached test groups. Never
// signal our own group; only the supervised child and its observed descendants.
function descendants(pid) {
  const rows = [];
  if (!canInspectDescendants()) return rows;
  if (process.platform === 'linux') {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        rows.push({ pid: Number(entry), parent: Number(fields[1]), group: Number(fields[2]) });
      } catch (_) { /* process exited */ }
    }
  } else if (process.platform !== 'win32') {
    const result = spawnSync('ps', ['-eo', 'pid=,ppid=,pgid='], { encoding: 'utf8', timeout: 1000 });
    for (const line of String(result.stdout || '').trim().split('\n')) {
      const [id, parent, group] = line.trim().split(/\s+/).map(Number);
      if (id) rows.push({ pid: id, parent, group });
    }
  }
  const owned = new Set([pid]);
  let size;
  do {
    size = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  } while (owned.size !== size);
  return rows.filter(row => owned.has(row.pid));
}

function signalTree(child, rows, signal) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 1000 });
    try { child.kill(signal); } catch (_) { /* already exited */ }
    return;
  }
  const groups = new Set([child.pid, ...rows.filter(row => row.pid === row.group).map(row => row.group)]);
  for (const group of groups) { try { process.kill(-group, signal); } catch (_) { /* already exited */ } }
  for (const row of [...rows].reverse()) { try { process.kill(row.pid, signal); } catch (_) { /* already exited */ } }
}

// Unlike spawnSync's timeout, settlement is bounded even if a child ignores
// TERM or an inherited output pipe never closes. All timers are owned here.
function runCommand(command, args, options = {}) {
  const { timeoutMs = 120000, termGraceMs = 10000, killGraceMs = 1000 } = options;
  return new Promise(resolve => {
    let child, timer, termTimer, killTimer, stopped, error, closed, settled = false;
    let rows = [];
    const finish = (forcedCompletion = false) => {
      if (settled) return;
      settled = true;
      for (const id of [timer, termTimer, killTimer]) clearTimeout(id);
      options.signal?.removeEventListener('abort', abort);
      child?.stdout?.destroy(); child?.stderr?.destroy();
      if (forcedCompletion) child?.unref();
      resolve({ status: closed?.code ?? null, signal: closed?.signal ?? null,
        error: error || null, timedOut: stopped === 'timeout',
        interruptedBy: stopped && stopped !== 'timeout' ? stopped : null, forcedCompletion });
    };
    const stop = reason => {
      if (stopped || settled) return;
      stopped = reason;
      try { rows = descendants(child?.pid); } catch (_) { /* group signal still works */ }
      signalTree(child, rows, 'SIGTERM');
      termTimer = setTimeout(() => {
        // Signal handlers can start cleanup workers after our first snapshot.
        try { rows = [...new Map([...rows, ...descendants(child?.pid)].map(row => [row.pid, row])).values()]; } catch (_) { /* best effort */ }
        signalTree(child, rows, 'SIGKILL');
        // Even a closed parent can leave a separate descendant group behind.
        killTimer = setTimeout(() => finish(!closed), killGraceMs);
      }, termGraceMs);
    };
    const abort = () => stop(String(options.signal.reason || 'SIGTERM'));
    if (options.signal?.aborted) { stopped = String(options.signal.reason || 'SIGTERM'); finish(); return; }
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
        stream.on('data', chunk => {
          try { options.onOutput?.(name, chunk); }
          catch (cause) { error = cause; stop('output-error'); }
        });
      }
      child.once('error', cause => { error = cause; if (!stopped) finish(); });
      child.once('close', (code, signal) => { closed = { code, signal }; if (!stopped) finish(); });
      timer = setTimeout(() => stop('timeout'), timeoutMs);
      options.signal?.addEventListener('abort', abort, { once: true });
    } catch (cause) { error = cause; finish(); }
  });
}

module.exports = { runCommand, canInspectDescendants };
