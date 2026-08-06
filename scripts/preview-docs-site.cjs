#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DOCUMENTATION } = require('./package-support.cjs');
const { cleanBasePath } = require('./documentation-system.cjs');

const repoRoot = path.resolve(__dirname, '..');
const repoRealRoot = fs.realpathSync(repoRoot);
const defaultPreviewRoot = path.join(repoRoot, '.pulse-docs-preview');
const PREVIEW_ROOT_SCHEMA = 'pulse.documentation-preview-root.v1';
const PREVIEW_ROOT_MARKER = '.pulse-docs-preview-root.json';
const MIME_TYPES = Object.freeze(new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm']
]));

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_DOCUMENTATION_PREVIEW_INVALID';
  throw error;
}

function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingParent(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail(`documentation preview root has no existing parent: ${target}`);
    current = parent;
  }
  return current;
}

function canonicalPreviewRoot(target) {
  const resolved = path.resolve(target);
  const existing = nearestExistingParent(resolved);
  const realExisting = fs.realpathSync(existing);
  if (path.resolve(existing) !== realExisting) fail(`documentation preview root must not traverse a symlink: ${target}`);
  const effective = path.resolve(realExisting, path.relative(existing, resolved));
  if (effective === path.parse(effective).root) fail('documentation preview root must not be the filesystem root');
  if (effective === repoRealRoot || within(effective, repoRealRoot)) fail('documentation preview root must not contain the repository');
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) fail(`documentation preview root must not be a symlink: ${target}`);
    if (!stat.isDirectory()) fail(`documentation preview root must be a directory: ${target}`);
  }
  return effective;
}

function parseArguments(argv) {
  const options = {
    host: '127.0.0.1',
    port: 4173,
    open: false,
    watch: false,
    build: true,
    sync: true,
    smoke: false,
    previewRoot: defaultPreviewRoot,
    previewRootExplicit: false,
    cleanupPreviewRoot: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--host') options.host = String(argv[++index] || '').trim();
    else if (token.startsWith('--host=')) options.host = token.slice('--host='.length).trim();
    else if (token === '--port') options.port = Number(argv[++index]);
    else if (token.startsWith('--port=')) options.port = Number(token.slice('--port='.length));
    else if (token === '--open') options.open = true;
    else if (token === '--watch') options.watch = true;
    else if (token === '--no-build') options.build = false;
    else if (token === '--no-sync') options.sync = false;
    else if (token === '--smoke') options.smoke = true;
    else if (token === '--preview-root') {
      const value = argv[++index];
      if (!value) fail('--preview-root requires a directory');
      options.previewRoot = path.resolve(value);
      options.previewRootExplicit = true;
    } else if (token.startsWith('--preview-root=')) {
      const value = token.slice('--preview-root='.length);
      if (!value) fail('--preview-root requires a directory');
      options.previewRoot = path.resolve(value);
      options.previewRootExplicit = true;
    } else if (token === '--help' || token === '-h') options.help = true;
    else fail(`unknown documentation preview option ${token}`);
  }
  if (!options.host) fail('--host requires a non-empty value');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) fail('--port must be an integer from 0 through 65535');
  if (options.smoke) {
    options.host = '127.0.0.1';
    options.port = 0;
    options.open = false;
    options.watch = false;
    if (!options.previewRootExplicit) {
      options.previewRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-docs-preview-'));
      options.cleanupPreviewRoot = true;
    }
  }
  options.previewRoot = canonicalPreviewRoot(options.previewRoot);
  return Object.freeze(options);
}

function usage() {
  return `Usage: pnpm docs:preview -- [options]\n\n` +
    `Options:\n` +
    `  --host <address>      Bind address (default: 127.0.0.1)\n` +
    `  --port <number>       Port, or 0 for an ephemeral port (default: 4173)\n` +
    `  --open                Open the preview in the default browser\n` +
    `  --watch               Rebuild when documentation sources change\n` +
    `  --no-build            Serve a previously generated, owned preview artifact\n` +
    `  --no-sync             Skip generated-document synchronization\n` +
    `  --smoke               Build, serve on an ephemeral port, verify routes, and exit\n` +
    `  --preview-root <dir>  Override the preview root (safe ownership checks apply)\n`;
}

function readPreviewMarker(root) {
  const markerFile = path.join(root, PREVIEW_ROOT_MARKER);
  if (!fs.existsSync(markerFile)) return undefined;
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (error) {
    fail(`documentation preview marker is invalid: ${error.message}`);
  }
  const basePath = cleanBasePath(DOCUMENTATION.basePath) || '';
  if (
    marker.schemaVersion !== PREVIEW_ROOT_SCHEMA ||
    marker.generatedBy !== 'scripts/preview-docs-site.cjs' ||
    marker.basePath !== basePath ||
    marker.siteVersion !== DOCUMENTATION.version
  ) {
    fail('documentation preview marker does not match this generator and documentation version');
  }
  return Object.freeze({ ...marker });
}

function assertReplaceablePreviewRoot(root) {
  if (!fs.existsSync(root)) return;
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`documentation preview root must be a real directory: ${root}`);
  const entries = fs.readdirSync(root).filter((entry) => entry !== PREVIEW_ROOT_MARKER);
  if (entries.length > 0 && !readPreviewMarker(root)) {
    fail(`refusing to replace populated directory without ${PREVIEW_ROOT_MARKER}: ${root}`);
  }
}

function writePreviewMarker(root) {
  const basePath = cleanBasePath(DOCUMENTATION.basePath) || '';
  const marker = Object.freeze({
    schemaVersion: PREVIEW_ROOT_SCHEMA,
    generatedBy: 'scripts/preview-docs-site.cjs',
    basePath,
    siteVersion: DOCUMENTATION.version
  });
  fs.writeFileSync(path.join(root, PREVIEW_ROOT_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error) fail(`${script} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${script} failed with exit ${result.status}:\n${(result.stderr || result.stdout || '').trim()}`);
  if (result.stdout.trim()) process.stdout.write(result.stdout);
}

function buildPreview(options, siteRoot) {
  if (options.sync) runNode('wasm/scripts/sync-doc-snippets.cjs', ['--write']);
  runNode('scripts/build-docs-site.cjs', ['--out', siteRoot]);
}

function preparePreviewArtifact(options, siteRoot) {
  if (!options.build) {
    if (!readPreviewMarker(options.previewRoot)) {
      fail(`existing preview root is not owned by the documentation preview generator: ${options.previewRoot}`);
    }
    if (!fs.existsSync(path.join(siteRoot, 'site-manifest.json'))) {
      fail(`preview artifact is missing at ${siteRoot}; remove --no-build or run pnpm docs:preview first`);
    }
    return;
  }
  assertReplaceablePreviewRoot(options.previewRoot);
  fs.rmSync(options.previewRoot, { recursive: true, force: true });
  fs.mkdirSync(options.previewRoot, { recursive: true });
  buildPreview(options, siteRoot);
  writePreviewMarker(options.previewRoot);
}

function requestPath(urlValue) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(urlValue, 'http://127.0.0.1').pathname); }
  catch (_) { return undefined; }
  if (pathname.includes('\0')) return undefined;
  return path.posix.normalize(pathname);
}

function resolveFile(siteRoot, relativePath) {
  let candidate = path.resolve(siteRoot, relativePath.replace(/^\/+/, ''));
  if (!within(siteRoot, candidate)) return undefined;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, 'index.html');
  if (!fs.existsSync(candidate) && !path.extname(candidate)) {
    const index = path.join(candidate, 'index.html');
    if (fs.existsSync(index)) candidate = index;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return undefined;
  const realRoot = fs.realpathSync(siteRoot);
  const realCandidate = fs.realpathSync(candidate);
  return within(realRoot, realCandidate) ? realCandidate : undefined;
}

function serveFile(response, file, method, status = 200) {
  response.writeHead(status, {
    'Content-Type': MIME_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  });
  if (method === 'HEAD') response.end();
  else fs.createReadStream(file).pipe(response);
}

function createPreviewServer(siteRoot, basePath) {
  const notFound = path.join(siteRoot, '404.html');
  const rootMounted = basePath === '';

  return http.createServer((request, response) => {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      response.end('Method not allowed\n');
      return;
    }
    const pathname = requestPath(request.url || '/');
    if (!pathname) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('Bad request\n');
      return;
    }
    if (!rootMounted && pathname === '/') {
      response.writeHead(302, { Location: `${basePath}/`, 'Cache-Control': 'no-store, max-age=0' });
      response.end();
      return;
    }
    if (!rootMounted && pathname === basePath) {
      response.writeHead(308, { Location: `${basePath}/`, 'Cache-Control': 'no-store, max-age=0' });
      response.end();
      return;
    }
    if (!rootMounted && !pathname.startsWith(`${basePath}/`)) {
      if (fs.existsSync(notFound)) serveFile(response, notFound, method, 404);
      else {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Not found\n');
      }
      return;
    }
    const relative = rootMounted
      ? pathname.replace(/^\/+/, '')
      : pathname.slice(basePath.length + 1);
    if (relative === PREVIEW_ROOT_MARKER) {
      if (fs.existsSync(notFound)) serveFile(response, notFound, method, 404);
      else {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('Not found\n');
      }
      return;
    }
    const file = resolveFile(siteRoot, relative);
    if (file) {
      serveFile(response, file, method);
      return;
    }
    if (fs.existsSync(notFound)) serveFile(response, notFound, method, 404);
    else {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('Not found\n');
    }
  });
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function fetchPreview(host, port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host, port, path: pathname, headers: { Accept: '*/*' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Object.freeze({
        status: response.statusCode,
        type: response.headers['content-type'] || '',
        location: response.headers.location || '',
        body: Buffer.concat(chunks).toString('utf8')
      })));
    });
    request.setTimeout(10_000, () => request.destroy(new Error(`preview request timed out: ${pathname}`)));
    request.on('error', reject);
  });
}

async function smokePreview(host, port, basePath) {
  const root = await fetchPreview(host, port, '/');
  if (basePath) {
    if (root.status !== 302 || root.location !== `${basePath}/`) fail(`preview root did not redirect to ${basePath}/`);
  } else {
    if (root.status !== 200) fail(`root-mounted preview returned ${root.status}; expected 200`);
    for (const marker of ['id="networkField"', 'data-hero-motion-toggle', 'class="home-example"', 'class="quick-start"']) {
      if (!root.body.includes(marker)) fail(`root-mounted preview is missing ${marker}`);
    }
  }
  const checks = [
    ...(basePath ? [{ path: `${basePath}/`, status: 200, type: 'text/html', markers: ['id="networkField"', 'data-hero-motion-toggle', 'class="home-example"', 'class="quick-start"'] }] : []),
    { path: `${basePath}/${DOCUMENTATION.version}/`, status: 200, type: 'text/html', markers: ['data-page-kind="docs"'] },
    { path: `${basePath}/${DOCUMENTATION.version}/search-index.json`, status: 200, type: 'application/json', markers: ['pulse.documentation-search.v2'] },
    { path: `${basePath}/${DOCUMENTATION.version}/assets/site.css`, status: 200, type: 'text/css', markers: ['syntax-dark.css'] },
    { path: `${basePath}/${DOCUMENTATION.version}/assets/syntax-dark.css`, status: 200, type: 'text/css', markers: ['--color-prettylights-syntax-comment'] },
    { path: `${basePath}/${DOCUMENTATION.version}/guides/routing/`, status: 200, type: 'text/html', markers: ['data-highlighted="starry-night"'] },
    { path: `${basePath}/${DOCUMENTATION.version}/examples/05-fastly-capabilities/`, status: 200, type: 'text/html', markers: ['Fastly capabilities'] },
    { path: `/${PREVIEW_ROOT_MARKER}`, status: 404, type: 'text/html', markers: ['<h1>Not found</h1>'] },
    { path: `${basePath}/not-a-real-page`, status: 404, type: 'text/html', markers: ['<h1>Not found</h1>'] }
  ];
  const results = [Object.freeze({ path: '/', status: root.status, ...(root.location ? { location: root.location } : {}) })];
  for (const check of checks) {
    const result = await fetchPreview(host, port, check.path);
    if (result.status !== check.status) fail(`preview smoke ${check.path} returned ${result.status}; expected ${check.status}`);
    if (!result.type.includes(check.type)) fail(`preview smoke ${check.path} returned ${result.type}; expected ${check.type}`);
    for (const marker of check.markers) if (!result.body.includes(marker)) fail(`preview smoke ${check.path} is missing ${marker}`);
    results.push(Object.freeze({ path: check.path, status: result.status, contentType: result.type }));
  }
  return Object.freeze(results);
}

function watchFingerprint() {
  const roots = [
    'README.md', 'API.md', 'docs', 'examples', 'release/documentation-site.json',
    'release/documentation-versions.json', 'release/pulse-release-manifest.json',
    'scripts/build-docs-site.cjs', 'scripts/highlight-code-blocks.mjs',
    'scripts/documentation-site', 'scripts/documentation-site-config.cjs'
  ];
  const rows = [];
  function visit(file) {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    } else if (stat.isFile()) rows.push(`${path.relative(repoRoot, file)}:${stat.size}:${stat.mtimeMs}`);
  }
  for (const relative of roots) visit(path.join(repoRoot, relative));
  return rows.sort().join('|');
}

function startWatcher(options, siteRoot) {
  let fingerprint = watchFingerprint();
  let rebuilding = false;
  return setInterval(() => {
    const next = watchFingerprint();
    if (next === fingerprint || rebuilding) return;
    fingerprint = next;
    rebuilding = true;
    try {
      process.stdout.write('[pulse docs] source change detected; rebuilding\n');
      buildPreview(options, siteRoot);
      process.stdout.write('[pulse docs] preview rebuilt\n');
    } catch (error) {
      process.stderr.write(`[pulse docs] rebuild failed: ${error.message}\n`);
    } finally {
      rebuilding = false;
    }
  }, 1000);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const basePath = cleanBasePath(DOCUMENTATION.basePath) || '';
  const siteRoot = path.join(options.previewRoot, basePath.replace(/^\//, ''));
  preparePreviewArtifact(options, siteRoot);

  const server = createPreviewServer(siteRoot, basePath);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const browseHost = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host.includes(':') ? `[${options.host}]` : options.host;
  const url = `http://${browseHost}:${port}${basePath}/`;

  if (options.smoke) {
    try {
      const checks = await smokePreview('127.0.0.1', port, basePath);
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 'pulse.documentation-preview.v1',
        status: 'ok',
        url,
        previewRoot: options.previewRoot,
        siteRoot,
        checks
      }, null, 2)}\n`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (options.cleanupPreviewRoot) fs.rmSync(options.previewRoot, { recursive: true, force: true });
    }
    return;
  }

  process.stdout.write(`[pulse docs] preview: ${url}\n`);
  process.stdout.write(`[pulse docs] source: ${siteRoot}\n`);
  if (options.open) openBrowser(url);
  const watcher = options.watch ? startWatcher(options, siteRoot) : undefined;
  const close = () => {
    if (watcher) clearInterval(watcher);
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
