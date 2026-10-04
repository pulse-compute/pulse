'use strict';

// First-party host integration only. S3 owns protocol composition; callers
// supply resolved credentials and an explicitly selected SHA/HMAC realization.
const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);
const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const encodeRfc3986 = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function encodeS3Key(key) {
  // Encoding only: portable key admission and legacy Assets path policy remain
  // separate. In particular, this preserves empty and repeated segments.
  return key.split('/').map(encodeRfc3986).join('/');
}

function canonicalQuery(url) {
  const pairs = [];
  url.searchParams.forEach((value, key) => pairs.push([encodeRfc3986(key), encodeRfc3986(value)]));
  pairs.sort(([ak, av], [bk, bv]) => ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1);
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

async function createAuthorization(input, crypto) {
  const { method, uri, query, headers, date, region, service, accessId, secret, payloadHash } = input;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(name => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [method, uri, query, canonicalHeaders, names.join(';'), payloadHash].join('\n');
  const stamp = date.slice(0, 8);
  const scope = `${stamp}/${region}/${service}/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hex(await crypto.sha256(bytes(canonical)))}`;
  let key = bytes(`AWS4${secret}`);
  try {
    for (const part of [stamp, region, service, 'aws4_request']) {
      const next = await crypto.hmacSha256(key, bytes(part)); key.fill(0); key = next;
    }
    const signature = await crypto.hmacSha256(key, bytes(toSign));
    try { return `AWS4-HMAC-SHA256 Credential=${accessId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${hex(signature)}`; }
    finally { signature.fill(0); }
  } finally { key.fill(0); }
}

async function signHttpRequest(input, crypto) {
  const url = new URL(input.url.toString());
  const method = input.method.toUpperCase();
  const date = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = input.payloadHash ?? 'UNSIGNED-PAYLOAD';
  const headers = new Headers(input.headers);
  headers.set('x-amz-date', date);
  headers.set('x-amz-content-sha256', payloadHash);
  if (input.token) headers.set('x-amz-security-token', input.token);
  const signingHeaders = Object.create(null);
  headers.forEach((value, name) => { if (name !== 'authorization') signingHeaders[name] = value; });
  signingHeaders.host = url.host;
  headers.set('authorization', await createAuthorization({ method, uri: url.pathname || '/', query: canonicalQuery(url),
    headers: signingHeaders, date, region: input.region ?? 'us-east-1', service: input.service ?? 's3',
    accessId: input.accessId, secret: input.secret, payloadHash }, crypto));
  return new Request(url, { method, headers });
}

exports.encodeS3Key = encodeS3Key;
exports.createAuthorization = createAuthorization;
exports.signHttpRequest = signHttpRequest;
Object.freeze(module.exports);
