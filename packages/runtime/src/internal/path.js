'use strict';

/**
 * Package-local JavaScript realization of the sealed Pulse path grammar.
 * It intentionally mirrors @pulse-compute/wasm-contracts without importing
 * compiler/package-contract code into the public runtime package.
 */

function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function trimTrailingSlash(value) {
  let out = value;
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function normalizeRoutePath(path) {
  const text = String(path ?? '').trim();
  return trimTrailingSlash(ensureLeadingSlash(text || '/'));
}

function stripScopedWildcard(path) {
  let normalized = normalizeRoutePath(path);
  if (normalized === '/*') return '/';
  if (normalized.endsWith('/*')) normalized = normalized.slice(0, -2);
  if (normalized.endsWith('*')) normalized = normalized.slice(0, -1);
  return trimTrailingSlash(normalized || '/');
}

function normalizeScopedPath(path) {
  const stripped = stripScopedWildcard(path || '/');
  return stripped === '/' ? '/*' : `${stripped}/*`;
}

function rawSegments(normalizedPath) {
  if (normalizedPath === '/') return [];
  const body = normalizedPath.slice(1);
  const segments = body.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Duplicate or empty path segment is unsupported: ${normalizedPath}`);
  }
  return segments;
}

function compileRoutePath(path, options = {}) {
  const scoped = Boolean(options.scoped);
  const normalized = scoped ? normalizeScopedPath(path) : normalizeRoutePath(path);
  const segments = [];
  const params = [];
  const seen = new Set();
  let wildcard = false;

  rawSegments(normalized).forEach((segment, index, all) => {
    if (segment === '*') {
      if (options.allowWildcard === false || index !== all.length - 1) {
        throw new Error(`Wildcard must be the final supported path segment: ${normalized}`);
      }
      wildcard = true;
      segments.push(Object.freeze({ kind: 'wildcard' }));
      return;
    }
    if (segment.startsWith('*') || segment.includes('*')) {
      throw new Error(`Only one unnamed trailing * wildcard segment is supported: ${normalized}`);
    }
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new Error(`Unsupported path parameter name "${name}" in ${normalized}`);
      }
      if (seen.has(name)) throw new Error(`Duplicate path parameter ":${name}" is unsupported: ${normalized}`);
      seen.add(name);
      params.push(name);
      segments.push(Object.freeze({ kind: 'param', name }));
      return;
    }
    if (!/^[A-Za-z0-9._~!$&'()+,;=@%-]+$/.test(segment)) {
      throw new Error(`Unsupported literal path segment "${segment}" in ${normalized}`);
    }
    segments.push(Object.freeze({ kind: 'literal', value: segment }));
  });

  return Object.freeze({
    original: String(path ?? ''),
    normalized,
    scoped,
    wildcard,
    segments: Object.freeze(segments),
    params: Object.freeze(params)
  });
}

function matchRoutePath(compiledPattern, path) {
  const pattern = compiledPattern && compiledPattern.segments
    ? compiledPattern
    : compileRoutePath(compiledPattern, { allowWildcard: true });
  const pathSegments = rawSegments(normalizeRoutePath(path));
  const params = {};
  let pathIndex = 0;

  for (const segment of pattern.segments) {
    if (segment.kind === 'wildcard') {
      const rest = pathSegments.slice(pathIndex);
      return Object.freeze({
        params: Object.freeze({ ...params }),
        rest: rest.length === 0 ? '/' : `/${rest.join('/')}`
      });
    }
    const value = pathSegments[pathIndex];
    if (value == null) return null;
    if (segment.kind === 'literal') {
      if (segment.value !== value) return null;
    } else {
      params[segment.name] = value;
    }
    pathIndex += 1;
  }

  if (pathIndex !== pathSegments.length) return null;
  return Object.freeze({ params: Object.freeze({ ...params }), rest: '/' });
}

module.exports = Object.freeze({
  compileRoutePath,
  matchRoutePath,
  normalizeRoutePath,
  normalizeScopedPath,
  stripScopedWildcard
});
