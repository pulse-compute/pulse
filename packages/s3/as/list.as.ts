// S3-owned bounded ListObjectsV2 protocol. Providers supply transport only.
class __PulseS3ListOptions { prefix: string = ''; continuationToken: string = ''; maxKeys: i32 = 100 }
class __PulseS3ListEntry { key: string = ''; byteLength: f64 = 0; etag: string | null = null }
class __PulseS3ListPage { entries: Array<__PulseS3ListEntry> = []; isTruncated: bool = false; nextContinuationToken: string | null = null }
function __pulse_s3_query_encode(text: string): string {
  const data = __pulse_s3_bytes(text), alphabet = '0123456789ABCDEF'; let out = '';
  for (let i = 0; i < data.length; i++) { const b = data[i];
    if (b >= 65 && b <= 90 || b >= 97 && b <= 122 || b >= 48 && b <= 57 || b == 45 || b == 46 || b == 95 || b == 126) out += String.fromCharCode(b);
    else out += '%' + alphabet.charAt(b >> 4) + alphabet.charAt(b & 15);
  }
  return out;
}
function __pulse_s3_list_scalar(text: string, max: i32): bool { return text.length <= max && __pulse_s3_scalar(text, true) && __pulse_s3_bytes(text).length <= max }
function __pulse_s3_list_query(options: __PulseS3ListOptions): string {
  return (options.continuationToken.length ? 'continuation-token=' + __pulse_s3_query_encode(options.continuationToken) + '&' : '')
    + 'encoding-type=url&list-type=2&max-keys=' + options.maxKeys.toString() + '&prefix=' + __pulse_s3_query_encode(options.prefix);
}
function __pulse_s3_hex_digit(c: i32): i32 { return c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1 }
function __pulse_s3_url_decode(text: string): string | null {
  const input = __pulse_s3_bytes(text), data = new Uint8Array(input.length); let n = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] != 37) { data[n++] = input[i]; continue; }
    if (i + 2 >= input.length) return null;
    const a = __pulse_s3_hex_digit(input[++i]), b = __pulse_s3_hex_digit(input[++i]);
    if (a < 0 || b < 0) return null; data[n++] = u8(a * 16 + b);
  }
  const bytes = data.subarray(0, n);
  return __pulse_s3_utf8_valid(bytes) ? String.UTF8.decodeUnsafe(bytes.dataStart, bytes.length, false) : null;
}
function __pulse_s3_xml_char(c: i32): bool { return c == 9 || c == 10 || c == 13 || c >= 32 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) && c != 0xfffe && c != 0xffff }
function __pulse_s3_xml_text(text: string): string | null {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c != '&') { out += c; continue; }
    const end = text.indexOf(';', i + 1); if (end < 0 || end - i > 12) return null;
    const entity = text.slice(i + 1, end);
    if (entity == 'amp') out += '&'; else if (entity == 'lt') out += '<'; else if (entity == 'gt') out += '>'; else if (entity == 'quot') out += '"'; else if (entity == 'apos') out += "'";
    else {
      if (entity.charAt(0) != '#') return null;
      const hex = entity.charAt(1) == 'x', start = hex ? 2 : 1; let code = 0;
      if (entity.length <= start) return null;
      for (let j = start; j < entity.length; j++) {
        const digit = hex ? __pulse_s3_hex_digit(entity.charCodeAt(j)) : entity.charCodeAt(j) - 48;
        if (digit < 0 || digit >= (hex ? 16 : 10)) return null; code = code * (hex ? 16 : 10) + digit;
        if (code > 0x10ffff) return null;
      }
      if (!__pulse_s3_xml_char(code)) return null;
      if (code < 0x10000) out += String.fromCharCode(code);
      else { code -= 0x10000; out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023)); }
    }
    i = end;
  }
  return out;
}
class __PulseS3XmlNode {
  name: string; text: string = ''; children: Array<__PulseS3XmlNode> = []; valid: bool = true;
  constructor(name: string) { this.name = name }
  field(name: string, required: bool = true): string | null {
    let result: string | null = null;
    for (let i = 0; i < this.children.length; i++) if (this.children[i].name == name) {
      if (result !== null || this.children[i].children.length) { this.valid = false; return null; }
      result = this.children[i].text;
    }
    if (required && result === null) this.valid = false;
    return result;
  }
}
function __pulse_s3_xml_name(text: string): bool {
  if (!text.length) return false;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (!(c >= 65 && c <= 90 || c >= 97 && c <= 122 || i > 0 && c >= 48 && c <= 57)) return false; }
  return true;
}
function __pulse_s3_xml_declaration(text: string): bool {
  // XML declaration attributes are fixed and quoted; no entity expansion.
  let i = 5, version = false, encoding = false, standalone = false;
  while (i < text.length - 2) {
    if (text.charAt(i).trim().length) return false;
    while (i < text.length - 2 && !text.charAt(i).trim().length) i++;
    if (i == text.length - 2) break;
    const eq = text.indexOf('=', i); if (eq < 0) return false;
    const name = text.slice(i, eq), quote = text.charAt(eq + 1); if (quote != '"' && quote != "'") return false;
    const end = text.indexOf(quote, eq + 2); if (end < 0) return false; const value = text.slice(eq + 2, end);
    if (name == 'version' && !version && !encoding && !standalone && value == '1.0') version = true;
    else if (name == 'encoding' && version && !encoding && !standalone && value.toUpperCase() == 'UTF-8') encoding = true;
    else if (name == 'standalone' && version && !standalone && (value == 'yes' || value == 'no')) standalone = true;
    else return false;
    i = end + 1;
  }
  return version && i == text.length - 2;
}
function __pulse_s3_xml_tree(input: string): __PulseS3XmlNode | null {
  if (!__pulse_s3_scalar(input) || __pulse_s3_bytes(input).length > 2097152) return null;
  for (let n = 0; n < input.length; n++) { const c = input.charCodeAt(n); if (c < 32 && c != 9 && c != 10 && c != 13 || c == 0xfffe || c == 0xffff) return null; }
  const text = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  let i = text.charCodeAt(0) == 0xfeff ? 1 : 0;
  if (text.slice(i, i + 5) == '<?xml') {
    const end = text.indexOf('?>', i); if (end < 0 || !__pulse_s3_xml_declaration(text.slice(i, end + 2))) return null; i = end + 2;
  }
  const stack = new Array<__PulseS3XmlNode>(); let root: __PulseS3XmlNode | null = null, count = 0;
  while (i < text.length) {
    if (text.charAt(i) != '<') {
      const next = text.indexOf('<', i), end = next < 0 ? text.length : next, raw = text.slice(i, end);
      if (raw.indexOf(']]>') >= 0) return null;
      const value = __pulse_s3_xml_text(raw); if (value === null) return null;
      if (stack.length) stack[stack.length - 1].text += value; else if (value.trim().length) return null;
      i = end; continue;
    }
    if (text.slice(i, i + 4) == '<!--') {
      const end = text.indexOf('-->', i + 4); if (end < 0 || (text.slice(i + 4, end).indexOf('--') >= 0 || text.slice(i + 4, end).endsWith('-'))) return null; i = end + 3; continue;
    }
    const end = text.indexOf('>', i + 1); if (end < 0) return null;
    let tag = text.slice(i + 1, end); i = end + 1;
    if (tag.charAt(0) == '/') { const name = tag.slice(1).trimEnd(); if (!__pulse_s3_xml_name(name) || !stack.length || stack.pop().name != name) return null; continue; }
    const closed = tag.endsWith('/'); if (closed) tag = tag.slice(0, -1); tag = tag.trimEnd();
    let split = 0; while (split < tag.length && tag.charAt(split).trim().length) split++;
    const name = tag.slice(0, split), attr = tag.slice(split).trim();
    if (!__pulse_s3_xml_name(name) || attr.length && (stack.length > 0 || attr != 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"' && attr != "xmlns='http://s3.amazonaws.com/doc/2006-03-01/'") || ++count > 16016 || stack.length >= 8) return null;
    const node = new __PulseS3XmlNode(name);
    if (stack.length) stack[stack.length - 1].children.push(node); else { if (root !== null) return null; root = node; }
    if (!closed) stack.push(node);
  }
  if (stack.length || root === null || root.name != 'ListBucketResult' || root.text.trim().length) return null;
  return root;
}
function __pulse_s3_parse_list(text: string, options: __PulseS3ListOptions, bucket: string): __PulseS3ListPage | null {
  const root = __pulse_s3_xml_tree(text); if (root === null) return null;
  const name = root.field('Name'), encoding = root.field('EncodingType'), prefix = root.field('Prefix'), max = root.field('MaxKeys');
  if (name !== bucket || encoding !== 'url' || prefix === null || __pulse_s3_url_decode(prefix) !== options.prefix || max === null || __pulse_s3_decimal(max) != f64(options.maxKeys)) return null;
  const trunc = root.field('IsTruncated'), token = root.field('NextContinuationToken', false), count = root.field('KeyCount');
  if (trunc != 'true' && trunc != 'false' || trunc == 'true' && (token === null || !token.length || !__pulse_s3_list_scalar(token, 4096) || token == options.continuationToken) || trunc == 'false' && token !== null) return null;
  const page = new __PulseS3ListPage(), seen = new Set<string>(); page.isTruncated = trunc == 'true'; page.nextContinuationToken = token;
  for (let i = 0; i < root.children.length; i++) {
    const node = root.children[i]; if (node.name == 'CommonPrefixes') return null; if (node.name != 'Contents') continue;
    if (node.text.trim().length) return null;
    const keyText = node.field('Key'), size = node.field('Size'), etag = node.field('ETag', false);
    if (!node.valid || keyText === null || size === null) return null;
    const key = __pulse_s3_url_decode(keyText), length = __pulse_s3_decimal(size);
    if (key === null || !key.length || !__pulse_s3_list_scalar(key, 1024) || !key.startsWith(options.prefix) || length < 0 || seen.has(key) || etag !== null && (!etag.length || !__pulse_s3_list_scalar(etag, 1024))) return null;
    const entry = new __PulseS3ListEntry(); entry.key = key; entry.byteLength = length; entry.etag = etag;
    page.entries.push(entry); seen.add(key); if (page.entries.length > options.maxKeys) return null;
  }
  return root.valid && count !== null && __pulse_s3_decimal(count) == f64(page.entries.length) ? page : null;
}
