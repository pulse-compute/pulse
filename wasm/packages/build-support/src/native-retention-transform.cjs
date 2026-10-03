'use strict';

// asc injects its own pinned Binaryen instance into transform constructors.
// No additional optimizer instance, public decorator or dependency is needed.
const generatedEntries = new Set(['canonical-native.as', 'fastly-native-platform-capabilities.as']);
// Legacy numeric names remain supported for captured sources and fixtures.
// The private retained suffix is only a batching aid: it grants no retention
// without the existing compiler-owned source and @noinline annotation.
const generatedFunction = /^__pulse_(?:expr_\d+|ex_\d+\$[ik]|chunk_\d+|shared_stage_\d+|stage_(?:prepare|clear|ready|result)|step|route_error)$/;

function commonPrefixLength(left, right) {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length++;
  return length;
}

function retentionPatterns(module, binaryen, retainedNames) {
  const selected = new Set(retainedNames.filter(name => module.getFunction(name)));
  if (selected.size < 2) return [...selected];
  const names = [];
  for (let index = 0; index < module.getNumFunctions(); index++) {
    names.push(binaryen.Function.getName(module.getFunctionByIndex(index)));
  }
  const patterns = new Set();
  for (const entry of generatedEntries) {
    const prefix = `${entry}/__pulse_ex_`, suffix = '$k';
    const matches = names.filter(name => name.startsWith(prefix) && name.endsWith(suffix));
    // Check every actual wildcard match, including unannotated functions and
    // imports. A private-looking name never grants retention on its own.
    if (matches.length > 1 && matches.every(name => selected.has(name))) {
      patterns.add(`${prefix}*${suffix}`);
      for (const name of matches) selected.delete(name);
    }
  }
  names.sort();
  for (let start = 0; start < names.length;) {
    if (!selected.has(names[start])) { start++; continue; }
    let end = start + 1;
    while (end < names.length && selected.has(names[end])) end++;
    // In lexical order, the nearest unselected neighbors bound every safe
    // prefix in this run. Include all module functions, including imports and
    // unannotated leaves: a wildcard must never broaden retention policy.
    const before = names[start - 1] || '';
    const after = names[end] || '';
    for (let index = start; index < end; index++) {
      const name = names[index];
      const length = Math.max(
        name.indexOf('/__pulse_') + '/__pulse_'.length,
        commonPrefixLength(name, before) + 1,
        commonPrefixLength(name, after) + 1
      );
      // An unselected name may extend the entire selected name (e.g. 1/10).
      // In that case only an exact pattern is safe.
      patterns.add(length > name.length ? name : `${name.slice(0, length)}*`);
    }
    start = end;
  }
  return [...patterns];
}

module.exports = class NativeRetentionTransform {
  afterParse(parser) {
    this.retainedNames = [];
    for (const source of parser.sources) {
      if (!generatedEntries.has(source.internalPath)) continue;
      for (const declaration of source.statements) {
        if (generatedFunction.test(declaration.name?.text || '')
          && declaration.decorators?.some(decorator => decorator.name?.text === 'noinline')) {
          this.retainedNames.push(`${source.internalPath}/${declaration.name.text}`);
        }
      }
    }
  }

  afterCompile(module) {
    // afterCompile precedes optimization; asc --runPasses runs too late.
    const previous = this.binaryen.getPassArgument('no-inline');
    try {
      // Binaryen's no-inline pass scans the whole module for one wildcard.
      // Batch only patterns whose existing matches are all already selected.
      for (const pattern of retentionPatterns(module, this.binaryen, this.retainedNames)) {
        this.binaryen.setPassArgument('no-inline', pattern);
        module.runPasses(['no-inline']);
      }
    } finally {
      this.binaryen.setPassArgument('no-inline', previous);
    }
  }
};
