// Private, trusted-driver kernel. No host imports, scheduler or effect dispatch.
// A driver binds a unique nonzero execution identity to each ledger and checks
// the managed invocation boundary before exposing a resource operation.
// Eight u64 words per active record and eight per staging record: 128N bytes.
// Active fields: kind, namespace, generation, owner, partition, state, value,
// spent. Value is a u32 provider handle or a safe-integer allocation allowance.
// Staging fields use the same layout; generation/state/spent are initially zero.
const PRL_SAFE: u64 = 9007199254740991;
const PRL_GENERATION_MAX: u64 = 4294967295;
const PRL_HANDLE: u64 = 1;
const PRL_ALLOCATION: u64 = 2;
const PRL_METADATA: u64 = 3;
const PRL_WORK: u64 = 1;
const PRL_CLEANUP: u64 = 2;
const PRL_EXIT: u64 = 3;
const PRL_FREE: u64 = 0;
const PRL_RESERVED: u64 = 1;
const PRL_ACQUIRING: u64 = 2;
const PRL_LIVE: u64 = 3;
const PRL_DISPOSING: u64 = 4;
const PRL_UNKNOWN: u64 = 5;
const PRL_EXHAUSTED: u64 = 6;

class PulseResourceLedger {
  // Implementation storage, never a public authoring surface. Wasm memory and
  // generated driver code remain trusted, as with existing raw result setters.
  bank: StaticArray<u64>;
  stage: StaticArray<u64>;
  capacity: i32;
  execution: u64;
  deadline: u64;
  lastNow: u64 = 0;
  handleLimit: u64;
  backingLimit: u64;
  stepLimit: u64;
  effectLimit: u64;
  handles: u64 = 0;
  backing: u64 = 0;
  records: u64 = 0;
  steps: u64 = 0; // Cumulative reservation, including consumed cleanup attempts.
  effects: u64 = 0; // Reserved envelope; NOT the driver's effect ticket counter.
  cleanupRemaining: u64 = 0;
  exitRemaining: u64 = 0;
  primary: u32 = 0;
  closed: bool = false;
  exitHeld: bool = false;
  pending: bool = false;
  stageCount: i32 = 0;
  committedCount: i32 = 0;
  stageCleanup: u64 = 0;
  stageExit: u64 = 0;
  stageEffects: u64 = 0;
  stageWithExit: bool = false;

  constructor(execution: u64, capacity: i32, handles: u64, backing: u64,
    steps: u64, effects: u64, deadline: u64, storageLimit: u32) {
    // Checked before any capacity-sized allocation. Actual allocator headers,
    // engine capacity and allocation failure remain separate physical limits.
    const valid = execution > 0 && execution <= PRL_SAFE && capacity > 0
      && storageLimit >= 1024 && storageLimit <= 2147483647
      && <u64>capacity <= (<u64>storageLimit - 1024) / 128
      && handles <= PRL_SAFE && backing <= PRL_SAFE && steps <= PRL_SAFE
      && effects <= PRL_SAFE && deadline > 0 && deadline <= PRL_SAFE;
    this.execution = execution;
    this.capacity = valid ? capacity : 0;
    this.handleLimit = handles; this.backingLimit = backing;
    this.stepLimit = steps; this.effectLimit = effects; this.deadline = deadline;
    const words = valid ? capacity * 8 : 0;
    this.bank = new StaticArray<u64>(words);
    this.stage = new StaticArray<u64>(words);
    if (!valid) { this.primary = 1; this.closed = true; }
  }

  private auth(execution: u64): bool { return this.capacity > 0 && execution == this.execution; }
  private reject(code: u32): bool {
    if (this.primary == 0) this.primary = code;
    this.pending = false; this.stageCount = 0;
    return false;
  }
  private clock(now: u64): bool {
    if (now > PRL_SAFE || now < this.lastNow) return this.reject(2);
    this.lastNow = now;
    return now < this.deadline || this.reject(3);
  }
  private active(execution: u64, now: u64): bool {
    return this.auth(execution) && !this.closed && this.primary == 0 && this.clock(now);
  }
  private match(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32): bool {
    if (!this.auth(execution) || slot < 0 || slot >= this.capacity || generation == 0 || generation > PRL_GENERATION_MAX) return false;
    const at = slot * 8;
    const state = unchecked(this.bank[at + 5]);
    return state != PRL_FREE && state != PRL_EXHAUSTED
      && unchecked(this.bank[at + 1]) == namespace
      && unchecked(this.bank[at + 2]) == generation
      && unchecked(this.bank[at + 3]) == owner;
  }
  private release(slot: i32): void {
    const at = slot * 8;
    if (unchecked(this.bank[at]) == PRL_HANDLE) this.handles--;
    this.records--;
    unchecked(this.bank[at + 5] = unchecked(this.bank[at + 2]) == PRL_GENERATION_MAX ? PRL_EXHAUSTED : PRL_FREE);
    unchecked(this.bank[at + 6] = 0);
  }

  // No reservation token is issued by the data-only planner. This transaction
  // validates current capacity and commits all descriptors without host calls,
  // callbacks, allocation or an externally visible intermediate reservation.
  begin(execution: u64, now: u64, cleanup: u64, exit: u64, effects: u64, withExit: bool): bool {
    if (!this.active(execution, now)) return false;
    if (this.pending || withExit == this.exitHeld || (!withExit && exit != 0)
      || cleanup > PRL_SAFE || exit > PRL_SAFE || effects > PRL_SAFE) return this.reject(1);
    if (cleanup > this.stepLimit - this.steps || exit > this.stepLimit - this.steps - cleanup) return this.reject(7);
    if (effects > this.effectLimit - this.effects) return this.reject(8);
    this.pending = true; this.stageCount = 0; this.committedCount = 0; this.stageCleanup = cleanup;
    this.stageExit = exit; this.stageEffects = effects; this.stageWithExit = withExit;
    return true;
  }
  stageRecord(execution: u64, kind: u32, namespace: u32, owner: u32, partition: u32, allowance: u64): bool {
    if (!this.auth(execution) || !this.pending) return false;
    if (kind < PRL_HANDLE || kind > PRL_METADATA || owner == 0
      || partition < PRL_WORK || partition > PRL_EXIT
      || (partition == PRL_EXIT && !this.stageWithExit)
      || (kind == PRL_HANDLE ? namespace == 0 : namespace != 0)
      || allowance > PRL_SAFE || (kind != PRL_ALLOCATION && allowance != 0)) return this.reject(1);
    if (this.stageCount == this.capacity) return this.reject(6);
    const at = this.stageCount++ * 8;
    unchecked(this.stage[at] = kind); unchecked(this.stage[at + 1] = namespace);
    unchecked(this.stage[at + 3] = owner); unchecked(this.stage[at + 4] = partition);
    unchecked(this.stage[at + 6] = allowance);
    return true;
  }
  abort(execution: u64): bool {
    if (!this.auth(execution) || !this.pending) return false;
    this.pending = false; this.stageCount = 0; return true;
  }
  commit(execution: u64, now: u64): bool {
    if (!this.pending || !this.active(execution, now)) return false;
    let handles: u64 = 0, backing: u64 = 0;
    for (let i = 0; i < this.stageCount; i++) {
      const at = i * 8, kind = unchecked(this.stage[at]);
      if (kind == PRL_HANDLE) handles++;
      if (kind == PRL_ALLOCATION) {
        const bytes = unchecked(this.stage[at + 6]);
        if (bytes > this.backingLimit - this.backing - backing) return this.reject(5);
        backing += bytes;
      }
    }
    if (handles > this.handleLimit - this.handles) return this.reject(4);
    let free: i32 = 0, exhausted: i32 = 0;
    for (let i = 0; i < this.capacity; i++) {
      const at = i * 8, state = unchecked(this.bank[at + 5]);
      if (state == PRL_FREE && unchecked(this.bank[at + 2]) < PRL_GENERATION_MAX) free++;
      else if (state == PRL_EXHAUSTED) exhausted++;
    }
    if (free < this.stageCount) return this.reject(free + exhausted >= this.stageCount ? 9 : 6);
    // All failure checks are complete. There is no fallible work in this loop.
    let next: i32 = 0;
    for (let i = 0; i < this.capacity && next < this.stageCount; i++) {
      const at = i * 8;
      if (unchecked(this.bank[at + 5]) != PRL_FREE || unchecked(this.bank[at + 2]) == PRL_GENERATION_MAX) continue;
      const generation = unchecked(this.bank[at + 2]) + 1, source = next++ * 8;
      for (let field = 0; field < 8; field++) unchecked(this.bank[at + field] = unchecked(this.stage[source + field]));
      unchecked(this.bank[at + 2] = generation); unchecked(this.bank[at + 5] = PRL_RESERVED);
      unchecked(this.bank[at + 7] = 0);
      unchecked(this.stage[source + 2] = i); unchecked(this.stage[source + 5] = generation);
    }
    this.handles += handles; this.backing += backing; this.records += this.stageCount;
    this.steps += this.stageCleanup + this.stageExit; this.effects += this.stageEffects;
    this.cleanupRemaining += this.stageCleanup; this.exitRemaining += this.stageExit;
    this.exitHeld = true; this.pending = false; this.committedCount = this.stageCount; this.stageCount = 0;
    return true;
  }
  // Borrowed result view, invalidated by the next begin. The driver copies each
  // execution/namespace/slot/generation/owner identity into its bounded state.
  reservedSlot(index: i32): i32 {
    return index >= 0 && index < this.committedCount ? <i32>unchecked(this.stage[index * 8 + 2]) : -1;
  }
  reservedGeneration(index: i32): u64 {
    return index >= 0 && index < this.committedCount ? unchecked(this.stage[index * 8 + 5]) : 0;
  }

  // Fence BEFORE the ABI call. A trap or missing outcome leaves ACQUIRING and
  // retains the reservation. A known result may still be recorded after close
  // or deadline expiry; recording it does not reopen business delivery.
  beginAcquire(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32, cleanup: bool, now: u64): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at]) != PRL_HANDLE || unchecked(this.bank[at + 5]) != PRL_RESERVED
      || (unchecked(this.bank[at + 4]) != PRL_WORK) != cleanup) return false;
    if ((!cleanup && (this.closed || this.primary != 0)) || !this.clock(now)) return false;
    unchecked(this.bank[at + 5] = PRL_ACQUIRING); return true;
  }
  acquired(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32, handle: u32): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at + 5]) != PRL_ACQUIRING) return false;
    unchecked(this.bank[at + 6] = handle); unchecked(this.bank[at + 5] = PRL_LIVE); return true;
  }
  noAcquisition(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32, known: bool): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at + 5]) != PRL_ACQUIRING) return false;
    if (known) this.release(slot); else { unchecked(this.bank[at + 5] = PRL_UNKNOWN); this.reject(10); }
    return true;
  }
  beginDispose(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32, now: u64): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at]) != PRL_HANDLE || unchecked(this.bank[at + 5]) != PRL_LIVE || !this.clock(now)) return false;
    const exit = unchecked(this.bank[at + 4]) == PRL_EXIT;
    if (exit ? this.exitRemaining == 0 : this.cleanupRemaining == 0) return this.reject(7);
    if (exit) this.exitRemaining--; else this.cleanupRemaining--;
    unchecked(this.bank[at + 5] = PRL_DISPOSING); return true;
  }
  disposed(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32, knownConsumed: bool): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at + 5]) != PRL_DISPOSING) return false;
    if (knownConsumed) this.release(slot); else { unchecked(this.bank[at + 5] = PRL_UNKNOWN); this.reject(10); }
    return true;
  }
  transferred(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32): bool {
    if (!this.match(execution, slot, generation, namespace, owner) || unchecked(this.bank[slot * 8 + 5]) != PRL_LIVE) return false;
    this.release(slot); return true;
  }
  unused(execution: u64, slot: i32, generation: u64, namespace: u32, owner: u32): bool {
    if (!this.match(execution, slot, generation, namespace, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at]) != PRL_HANDLE || unchecked(this.bank[at + 5]) != PRL_RESERVED
      || (unchecked(this.bank[at + 4]) != PRL_WORK && !this.closed)) return false;
    this.release(slot); return true;
  }
  consume(execution: u64, slot: i32, generation: u64, owner: u32, bytes: u64, cleanup: bool, now: u64): bool {
    if (!this.match(execution, slot, generation, 0, owner)) return false;
    const at = slot * 8;
    if (unchecked(this.bank[at]) != PRL_ALLOCATION || (unchecked(this.bank[at + 4]) != PRL_WORK) != cleanup) return false;
    if ((!cleanup && (this.closed || this.primary != 0)) || !this.clock(now)) return false;
    if (bytes > unchecked(this.bank[at + 6]) - unchecked(this.bank[at + 7])) return this.reject(5);
    unchecked(this.bank[at + 7] = unchecked(this.bank[at + 7]) + bytes); return true;
  }
  fail(execution: u64, code: u32): bool {
    if (!this.auth(execution) || code == 0) return false;
    this.reject(code); return true;
  }
  close(execution: u64): bool {
    if (!this.auth(execution)) return false;
    this.closed = true; this.pending = false; this.stageCount = 0; return true;
  }
}
