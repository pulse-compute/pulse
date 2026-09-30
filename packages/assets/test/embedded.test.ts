import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createEmbeddedManifest, createAssets, EMBEDDED_ASSET_LIMITS, AssetBucketConfigError } from '../src/index.js';
const require = createRequire(import.meta.url);
const { Router } = require('../../runtime/src/index.js');
const { executeRouter } = require('../../runtime/src/internal/index.js');
const bytes = new Uint8Array([0, 255, 192, 128, 254, 1]);
const files = [{ path: '/image.bin', bytes }, { path: '/empty', bytes: new Uint8Array() }, { path: '/é.txt', bytes: new TextEncoder().encode('hello'), contentType: 'text/plain' }];
const fixture = async () => createEmbeddedManifest(files);
async function appFor(manifest?: Awaited<ReturnType<typeof fixture>>) {
  manifest ??= await fixture();
  const app = new Router();
  app.use('/assets', createAssets({ mode: 'embedded', manifest, ttl: 60, passThroughOn404: false }));
  return (path = '/image.bin', method = 'GET', headers: HeadersInit = {}) => executeRouter(app, new Request(`https://app.invalid/assets${path}`, { method, headers }));
}

describe('explicit embedded asset manifests', () => {
  it('has order-independent deterministic identity over paths, media types, lengths and full byte digests', async () => {
    const first = await fixture();
    expect(await createEmbeddedManifest([...files].reverse())).toEqual(first);
    const rows = first.files.map(f => [f.path, f.contentType, f.byteLength, f.sha256]);
    expect(first.id).toBe(createHash('sha256').update(JSON.stringify(['pulse.embedded-assets.v1', rows])).digest('hex'));
    expect(first.files.find(f => f.path === '/image.bin')!.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    for (const change of [{ path: '/different', bytes }, { path: '/image.bin', bytes: new Uint8Array([1]) }, { path: '/image.bin', bytes, contentType: 'image/png' }]) {
      expect((await createEmbeddedManifest([change])).id).not.toBe((await createEmbeddedManifest([files[0]!])).id);
    }
  });
  it('snapshots caller bytes before awaiting and serialized manifests at construction', async () => {
    const source = new Uint8Array(bytes);
    const pending = createEmbeddedManifest([{path:'/image.bin',bytes:source}]); source.fill(9);
    const mutable = JSON.parse(JSON.stringify(await pending));
    const serve = await appFor(mutable); mutable.files[0].data = 'bad'; mutable.files.length = 0;
    expect(new Uint8Array(await (await serve()).arrayBuffer())).toEqual(bytes);
    const returned = new Uint8Array(await (await serve()).arrayBuffer()); returned.fill(5);
    expect(new Uint8Array(await (await serve()).arrayBuffer())).toEqual(bytes);
  });
  it('serves exact GET, bodyless HEAD, Unicode paths, empty files and misses through Pulse middleware', async () => {
    const serve = await appFor();
    const get = await serve(); expect(get.status).toBe(200); expect(get.headers.get('content-length')).toBe('6'); expect(get.headers.get('cache-control')).toBe('public, max-age=60');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
    const head = await serve('/image.bin','HEAD'); expect(head.headers.get('etag')).toBe(get.headers.get('etag')); expect(head.headers.get('content-length')).toBe('6'); expect(await head.text()).toBe('');
    expect(await (await serve('/%C3%A9.txt?ignored=1')).text()).toBe('hello');
    const empty = await serve('/empty'); expect(empty.headers.get('content-length')).toBe('0'); expect(await empty.text()).toBe('');
    expect((await serve('/missing')).status).toBe(404);
  });
  it('applies weak/single If-None-Match before ranges, clips ranges and handles If-Range', async () => {
    const serve = await appFor(); const get = await serve(); const etag = get.headers.get('etag')!;
    for (const validator of [etag, 'W/'+etag, '*']) { const r=await serve('/image.bin','GET',{'if-none-match':validator,range:'bytes=99-100'}); expect(r.status).toBe(304); expect(await r.text()).toBe(''); }
    let r=await serve('/image.bin','GET',{range:'bytes=1-99'}); expect(r.status).toBe(206); expect(r.headers.get('content-range')).toBe('bytes 1-5/6'); expect(r.headers.get('content-length')).toBe('5'); expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes.subarray(1));
    r=await serve('/image.bin','GET',{range:'bytes=1-2','if-range':'"different"'}); expect(r.status).toBe(200);
    r=await serve('/image.bin','GET',{range:'bytes=1-2','if-range':etag}); expect(r.status).toBe(206);
    r=await serve('/image.bin','HEAD',{range:'bytes=1-2'}); expect(r.status).toBe(200); expect(r.headers.get('content-length')).toBe('6');
    r=await serve('/empty','GET',{range:'bytes=0-0'}); expect(r.status).toBe(416); expect(r.headers.get('content-range')).toBe('bytes */0');
    for (const range of ['bytes=2-1','bytes=1-','bytes=-3','bytes=0-1,3-4','bytes=0-9007199254740992']) expect((await serve('/image.bin','GET',{range})).status).toBe(400);
    expect((await serve('/image.bin','GET',{'if-none-match':'"a", "b"'})).status).toBe(400);
  });
  it('rejects traversal, aliases, malformed encoding, duplicates and non-data fields', async () => {
    for (const path of ['/../x','/a/./b','/a//b','/x/','relative','/a\\b','/a%2fb','/a?b','/a#b','/\u0000','/\ud800']) await expect(createEmbeddedManifest([{path,bytes}])).rejects.toBeInstanceOf(AssetBucketConfigError);
    await expect(createEmbeddedManifest([files[0]!,files[0]!])).rejects.toBeInstanceOf(AssetBucketConfigError);
    await expect(createEmbeddedManifest([{get path(){throw Error('getter called');},bytes}])).rejects.toBeInstanceOf(AssetBucketConfigError);
    const serve=await appFor(); for(const path of ['/%2fimage.bin','/%5cimage.bin','/%ZZ','/%252e%252e/image.bin']) expect((await serve(path)).status).toBe(400);
  });
  it('enforces inclusive per-file, aggregate and count bounds before decoding', async () => {
    const full = new Uint8Array(EMBEDDED_ASSET_LIMITS.fileBytes);
    await expect(createEmbeddedManifest([{path:'/big',bytes:new Uint8Array(full.length+1)}])).rejects.toBeInstanceOf(AssetBucketConfigError);
    const four = Array.from({length:4},(_,i)=>({path:`/f${i}`,bytes:full}));
    expect((await createEmbeddedManifest(four)).byteLength).toBe(EMBEDDED_ASSET_LIMITS.totalBytes);
    await expect(createEmbeddedManifest([...four,{path:'/over',bytes:new Uint8Array(1)}])).rejects.toBeInstanceOf(AssetBucketConfigError);
    expect((await createEmbeddedManifest(Array.from({length:256},(_,i)=>({path:`/f${i}`,bytes:new Uint8Array()})))).files.length).toBe(256);
    await expect(createEmbeddedManifest(Array.from({length:257},(_,i)=>({path:`/f${i}`,bytes:new Uint8Array()})))).rejects.toBeInstanceOf(AssetBucketConfigError);
  });
  it('rejects serialized tampering before serving any file', async () => {
    for (const mutate of [(m:any)=>m.id='0'.repeat(64),(m:any)=>m.files[1].sha256='0'.repeat(64),(m:any)=>m.files[1].data='AAAAAAAB']) {
      const manifest=JSON.parse(JSON.stringify(await fixture())); mutate(manifest);
      const middleware=createAssets({mode:'embedded',manifest});
      await expect(middleware.core.handle({request:new Request('https://app.invalid/empty'),path:{relative:'/empty'}} as any)).rejects.toBeInstanceOf(AssetBucketConfigError);
    }
    const bad=JSON.parse(JSON.stringify(await fixture()));bad.files[0].data='x'.repeat(400000);
    expect(()=>createAssets({mode:'embedded',manifest:bad})).toThrow(AssetBucketConfigError);
  });
});
