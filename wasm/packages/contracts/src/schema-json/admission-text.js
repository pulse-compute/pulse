'use strict';

const { JsonAdmissionBudget } = require('./admission.js');

class JsonAdmissionFrame {
  kind/*: i32 */ = 0; // 0 array; 1 object
  state/*: i32 */ = 0;
  count/*: i32 */ = 0;
  start/*: i32 */ = 0;
  names/*: Map<string, i32> */ = new Map();
}

// Iterative syntax and resource admission; never constructs JSON containers.
// Root containers have depth 1, root scalars depth 0. Nodes include every
// syntactic value, even overwritten/unknown values. Keys are not value nodes.
// duplicateMode: 0 allow, 1 reject, 2 report offsets for schema-owned policy.
class JsonTextAdmission extends JsonAdmissionBudget {
  text/*: string */;
  duplicateMode/*: i32 */;
  offset/*: i32 */ = 0;
  textBytes/*: i32 */ = 0;
  frames/*: Array<JsonAdmissionFrame> */ = [];
  duplicateObjects/*: Array<i32> */ = [];
  duplicateKeys/*: Array<i32> */ = [];
  duplicateFirstKeys/*: Array<i32> */ = [];
  constructor(text/*: string */, limits/*: JsonAdmissionLimits */, duplicateMode/*: i32 */) {
    super(limits);
    this.text = text;
    this.duplicateMode = duplicateMode;
  }
  space()/*: void */ {
    while (this.offset < this.text.length) {
      const c = this.text.charCodeAt(this.offset);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      this.offset++;
    }
  }
  rawBytes()/*: bool */ {
    // UTF-8 byte count matches replacement encoding for raw lone surrogates.
    // This prepass stops before any syntax-frame or decoded-key allocation.
    if (this.text.length > this.limits.maxTextBytes) return this.fail(2);
    for (let i = 0; i < this.text.length; i++) {
      const c = this.text.charCodeAt(i);
      let n = c < 128 ? 1 : c < 2048 ? 2 : 3;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < this.text.length) {
        const next = this.text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { n = 4; i++; }
      }
      if (n > this.limits.maxTextBytes - this.textBytes) return this.fail(2);
      this.textBytes += n;
    }
    return true;
  }
  string(key/*: bool */)/*: string */ {
    const capture = key && this.duplicateMode !== 0;
    const parts/*: Array<string> */ = [];
    let length = 0;
    let high = false;
    this.offset++; // opening quote
    if (!this.addBytes(2)) return '';
    while (this.offset < this.text.length && this.failure === 0) {
      let c = this.text.charCodeAt(this.offset++);
      if (c === 34) {
        if (high) this.addBytes(6);
        return capture ? parts.join('') : '';
      }
      if (c < 32) { this.fail(1); return ''; }
      if (c === 92) {
        if (this.offset >= this.text.length) { this.fail(1); return ''; }
        c = this.text.charCodeAt(this.offset++);
        if (c === 117) {
          let unit = 0;
          for (let n = 0; n < 4; n++) {
            if (this.offset >= this.text.length) { this.fail(1); return ''; }
            const h = this.text.charCodeAt(this.offset++);
            const digit = h >= 48 && h <= 57 ? h - 48 : h >= 65 && h <= 70 ? h - 55 : h >= 97 && h <= 102 ? h - 87 : -1;
            if (digit < 0) { this.fail(1); return ''; }
            unit = unit * 16 + digit;
          }
          c = unit;
        } else if (c === 98) c = 8;
        else if (c === 102) c = 12;
        else if (c === 110) c = 10;
        else if (c === 114) c = 13;
        else if (c === 116) c = 9;
        else if (c !== 34 && c !== 92 && c !== 47) { this.fail(1); return ''; }
      }
      const limit = key ? this.limits.maxKeyLength : this.limits.maxStringLength;
      if (length >= limit) { this.fail(key ? 7 : 8); return ''; }
      length++;
      if (capture) parts.push(String.fromCharCode(c));
      if (high) {
        high = false;
        if (c >= 0xdc00 && c <= 0xdfff) { this.addBytes(4); continue; }
        if (!this.addBytes(6)) return '';
      }
      if (c >= 0xd800 && c <= 0xdbff) high = true;
      else this.addBytes(c < 32 ? 6 : c === 34 || c === 92 ? 2 : c < 128 ? 1 : c < 2048 ? 2 : c >= 0xdc00 && c <= 0xdfff ? 6 : 3);
    }
    this.fail(1);
    return '';
  }
  digit()/*: bool */ {
    if (this.offset >= this.text.length) return false;
    const c = this.text.charCodeAt(this.offset);
    return c >= 48 && c <= 57;
  }
  number()/*: bool */ {
    const start = this.offset;
    if (this.text.charCodeAt(this.offset) === 45) this.offset++;
    if (!this.digit()) return this.fail(1);
    if (this.text.charCodeAt(this.offset) === 48) this.offset++;
    else while (this.digit()) this.offset++;
    if (this.offset < this.text.length && this.text.charCodeAt(this.offset) === 46) {
      this.offset++;
      if (!this.digit()) return this.fail(1);
      while (this.digit()) this.offset++;
    }
    if (this.offset < this.text.length) {
      const c = this.text.charCodeAt(this.offset);
      if (c === 69 || c === 101) {
        this.offset++;
        if (this.offset < this.text.length && (this.text.charCodeAt(this.offset) === 43 || this.text.charCodeAt(this.offset) === 45)) this.offset++;
        if (!this.digit()) return this.fail(1);
        while (this.digit()) this.offset++;
      }
    }
    if (!isFinite(parseFloat(this.text.substring(start, this.offset)))) return this.fail(11);
    return this.addBytes(24); // finite-f64 conservative spelling budget
  }
  value()/*: bool */ {
    this.space();
    if (this.offset >= this.text.length) return this.fail(1);
    const c = this.text.charCodeAt(this.offset);
    const container = c === 91 || c === 123;
    if (!this.node(container ? this.frames.length + 1 : this.frames.length)) return false;
    if (container) {
      if (!this.addBytes(1)) return false;
      const frame = new JsonAdmissionFrame();
      frame.kind = c === 123 ? 1 : 0;
      frame.start = this.offset++;
      this.frames.push(frame);
      return true;
    }
    if (c === 34) { this.string(false); return this.failure === 0; }
    let literal = '';
    if (c === 116) literal = 'true';
    else if (c === 102) literal = 'false';
    else if (c === 110) literal = 'null';
    if (literal.length > 0) {
      if (this.text.substring(this.offset, this.offset + literal.length) !== literal) return this.fail(1);
      this.offset += literal.length;
      return this.addBytes(literal.length);
    }
    return this.number();
  }
  scan()/*: bool */ {
    if (this.duplicateMode < 0 || this.duplicateMode > 2) return this.fail(12);
    if (!this.rawBytes() || !this.value()) return false;
    while (this.frames.length > 0 && this.failure === 0) {
      this.space();
      if (this.offset >= this.text.length) return this.fail(1);
      const frame = this.frames[this.frames.length - 1];
      const c = this.text.charCodeAt(this.offset);
      const end = frame.kind === 0 ? 93 : 125;
      const after = frame.kind === 0 ? 1 : 3;
      if ((frame.state === 0 || frame.state === after) && c === end) {
        this.offset++;
        if (!this.addBytes(1)) return false;
        this.frames.pop();
      } else if (frame.state === after) {
        if (c !== 44) return this.fail(1);
        this.offset++;
        if (!this.addBytes(1)) return false;
        frame.state = frame.kind === 0 ? 2 : 4;
      } else if (frame.kind === 0) {
        if (frame.count >= this.limits.maxArrayItems) return this.fail(6);
        frame.count++;
        frame.state = 1;
        if (!this.value()) return false;
      } else if (frame.state === 0 || frame.state === 4) {
        if (c !== 34) return this.fail(1);
        if (frame.count >= this.limits.maxObjectMembers) return this.fail(5);
        frame.count++;
        const start = this.offset;
        const name = this.string(true);
        if (this.failure !== 0) return false;
        if (this.duplicateMode !== 0) {
          if (frame.names.has(name)) {
            if (this.duplicateMode === 1) return this.fail(10);
            this.duplicateObjects.push(frame.start);
            this.duplicateKeys.push(start);
            this.duplicateFirstKeys.push(frame.names.get(name)/* nonnull */);
          } else frame.names.set(name, start);
        }
        frame.state = 1;
      } else if (frame.state === 1) {
        if (c !== 58) return this.fail(1);
        this.offset++;
        if (!this.addBytes(1)) return false;
        frame.state = 2;
      } else {
        frame.state = 3;
        if (!this.value()) return false;
      }
    }
    this.space();
    return this.failure === 0 && (this.offset === this.text.length || this.fail(1));
  }
}

module.exports = { JsonAdmissionFrame, JsonTextAdmission };
