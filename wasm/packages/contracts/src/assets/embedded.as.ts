// Native counterpart of embeddedAssetResponse; inputs are admitted by the Assets lowerer.
class __PulseEmbeddedSelection {
  status: i32 = 200; start: i32 = 0; end: i32 = -1; contentRange: string = '';
}
function __pulse_embedded_decimal(value: string): f64 {
  if (!value.length || (value.length > 1 && value.charCodeAt(0) == 48)) return -1;
  let output: f64 = 0;
  for (let i = 0; i < value.length; i++) {
    const digit = value.charCodeAt(i) - 48; if (digit < 0 || digit > 9) return -1;
    output = output * 10 + digit; if (output > 9007199254740991) return -1;
  }
  return output;
}
function __pulse_embedded_selection(length: i32, method: string, etag: string, validator: string | null, range: string | null, ifRange: string | null): __PulseEmbeddedSelection {
  const output = new __PulseEmbeddedSelection(); output.end = length - 1;
  if (length < 0) { output.status = 404; return output; }
  if (validator !== null) {
    let tag = validator;
    if (tag.startsWith('W/')) tag = tag.slice(2);
    if (validator != '*') {
      if (tag.length < 2 || tag.charAt(0) != '"' || tag.charAt(tag.length - 1) != '"') { output.status = 400; return output; }
      for (let i = 1; i < tag.length - 1; i++) if (tag.charCodeAt(i) < 33 || tag.charCodeAt(i) > 126 || tag.charCodeAt(i) == 34) { output.status = 400; return output; }
    }
    if (validator == '*' || tag == etag) { output.status = 304; return output; }
  }
  if (method == 'GET' && range !== null && (ifRange === null || ifRange == etag)) {
    if (!range.startsWith('bytes=')) { output.status = 400; return output; }
    const parts = range.slice(6).split('-');
    if (parts.length != 2) { output.status = 400; return output; }
    const start = __pulse_embedded_decimal(parts[0]), end = __pulse_embedded_decimal(parts[1]);
    if (start < 0 || end < start) { output.status = 400; return output; }
    if (start >= length) { output.status = 416; output.contentRange = 'bytes */' + length.toString(); return output; }
    output.start = i32(start); output.end = i32(Math.min(end, f64(length - 1))); output.status = 206;
    output.contentRange = 'bytes ' + output.start.toString() + '-' + output.end.toString() + '/' + length.toString();
  }
  return output;
}
function __pulse_embedded_bytes(data: string, start: i32, end: i32): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output = new Uint8Array(max<i32>(0, end - start + 1));
  // Decode only the selected interval, without a full-file temporary copy.
  for (let index = start; index <= end; index++) {
    const group = (index / 3) * 4, part = index % 3;
    const a = alphabet.indexOf(data.charAt(group + part)), b = alphabet.indexOf(data.charAt(group + part + 1));
    output[index - start] = u8(part == 0 ? (a << 2) | (b >> 4) : part == 1 ? (a << 4) | (b >> 2) : (a << 6) | b);
  }
  return output;
}
