'use strict';

// A conservative cumulative charge, deliberately never refunded. Counting a
// primitive again on a property read can overestimate retention. Object graphs
// are visited once; guest mutations are charged separately at the host imports.
// No charge releases an alias, pending payload, schema value, or returned root.
class NativeValueBudget {
  constructor(policy, onFailure = () => {}) {
    this.policy = policy;
    this.onFailure = onFailure;
    this.bytes = 0;
    this.values = 0;
    this.failure = undefined;
    this.objects = new WeakSet();
  }

  charge(values, bytes) {
    if (this.failure) throw this.failure;
    if (values > this.policy.maxValues - this.values || bytes > this.policy.maxBytes - this.bytes) {
      const error = new Error('Native read-loop execution exceeded its retained-value budget.');
      error.code = 'PULSE_RUNTIME_MEMORY_LIMIT_EXCEEDED';
      error.detail = Object.freeze({ bytes: this.bytes, values: this.values,
        maxBytes: this.policy.maxBytes, maxValues: this.policy.maxValues });
      this.failure = error;
      this.onFailure();
      throw error;
    }
    this.values += values;
    this.bytes += bytes;
  }

  retain(value) {
    const visit = input => {
      this.charge(1, this.policy.valueBytes);
      if (typeof input === 'string') this.charge(0, input.length * 2);
      else if (input && typeof input === 'object' && !this.objects.has(input)) {
        this.objects.add(input);
        // Charge sparse capacity before visiting elements. Avoid allocating an
        // intermediate array proportional to an untrusted container's length.
        if (Array.isArray(input)) this.charge(input.length, input.length * this.policy.edgeBytes);
        for (const key in input) if (Object.hasOwn(input, key)) {
          this.charge(1, this.policy.edgeBytes + key.length * 2);
          visit(input[key]);
        }
      }
    };
    visit(value);
  }

  write(target, key, value) {
    this.charge(1, this.policy.edgeBytes + String(key).length * 2);
    if (Array.isArray(target)) {
      const index = Number(key);
      const length = key === 'length' ? Number(value) :
        Number.isInteger(index) && index >= 0 && String(index) === String(key) ? index + 1 : target.length;
      if (length > target.length) this.charge(length - target.length, (length - target.length) * this.policy.edgeBytes);
    }
    this.retain(value);
  }

  snapshot() { return Object.freeze({ version: this.policy.version, bytes: this.bytes, values: this.values }); }
}

module.exports = { NativeValueBudget };
