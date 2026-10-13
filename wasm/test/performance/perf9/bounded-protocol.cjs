'use strict';
const assert = require('node:assert/strict');
const old = require('./measurement-protocol.cjs');
const names = ['default', 'bounded', 'rust'];
const permutations = [
  ['default','bounded','rust'], ['default','rust','bounded'], ['bounded','default','rust'],
  ['bounded','rust','default'], ['rust','default','bounded'], ['rust','bounded','default']
];
const selected = ['echo-1024-c4', 'echo-1048576-c1', 'echo-1048576-c4'];
const protocol = {
  version: 'pulse.perf9-02-bounded.v1', seed: 90213, parent: old.protocol,
  selected, names, blocks: 30, requests: 16, warmup: 8,
  order: 'Shuffle cells, then five shuffled repetitions of all six permutations per cell; each arm occupies each position ten times; pairwise precedence balanced 15/15',
  comparisons: [['bounded','default'], ['default','rust'], ['bounded','rust']],
  inference: 'Same paired-block-p50 bootstrap, 4000 resamples, 95% exploratory unadjusted intervals; each comparison uses the same three-arm blocks; never pools with original baseline',
  builds: 'Three fresh builds per artifact in a Latin-square order; compilation wall time and compiler process peak RSS are descriptive, not a compiler-speed significance claim',
  profiling: 'Separate post-measurement guest sampling diagnostic; never used to estimate guest CPU share or milliseconds'
};
function schedule() {
  const random = old.rng(protocol.seed);
  return old.shuffle(old.cells('standard').filter(x => selected.includes(x.id)), random).map(c => ({
    ...c, orders: old.shuffle(Array.from({length:30}, (_,i) => [...permutations[i%6]]), random)
  }));
}
function summarize(cell, seed) {
  const result = {};
  for (let i=0;i<protocol.comparisons.length;i++) {
    const [left,right] = protocol.comparisons[i];
    const pairCell = { pairs: cell.blocks.map(b => ({pulse:b[left],rust:b[right]})) };
    const summary = old.summarize(pairCell, 'standard', seed+i);
    result[left+'Vs'+right] = {
      left, right, leftSummary:summary.pulse, rightSummary:summary.rust,
      comparison:{...summary.comparison, estimand:`mean paired block-p50 (${left} minus ${right})`,
        direction:summary.comparison.direction.replace('Pulse',left).replace('Rust',right)},
      processCpuDifference:cpuDifference(cell.blocks,left,right,seed+i)
    };
  }
  return result;
}
function cpuDifference(blocks,left,right,seed) {
  const differences=blocks.map(b=>{
    const value=name=>(b[name].resources.userMs+b[name].resources.systemMs)/b[name].requests.length;
    return value(left)-value(right);
  });
  const random=old.rng(seed),samples=[];
  for(let i=0;i<4000;i++) {let sum=0;for(let j=0;j<differences.length;j++)sum+=differences[Math.floor(random()*differences.length)];samples.push(sum/differences.length);}
  samples.sort((a,b)=>a-b);
  return {domain:'Viceroy process CPU ms/attempt; not guest CPU',meanMs:old.stats(differences).mean,
    ms95:[samples[100],samples[3899]],method:'paired-block percentile bootstrap; descriptive counter resolution remains 10 ms per process window'};
}
function selfTest() {
  const planned = schedule(); assert.equal(planned.length,3);assert.deepEqual(schedule(),planned);
  for(const c of planned) {
    assert.equal(c.orders.length,30);
    for(const name of names) for(let position=0;position<3;position++) assert.equal(c.orders.filter(p=>p[position]===name).length,10);
    for(const [left,right] of protocol.comparisons) assert.equal(c.orders.filter(p=>p.indexOf(left)<p.indexOf(right)).length,15);
    for(const order of permutations) assert.equal(c.orders.filter(p=>p.join()===order.join()).length,5);
  }
}
module.exports = {protocol,names,schedule,summarize,selfTest};
