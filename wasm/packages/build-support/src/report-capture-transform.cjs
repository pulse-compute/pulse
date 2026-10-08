'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { assertCompanion, functionNames, MAX_BYTES } = require('./wasm-evidence');
const { captureGraph } = require('./report-direct-graph');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
module.exports = class ReportCapture {
  constructor(config) { this.config = config; }
  afterCompile(module) {
    const emit = module.emitBinary.bind(module), binaryen = this.binaryen, config = this.config;
    module.emitBinary = (...args) => {
      const result = emit(...args);
      // Pinned asc final-output call has one source-map argument (possibly null).
      // Zero-argument convergence probes must never publish evidence.
      if (!args.length) return result;
      try {
        const production = Buffer.from(result.binary); assert.ok(production.length <= MAX_BYTES);
        const previous = binaryen.getDebugInfo(); let named;
        try { binaryen.setDebugInfo(true); named = Buffer.from(emit(null).binary); }
        finally { binaryen.setDebugInfo(previous); }
        const parsed = assertCompanion(production, named);
        assert.deepEqual(Buffer.from(emit(...args).binary), production);
        const sections = WebAssembly.Module.customSections(new WebAssembly.Module(named), 'name');
        assert.equal(sections.length, 1);
        const names = functionNames(Buffer.from(sections[0]));
        const functions = parsed.functions.map(row => ({ ...row, name: names.get(row.index) ?? null }));
        const byName = new Map(functions.filter(row => row.name !== null).map(row => [row.name, row.index]));
        assert.equal(byName.size, functions.filter(row => row.name !== null).length);
        const ownership = config.ownership;
        const handlerBodies = (ownership.handlerBodies || []).map(row => ({ entryId: row.id, handlerId: row.handlerId, chunks: row.chunks }));
        const special = new Set([...(ownership.stages || []), ...(ownership.helperBodies || [])].flatMap(row => row.chunks || []));
        const bounded = ownership.dispatcher?.strategy === 'bounded-state-chunks';
        const chunkMappings = [...new Set(handlerBodies.flatMap(row => row.chunks))].map(chunk => {
          const supported = bounded && !special.has(chunk);
          const index = supported ? byName.get(config.prefix + '__pulse_chunk_' + chunk) : undefined;
          return { chunk, functionIndex: index ?? null, reason: index !== undefined ? null : supported ? 'incomplete-mapping' : 'unsupported-mapping' };
        });
        const graph = captureGraph(binaryen, named, functions, parsed.importedFunctions);
        const artifactSha256 = hash(production);
        const capture = { kind: 'pulse.report-attribution', attributionVersion: 1,
          artifactId: 'artifact:' + artifactSha256, artifactSha256, stage: 'final',
          importedFunctions: parsed.importedFunctions, functions: parsed.functions, handlerBodies, chunkMappings,
          graph: { state: graph.status, reason: graph.status === 'available' ? null : 'unsupported-call-graph',
            method: 'static-direct-calls-v1', edges: graph.status === 'available' ? graph.edges : [] } };
        const wire = JSON.stringify(capture); assert.ok(Buffer.byteLength(wire) <= 16 * 1024 * 1024);
        fs.writeFileSync(config.file, wire);
      } catch {
        // Evidence is optional; never reject an otherwise-valid ordinary build.
        try { fs.rmSync(config.file, { force: true }); } catch { /* no usable capture */ }
      }
      return result;
    };
  }
};
