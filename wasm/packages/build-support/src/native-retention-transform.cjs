'use strict';

// asc injects its own pinned Binaryen instance into transform constructors.
// No additional optimizer instance, public decorator or dependency is needed.
const generatedEntries = new Set(['canonical-native.as', 'fastly-native-platform-capabilities.as']);
const generatedFunction = /^__pulse_(?:expr_\d+|chunk_\d+|step)$/;

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
      for (const name of this.retainedNames) {
        if (!module.getFunction(name)) continue; // Unreachable declarations need no policy.
        this.binaryen.setPassArgument('no-inline', name);
        module.runPasses(['no-inline']);
      }
    } finally {
      this.binaryen.setPassArgument('no-inline', previous);
    }
  }
};
