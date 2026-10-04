import { AssetBucketConfigError } from './errors.js';

export const EMBEDDED_ASSET_LIMITS = Object.freeze({ files: 256, fileBytes: 262144, totalBytes: 1048576, pathBytes: 1024 });
export type EmbeddedAssetInput = { readonly path: string; readonly bytes: Uint8Array; readonly contentType?: string };
export type EmbeddedAssetRecord = { readonly path: string; readonly data: string; readonly byteLength: number; readonly sha256: string; readonly contentType: string };
export type EmbeddedAssetManifest = { readonly version: 'pulse.embedded-assets.v1'; readonly id: string; readonly byteLength: number; readonly files: readonly EmbeddedAssetRecord[] };
const VERSION = 'pulse.embedded-assets.v1';
const utf8 = new TextEncoder();
const fail = (): never => { throw new AssetBucketConfigError('Invalid or oversized embedded asset manifest'); };
function record(value: unknown, fields: readonly string[]): void {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  for (const key of Reflect.ownKeys(value as object)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !fields.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail();
  }
}
function validPath(path: string): string {
  if (typeof path !== 'string' || /[\uD800-\uDFFF]/u.test(path) || !path.startsWith('/') || path === '/' || path.length > EMBEDDED_ASSET_LIMITS.pathBytes
    || utf8.encode(path).length > EMBEDDED_ASSET_LIMITS.pathBytes || /[\\%?#\u0000-\u001f\u007f-\u009f]/u.test(path)
    || path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) fail();
  return path;
}
function contentType(value: string): string {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,128}$/.test(value) || value.trim() !== value) fail();
  return value;
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function identity(files: readonly EmbeddedAssetRecord[]): Promise<string> {
  return digest(utf8.encode(JSON.stringify([VERSION, files.map(f => [f.path, f.contentType, f.byteLength, f.sha256])])));
}

/** Explicit bytes only: no directory scan, filesystem access or network fetch. */
export async function createEmbeddedManifest(input: readonly EmbeddedAssetInput[]): Promise<EmbeddedAssetManifest> {
  if (!Array.isArray(input) || input.length > EMBEDDED_ASSET_LIMITS.files) fail();
  let total = 0;
  const paths = new Set<string>();
  // Snapshot every input before the first await, including caller-owned bytes.
  const entries = input.map(file => {
    record(file, ['path', 'bytes', 'contentType']);
    const path = validPath(file.path);
    if (paths.has(path) || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength > EMBEDDED_ASSET_LIMITS.fileBytes) fail();
    paths.add(path); total += file.bytes.byteLength;
    if (total > EMBEDDED_ASSET_LIMITS.totalBytes) fail();
    return { path, bytes: new Uint8Array(file.bytes), contentType: contentType(file.contentType ?? 'application/octet-stream') };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const files: EmbeddedAssetRecord[] = [];
  for (const file of entries) files.push(Object.freeze({ path: file.path, contentType: file.contentType, byteLength: file.bytes.length, sha256: await digest(file.bytes), data: base64(file.bytes) }));
  return Object.freeze({ version: VERSION, id: await identity(files), byteLength: total, files: Object.freeze(files) });
}

/** Constructor admission snapshots bounded serialized fields without retaining caller state. */
export function snapshotEmbeddedManifest(input: EmbeddedAssetManifest): EmbeddedAssetManifest {
  record(input, ['version', 'id', 'byteLength', 'files']);
  if (input.version !== VERSION || typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id)
    || !Array.isArray(input.files) || input.files.length > EMBEDDED_ASSET_LIMITS.files) fail();
  let total = 0, previous = '';
  const files = input.files.map(file => {
    record(file, ['path', 'data', 'byteLength', 'sha256', 'contentType']);
    const path = validPath(file.path);
    if (path <= previous || !Number.isInteger(file.byteLength) || file.byteLength < 0 || file.byteLength > EMBEDDED_ASSET_LIMITS.fileBytes
      || typeof file.data !== 'string' || file.data.length !== 4 * Math.ceil(file.byteLength / 3)
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) fail();
    total += file.byteLength; previous = path;
    if (total > EMBEDDED_ASSET_LIMITS.totalBytes) fail();
    return Object.freeze({ path, data: file.data, byteLength: file.byteLength, sha256: file.sha256, contentType: contentType(file.contentType) });
  });
  if (input.byteLength !== total) fail();
  return Object.freeze({ version: VERSION, id: input.id, byteLength: total, files: Object.freeze(files) });
}

type Loaded = ReadonlyMap<string, { readonly record: EmbeddedAssetRecord; readonly bytes: Uint8Array }>;
export async function loadEmbeddedManifest(input: EmbeddedAssetManifest): Promise<Loaded> {
  const files = new Map<string, { record: EmbeddedAssetRecord; bytes: Uint8Array }>();
  for (const file of input.files) {
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0)); } catch { return fail(); }
    if (bytes.length !== file.byteLength || base64(bytes) !== file.data || await digest(bytes) !== file.sha256) fail();
    files.set(file.path, { record: file, bytes });
  }
  if (await identity(input.files) !== input.id) fail();
  return files;
}

export function embeddedRequestPath(raw: string): string {
  if (/%(?:2f|5c)/i.test(raw)) fail();
  try { return validPath(decodeURIComponent(raw)); } catch { return fail(); }
}

export function embeddedResponse(files: Loaded, path: string, request: Request): Response | undefined {
  const file = files.get(path);
  if (!file) return undefined;
  const { record: entry, bytes } = file;
  const etag = `"${entry.sha256}"`;
  const headers = new Headers({ 'content-type': entry.contentType, etag, 'accept-ranges': 'bytes' });
  const validator = request.headers.get('if-none-match');
  if (validator !== null) {
    if (!/^(?:\*|(?:W\/)?"[\x21\x23-\x7e]*")$/.test(validator)) return new Response(null, { status: 400 });
    if (validator === '*' || validator.replace(/^W\//, '') === etag) return new Response(null, { status: 304, headers });
  }
  let start = 0, end = bytes.length - 1, status = 200;
  const range = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (request.method === 'GET' && range !== null && (ifRange === null || ifRange === etag)) {
    const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(range);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[1]) > Number(match[2])) return new Response(null, { status: 400 });
    start = Number(match[1]); end = Math.min(Number(match[2]), end);
    if (start >= bytes.length) { headers.set('content-range', `bytes */${bytes.length}`); return new Response(null, { status: 416, headers }); }
    status = 206; headers.set('content-range', `bytes ${start}-${end}/${bytes.length}`);
  }
  headers.set('content-length', String(Math.max(0, end - start + 1)));
  // Copy only the selected representation; callers cannot mutate retained bytes.
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes.slice(start, end + 1)), { status, headers });
}
