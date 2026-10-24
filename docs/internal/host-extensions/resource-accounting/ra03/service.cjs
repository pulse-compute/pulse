'use strict';
// Internal prototype. Trusted provider-facing ledger; no host calls or scheduler.
// All retained mutable records live in fixed typed arrays. Caller-owned tokens,
// diagnostic snapshots and transient argument arrays are NOT allocation-free.
const policy = require('../ra02/policy.json');
const D = ['handles', 'bytes', 'records'];
const R = { gen: 0, phase: 1, profile: 2, future: 3, children: 4, workSteps: 5, cleanupSteps: 6, live: 7, work: 10, tail: 13, childSerial: 16, used: 17, effectSettled: 18, size: 19 };
const C = { gen: 0, state: 1, lane: 2, owner: 3, binding: 4, payload: 5, access: 6, exclusive: 7, charge: 8, action: 11, actionGen: 12, attempted: 13, size: 14 };
const PHASE = { free: 0, captured: 1, work: 2, cleanup: 3, finished: 4 };
const STATE = { free: 0, prepared: 1, owned: 2, busy: 3, released: 4, consumed: 5, transferred: 6, unresolved: 7 };
const ACCESS = { quiescent: 1, active: 2, unknown: 3 };
const fail = code => { throw Object.assign(new Error(code), { code: 'RA03_' + code }); };
const need = (ok, code) => { if (!ok) fail(code); };
function integer(n, max = Number.MAX_SAFE_INTEGER) { need(Number.isSafeInteger(n) && n >= 0 && n <= max, 'BOUND'); return n; }
function vector(v) { need(v && Object.keys(v).length === 3 && D.every(d => Object.hasOwn(v, d)), 'DIMENSIONS'); return D.map(d => integer(v[d])); }
const out = a => Object.fromEntries(D.map((d, i) => [d, a[i]]));
const plus = (a, b) => a.map((v, i) => integer(v + b[i]));
function fits(a, b, code) { need(a.every((v, i) => v <= b[i]), code); }
const zero = () => [0, 0, 0];
function normalizeProfile(p, slots, locks) {
  const fields = ['version','coverage','binding','work','cleanup','effects','workSteps','cleanupSteps','exclusive'];
  need(p && Object.keys(p).length === fields.length && fields.every(k => Object.hasOwn(p, k)), 'PROFILE_FIELDS');
  need(p?.version === policy.version && p.coverage === 'complete-for-accounted-domain', 'PROFILE');
  const work = vector(p.work), cleanup = vector(p.cleanup), envelope = plus(work, cleanup);
  need(integer(p.binding, 63) >= 1, 'BINDING');
  need(integer(p.effects, 1024) >= 1, 'EFFECT_BOUND');
  need(integer(p.workSteps, 1000000) >= 1 && integer(p.cleanupSteps, 1000000) >= 1, 'STEP_BOUND');
  need(envelope[2] <= slots && work[2] >= 1, 'RECORD_PROFILE');
  need(Array.isArray(p.exclusive) && p.exclusive.length <= locks, 'EXCLUSIVE');
  const exclusive = [...p.exclusive];
  exclusive.forEach((v, i) => { integer(v, locks - 1); need(exclusive.indexOf(v) === i, 'EXCLUSIVE'); });
  return Object.freeze({ work: Object.freeze(work), cleanup: Object.freeze(cleanup), envelope: Object.freeze(envelope), effects: p.effects,
    binding: p.binding, workSteps: p.workSteps, cleanupSteps: p.cleanupSteps, exclusive: Object.freeze(exclusive) });
}
class Ledger {
  #roots; #claims; #children; #seen; #locks; #profiles; #identity = Object.freeze({});
  #capacity; #baseline; #exit; #exitCharge = new Float64Array(3);
  #rootSlots; #claimSlots; #childSlots; #emergencySlots; #normalClaims; #deadline; #clock; #effectsLimit;
  #used = 0; #stopped = false; #ended = false; #fault = null; #coverageLost = false;
  #tokens = 0; #snapshots = 0; #highRecords = 0; #activeRecords = 0;
  constructor(config) {
    const { rootSlots, claimsPerRoot, childrenPerRoot, emergencySlots, exclusiveSlots = 16 } = config;
    need(integer(rootSlots, 1024) > 0 && integer(claimsPerRoot, 64) > 0, 'STORAGE_BOUND');
    integer(childrenPerRoot, 1024); need(integer(emergencySlots, 32) > 0, 'EMERGENCY_BOUND');
    need(integer(exclusiveSlots, 256) > 0, 'EXCLUSIVE_BOUND');
    this.#capacity = Object.freeze(vector(config.capacity)); this.#baseline = Object.freeze(vector(config.baseline)); this.#exit = Object.freeze(vector(config.exit));
    fits(plus(this.#baseline, this.#exit), this.#capacity, 'EXECUTION_RESERVE');
    // Emergency records are statically owned by the execution, never ordinary work.
    need(this.#exit[2] >= emergencySlots, 'EMERGENCY_RESERVE');
    this.#effectsLimit = integer(config.effectsLimit, 1000000);
    this.#deadline = integer(config.deadline); need(typeof config.clock === 'function', 'CLOCK'); this.#clock = config.clock;
    need(Array.isArray(config.profiles) && config.profiles.length > 0 && config.profiles.length <= 64, 'PROFILES');
    this.#profiles = Object.freeze(config.profiles.map(p => normalizeProfile(p, claimsPerRoot, exclusiveSlots)));
    need(this.#profiles.every(p => p.effects - 1 <= childrenPerRoot), 'CHILD_STORAGE');
    this.#rootSlots = rootSlots; this.#claimSlots = claimsPerRoot; this.#childSlots = childrenPerRoot; this.#emergencySlots = emergencySlots;
    this.#normalClaims = rootSlots * claimsPerRoot;
    this.#roots = new Float64Array(rootSlots * R.size);
    this.#claims = new Float64Array((this.#normalClaims + emergencySlots) * C.size);
    // One generation plus live bit per child slot; settlement recycles a slot.
    this.#children = new Float64Array(rootSlots * childrenPerRoot * 2);
    this.#seen = new Uint8Array(rootSlots); this.#locks = new Uint8Array(exclusiveSlots);
  }
  #root(t) {
    need(t?.execution === this.#identity && t.type === 'root' && Number.isSafeInteger(t.slot) && t.slot >= 0 && t.slot < this.#rootSlots, 'ROOT');
    const i = t.slot * R.size;
    need(this.#roots[i + R.phase] !== PHASE.free && this.#roots[i + R.gen] === t.generation, 'STALE_ROOT'); return i;
  }
  #claim(t) {
    need(t?.execution === this.#identity && t.type === 'claim' && Number.isSafeInteger(t.slot) && t.slot >= 0 && t.slot < this.#normalClaims, 'CLAIM');
    const i = t.slot * C.size;
    need(this.#claims[i + C.state] !== STATE.free && this.#claims[i + C.gen] === t.generation, 'STALE_CLAIM'); return i;
  }
  #token(type, slot, generation) { this.#tokens++; return Object.freeze({ execution: this.#identity, type, slot, generation }); }
  #generation(n) { need(n < Number.MAX_SAFE_INTEGER, 'GENERATION_EXHAUSTED'); return n + 1; }
  #profile(i) { return this.#profiles[this.#roots[i + R.profile]]; }
  #read(array, i) { return [array[i], array[i + 1], array[i + 2]]; }
  #write(array, i, v) { for (let d = 0; d < 3; d++) array[i + d] = v[d]; }
  #checkTime() { const now = this.#clock(); integer(now); if (now >= this.#deadline) { this.#stopped = true; fail('DEADLINE'); } }
  #open(work = false) { need(!this.#ended, 'ENDED'); this.#checkTime(); if (work) need(!this.#stopped, 'STOPPED'); }
  #held(i) {
    const start = i / R.size * this.#claimSlots;
    for (let k = start; k < start + this.#claimSlots; k++) if (this.#claims[k * C.size + C.state]) return true;
    return false;
  }
  #tail(i, d) {
    if (!this.#held(i)) return 0;
    return Math.min(this.#profile(i).cleanup[d], Math.max(0, this.#roots[i + R.tail + d] - this.#roots[i + R.live + d]));
  }
  #commit(d) {
    let n = this.#baseline[d] + this.#exit[d];
    for (let i = 0; i < this.#roots.length; i += R.size) {
      const phase = this.#roots[i + R.phase];
      if (phase === PHASE.work || phase === PHASE.cleanup) n += this.#profile(i).envelope[d];
      else if (phase === PHASE.finished) n += this.#roots[i + R.live + d] + this.#tail(i, d);
    }
    return integer(n);
  }
  #promised() { let n = 0; for (let i = 0; i < this.#roots.length; i += R.size) n += this.#roots[i + R.future]; return n; }
  #maybeFinish(i) {
    if (!this.#roots[i + R.effectSettled] || ![PHASE.work, PHASE.cleanup].includes(this.#roots[i + R.phase]) || this.#roots[i + R.children]) return;
    const start = i / R.size * this.#claimSlots;
    for (let j = start; j < start + this.#claimSlots; j++) if ([STATE.prepared, STATE.busy].includes(this.#claims[j * C.size + C.state])) return;
    this.finish(this.#token('root', i / R.size, this.#roots[i + R.gen]));
  }
  settleEffect(root) { const i = this.#root(root); this.#roots[i + R.effectSettled] = 1; this.#maybeFinish(i); }
  #retireRoot(i) {
    if (this.#roots[i + R.phase] === PHASE.finished && !this.#held(i)) this.#roots[i + R.phase] = PHASE.free;
  }
  local() {
    this.#open(true); need(this.#used + this.#promised() < this.#effectsLimit, 'EFFECT_CAPACITY'); this.#used++;
  }
  capture(profileIndex = 0) {
    this.#open(true); integer(profileIndex, this.#profiles.length - 1);
    need(this.#used + this.#promised() < this.#effectsLimit, 'EFFECT_CAPACITY');
    let i = 0; while (i < this.#roots.length && this.#roots[i + R.phase]) i += R.size;
    need(i < this.#roots.length, 'ROOT_STORAGE');
    const gen = this.#generation(this.#roots[i + R.gen]); this.#roots.fill(0, i, i + R.size);
    this.#roots[i + R.gen] = gen; this.#roots[i + R.phase] = PHASE.captured; this.#roots[i + R.profile] = profileIndex; this.#used++;
    return this.#token('root', i / R.size, gen);
  }
  admit(tokens) {
    this.#open(true); need(Array.isArray(tokens) && tokens.length <= 32, 'COHORT_BOUND');
    this.#seen.fill(0); this.#locks.fill(0);
    // Include whole-operation promises and retained exclusive obligations.
    for (let i = 0; i < this.#roots.length; i += R.size) if ([PHASE.work, PHASE.cleanup].includes(this.#roots[i + R.phase]))
      for (const lock of this.#profile(i).exclusive) this.#locks[lock] = 1;
    for (let i = 0; i < this.#normalClaims * C.size; i += C.size) if (this.#claims[i + C.state] && this.#claims[i + C.exclusive]) this.#locks[this.#claims[i + C.exclusive] - 1] = 1;
    const demand = D.map((_, d) => this.#commit(d)); let effects = this.#used + this.#promised();
    for (const t of tokens) {
      const i = this.#root(t), p = this.#profile(i);
      need(this.#roots[i + R.phase] === PHASE.captured && !this.#seen[t.slot], 'ADMISSION_BOUNDARY'); this.#seen[t.slot] = 1;
      for (let d = 0; d < 3; d++) demand[d] = integer(demand[d] + p.envelope[d]);
      effects = integer(effects + p.effects - 1);
      for (const lock of p.exclusive) { need(!this.#locks[lock], 'EXCLUSIVE_CONFLICT'); this.#locks[lock] = 1; }
    }
    fits(demand, this.#capacity, 'RESOURCE_CAPACITY'); need(effects <= this.#effectsLimit, 'EFFECT_CAPACITY');
    // Commit only after the entire cohort passes. No dispatch here.
    for (const t of tokens) { const i = this.#root(t); this.#roots[i + R.phase] = PHASE.work; this.#roots[i + R.future] = this.#profile(i).effects - 1; }
  }
  deny(tokens) {
    need(Array.isArray(tokens) && tokens.length <= 32, 'COHORT_BOUND'); this.#seen.fill(0);
    for (const t of tokens) { need(this.#roots[this.#root(t) + R.phase] === PHASE.captured && !this.#seen[t.slot], 'ADMISSION_BOUNDARY'); this.#seen[t.slot] = 1; }
    for (const t of tokens) this.#roots[t.slot * R.size + R.phase] = PHASE.free;
  }
  child(root) {
    this.#open(true); const i = this.#root(root);
    need(this.#roots[i + R.phase] === PHASE.work && this.#roots[i + R.future] > 0, 'CHILD_BUDGET');
    const start = root.slot * this.#childSlots * 2; let j = start;
    while (j < start + this.#childSlots * 2 && this.#children[j + 1]) j += 2;
    need(j < start + this.#childSlots * 2, 'CHILD_STORAGE');
    const gen = this.#generation(this.#children[j]); this.#children[j] = gen; this.#children[j + 1] = 1;
    this.#roots[i + R.future]--; this.#roots[i + R.children]++; this.#used++;
    return this.#token('child', j / 2, gen);
  }
  settleChild(root, ticket) {
    const i = this.#root(root), j = ticket?.slot * 2;
    need(ticket?.execution === this.#identity && ticket.type === 'child' && Number.isSafeInteger(ticket.slot)
      && ticket.slot >= root.slot * this.#childSlots && ticket.slot < (root.slot + 1) * this.#childSlots
      && this.#children[j] === ticket.generation && this.#children[j + 1] === 1, 'STALE_CHILD');
    this.#children[j + 1] = 0; this.#roots[i + R.children]--; this.#maybeFinish(i);
  }
  step(root, lane = 'work') {
    this.#open(lane === 'work'); const i = this.#root(root), p = this.#profile(i);
    need(lane === 'work' || lane === 'cleanup', 'LANE');
    need(this.#roots[i + R.phase] !== PHASE.captured && (lane !== 'work' || this.#roots[i + R.phase] === PHASE.work), 'STOPPED');
    const field = lane === 'work' ? R.workSteps : R.cleanupSteps, limit = lane === 'work' ? p.workSteps : p.cleanupSteps;
    need(this.#roots[i + field] < limit, 'STEP_LIMIT'); this.#roots[i + field]++;
  }
  prepare(root, charges, lane = 'work', owner = 0) {
    this.#open(lane === 'work'); const i = this.#root(root), p = this.#profile(i);
    integer(owner, p.effects + 1); need(lane === 'work' || lane === 'cleanup', 'LANE');
    need(Array.isArray(charges) && charges.length <= this.#claimSlots, 'OUTPUT_BOUND');
    need(this.#roots[i + R.phase] !== PHASE.captured && (lane !== 'work' || this.#roots[i + R.phase] === PHASE.work), 'STOPPED');
    const rows = charges.map(vector), total = rows.reduce(plus, zero()); rows.forEach(v => need(v[2] >= 1, 'RECORD_CHARGE'));
    if (lane === 'work') fits(plus(this.#read(this.#roots, i + R.work), total), p.work, 'WORK_ENVELOPE');
    if (this.#roots[i + R.phase] === PHASE.finished) fits(total, D.map((_, d) => this.#tail(i, d)), 'TAIL_ENVELOPE');
    fits(plus(this.#read(this.#roots, i + R.live), total), p.envelope, 'ROOT_ENVELOPE');
    const start = root.slot * this.#claimSlots, slots = [];
    for (let k = start; k < start + (lane === 'work' ? p.work[2] : this.#claimSlots) && slots.length < rows.length; k++) if (!this.#claims[k * C.size + C.state]) slots.push(k);
    need(slots.length === rows.length, 'RECORD_STORAGE');
    slots.forEach(k => this.#generation(this.#claims[k * C.size + C.gen]));
    // Caller supplies a qualified finite hostcall bound; records and logical
    // output charges are registered BEFORE entry, including the failure path.
    this.step(root, lane);
    for (let d = 0; d < 3; d++) { this.#roots[i + R.live + d] += total[d]; if (lane === 'work') this.#roots[i + R.work + d] += total[d]; }
    return slots.map((slot, n) => {
      const k = slot * C.size, gen = this.#generation(this.#claims[k + C.gen]); this.#claims.fill(0, k, k + C.size);
      this.#claims[k + C.gen] = gen; this.#claims[k + C.state] = STATE.prepared; this.#claims[k + C.lane] = lane === 'work' ? 1 : 2;
      this.#claims[k + C.owner] = owner; this.#claims[k + C.binding] = p.binding; this.#claims[k + C.payload] = -1; this.#claims[k + C.access] = ACCESS.unknown;
      this.#write(this.#claims, k + C.charge, rows[n]); this.#activeRecords++; this.#highRecords = Math.max(this.#highRecords, this.#activeRecords);
      return this.#token('claim', slot, gen);
    });
  }
  adopt(token, payload, access = 'quiescent', exclusive = null) {
    const k = this.#claim(token), ri = Math.floor(token.slot / this.#claimSlots) * R.size;
    integer(payload); need(ACCESS[access] && this.#claims[k + C.state] === STATE.prepared, 'ADOPTION');
    if (exclusive !== null) { need(this.#profile(ri).exclusive.includes(exclusive), 'UNDECLARED_EXCLUSIVE');
      for (let j = 0; j < this.#normalClaims * C.size; j += C.size) need(!this.#claims[j + C.state] || this.#claims[j + C.exclusive] !== exclusive + 1, 'DUPLICATE_EXCLUSIVE'); }
    for (let j = 0; j < this.#claims.length; j += C.size) if (j !== k && this.#claims[j + C.payload] >= 0
      && ([STATE.owned, STATE.busy, STATE.unresolved].includes(this.#claims[j + C.state]) || (this.#claims[j + C.state] === STATE.consumed && this.#claims[j + C.access] !== ACCESS.quiescent)))
      need(this.#claims[j + C.binding] !== this.#claims[k + C.binding] || this.#claims[j + C.payload] !== payload, 'DUPLICATE_PAYLOAD');
    this.#claims[k + C.payload] = payload; this.#claims[k + C.access] = ACCESS[access]; this.#claims[k + C.exclusive] = exclusive === null ? 0 : exclusive + 1;
    // Late delivery remains represented. Ending an execution is not disposal.
    this.#claims[k + C.state] = this.#ended || this.#clock() >= this.#deadline ? STATE.unresolved : STATE.owned;
    this.#maybeFinish(ri);
  }
  noOutput(token, proof) {
    const k = this.#claim(token); need(this.#claims[k + C.state] === STATE.prepared && proof === 'provider-proved-no-output', 'NO_OUTPUT_PROOF');
    this.#claims[k + C.state] = STATE.released; this.#claims[k + C.access] = ACCESS.quiescent;
    this.refund(token, out(this.#read(this.#claims, k + C.charge)), 'released-quiescent');
  }
  handoff(token, from, to) {
    this.#open(true); const k = this.#claim(token), i = Math.floor(token.slot / this.#claimSlots) * R.size;
    integer(to, this.#profile(i).effects + 1);
    need(this.#roots[i + R.phase] === PHASE.work && this.#claims[k + C.owner] === from && from !== to, 'OWNER');
    need(this.#claims[k + C.state] === STATE.owned && this.#claims[k + C.access] === ACCESS.quiescent, 'HANDOFF_STATE');
    this.#claims[k + C.owner] = to;
  }
  beginAction(token, owner, action, lane = 'work') {
    const k = this.#claim(token), i = Math.floor(token.slot / this.#claimSlots) * R.size;
    const kinds = { read: 1, close: 2, send: 3 };
    need(kinds[action] && this.#claims[k + C.owner] === owner, 'OWNER');
    need(this.#claims[k + C.state] === STATE.owned, 'ACTION_STATE');
    need(lane !== 'cleanup' || action === 'close', 'CLEANUP_ACTION');
    need(action === 'read' || this.#claims[k + C.access] === ACCESS.quiescent, 'EXTERNAL_ACCESS');
    const mask = 1 << kinds[action];
    need(!(this.#claims[k + C.attempted] & (mask << 8)) && (action === 'read' || !(this.#claims[k + C.attempted] & mask)), 'RETRY');
    const generation = this.#generation(this.#claims[k + C.actionGen]);
    this.step(this.#token('root', i / R.size, this.#roots[i + R.gen]), lane);
    this.#claims[k + C.action] = kinds[action]; this.#claims[k + C.actionGen] = generation;
    this.#claims[k + C.attempted] |= mask; this.#claims[k + C.state] = STATE.busy;
    this.#tokens++;
    return Object.freeze({ execution: this.#identity, type: 'action', slot: token.slot, generation: token.generation, actionGeneration: generation, owner });
  }
  completeAction(ticket, status, disposition, access) {
    need(ticket?.type === 'action', 'ACTION_TICKET');
    const token = { ...ticket, type: 'claim' }, k = this.#claim(token);
    need(this.#claims[k + C.state] === STATE.busy && this.#claims[k + C.actionGen] === ticket.actionGeneration
      && this.#claims[k + C.owner] === ticket.owner, 'STALE_ACTION');
    need(status === 'ok' || status === 'error', 'STATUS'); need(ACCESS[access], 'ACCESS');
    const expected = { 1: 'retained', 2: 'released', 3: 'transferred' }[this.#claims[k + C.action]];
    need(status === 'ok' ? disposition === expected : ['retained', 'unknown'].includes(disposition), 'DISPOSITION');
    need(disposition !== 'released' || access === 'quiescent', 'EXTERNAL_ACCESS');
    if (status === 'error') this.#claims[k + C.attempted] |= (1 << this.#claims[k + C.action]) << 8;
    const independentCleanup = status === 'error' && this.#claims[k + C.action] === 1 && disposition === 'retained';
    this.#claims[k + C.state] = independentCleanup ? STATE.owned : status === 'error' ? STATE.unresolved : disposition === 'retained' ? STATE.owned : STATE[disposition];
    this.#claims[k + C.access] = ACCESS[access];
    this.#maybeFinish(Math.floor(ticket.slot / this.#claimSlots) * R.size);
  }
  observe(token, state, access, owner = 0) {
    const k = this.#claim(token), prior = this.#claims[k + C.state];
    need(this.#claims[k + C.owner] === owner, 'OWNER');
    need(STATE[state] >= STATE.owned && ACCESS[access], 'OBSERVATION');
    need(state !== 'released' || access === 'quiescent', 'EXTERNAL_ACCESS');
    if (![STATE.owned, STATE.busy, STATE.prepared].includes(prior)) need(STATE[state] === prior, 'RESURRECTION');
    if (prior === STATE.prepared) need(state === 'unresolved', 'ADOPTION_REQUIRED');
    this.#claims[k + C.state] = STATE[state]; this.#claims[k + C.access] = ACCESS[access];
    this.#maybeFinish(Math.floor(token.slot / this.#claimSlots) * R.size);
  }
  refund(token, amount, proofName, releaseExclusive = false) {
    const k = this.#claim(token), i = Math.floor(token.slot / this.#claimSlots) * R.size, amountV = vector(amount), proof = policy.fixtureProofs[proofName];
    const state = Object.keys(STATE).find(s => STATE[s] === this.#claims[k + C.state]);
    need(['released', 'consumed', 'transferred'].includes(state), 'NO_RELEASE_EVIDENCE');
    need(proof?.dispositions.includes(state), 'PROOF');
    need(!proof.quiescent || this.#claims[k + C.access] === ACCESS.quiescent, 'QUIESCENCE');
    fits(amountV, this.#read(this.#claims, k + C.charge), 'DOUBLE_REFUND');
    for (let d = 0; d < 3; d++) if (amountV[d]) need(proof.dimensions.includes(D[d]), 'PROOF_DIMENSION');
    if (releaseExclusive) need(this.#claims[k + C.exclusive] && proof.exclusive, 'PROOF_EXCLUSIVE');
    for (let d = 0; d < 3; d++) { this.#claims[k + C.charge + d] -= amountV[d]; this.#roots[i + R.live + d] -= amountV[d]; if (this.#claims[k + C.lane] === 1) this.#roots[i + R.work + d] -= amountV[d]; }
    if (releaseExclusive) this.#claims[k + C.exclusive] = 0;
    if (!this.#claims[k + C.exclusive] && D.every((_, d) => this.#claims[k + C.charge + d] === 0)) {
      this.#claims[k + C.state] = STATE.free; this.#claims[k + C.payload] = -1; this.#activeRecords--; this.#retireRoot(i);
      this.#maybeFinish(i);
    }
  }
  stop(root) { if (root) { const i = this.#root(root); need([PHASE.work, PHASE.cleanup].includes(this.#roots[i + R.phase]), 'ADMISSION_BOUNDARY'); this.#roots[i + R.phase] = PHASE.cleanup; } else this.#stopped = true; }
  finish(root) {
    const i = this.#root(root); need([PHASE.work, PHASE.cleanup].includes(this.#roots[i + R.phase]), 'SETTLEMENT');
    need(this.#roots[i + R.children] === 0, 'CHILD_LIVE');
    const start = root.slot * this.#claimSlots;
    for (let j = start; j < start + this.#claimSlots; j++) need(![STATE.prepared, STATE.busy].includes(this.#claims[j * C.size + C.state]), 'IN_FLIGHT');
    const p = this.#profile(i); for (let d = 0; d < 3; d++) this.#roots[i + R.tail + d] = this.#roots[i + R.live + d] + Math.min(p.cleanup[d], p.envelope[d] - this.#roots[i + R.live + d]);
    this.#roots[i + R.phase] = PHASE.finished; this.#roots[i + R.future] = 0; this.#retireRoot(i);
  }
  chargeExit(charge) { this.#open(); const v = vector(charge); fits(plus(Array.from(this.#exitCharge), v), this.#exit, 'EXIT_ENVELOPE'); for (let d = 0; d < 3; d++) this.#exitCharge[d] += v[d]; }
  contain(root, outputs, reason = 'PROVIDER_CONTRACT') {
    const i = this.#root(root); this.#stopped = true; this.#fault ||= reason;
    // Preserve every representable unexpected output without new record allocation.
    // A violated ABI maximum cannot have a finite all-output guarantee: explicitly
    // mark coverage lost and require execution teardown, never claim cleanup.
    if (!Array.isArray(outputs)) { this.#coverageLost = true; return; }
    if (outputs.length > this.#emergencySlots) this.#coverageLost = true;
    for (let o = 0; o < Math.min(outputs.length, this.#emergencySlots); o++) {
      const value = outputs[o];
      let j = this.#normalClaims * C.size;
      while (j < this.#claims.length && this.#claims[j + C.state]) j += C.size;
      if (j >= this.#claims.length || !Number.isSafeInteger(value) || value < 0) { this.#coverageLost = true; continue; }
      this.#claims[j + C.state] = STATE.unresolved; this.#claims[j + C.payload] = value; this.#claims[j + C.binding] = this.#profile(i).binding;
      this.#claims[j + C.owner] = root.slot; this.#claims[j + C.access] = ACCESS.unknown;
    }
  }
  end() { this.#ended = true; this.#stopped = true; }
  storage() {
    return Object.freeze({ rootSlots: this.#rootSlots, claimsPerRoot: this.#claimSlots, childrenPerRoot: this.#childSlots, emergencySlots: this.#emergencySlots,
      rootBytes: this.#roots.byteLength, claimBytes: this.#claims.byteLength, childBytes: this.#children.byteLength,
      scratchBytes: this.#seen.byteLength + this.#locks.byteLength + this.#exitCharge.byteLength,
      backingBytes: this.#roots.byteLength + this.#claims.byteLength + this.#children.byteLength + this.#seen.byteLength + this.#locks.byteLength + this.#exitCharge.byteLength,
      tokenObjectsCreated: this.#tokens, snapshotObjectsCreated: this.#snapshots, activeRecords: this.#activeRecords, peakRecords: this.#highRecords });
  }
  snapshot() {
    this.#snapshots++; const carry = zero(), tail = zero(), charged = Array.from(this.#exitCharge);
    let activeRoots = 0, retainedRoots = 0, prepared = 0, unresolved = 0, emergency = 0;
    for (let i = 0; i < this.#roots.length; i += R.size) {
      const phase = this.#roots[i + R.phase]; if (phase === PHASE.work || phase === PHASE.cleanup) activeRoots++;
      if (phase === PHASE.finished) { retainedRoots++; for (let d = 0; d < 3; d++) { carry[d] += this.#roots[i + R.live + d]; tail[d] += this.#tail(i, d); } }
      for (let d = 0; d < 3; d++) charged[d] += this.#roots[i + R.live + d];
    }
    for (let j = 0; j < this.#claims.length; j += C.size) { if (this.#claims[j + C.state] === STATE.prepared) prepared++; if (this.#claims[j + C.state] === STATE.unresolved) unresolved++; if (j >= this.#normalClaims * C.size && this.#claims[j + C.state]) emergency++; }
    return { committed: out(D.map((_, d) => this.#commit(d))), charged: out(charged), carry: out(carry), carryCleanupReserve: out(tail), usedEffects: this.#used, promisedEffects: this.#promised(),
      activeRoots, retainedRoots, prepared, unresolved, emergency, stopped: this.#stopped, ended: this.#ended, fault: this.#fault, coverageLost: this.#coverageLost,
      accountingComplete: !this.#fault && !this.#coverageLost };
  }
}
module.exports = { Ledger, PHASE, STATE, ACCESS };
