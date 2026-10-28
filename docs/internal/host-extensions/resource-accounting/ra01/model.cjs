'use strict';
// Offline trace oracle only. It performs no host calls, admission, scheduling,
// allocation accounting, code generation or production integration.
const contract = require('./contract.json');
const copy = value => JSON.parse(JSON.stringify(value));
function fail(code) { throw Object.assign(new Error(code), { code: 'RA01_' + code }); }
function need(ok, code) { if (!ok) fail(code); }
function key(ref) {
  need(ref && typeof ref.execution === 'string' && Number.isSafeInteger(ref.slot) && ref.slot >= 0
    && Number.isSafeInteger(ref.generation) && ref.generation > 0, 'IDENTITY');
  return JSON.stringify([ref.execution, ref.slot, ref.generation]);
}
function initial(execution = 'execution-1') {
  return { execution, ended: false, owners: {}, resources: {}, calls: {}, pins: {}, generations: {}, observations: [] };
}
function owner(s, id) { need(Object.hasOwn(s.owners, id), 'OWNER'); return s.owners[id]; }
function resource(s, ref) {
  need(ref.execution === s.execution, 'EXECUTION');
  const r = s.resources[key(ref)]; need(r, 'STALE_REFERENCE'); return r;
}
function active(s, o) {
  if (o.phase !== 'open' || o.stopped) return false;
  let parent = o.parent;
  while (parent) {
    const p = owner(s, parent);
    if (p.stopped || (o.kind !== 'result' && p.phase !== 'open')) return false;
    parent = p.parent;
  }
  return true;
}
function available(s, r, actor) {
  need(r.owner === actor, 'OWNER'); need(r.state === 'owned', 'STATE');
  need(!Object.values(s.pins).some(p => p.resource === key(r.ref)), 'PINNED');
}
const held = r => ['owned', 'busy', 'unresolved'].includes(r.state)
  || (r.state === 'consumed' && r.access !== 'quiescent');
function adopt(s, item, allowLate = false) {
  const o = owner(s, item.owner), k = key(item.ref);
  need(item.ref.execution === s.execution, 'EXECUTION');
  need(allowLate || active(s, o), 'CLOSED_OWNER');
  need(typeof item.namespace === 'string' && item.namespace.length > 0
    && (typeof item.payload === 'string' || Number.isSafeInteger(item.payload)), 'PAYLOAD');
  need(Object.values(contract.actions).some(a => a.kinds.includes(item.kind)), 'KIND');
  need(contract.access.includes(item.access), 'ACCESS');
  need(item.binding && ['capability', 'service', 'useSite', 'implementation'].every(k =>
    typeof item.binding[k] === 'string' && item.binding[k].length > 0), 'BINDING');
  need(!Object.hasOwn(s.resources, k), 'DUPLICATE_REFERENCE');
  const priorGeneration = s.generations[item.ref.slot] || 0;
  need(item.ref.generation > priorGeneration, 'STALE_REFERENCE');
  need(!Object.values(s.resources).some(r => r.ref.slot === item.ref.slot && held(r)), 'LIVE_SLOT');
  need(!Object.values(s.resources).some(r => r.namespace === item.namespace && r.payload === item.payload
    && held(r)), 'DUPLICATE_PAYLOAD');
  s.generations[item.ref.slot] = item.ref.generation;
  s.resources[k] = { ...copy(item), root: o.root, state: 'owned', disposition: 'retained', attempted: [], failedActions: [], late: !active(s, o) };
}
function apply(s, e) {
  need(!s.ended, 'EXECUTION_ENDED');
  switch (e.type) {
    case 'owner': {
      need(typeof e.id === 'string' && e.id.length > 0 && !Object.hasOwn(s.owners, e.id), 'OWNER');
      need(['operation', 'result'].includes(e.kind), 'OWNER_KIND');
      let root = e.id;
      if (e.parent) { const p = owner(s, e.parent); need(active(s, p), 'CLOSED_OWNER'); need(p.kind === 'operation', 'OWNER_KIND'); root = p.root; }
      need(e.kind !== 'result' || e.parent, 'OWNER_KIND');
      s.owners[e.id] = { root, parent: e.parent || null, kind: e.kind, phase: 'open', stopped: false, errors: 0 };
      break;
    }
    case 'adopt': adopt(s, e.resource); break;
    case 'pin': {
      const r = resource(s, e.ref), o = owner(s, e.actor);
      need(active(s, o) && !r.late, 'CLOSED_OWNER');
      need(r.state === 'owned' && o.root === r.root, 'BORROW');
      need(typeof e.id === 'string' && !Object.hasOwn(s.pins, e.id), 'PIN');
      s.pins[e.id] = { resource: key(e.ref), actor: e.actor }; break;
    }
    case 'unpin': {
      need(Object.hasOwn(s.pins, e.id) && s.pins[e.id].actor === e.actor, 'PIN');
      delete s.pins[e.id]; break;
    }
    case 'handoff': {
      const r = resource(s, e.ref), dest = owner(s, e.to);
      available(s, r, e.actor);
      need(active(s, owner(s, e.actor)) && active(s, dest) && !r.late, 'CLOSED_OWNER');
      need(dest.root === r.root && e.to !== e.actor, 'ROOT');
      need(r.access === 'quiescent', 'EXTERNAL_ACCESS');
      r.owner = e.to; break;
    }
    case 'quiesce': {
      const r = resource(s, e.ref); available(s, r, e.actor);
      need(e.proof === 'fixture-provider-completion', 'QUIESCENCE_PROOF');
      r.access = 'quiescent'; break;
    }
    case 'begin': {
      const o = owner(s, e.actor);
      need(typeof e.id === 'string' && !Object.hasOwn(s.calls, e.id), 'CALL');
      need(['work', 'cleanup'].includes(e.mode), 'MODE');
      need(e.mode === 'cleanup' || active(s, o), 'CLOSED_OWNER');
      need(Array.isArray(e.inputs) && e.inputs.length > 0 && Array.isArray(e.outputKinds), 'INPUTS');
      const seen = new Set();
      for (const input of e.inputs) {
        const r = resource(s, input.ref), a = contract.actions[input.action];
        need(a && a.kinds.includes(r.kind), 'ACTION'); available(s, r, e.actor);
        need(!seen.has(key(input.ref)), 'DUPLICATE_INPUT'); seen.add(key(input.ref));
        need(e.mode !== 'work' || !r.late, 'CLOSED_OWNER');
        need(e.mode !== 'cleanup' || (['dispose', 'cancel'].includes(a.intent) || ['resolve', 'poll-unready'].includes(input.action)), 'CLEANUP_COMMIT');
        need(a.repeatable || !r.attempted.includes(input.action), 'RETRY');
        need(!r.failedActions.includes(input.action), 'RETRY');
        need(a.intent !== 'dispose' || r.access === 'quiescent'
          || e.disposeProof === 'fixture-provider-dispose-quiescence', 'EXTERNAL_ACCESS');
        need(input.action !== 'close' || r.kind !== 'cache' || e.ready === true, 'WOULD_BLOCK');
        need(e.mode !== 'cleanup' || input.action !== 'resolve' || e.ready === true, 'WOULD_BLOCK');
      }
      for (const input of e.inputs) {
        const r = resource(s, input.ref); r.state = 'busy'; r.attempted.push(input.action);
      }
      s.calls[e.id] = { ...copy(e), state: 'busy' }; break;
    }
    case 'complete': {
      const call = s.calls[e.id]; need(call && call.state === 'busy', 'CALL');
      need(e.actor === call.actor, 'OWNER'); need(['ok', 'error'].includes(e.status), 'STATUS');
      need(Array.isArray(e.results) && e.results.length === call.inputs.length && Array.isArray(e.outputs), 'PARTIAL_REPORT');
      need(contract.acceptance.includes(e.acceptance), 'ACCEPTANCE');
      if (call.inputs.some(i => i.action === 'commit')) {
        need(e.acceptance !== 'not-applicable' && (e.status !== 'ok' || e.acceptance === 'accepted'), 'ACCEPTANCE');
      }
      const seen = new Set();
      for (const result of e.results) {
        const k = key(result.ref), input = call.inputs.find(i => key(i.ref) === k);
        need(input && !seen.has(k), 'PARTIAL_REPORT'); seen.add(k);
        const r = resource(s, result.ref), a = contract.actions[input.action];
        need(r.state === 'busy' && r.owner === e.actor, 'STATE');
        need(a[e.status === 'ok' ? 'success' : 'error'].includes(result.disposition), 'DISPOSITION');
        if (e.status === 'error' && result.disposition !== 'unknown') need(result.basis === 'fixture-host-observation', 'DISPOSITION_PROOF');
        need(contract.access.includes(result.access), 'ACCESS');
        if (r.access !== 'quiescent' && result.access === 'quiescent') need(result.proof === 'fixture-provider-completion', 'QUIESCENCE_PROOF');
        if (result.disposition === 'released') need(result.access === 'quiescent', 'EXTERNAL_ACCESS');
        if (result.disposition === 'transferred') need(typeof result.receiver === 'string' && result.receiver.length > 0
          && (result.access === 'quiescent' || result.receiverOwnsAccess === true), 'RECEIVER');
        r.state = result.disposition === 'retained' ? 'owned' : result.disposition === 'unknown' ? 'unresolved' : result.disposition;
        // A failed terminal disposal/finalization is quarantined even if retained.
        if (e.status === 'error' && ['dispose', 'commit', 'cancel'].includes(a.intent) && result.disposition === 'retained') r.state = 'unresolved';
        r.disposition = result.disposition; r.access = result.access; r.acceptance = e.acceptance;
        if (e.status === 'error') r.failedActions.push(input.action);
      }
      const remainingKinds = [...call.outputKinds];
      for (const output of e.outputs) {
        const index = remainingKinds.indexOf(output.kind); need(index >= 0 && output.owner === call.actor, 'OUTPUT');
        remainingKinds.splice(index, 1); adopt(s, output, true);
      }
      if (e.status === 'ok') need(remainingKinds.length === 0, 'PARTIAL_REPORT');
      call.state = 'complete';
      if (e.status === 'error') owner(s, call.actor).errors++;
      s.observations.push({ call: e.id, status: e.status, acceptance: e.acceptance }); break;
    }
    case 'settle': {
      const o = owner(s, e.actor); need(o.phase !== 'settled', 'SETTLED');
      need(!Object.values(s.calls).some(c => c.actor === e.actor && c.state === 'busy'), 'IN_FLIGHT');
      need(!Object.values(s.owners).some(c => c.parent === e.actor && c.kind === 'operation' && c.phase !== 'settled'), 'CHILD_LIVE');
      need(['ok', 'error'].includes(e.status) && (e.status !== 'ok' || o.errors === 0), 'SETTLEMENT');
      o.phase = 'settled'; break;
    }
    case 'stop': {
      owner(s, e.actor).stopped = true; break;
    }
    case 'end': {
      need(['return', 'trap', 'termination'].includes(e.reason), 'END');
      if (e.reason === 'return') need(!Object.values(s.calls).some(c => c.state === 'busy'), 'IN_FLIGHT');
      for (const r of Object.values(s.resources)) if (['owned', 'busy'].includes(r.state)) {
        r.disposition = r.state === 'busy' ? 'unknown' : 'retained'; r.state = 'unresolved';
      }
      s.ended = true; break;
    }
    default: fail('EVENT');
  }
}
function step(state, event) { const next = copy(state); apply(next, event); return next; }
function summary(s) {
  // Payloads and ABI namespaces deliberately do not cross the observation boundary.
  return { execution: s.execution, ended: s.ended, resources: Object.values(s.resources).map(r => ({
    ref: r.ref, kind: r.kind, binding: r.binding, root: r.root, owner: r.owner, state: r.state,
    disposition: r.disposition, access: r.access, acceptance: r.acceptance || 'not-applicable'
  })), outstandingPins: Object.keys(s.pins).length, observations: s.observations };
}
module.exports = { initial, step, summary };
