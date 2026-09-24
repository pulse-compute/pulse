'use strict';

// asc injects its own pinned Binaryen instance into transform constructors.
// No additional optimizer instance, public decorator or dependency is needed.
const generatedEntries = new Set(['canonical-native.as', 'fastly-native-platform-capabilities.as']);
const generatedFunction = /^__pulse_(?:expr_\d+|chunk_\d+|step)$/;

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
  names.sort();
  const patterns = new Set();
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
      // Batch only prefixes whose existing matches are all already selected.
      for (const pattern of retentionPatterns(module, this.binaryen, this.retainedNames)) {
        this.binaryen.setPassArgument('no-inline', pattern);
        module.runPasses(['no-inline']);
      }
    } finally {
      this.binaryen.setPassArgument('no-inline', previous);
    }
  }
};
