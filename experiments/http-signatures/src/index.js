/* RFC 9421 bounded HTTP Message Signature profile: experimental, JS-only.
 * No automatic host authority, key lookup, or implied body integrity.
 * Components and signature parameters are represented in RFC 8941 syntax.
 */
const MAX_FIELD_BYTES = 16 * 1024;
const MAX_BASE_BYTES = 64 * 1024;
const MAX_COMPONENTS = 32;
const MAX_SIGNATURES = 8;
const encoder = new TextEncoder();
const LABEL = /^[a-z*][a-z0-9_.*-]*$/;
const VCHAR = /^[\x20-\x7e]*$/;
const COMPONENT = /^(@[a-z-]+|[!#$%&'*+.^_`|~0-9a-z-]+)$/;
const DERIVED = new Set(['@method', '@authority', '@scheme', '@target-uri', '@path', '@query', '@request-target', '@status']);
const PARAM_KEYS = new Set(['created', 'expires', 'keyid', 'alg', 'nonce', 'tag']);
const requireText = (value, description, limit = MAX_FIELD_BYTES) => {
  if (typeof value !== 'string' || encoder.encode(value).length > limit || !VCHAR.test(value)) throw new TypeError('Invalid ' + description);
  return value;
};
const sfString = v => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function parseString(s, cursor) {
  if (s[cursor.i++] !== '"') throw new TypeError('Expected structured field string');
  let output = '';
  while (cursor.i < s.length) {
    const c = s[cursor.i++];
    if (c === '"') return output;
    if (c === '\\') {
      const next = s[cursor.i++];
      if (next !== '"' && next !== '\\') throw new TypeError('Bad string escape');
      output += next;
    } else {
      if (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126) throw new TypeError('Bad SF character');
      output += c;
    }
  }
  throw new TypeError('Unclosed structured field string');
}
function normalizeComponents(components) {
  if (!Array.isArray(components) || !components.length || components.length > MAX_COMPONENTS) throw new TypeError('Invalid components count');
  const seen = new Set();
  return components.map(component => {
    if (typeof component !== 'string' || !COMPONENT.test(component) || component !== component.toLowerCase()
      || component === '@signature-params' || (component.startsWith('@') && !DERIVED.has(component))) throw new TypeError('Unsupported component');
    if (seen.has(component)) throw new TypeError('Repeated component');
    seen.add(component);
    return component;
  });
}
function normalizeParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('Invalid signature parameters');
  const entries = Object.entries(params);
  if (!entries.length || entries.length > PARAM_KEYS.size) throw new TypeError('Missing signature parameters');
  for (const [key, value] of entries) {
    if (!PARAM_KEYS.has(key)) throw new TypeError('Unsupported signature parameter');
    if (key === 'created' || key === 'expires') {
      if (!Number.isSafeInteger(value) || value < 0 || value > 999999999999999) throw new TypeError('Invalid timestamp');
    } else if (typeof value !== 'string' || !VCHAR.test(value) || value.length > 512) {
      throw new TypeError('Invalid signature parameter string');
    }
  }
  return entries;
}
export function serializeSignatureParams(components, params) {
  const names = normalizeComponents(components);
  return '(' + names.map(sfString).join(' ') + ')' + normalizeParams(params).map(([k, v]) => ';' + k + '=' + (typeof v === 'number' ? v : sfString(v))).join('');
}
function parseInnerList(input) {
  requireText(input, 'Signature-Input');
  const cursor = {i: 0}, components = [], params = Object.create(null);
  if (input[cursor.i++] !== '(') throw new TypeError('Expected SF inner list');
  while (input[cursor.i] !== ')') {
    if (components.length >= MAX_COMPONENTS) throw new TypeError('Too many components');
    components.push(parseString(input, cursor));
    if (input[cursor.i] === ' ') {
      while (input[cursor.i] === ' ') cursor.i++;
      if (input[cursor.i] !== '"' && input[cursor.i] !== ')') throw new TypeError('Invalid inner list spacing');
    } else if (input[cursor.i] !== ')') throw new TypeError('Invalid inner list separator');
    if (cursor.i >= input.length) throw new TypeError('Unclosed SF list');
  }
  cursor.i++;
  while (cursor.i < input.length) {
    if (input[cursor.i++] !== ';') throw new TypeError('Invalid signature parameter delimiter');
    const rest = input.slice(cursor.i), match = rest.match(/^([a-z*][a-z0-9_.*-]*)=/);
    if (!match) throw new TypeError('Invalid SF parameter');
    const name = match[1]; cursor.i += match[0].length;
    if (Object.hasOwn(params, name)) throw new TypeError('Duplicate parameter');
    if (input[cursor.i] === '"') params[name] = parseString(input, cursor);
    else {
      const m = input.slice(cursor.i).match(/^(0|[1-9][0-9]{0,14})(?=;|$)/);
      if (!m) throw new TypeError('Unsupported SF parameter type');
      params[name] = Number(m[1]); cursor.i += m[1].length;
    }
  }
  normalizeComponents(components); normalizeParams(params);
  return { components, params };
}
// This profile deliberately rejects SF field-component parameters (;sf, ;key,
// ;bs, ;req, ;tr) rather than treating them as ordinary field values.
function selectHeader(headers, name) {
  let values = [];
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') throw new TypeError('Invalid header tuple');
      if (entry[0].toLowerCase() === name) values.push(entry[1]);
    }
  } else if (headers && typeof headers.get === 'function') {
    const value = headers.get(name); if (value !== null && value !== undefined) values = [value];
  } else if (headers && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) values.push(v);
  }
  if (!values.length || values.length > 16 || (name === 'set-cookie' && values.length > 1)) throw new TypeError('Missing or ambiguous field: ' + name);
  return values.map(v => requireText(v, 'HTTP field').trim().replace(/\t/g, ' ')).join(', ');
}
function resolveComponent(message, name) {
  if (!message || typeof message !== 'object') throw new TypeError('Missing HTTP message');
  if (!name.startsWith('@')) return selectHeader(message.headers, name);
  if (name === '@method') return requireText(message.method, 'HTTP method', 64);
  if (name === '@status') {
    if (message.method !== undefined) throw new TypeError('Status is not a request component');
    if (!Number.isSafeInteger(message.status) || message.status < 100 || message.status > 999) throw new TypeError('Missing HTTP status');
    return String(message.status);
  }
  if (message.status !== undefined) throw new TypeError('Request derived component on a response');
  if (typeof message.url !== 'string') throw new TypeError('Missing authoritative request URL');
  // URI source MUST be the actual target URI provided by the trusted HTTP host.
  // URL parsers may normalize paths; callers must provide the exact URI if it matters.
  const url = new URL(message.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.hash || url.username || url.password) throw new TypeError('Unsafe target URI');
  switch (name) {
    case '@target-uri': return requireText(message.url, 'target URI');
    case '@scheme': return url.protocol.slice(0, -1).toLowerCase();
    case '@authority': return url.host.toLowerCase();
    case '@path': return url.pathname || '/';
    case '@query': return url.search || '?';
    case '@request-target':
      if (['CONNECT','OPTIONS'].includes(message.method)) throw new TypeError('Request-target form ambiguous');
      return (url.pathname || '/') + url.search;
    default: throw new TypeError('Unsupported derived component');
  }
}
export function createSignatureBase(message, {components, params}) {
  const innerList = serializeSignatureParams(components, params);
  const base = normalizeComponents(components).map(name => sfString(name) + ': ' + resolveComponent(message, name))
    .concat('"@signature-params": ' + innerList).join('\n');
  if (encoder.encode(base).length > MAX_BASE_BYTES || !/^[\x20-\x7e\n]*$/.test(base)) throw new TypeError('Non-ASCII or overlarge signature base');
  return base;
}
function parseDictionary(source, kind) {
  const text = requireText(source, kind), parts = [];
  let start = 0, quoted = false, escape = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (quoted && c === '\\') { escape = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '(') depth++;
    if (!quoted && c === ')') depth--;
    if (depth < 0) throw new TypeError('Bad structured dictionary');
    if (c === ',' && !quoted && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (quoted || depth !== 0) throw new TypeError('Bad structured dictionary');
  parts.push(text.slice(start).trim());
  if (parts.length > MAX_SIGNATURES) throw new TypeError('Too many signatures');
  const output = new Map();
  for (const part of parts) {
    const m = part.match(/^([a-z*][a-z0-9_.*-]*)=(.+)$/);
    if (!m || !LABEL.test(m[1]) || output.has(m[1])) throw new TypeError('Invalid/duplicate signature label');
    output.set(m[1], m[2]);
  }
  return output;
}
function base64(bytes) {
  // Platform-neutral, does not retain keys or rely on Buffer.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i+1], c = bytes[i+2];
    out += alphabet[a>>2] + alphabet[((a&3)<<4)|((b??0)>>4)] + (b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>6)]) + (c===undefined?'=':alphabet[c&63]);
  }
  return out;
}
function unbase64(text) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new TypeError('Bad base64');
  const bytes = new Uint8Array(text.length / 4 * 3 - (text.endsWith('==')?2:text.endsWith('=')?1:0));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0, buffer = 0, at = 0;
  for (const ch of text.replace(/=/g,'')) { buffer = (buffer << 6) | alphabet.indexOf(ch); bits += 6; if(bits >= 8){bits -= 8; bytes[at++] = (buffer >>> bits)&255;} }
  return bytes;
}
const keyBytes = key => {
  if (!(key instanceof Uint8Array) || key.length < 16 || key.length > 4096) throw new TypeError('Invalid HMAC key');
  return key;
};
async function hmac(key, base, crypto) {
  if (!crypto?.subtle) throw new TypeError('Explicit Web Crypto backend required');
  const imported = await crypto.subtle.importKey('raw', keyBytes(key), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(base)));
}
/** A concrete JavaScript reference profile, not Pulse Native lowering. */
export async function signMessage(message, {label='sig1', components, params, key, crypto=globalThis.crypto}) {
  if (!LABEL.test(label)) throw new TypeError('Invalid label');
  if (params.alg !== undefined && params.alg !== 'hmac-sha256') throw new TypeError('Unsupported algorithm');
  if (typeof params.keyid !== 'string' || !params.keyid || !Number.isSafeInteger(params.created)) throw new TypeError('Signing requires keyid and created');
  const base = createSignatureBase(message, {components, params});
  const signature = await hmac(key, base, crypto);
  return Object.freeze({
    signatureInput: label + '=' + serializeSignatureParams(components,params),
    signature: label + '=:' + base64(signature) + ':',
  });
}
/** Verifier policy is an application contract, not supplied by the attacker. */
export async function verifyMessage(message, {signatureInput, signature, label, key, requiredComponents, requiredKeyId, nowSeconds, maxAgeSeconds, crypto=globalThis.crypto}) {
  try {
    if (!LABEL.test(label) || !Array.isArray(requiredComponents) || !requiredComponents.length ||
      !Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) return false;
    const inputs = parseDictionary(signatureInput, 'Signature-Input'), values = parseDictionary(signature, 'Signature');
    if (!inputs.has(label) || !values.has(label)) return false;
    const {components, params} = parseInnerList(inputs.get(label));
    const canonical = serializeSignatureParams(components, params);
    if (inputs.get(label) !== canonical) return false; // narrowed profile; no SF formatting ambiguities
    if (params.alg !== undefined && params.alg !== 'hmac-sha256') return false;
    if (typeof params.keyid !== 'string' || params.keyid !== requiredKeyId || !Number.isSafeInteger(params.created)) return false;
    if (params.created > nowSeconds || nowSeconds - params.created > maxAgeSeconds || (params.expires !== undefined && (params.expires < params.created || nowSeconds > params.expires))) return false;
    normalizeComponents(requiredComponents);
    if (!requiredComponents.every(name => components.includes(name))) return false;
    const encoded = values.get(label), match = encoded.match(/^:([A-Za-z0-9+/]*={0,2}):$/);
    if (!match || match[1].length > 64) return false;
    const actual = unbase64(match[1]);
    if (actual.length !== 32) return false;
    if (!crypto?.subtle) return false;
    const imported = await crypto.subtle.importKey('raw', keyBytes(key), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', imported, actual, encoder.encode(createSignatureBase(message, {components, params})));
    actual.fill(0);
    return valid;
  } catch { return false; }
}
