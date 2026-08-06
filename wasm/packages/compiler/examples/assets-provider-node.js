import { Router } from './pulse-runtime/dist/index.js';
import { assets } from '@pulse-compute/assets/pulsewasm';

const app = new Router();

export function serveAsset(ctx, next) {
  const found = assets.lookup('public', '/app.js', { cacheControl: 'public, max-age=60' });
  return assets.respond(found);
}

export function headAsset(ctx, next) {
  const found = assets.lookup('public', '/metadata.txt', { method: 'HEAD', passThroughOn404: true });
  return assets.respond(found);
}

app.get('/app.js', serveAsset);
app.head('/metadata.txt', headAsset);
