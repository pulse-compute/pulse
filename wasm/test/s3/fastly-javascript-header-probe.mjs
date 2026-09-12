// Provider feasibility probe, not an S3 implementation or acceptance consumer.
import { CacheOverride } from 'fastly:cache-override';

addEventListener('fetch', (event) => event.respondWith((async () => {
  const path = new URL(event.request.url).pathname;
  const response = await fetch(`http://origin.test${path}`, {
    backend: 'origin',
    cacheOverride: new CacheOverride('pass'),
    redirect: 'manual',
    fastly: { decompressGzip: false }
  });
  // Read from the host-backed Headers before materializing the iterator.
  const etag = response.headers.get('etag');
  const contentType = response.headers.get('content-type');
  const headers = [...response.headers];
  await response.arrayBuffer();
  return new Response(JSON.stringify({ status: response.status, etag, contentType, headers }), {
    headers: { 'content-type': 'application/json' }
  });
})()));
