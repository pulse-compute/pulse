'use strict';

// Shared by build-time validators and runtime-safe package contracts.
const LOWERABLE_COMPILER_BUILDER_VERSION = 'pulsewasm.lowerable-compiler-builder.v1';
const LOWERABLE_COMPILER_TRUST = Object.freeze(['build-dependency', 'first-party']);
function isTrustedLowerer(trust) { return LOWERABLE_COMPILER_TRUST.includes(trust); }

module.exports = { LOWERABLE_COMPILER_BUILDER_VERSION, LOWERABLE_COMPILER_TRUST, isTrustedLowerer };
