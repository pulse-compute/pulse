// S3 owns exact-key encoding, SigV4 composition and strict byte interpretation.
// Crypto supplies the selected digest/MAC exports. Providers supply credentials,
// time and transport; none of those authorities are application imports.
function __pulse_s3_bytes(text: string): Uint8Array { return Uint8Array.wrap(String.UTF8.encode(text, false)) }
function __pulse_s3_scalar(text: string, controls: bool = false): bool {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (controls && (c < 32 || (c >= 127 && c <= 159))) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      if (++i >= text.length) return false;
      const low = text.charCodeAt(i);
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function __pulse_s3_key(key: string): string | null {
  if (!key.length || !__pulse_s3_scalar(key, true)) return null;
  const segments = key.split('/');
  for (let i = 0; i < segments.length; i++) if (segments[i] == '.' || segments[i] == '..') return null;
  const bytes = __pulse_s3_bytes(key);
  if (bytes.length > 1024) return null;
  const alphabet = '0123456789ABCDEF'; let output = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 45 || b == 46 || b == 95 || b == 126 || b == 47) output += String.fromCharCode(b);
    else output += '%' + alphabet.charAt(b >> 4) + alphabet.charAt(b & 15);
  }
  return output;
}
function __pulse_s3_utf8_valid(bytes: Uint8Array): bool {
  for (let i = 0; i < bytes.length;) {
    const lead = bytes[i++]; if (lead < 128) continue;
    let count = 0, minimum = 128, maximum = 191;
    if (lead >= 194 && lead <= 223) count = 1;
    else if (lead >= 224 && lead <= 239) { count = 2; if (lead == 224) minimum = 160; if (lead == 237) maximum = 159; }
    else if (lead >= 240 && lead <= 244) { count = 3; if (lead == 240) minimum = 144; if (lead == 244) maximum = 143; }
    else return false;
    if (i + count > bytes.length || i32(bytes[i]) < minimum || i32(bytes[i]) > maximum) return false;
    i++; for (let n = 1; n < count; n++, i++) if (bytes[i] < 128 || bytes[i] > 191) return false;
  }
  return true;
}
function __pulse_s3_hex(bytes: Uint8Array): string {
  const alphabet = '0123456789abcdef'; let output = '';
  for (let i = 0; i < bytes.length; i++) output += alphabet.charAt(bytes[i] >> 4) + alphabet.charAt(bytes[i] & 15);
  return output;
}
function __pulse_s3_sha(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(32);
  if (pulse_crypto_sha256_bytes_v1(i32(bytes.dataStart), bytes.length, i32(output.dataStart), 32) != 1) unreachable();
  return output;
}
function __pulse_s3_mac(key: Uint8Array, text: string): Uint8Array {
  const data = __pulse_s3_bytes(text), output = new Uint8Array(32);
  const status = pulse_crypto_hmac_sha256_bytes_v1(i32(key.dataStart), key.length, i32(data.dataStart), data.length, i32(output.dataStart), 32);
  key.fill(0);
  if (status != 1) unreachable();
  return output;
}
function __pulse_s3_ascii(text: string, max: i32): bool {
  if (!text.length || text.length > max) return false;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 33 || text.charCodeAt(i) > 126) return false;
  return true;
}
function __pulse_s3_credentials(id: string, secret: string, token: string): bool {
  return __pulse_s3_ascii(id, 256) && __pulse_s3_scalar(secret) && secret.length > 0 && __pulse_s3_bytes(secret).length <= 4096
    && secret.indexOf('\r') < 0 && secret.indexOf('\n') < 0 && (!token.length || __pulse_s3_ascii(token, 4096));
}
function __pulse_s3_pad(value: i32, digits: i32): string { return value.toString().padStart(digits, '0') }
function __pulse_s3_date(seconds: i64): string {
  if (seconds < 0 || seconds > 253402300799) return '';
  // Gregorian civil date from Unix days, bounded to years 1970..9999.
  const z = i32(seconds / 86400) + 719468, era = z / 146097, doe = z - era * 146097;
  const yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  let year = yoe + era * 400;
  const doy = doe - (365 * yoe + yoe / 4 - yoe / 100), mp = (5 * doy + 2) / 153;
  const day = doy - (153 * mp + 2) / 5 + 1, month = mp + (mp < 10 ? 3 : -9);
  if (month <= 2) year++;
  return __pulse_s3_pad(year, 4) + __pulse_s3_pad(month, 2) + __pulse_s3_pad(day, 2) + 'T'
    + __pulse_s3_pad(i32(seconds / 3600 % 24), 2) + __pulse_s3_pad(i32(seconds / 60 % 60), 2) + __pulse_s3_pad(i32(seconds % 60), 2) + 'Z';
}
class __PulseS3Signature {
  date: string = ''; digest: string = ''; authorization: string = '';
}
function __pulse_s3_sign(method: string, path: string, host: string, region: string, id: string, secret: string, token: string, seconds: i64): __PulseS3Signature {
  const result = new __PulseS3Signature(); result.date = __pulse_s3_date(seconds);
  result.digest = __pulse_s3_hex(__pulse_s3_sha(new Uint8Array(0)));
  const names = 'host;x-amz-content-sha256;x-amz-date' + (token.length ? ';x-amz-security-token' : '');
  const headers = 'host:' + host + '\nx-amz-content-sha256:' + result.digest + '\nx-amz-date:' + result.date + '\n'
    + (token.length ? 'x-amz-security-token:' + token + '\n' : '');
  const canonical = method + '\n' + path + '\n\n' + headers + '\n' + names + '\n' + result.digest;
  const day = result.date.slice(0, 8), scope = day + '/' + region + '/s3/aws4_request';
  const toSign = 'AWS4-HMAC-SHA256\n' + result.date + '\n' + scope + '\n' + __pulse_s3_hex(__pulse_s3_sha(__pulse_s3_bytes(canonical)));
  let key = __pulse_s3_mac(__pulse_s3_bytes('AWS4' + secret), day);
  key = __pulse_s3_mac(key, region); key = __pulse_s3_mac(key, 's3'); key = __pulse_s3_mac(key, 'aws4_request');
  const signature = __pulse_s3_mac(key, toSign);
  result.authorization = 'AWS4-HMAC-SHA256 Credential=' + id + '/' + scope + ', SignedHeaders=' + names + ', Signature=' + __pulse_s3_hex(signature);
  signature.fill(0); return result;
}
function __pulse_s3_status_reason(status: i32): string {
  if (status == 401 || status == 403) return 'not-authorized';
  if (status == 429) return 'throttled'; if (status == 408) return 'timeout';
  if (status >= 500 && status <= 599) return 'unavailable'; return 'protocol';
}
