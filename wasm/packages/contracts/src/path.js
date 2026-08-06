'use strict';

const PATH_GRAMMAR_VERSION = 'pulsewasm.path-grammar.v1';

const PATH_POLICY = {
  grammarVersion: PATH_GRAMMAR_VERSION,
  runtimeReference: 'pulse-runtime/src/router-path.ts',
  normalizer: 'compileRoutePath-compatible strict PulseWasm subset',
  allowed: {
    literals: true,
    params: ':param with JavaScript identifier names',
    wildcard: 'one unnamed trailing * segment only',
    scoped: 'mount/use prefixes compile as prefix/* patterns'
  },
  rejected: [
    'dynamic path expressions',
    'empty middle segments / duplicate slashes',
    'named wildcard segments such as *rest',
    'non-trailing wildcards',
    'duplicate parameter names in a single compiled path',
    'optional path segments',
    'regex path segments',
    'computed route paths'
  ]
};

function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`;
}

function trimTrailingSlash(value) {
  let out = value;
  while (out.length > 1 && out.endsWith('/')) {
    out = out.slice(0, -1);
  }
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
  if (stripped === '/') return '/*';
  return `${stripped}/*`;
}

function rawSegments(normalizedPath) {
  if (normalizedPath === '/') return [];
  if (!normalizedPath.startsWith('/')) {
    throw new Error(`PulseWasm path must be absolute after normalization: ${normalizedPath}`);
  }
  const body = normalizedPath.slice(1);
  const segments = body.split('/');
  const emptyIndex = segments.findIndex((segment) => segment.length === 0);
  if (emptyIndex !== -1) {
    throw new Error(`Duplicate or empty path segment is unsupported: ${normalizedPath}`);
  }
  return segments;
}

function parseSegments(normalizedPath, options = {}) {
  const segments = rawSegments(normalizedPath);
  const parsed = [];
  const params = [];
  const seenParams = new Set();
  let wildcard = false;

  segments.forEach((segment, index) => {
    if (segment === '*') {
      if (!options.allowWildcard) {
        throw new Error(`Wildcard paths are not supported here: ${normalizedPath}`);
      }
      if (index !== segments.length - 1) {
        throw new Error(`Wildcard must be the final path segment: ${normalizedPath}`);
      }
      wildcard = true;
      parsed.push({ kind: 'wildcard' });
      return;
    }

    if (segment.startsWith('*') || segment.includes('*')) {
      throw new Error(`Only one unnamed trailing * wildcard segment is supported: ${normalizedPath}`);
    }

    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!name) {
        throw new Error(`Path parameter name cannot be empty: ${normalizedPath}`);
      }
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        throw new Error(`Unsupported path parameter name "${name}" in ${normalizedPath}`);
      }
      if (seenParams.has(name)) {
        throw new Error(`Duplicate path parameter ":${name}" is unsupported: ${normalizedPath}`);
      }
      seenParams.add(name);
      params.push(name);
      parsed.push({ kind: 'param', name });
      return;
    }

    if (!/^[A-Za-z0-9._~!$&'()+,;=@%-]+$/.test(segment)) {
      throw new Error(`Unsupported literal path segment "${segment}" in ${normalizedPath}`);
    }
    parsed.push({ kind: 'literal', value: segment });
  });

  return { segments: parsed, params, wildcard };
}

function compileRoutePath(path, options = {}) {
  const scoped = Boolean(options.scoped);
  const normalized = scoped ? normalizeScopedPath(path) : normalizeRoutePath(path);
  const parsed = parseSegments(normalized, {
    allowWildcard: options.allowWildcard !== false
  });
  return {
    original: String(path ?? ''),
    normalized,
    scoped,
    wildcard: parsed.wildcard,
    segments: parsed.segments,
    params: parsed.params,
    grammarVersion: PATH_GRAMMAR_VERSION
  };
}

function publicPathPattern(compiled) {
  return {
    grammarVersion: compiled.grammarVersion || PATH_GRAMMAR_VERSION,
    normalized: compiled.normalized,
    scoped: Boolean(compiled.scoped),
    wildcard: Boolean(compiled.wildcard),
    segments: compiled.segments || [],
    params: compiled.params || []
  };
}

function validatePath(path, options = {}) {
  const compiled = compileRoutePath(path, {
    scoped: Boolean(options.scoped),
    allowWildcard: options.allowWildcard
  });
  return {
    normalized: options.scoped ? stripScopedWildcard(compiled.normalized) : compiled.normalized,
    params: compiled.params,
    wildcard: compiled.wildcard,
    segments: compiled.segments,
    pattern: publicPathPattern(compiled)
  };
}

function joinPaths(prefix, path) {
  const left = stripScopedWildcard(prefix || '/');
  const right = normalizeRoutePath(path || '/');
  if (left === '/') return right;
  if (right === '/') return left;
  return normalizeRoutePath(`${left}/${right.replace(/^\/+/, '')}`);
}

function joinScopedPrefix(prefix, scopedPath) {
  return stripScopedWildcard(joinPaths(prefix || '/', stripScopedWildcard(scopedPath || '/')));
}

function splitSegments(path) {
  const normalized = normalizeRoutePath(path);
  return rawSegments(normalized);
}

function extractParams(path) {
  return compileRoutePath(path, { allowWildcard: true }).params;
}

function scopedPathMatchDetails(routePath, scopedPath) {
  const route = compileRoutePath(routePath, { allowWildcard: true });
  const scoped = compileRoutePath(stripScopedWildcard(scopedPath), { scoped: true, allowWildcard: true });
  const scopedSegments = scoped.segments.filter((segment) => segment.kind !== 'wildcard');
  const captures = [];

  if (scopedSegments.length === 0) {
    return { matches: true, captures, diagnostics: [] };
  }
  if (scopedSegments.length > route.segments.length) {
    return { matches: false, captures, diagnostics: [] };
  }

  const diagnostics = [];
  for (let i = 0; i < scopedSegments.length; i += 1) {
    const expected = scopedSegments[i];
    const actual = route.segments[i];
    if (!actual) return { matches: false, captures, diagnostics };

    if (expected.kind === 'literal') {
      if (actual.kind !== 'literal' || expected.value !== actual.value) {
        return { matches: false, captures, diagnostics };
      }
      continue;
    }

    if (expected.kind === 'param') {
      if (actual.kind !== 'param' || actual.name !== expected.name) {
        diagnostics.push({
          code: 'PULSEWASM_SCOPED_PARAM_MISMATCH',
          message: `Scoped middleware parameter :${expected.name} must align with the same route parameter at segment ${i + 1}.`,
          hint: 'For PulseWasm v1, path-scoped middleware params must be represented by the final flattened route path with the same name.'
        });
      } else {
        captures.push({ name: expected.name, routeParam: actual.name, segmentIndex: i });
      }
      continue;
    }
  }

  return { matches: diagnostics.length === 0, captures, diagnostics };
}

function scopedPathMatches(routePath, scopedPath) {
  return scopedPathMatchDetails(routePath, scopedPath).matches;
}

function matchRoutePath(compiledPattern, path) {
  const pattern = compiledPattern.segments ? compiledPattern : compileRoutePath(compiledPattern, { allowWildcard: true });
  const pathSegments = rawSegments(normalizeRoutePath(path));
  const params = {};
  let pathIndex = 0;

  for (const segment of pattern.segments) {
    if (segment.kind === 'wildcard') {
      const restSegments = pathSegments.slice(pathIndex);
      return { params, rest: restSegments.length === 0 ? '/' : `/${restSegments.join('/')}` };
    }

    const value = pathSegments[pathIndex];
    if (value == null) return null;

    if (segment.kind === 'literal') {
      if (segment.value !== value) return null;
    } else if (segment.kind === 'param') {
      params[segment.name] = value;
    }
    pathIndex += 1;
  }

  if (pathIndex !== pathSegments.length) return null;
  return { params, rest: '/' };
}

module.exports = {
  PATH_GRAMMAR_VERSION,
  PATH_POLICY,
  compileRoutePath,
  ensureLeadingSlash,
  extractParams,
  joinPaths,
  joinScopedPrefix,
  matchRoutePath,
  normalizeRoutePath,
  normalizeScopedPath,
  publicPathPattern,
  scopedPathMatchDetails,
  scopedPathMatches,
  stripScopedWildcard,
  validatePath
};
