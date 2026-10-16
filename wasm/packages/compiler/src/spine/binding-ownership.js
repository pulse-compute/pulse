'use strict';

// A named binding is compiler evidence, independent of a host's configured
// value. Both authored recognition and lowered-reference projection use this
// state policy; absence of a literal never invents a resolved binding.
function bindingOwnership(kind, name, dynamic = false) {
  if (!['config', 'secret', 'kv', 's3'].includes(kind)) return undefined;
  const canonicalId = typeof name === 'string' ? name : null;
  return Object.freeze({ kind, canonicalId,
    state: canonicalId !== null ? 'resolved' : dynamic ? 'dynamic' : 'unknown' });
}

module.exports = { bindingOwnership };
