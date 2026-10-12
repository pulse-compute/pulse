'use strict';
const { createHash } = require('node:crypto');

// Opt-in compatibility patch for the exact json-as 1.5.0 source.
// See the adjacent upstream patch. Enabled caches preserve their original arena.
// Never edit an installation or mutate an unreviewed dependency.
const sourceSha256 = '337a8edd1df0907a8b41dd1f38b6204fba6f1b40d82b3edbad0a65852bc2b830';
module.exports = class SchemaCacheArenaTransform {
  afterParse(parser) {
    const sources = parser.sources.filter(source => /(?:^|\/)json-as\/lib\/as-bs(?:\.ts)?$/.test(source.internalPath));
    if (sources.length !== 1 || createHash('sha256').update(sources[0].text).digest('hex') !== sourceSha256) {
      throw new Error('Pulse schema cache arena patch requires the pinned json-as 1.5.0 lib/as-bs.ts source; review the dependency before rebuilding.');
    }
    const scope = sources[0].statements.find(statement => statement.name?.text === 'sc');
    const declarations = scope?.members.flatMap(statement => statement.declarations || []) || [];
    const arena = declarations.find(declaration => declaration.name.text === 'ARENA_SIZE');
    const cache = declarations.find(declaration => declaration.name.text === 'CACHE_SIZE_BASE')?.initializer;
    if (!arena?.initializer || cache?.condition?.text !== 'CACHE_ENABLED' || !cache.ifElse) {
      throw new Error('Pulse schema cache arena patch encountered an unexpected AssemblyScript AST.');
    }
    // Reuse the pinned AST's CACHE_ENABLED and zero expressions. Construct the
    // conditional with asc's own node class; no second compiler is loaded.
    arena.initializer = new cache.constructor(cache.condition, arena.initializer, cache.ifElse, arena.initializer.range);
  }
};
