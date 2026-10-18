#!/usr/bin/env node
'use strict';

// Read-only analysis of an explicitly supplied test-only phase trace directory.
// This is not a release verifier and never authorizes artifact/result reuse.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function unionMs(intervals) {
  let total = 0, right = -Infinity;
  for (const [start, end] of intervals.sort((a,b)=>a[0]-b[0])) {
    if (end > right) { total += end - Math.max(start, right); right = end; }
  }
  return total;
}
function analyze(directory) {
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Expected an ordinary explicit trace directory');
  const totals = {}, processes = [], compiles = [], artifacts = [], warnings = [];
  for (const name of fs.readdirSync(directory).filter(name=>name.endsWith('.jsonl')).sort()) {
    const file = path.join(directory,name);
    assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), 'Trace must be an ordinary file');
    const bytes=fs.readFileSync(file), rows=[];
    for (const [index,line] of bytes.toString('utf8').trim().split('\n').entries()) {
      try { rows.push(JSON.parse(line)); } catch { warnings.push(`${name}:${index+1}: invalid JSON; observation incomplete`); }
    }
    const header=rows.find(row=>row.event==='process'), terminal=rows.findLast(row=>row.event==='exit');
    assert.equal(header?.schema,'pulse.test-phase-observation.v1','Unknown trace schema');
    const spans=new Map(), ends=new Set();
    for(const row of rows) {
      if(row.event==='start') { assert(!spans.has(row.id),'Duplicate span'); spans.set(row.id,{...row}); }
      if(row.event==='end') { assert(spans.has(row.id) && !ends.has(row.id),'Unmatched/duplicate end'); Object.assign(spans.get(row.id),row); ends.add(row.id); }
    }
    const complete=[...spans.values()].filter(s=>ends.has(s.id));
    const byLabel={};
    for(const span of complete) {
      assert(Number.isFinite(span.start)&&Number.isFinite(span.end)&&span.end>=span.start,'Invalid interval');
      const duration=span.end-span.start;
      const children=complete.filter(c=>c.parent===span.id).map(c=>[Math.max(span.start,c.start),Math.min(span.end,c.end)]).filter(([a,b])=>b>=a);
      const own=duration-unionMs(children);
      const row=byLabel[span.label] ||= {calls:0,threw:0,inclusiveMs:0,exclusiveMs:0};
      row.calls++; row.threw+=span.status==='threw'?1:0; row.inclusiveMs+=duration; row.exclusiveMs+=own;
      const identity={trace:name,pid:header.pid,ppid:header.ppid,span:span.id,parent:span.parent,label:span.label,durationMs:duration,status:span.status,absoluteStart:header.origin+span.start,absoluteEnd:header.origin+span.end};
      if(span.label==='preparation.asc') compiles.push({...identity,...span.metadata,...span.artifact});
      else if(span.artifact?.wasmSha256) artifacts.push({...identity,...span.artifact});
    }
    for(const [label,row] of Object.entries(byLabel)) {
      const total=totals[label] ||= {calls:0,threw:0,inclusiveMs:0,exclusiveMs:0};
      for(const key of Object.keys(row)) total[key]+=row[key];
    }
    const observedMs=terminal ? terminal.end-header.begin : null;
    const coveredMs=unionMs(complete.map(s=>[s.start,s.end]));
    if(!terminal || ends.size!==spans.size || terminal.dropped || terminal.observationErrors) warnings.push(`${name}: missing terminal, open spans, dropped events or observation errors`);
    processes.push({trace:name,sha256:hash(bytes),...header,terminalExitCode:terminal?.exitCode ?? null,
      observedMs,coveredMs,unattributedMs:observedMs===null?null:Math.max(0,observedMs-coveredMs),
      openSpans:spans.size-ends.size,dropped:terminal?.dropped ?? null,observationErrors:terminal?.observationErrors ?? null,
      phases:byLabel,nestedCounters:terminal?.counts || {}});
  }
  // asc may relaunch Node with --enable-source-maps. Exclude a child launch
  // only when observed ancestry, containment and all recorded input/output
  // fingerprints agree. Keep raw intervals and the exclusion relationship.
  const sameCompile=(a,b)=>['sourceSha256','optionsSha256','ascSha256','wasmSha256','exitCode']
    .every(key=>a[key]!==undefined && a[key]===b[key]);
  const ancestor=(parent,child)=>{
    let pid=child.ppid; const seen=new Set();
    while(pid && !seen.has(pid)) {
      if(pid===parent.pid)return true;
      seen.add(pid);
      const process=processes.find(p=>p.pid===pid && p.origin+p.begin<=child.absoluteStart
        && (p.observedMs===null || p.origin+p.begin+p.observedMs>=child.absoluteEnd));
      pid=process?.ppid;
    }
    return false;
  };
  const nestedCompilerLaunches=[],outerCompilerLaunches=[];
  for(const child of compiles) {
    const parent=compiles.find(p=>p.trace!==child.trace && p.absoluteStart<=child.absoluteStart
      && p.absoluteEnd>=child.absoluteEnd && sameCompile(p,child) && ancestor(p,child));
    if(parent)nestedCompilerLaunches.push({...child,nestedIn:{trace:parent.trace,span:parent.span}});
    else outerCompilerLaunches.push(child);
  }
  const groups=new Map();
  for(const item of outerCompilerLaunches.filter(c=>c.exitCode===0 && c.wasmSha256)) {
    const key=[item.sourceSha256,item.optionsSha256,item.ascSha256,item.wasmSha256].join(':');
    const group=groups.get(key)||[];group.push(item);groups.set(key,group);
  }
  return {schema:'pulse.qualification-phases.v1',directory,limits:[
    'Diagnostic observations, not qualification authority. Returned includes expected nonzero subprocess results; inspect exitCode and the task runner.',
    'Inclusive/exclusive sums across processes overlap and are NOT wall-clock savings or CPU. Async siblings can overlap.',
    'Nested fs/hash/assert counters are subsets of spans; never add them to phase totals. Direct assert() calls, ESM loading and internal lexical calls may remain unattributed.',
    'Repeated groups match entry bytes, normalized argv, asc script and output bytes only. Transitive inputs/environment equality and permission to reuse are not established.'
  ],warnings,processes,totals,compiles,outerCompilerLaunches,nestedCompilerLaunches,artifacts,repeatedAscGroups:[...groups.values()].filter(g=>g.length>1)};
}
module.exports={analyze,unionMs};
if(require.main===module) {
  try { assert.equal(process.argv.length,3,'Usage: qualification-phases.cjs <explicit trace directory>'); console.log(JSON.stringify(analyze(path.resolve(process.argv[2])),null,2)); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
