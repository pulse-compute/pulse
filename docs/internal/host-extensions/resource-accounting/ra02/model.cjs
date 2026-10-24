'use strict';
// Offline accounting oracle: no host calls, scheduler, compiler or production API.
const policy = require('./policy.json');
const D = policy.dimensions;
const clone = x => JSON.parse(JSON.stringify(x));
const zero = () => Object.fromEntries(D.map(d => [d, 0]));
function reject(code, detail = {}) { throw Object.assign(new Error(code), { code: 'RA02_' + code, detail }); }
function need(ok, code, detail) { if (!ok) reject(code, detail); }
function number(n) { need(Number.isSafeInteger(n) && n >= 0, 'BOUND'); return n; }
function id(x) { need(typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(x), 'IDENTITY'); return x; }
function vector(v) {
  need(v && Object.keys(v).length === D.length && D.every(d => Object.hasOwn(v, d)), 'DIMENSIONS');
  return Object.fromEntries(D.map(d => [d, number(v[d])]));
}
function add(a, b) { return Object.fromEntries(D.map(d => [d, number(a[d] + b[d])])); }
function sub(a, b) { return Object.fromEntries(D.map(d => [d, number(a[d] - b[d])])); }
function fits(a, b, code, detail = {}) { for (const d of D) need(a[d] <= b[d], code, { ...detail, dimension: d, required: a[d], available: b[d] }); }
function sum(xs) { return xs.reduce(add, zero()); }
function key(ref) {
  need(ref && typeof ref.execution === 'string' && Number.isSafeInteger(ref.slot) && ref.slot >= 0 && Number.isSafeInteger(ref.generation) && ref.generation > 0, 'IDENTITY');
  return JSON.stringify([ref.execution, ref.slot, ref.generation]);
}
function binding(b) { need(b && ['capability', 'service', 'useSite', 'implementation'].every(k => typeof b[k] === 'string' && b[k].length > 0), 'BINDING'); }
function profile(p) {
  need(p && p.version === policy.version, 'PROTOCOL'); id(p.id); binding(p.binding);
  need(p.coverage === 'complete-for-accounted-domain', 'COVERAGE');
  vector(p.work); vector(p.cleanup); need(number(p.effects) >= 1, 'BOUND');
  need(Array.isArray(p.exclusive) && new Set(p.exclusive).size === p.exclusive.length, 'EXCLUSIVE'); p.exclusive.forEach(id);
  return clone(p);
}
function initial(config) {
  need(config && config.profile === 'fixture-qualified-v0', 'PROFILE');
  const capacity = vector(config.capacity), baseline = vector(config.baseline), exit = vector(config.exit);
  fits(add(baseline, exit), capacity, 'EXECUTION_RESERVE');
  const effectsLimit = number(config.effectsLimit), used = number(config.used || 0);
  need(used <= effectsLimit, 'EFFECT_CAPACITY');
  return { execution: 'execution-1', capacity, baseline, exit, effectsLimit, used, captures: {}, roots: {}, claims: {}, exitClaims: {}, ended: false, stopped: false };
}
const root = (s, name) => { need(Object.hasOwn(s.roots, name), 'ROOT'); return s.roots[name]; };
const rootClaims = (s, name) => Object.values(s.claims).filter(c => c.root === name);
const live = (s, name, lane) => sum(rootClaims(s, name).filter(c => !lane || c.lane === lane).map(c => c.remaining));
const promisedEffects = s => Object.values(s.roots).filter(r => r.phase !== 'finished').reduce((n, r) => number(n + r.futureEffects), 0);
function tail(s, name) {
  const r = root(s, name), charged = live(s, name);
  if (!rootClaims(s, name).some(c => c.exclusive || D.some(d => c.remaining[d]))) return zero();
  return Object.fromEntries(D.map(d => [d, Math.min(r.profile.cleanup[d], Math.max(0, r.tailCap[d] - charged[d]))]));
}
function committed(s) {
  return add(add(s.baseline, s.exit), sum(Object.entries(s.roots).map(([name, r]) => r.phase === 'finished'
    ? add(live(s, name), tail(s, name)) : add(r.profile.work, r.profile.cleanup))));
}
function locks(s) {
  const out = new Set();
  for (const [name, r] of Object.entries(s.roots)) if (r.phase !== 'finished') r.profile.exclusive.forEach(k => out.add(k));
  for (const c of Object.values(s.claims)) if (c.exclusive) out.add(c.exclusive);
  return out;
}
function verify(s) { fits(committed(s), s.capacity, 'OVERCOMMIT'); need(s.used + promisedEffects(s) <= s.effectsLimit, 'EFFECT_OVERCOMMIT'); }
function apply(s, e) {
  need(!s.ended, 'ENDED');
  switch (e.type) {
    case 'capture': {
      id(e.root); need(!s.stopped && !Object.hasOwn(s.captures, e.root), 'CAPTURE');
      need(s.used + promisedEffects(s) < s.effectsLimit, 'EFFECT_CAPACITY');
      s.used++; s.captures[e.root] = true; break;
    }
    case 'admit': {
      need(!s.stopped && e.fresh === true && Array.isArray(e.members), 'ADMISSION_BOUNDARY');
      const seen = new Set(), exclusive = locks(s); let resources = committed(s), effects = s.used + promisedEffects(s);
      for (const m of e.members) {
        id(m.root); need(s.captures[m.root] === true && !Object.hasOwn(s.roots, m.root) && !seen.has(m.root), 'CAPTURE'); seen.add(m.root);
        const p = profile(m.profile); resources = add(resources, add(p.work, p.cleanup)); effects = number(effects + p.effects - 1);
        fits(resources, s.capacity, 'RESOURCE_CAPACITY', { binding: p.binding, root: m.root });
        need(effects <= s.effectsLimit, 'EFFECT_CAPACITY', { required: effects, available: s.effectsLimit, binding: p.binding });
        for (const k of p.exclusive) { need(!exclusive.has(k), 'EXCLUSIVE_CONFLICT', { binding: k, root: m.root }); exclusive.add(k); }
      }
      for (const m of e.members) s.roots[m.root] = { profile: profile(m.profile), phase: 'work', futureEffects: m.profile.effects - 1, children: {} };
      break;
    }
    case 'deny': {
      need(Array.isArray(e.roots), 'CAPTURE');
      for (const name of e.roots) need(s.captures[name] === true && !Object.hasOwn(s.roots, name), 'CAPTURE');
      for (const name of e.roots) s.captures[name] = false;
      break;
    }
    case 'ticket': {
      const r = root(s, e.root); id(e.id); need(!s.stopped && r.phase === 'work', 'STOPPED');
      need(r.futureEffects > 0 && !Object.hasOwn(r.children, e.id), 'CHILD_BUDGET');
      r.futureEffects--; s.used++; r.children[e.id] = 'live'; break;
    }
    case 'settle-child': {
      const r = root(s, e.root); need(r.children[e.id] === 'live', 'CHILD_TICKET'); r.children[e.id] = 'settled'; break;
    }
    case 'acquire': {
      const r = root(s, e.root), charge = vector(e.charge), k = key(e.resource.ref); binding(e.resource.binding);
      need(charge.records >= 1, 'RECORD_CHARGE');
      need(e.resource.ref.execution === s.execution && e.resource.root === e.root, 'ATTRIBUTION');
      need(!Object.hasOwn(s.claims, k), 'DUPLICATE_CLAIM');
      need(e.resource.state === 'owned' && e.resource.disposition === 'retained', 'OWNERSHIP');
      need(['quiescent', 'active', 'unknown'].includes(e.resource.access), 'ACCESS');
      need(['work', 'cleanup'].includes(e.lane), 'LANE');
      if (e.lane === 'cleanup') {
        need(e.authority === 'fixture-cleanup-owner', 'CLEANUP_AUTHORITY');
        if (r.phase === 'finished') fits(charge, tail(s, e.root), 'TAIL_ENVELOPE');
      }
      if (e.lane === 'work') {
        need(!s.stopped && r.phase === 'work', 'STOPPED');
        fits(add(live(s, e.root, 'work'), charge), r.profile.work, 'WORK_ENVELOPE', { binding: e.resource.binding });
      }
      fits(add(live(s, e.root), charge), add(r.profile.work, r.profile.cleanup), 'ROOT_ENVELOPE', { binding: e.resource.binding });
      if (e.exclusive) {
        need(r.profile.exclusive.includes(e.exclusive), 'UNDECLARED_EXCLUSIVE');
        need(!Object.values(s.claims).some(c => c.exclusive === e.exclusive), 'DUPLICATE_EXCLUSIVE');
      }
      s.claims[k] = { root: e.root, resource: clone(e.resource), lane: e.lane, remaining: charge, exclusive: e.exclusive || null }; break;
    }
    case 'observe': {
      const c = s.claims[key(e.resource.ref)]; need(c, 'CLAIM');
      need(c.root === e.resource.root && JSON.stringify(c.resource.binding) === JSON.stringify(e.resource.binding), 'ATTRIBUTION');
      const expected = { owned: ['retained'], busy: ['retained'], released: ['released'], transferred: ['transferred'], consumed: ['consumed'], unresolved: ['unknown', 'retained'] };
      need(expected[e.resource.state]?.includes(e.resource.disposition), 'OWNERSHIP');
      if (!['owned', 'busy'].includes(c.resource.state)) need(e.resource.state === c.resource.state && e.resource.disposition === c.resource.disposition, 'RESURRECTION');
      need(['quiescent', 'active', 'unknown'].includes(e.resource.access), 'ACCESS');
      c.resource = clone(e.resource); break;
    }
    case 'refund': {
      const c = s.claims[key(e.ref)]; need(c, 'CLAIM');
      const v = vector(e.amount); fits(v, c.remaining, 'DOUBLE_REFUND');
      need(!['owned', 'busy', 'unresolved'].includes(c.resource.state), 'NO_RELEASE_EVIDENCE');
      const proof = policy.fixtureProofs[e.proof]; need(proof && proof.dispositions.includes(c.resource.disposition), 'PROOF');
      need(!proof.quiescent || c.resource.access === 'quiescent', 'QUIESCENCE');
      for (const d of D) if (v[d]) need(proof.dimensions.includes(d), 'PROOF_DIMENSION');
      if (e.releaseExclusive) need(c.exclusive && proof.exclusive, 'PROOF_EXCLUSIVE');
      c.remaining = sub(c.remaining, v); if (e.releaseExclusive) c.exclusive = null; break;
    }
    case 'stop': {
      if (e.root) { const r = root(s, e.root); need(r.phase !== 'finished', 'FINISHED'); r.phase = 'cleanup'; }
      else { s.stopped = true; for (const r of Object.values(s.roots)) if (r.phase !== 'finished') r.phase = 'cleanup'; }
      break;
    }
    case 'finish': {
      const r = root(s, e.root); need(r.phase !== 'finished' && e.settled === true, 'SETTLEMENT');
      need(Object.values(r.children).every(v => v === 'settled'), 'CHILD_LIVE');
      need(!rootClaims(s, e.root).some(c => c.resource.state === 'busy'), 'IN_FLIGHT');
      const charged = live(s, e.root), envelope = add(r.profile.work, r.profile.cleanup);
      r.tailCap = Object.fromEntries(D.map(d => [d, Math.min(envelope[d], number(charged[d] + r.profile.cleanup[d]))]));
      r.phase = 'finished'; r.futureEffects = 0; break;
    }
    case 'exit-acquire': {
      id(e.id); need(e.authority === 'fixture-execution-owner' && !Object.hasOwn(s.exitClaims, e.id), 'EXIT_AUTHORITY');
      const v = vector(e.charge); fits(add(sum(Object.values(s.exitClaims)), v), s.exit, 'EXIT_ENVELOPE');
      s.exitClaims[e.id] = v; break;
    }
    case 'end': s.ended = true; break;
    default: reject('EVENT');
  }
  verify(s);
}
function step(state, event) { const next = clone(state); apply(next, event); return next; }
function summary(s) {
  return { committed: committed(s), available: sub(s.capacity, committed(s)), usedEffects: s.used,
    promisedEffects: promisedEffects(s), exclusive: [...locks(s)].sort(), carry: sum(Object.entries(s.roots).filter(([, r]) => r.phase === 'finished').map(([n]) => live(s, n))),
    carryCleanupReserve: sum(Object.entries(s.roots).filter(([, r]) => r.phase === 'finished').map(([n]) => tail(s, n))),
    charges: Object.values(s.claims).map(c => ({ root: c.root, ref: c.resource.ref, binding: c.resource.binding, disposition: c.resource.disposition, access: c.resource.access, remaining: c.remaining, exclusive: c.exclusive })), ended: s.ended };
}
module.exports = { initial, step, summary, zero };
