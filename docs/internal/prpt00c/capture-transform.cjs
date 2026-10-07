'use strict';

// Evidence-only adapter for the lockfile-pinned asc emission lifecycle.
// No product compiler imports this transform.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { assertCompanion, functionNames } = require('../../../wasm/test/runtime/compiler-efficiency/o08-wasm-census.cjs');
const { captureGraph } = require('./direct-graph.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

module.exports = class FinalEmissionCapture {
  afterCompile(module) {
    const emit = module.emitBinary.bind(module);
    const binaryen = this.binaryen;
    let convergenceEmissions = 0;
    module.emitBinary = (...args) => {
      const result = emit(...args);
      // asc's convergence loop uses emitBinary(); actual output uses
      // emitBinary(sourceMapUrl), including null when maps are disabled.
      if (!args.length) { convergenceEmissions++; return result; }
      const production = Buffer.from(result.binary);
      const previous = binaryen.getDebugInfo();
      let named;
      try {
        binaryen.setDebugInfo(true);
        named = Buffer.from(emit(null).binary);
      } finally {
        binaryen.setDebugInfo(previous);
      }
      const parsed = assertCompanion(production, named);
      const wasm = new WebAssembly.Module(named);
      const sections = WebAssembly.Module.customSections(wasm, 'name');
      assert.equal(sections.length, 1, 'one verified names section');
      const names = functionNames(Buffer.from(sections[0]));
      const imported = WebAssembly.Module.imports(wasm).filter(row => row.kind === 'function').length;
      const functions = parsed.bodies.map((bytes, ordinal) => ({
        index: imported + ordinal, name: names.get(imported + ordinal) || null, bytes
      }));
      assert.equal(new Set(functions.filter(f => f.name).map(f => f.name)).size,
        functions.filter(f => f.name).length, 'defined names are unique');
      // A second ordinary serialization also checks debug-state restoration.
      assert.deepEqual(Buffer.from(emit(...args).binary), production);
      const graph = captureGraph(binaryen, named, functions, imported);
      fs.writeFileSync(process.env.PRPT00C_CAPTURE_FILE, JSON.stringify({
        version: 'pulse.prpt00c.emission-capture.v1',
        artifactSha256: hash(production), artifactBytes: production.length,
        convergenceEmissions, nonCustomSectionsIdentical: true,
        restoredSerializationIdentical: true, importedFunctions: imported,
        functions, graph,
        sections: parsed.sections.map(({ raw, ...row }) => row)
      }, null, 2) + '\n');
      // Return the first serialization, including its original custom sections.
      return result;
    };
  }
};
