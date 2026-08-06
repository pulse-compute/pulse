'use strict';

const CANONICAL_PROGRAM_VERSION = 'pulse.canonical-program.v2';
const CANONICAL_RUNTIME_PROTOCOL_VERSION = 'pulse.canonical-runtime-protocol.v2';
const CANONICAL_EFFECT_MARKER_KINDS = Object.freeze(['effect', 'group']);
const CANONICAL_PACKAGE_EFFECT_VERSION = 'pulse.canonical-package-effect.v1';

module.exports = Object.freeze({
  CANONICAL_PROGRAM_VERSION,
  CANONICAL_RUNTIME_PROTOCOL_VERSION,
  CANONICAL_EFFECT_MARKER_KINDS,
  CANONICAL_PACKAGE_EFFECT_VERSION
});
