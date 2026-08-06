import { Router } from '@pulse-compute/runtime';
import { assets } from '@pulse-compute/assets';

// Native package-out discovery fixture. Runtime JavaScript examples await assets.lookup().
const router = new Router();

router.get('/app.js', serveApp);
router.head('/metadata.txt', serveMetadata);

export default router;

export function serveApp(ctx, next) {
  const found = assets.lookup(ctx, 'public', '/app.js', {
    method: 'GET',
    cacheControl: 'public, max-age=60'
  });

  return assets.respond(found);
}

export function serveMetadata(ctx, next) {
  const found = assets.lookup(ctx, 'public', '/metadata.txt', {
    method: 'HEAD',
    passThroughOn404: true
  });

  return assets.respond(found);
}
