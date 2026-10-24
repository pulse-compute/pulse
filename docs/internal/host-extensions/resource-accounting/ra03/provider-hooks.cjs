'use strict';
// Private prototype hooks. No discovery, callbacks in the DSL, or host ABI claim.
function contractError(code) { return Object.assign(new Error(code), { code: 'RA03_' + code }); }
function executionHooks(ledger, profileFor) {
  if (typeof profileFor !== 'function') throw contractError('PROFILE_RESOLVER');
  return Object.freeze({
    local() { ledger.local(); },
    capture(descriptor) { return ledger.capture(profileFor(descriptor)); },
    admit(roots) { try { ledger.admit(roots); } catch (error) { ledger.deny(roots); throw error; } },
    settle(root) { ledger.settleEffect(root); },
    stop() { ledger.stop(); },
    end() { ledger.end(); }
  });
}
async function providerCall(ledger, root, charges, invoke, { lane = 'work', containExecution = () => {} } = {}) {
  const tickets = ledger.prepare(root, charges, lane); // Complete preflight BEFORE host entry.
  let result;
  try { result = await invoke(); }
  catch (error) {
    for (const t of tickets) ledger.observe(t, 'unresolved', 'unknown');
    ledger.stop(); throw error; // Unknown output/disposition; no status-derived refund.
  }
  const outputs = result?.outputs;
  let fault = !Array.isArray(outputs) || outputs.length > tickets.length;
  for (let i = 0; i < tickets.length; i++) {
    const value = Array.isArray(outputs) ? outputs[i] : undefined;
    if (value === undefined && result?.noOutputProof === 'provider-proved-no-output') ledger.noOutput(tickets[i], result.noOutputProof);
    else if (Number.isSafeInteger(value) && value >= 0) {
      try { ledger.adopt(tickets[i], value); }
      catch (_) { ledger.observe(tickets[i], 'unresolved', 'unknown'); ledger.contain(root, [value]); fault = true; }
    } else { ledger.observe(tickets[i], 'unresolved', 'unknown'); fault = true; }
  }
  if (fault) {
    // Slice only the finite emergency prefix, while preserving overflow evidence.
    // Ledger.contain itself caps traversal; a hostile/unqualified ABI count is
    // an explicit coverage failure, not an invitation to allocate an array.
    const excess = Array.isArray(outputs) ? outputs.slice(tickets.length, tickets.length + ledger.storage().emergencySlots + 1) : null;
    ledger.contain(root, excess);
    containExecution(ledger.snapshot()); // Provider-owned teardown/escalation; no retry.
    throw contractError('PROVIDER_CONTRACT');
  }
  return tickets;
}
module.exports = { executionHooks, providerCall, contractError };
