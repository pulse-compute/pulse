'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { diagnosticCodes } = require('./constants.js');
const { fail, wrap } = require('./errors.js');
const { sha256 } = require('./files.js');
const { runTool } = require('./toolchain.js');

const utf8 = new TextDecoder('utf-8', { fatal: true });
const typeNames = new Map([
  [0x7f, 'i32'],
  [0x7e, 'i64'],
  [0x7d, 'f32'],
  [0x7c, 'f64'],
  [0x7b, 'v128'],
  [0x70, 'funcref'],
  [0x6f, 'externref']
]);
const exportKinds = ['function', 'table', 'memory', 'global'];
const sectionRanks = new Map([
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 5],
  [6, 6],
  [7, 7],
  [8, 8],
  [9, 9],
  [12, 10],
  [10, 11],
  [11, 12]
]);

class Reader {
  constructor(bytes, label, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.label = label;
    this.offset = start;
    this.end = end;
  }

  ensure(length, context) {
    if (this.offset + length > this.end) fail(diagnosticCodes.invalid, `${this.label} has truncated ${context}.`);
  }

  byte(context) {
    this.ensure(1, context);
    return this.bytes[this.offset++];
  }

  take(length, context) {
    this.ensure(length, context);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  uleb(context, maximumBits = 32) {
    let value = 0;
    let shift = 0;
    while (this.offset < this.end) {
      const byte = this.byte(context);
      value += (byte & 0x7f) * (2 ** shift);
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) fail(diagnosticCodes.invalid, `${this.label} ${context} exceeds safe integer range.`);
        return value;
      }
      shift += 7;
      if (shift > maximumBits + 7) fail(diagnosticCodes.invalid, `${this.label} ${context} ULEB is too large.`);
    }
    fail(diagnosticCodes.invalid, `${this.label} has truncated ${context}.`);
  }

  sleb(context, maximumBits = 32) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = this.byte(context);
      value += (byte & 0x7f) * (2 ** shift);
      shift += 7;
      if (shift > maximumBits + 7) fail(diagnosticCodes.invalid, `${this.label} ${context} SLEB is too large.`);
    } while ((byte & 0x80) !== 0);
    if (shift < maximumBits && (byte & 0x40)) value -= 2 ** shift;
    return value;
  }

  name(context) {
    const length = this.uleb(`${context} length`);
    try {
      return utf8.decode(this.take(length, context));
    } catch (error) {
      fail(diagnosticCodes.invalid, `${this.label} ${context} is not valid UTF-8.`, { cause: error.message });
    }
  }

  vector(context, readEntry) {
    const count = this.uleb(`${context} count`);
    const result = [];
    for (let index = 0; index < count; index += 1) result.push(readEntry(this, index));
    return result;
  }

  done(context) {
    if (this.offset !== this.end) fail(diagnosticCodes.invalid, `${this.label} ${context} was not fully decoded.`);
  }
}

function valueType(reader, context) {
  const byte = reader.byte(context);
  const name = typeNames.get(byte);
  if (!name) fail(diagnosticCodes.featureMismatch, `${reader.label} uses unsupported value type 0x${byte.toString(16)}.`);
  return name;
}

function limits(reader, context) {
  const flags = reader.uleb(`${context} flags`);
  if (flags !== 0 && flags !== 1 && flags !== 3) {
    fail(diagnosticCodes.featureMismatch, `${reader.label} uses unsupported memory/table limit flags ${flags}.`);
  }
  const minimumPages = reader.uleb(`${context} minimum`);
  const maximumPages = flags & 1 ? reader.uleb(`${context} maximum`) : null;
  return Object.freeze({
    minimumPages,
    maximumPages,
    shared: Boolean(flags & 2)
  });
}

function tableType(reader, context) {
  const element = valueType(reader, `${context} element`);
  return Object.freeze({ element, limits: limits(reader, context) });
}

function globalType(reader, context) {
  return Object.freeze({
    type: valueType(reader, `${context} type`),
    mutable: reader.byte(`${context} mutability`) === 1
  });
}

function initExpression(reader, context) {
  const opcode = reader.byte(`${context} opcode`);
  let instruction;
  let value;
  if (opcode === 0x41) {
    instruction = 'i32.const';
    value = reader.sleb(`${context} i32`, 32);
  } else if (opcode === 0x42) {
    instruction = 'i64.const';
    value = reader.sleb(`${context} i64`, 64);
  } else if (opcode === 0x43) {
    instruction = 'f32.const';
    value = reader.take(4, `${context} f32`).toString('hex');
  } else if (opcode === 0x44) {
    instruction = 'f64.const';
    value = reader.take(8, `${context} f64`).toString('hex');
  } else if (opcode === 0x23) {
    instruction = 'global.get';
    value = reader.uleb(`${context} global index`);
  } else {
    fail(diagnosticCodes.featureMismatch, `${reader.label} uses unsupported initializer opcode 0x${opcode.toString(16)}.`);
  }
  if (reader.byte(`${context} end`) !== 0x0b) fail(diagnosticCodes.invalid, `${reader.label} initializer must end immediately.`);
  return Object.freeze({ instruction, value });
}

function parseModule(bytes, label) {
  if (
    bytes.length < 8
    || bytes.subarray(0, 4).toString('hex') !== '0061736d'
    || bytes.subarray(4, 8).toString('hex') !== '01000000'
  ) {
    fail(diagnosticCodes.invalid, `${label} is not a core WebAssembly v1 module.`);
  }
  const root = new Reader(bytes, label, 8);
  const sections = new Map();
  let lastSectionRank = 0;
  while (root.offset < root.end) {
    const id = root.byte('section id');
    const size = root.uleb('section size');
    root.ensure(size, 'section payload');
    const start = root.offset;
    root.offset += size;
    if (id === 0) continue;
    const rank = sectionRanks.get(id);
    if (!rank) fail(diagnosticCodes.featureMismatch, `${label} uses unsupported section ${id}.`);
    if (rank < lastSectionRank || sections.has(id)) fail(diagnosticCodes.invalid, `${label} has duplicate or out-of-order section ${id}.`);
    lastSectionRank = rank;
    sections.set(id, new Reader(bytes, label, start, start + size));
  }

  const types = [];
  if (sections.has(1)) {
    const reader = sections.get(1);
    types.push(...reader.vector('types', (entry, index) => {
      if (entry.byte(`type ${index} form`) !== 0x60) fail(diagnosticCodes.featureMismatch, `${label} type ${index} is not a function type.`);
      return Object.freeze({
        parameters: Object.freeze(entry.vector(`type ${index} parameters`, (item, itemIndex) => valueType(item, `type ${index} parameter ${itemIndex}`))),
        results: Object.freeze(entry.vector(`type ${index} results`, (item, itemIndex) => valueType(item, `type ${index} result ${itemIndex}`)))
      });
    }));
    reader.done('type section');
  }

  const imports = [];
  const importedFunctionTypes = [];
  const importedMemories = [];
  let importedTables = 0;
  let importedGlobals = 0;
  if (sections.has(2)) {
    const reader = sections.get(2);
    imports.push(...reader.vector('imports', (entry, index) => {
      const module = entry.name(`import ${index} module`);
      const name = entry.name(`import ${index} name`);
      const kind = entry.byte(`import ${index} kind`);
      if (kind === 0) {
        const typeIndex = entry.uleb(`import ${index} function type`);
        const type = types[typeIndex];
        if (!type) fail(diagnosticCodes.invalid, `${label} import ${module}.${name} references missing type ${typeIndex}.`);
        importedFunctionTypes.push(typeIndex);
        return Object.freeze({ module, name, kind: 'function', type });
      }
      if (kind === 1) {
        importedTables += 1;
        return Object.freeze({ module, name, kind: 'table', type: tableType(entry, `import ${index} table`) });
      }
      if (kind === 2) {
        const type = limits(entry, `import ${index} memory`);
        importedMemories.push(type);
        return Object.freeze({ module, name, kind: 'memory', type });
      }
      if (kind === 3) {
        importedGlobals += 1;
        return Object.freeze({ module, name, kind: 'global', type: globalType(entry, `import ${index} global`) });
      }
      fail(diagnosticCodes.featureMismatch, `${label} import ${module}.${name} uses unsupported kind ${kind}.`);
    }));
    reader.done('import section');
  }

  const functionTypeIndexes = [];
  if (sections.has(3)) {
    const reader = sections.get(3);
    functionTypeIndexes.push(...reader.vector('functions', (entry, index) => {
      const typeIndex = entry.uleb(`function ${index} type`);
      if (!types[typeIndex]) fail(diagnosticCodes.invalid, `${label} function ${index} references missing type ${typeIndex}.`);
      return typeIndex;
    }));
    reader.done('function section');
  }

  let definedTables = 0;
  if (sections.has(4)) {
    const reader = sections.get(4);
    definedTables = reader.vector('tables', (entry, index) => tableType(entry, `table ${index}`)).length;
    reader.done('table section');
  }

  const definedMemories = [];
  if (sections.has(5)) {
    const reader = sections.get(5);
    definedMemories.push(...reader.vector('memories', (entry, index) => limits(entry, `memory ${index}`)));
    reader.done('memory section');
  }

  const globals = [];
  if (sections.has(6)) {
    const reader = sections.get(6);
    globals.push(...reader.vector('globals', (entry, index) => Object.freeze({
      ...globalType(entry, `global ${index}`),
      initializer: initExpression(entry, `global ${index} initializer`)
    })));
    reader.done('global section');
  }

  const allFunctionTypes = [...importedFunctionTypes, ...functionTypeIndexes].map((typeIndex) => types[typeIndex]);
  const allMemories = [...importedMemories, ...definedMemories];
  const exports = [];
  if (sections.has(7)) {
    const reader = sections.get(7);
    exports.push(...reader.vector('exports', (entry, index) => {
      const name = entry.name(`export ${index} name`);
      const kindIndex = entry.byte(`export ${index} kind`);
      const itemIndex = entry.uleb(`export ${index} index`);
      const kind = exportKinds[kindIndex];
      if (!kind) fail(diagnosticCodes.featureMismatch, `${label} export ${name} uses unsupported kind ${kindIndex}.`);
      if (kind === 'function') {
        const type = allFunctionTypes[itemIndex];
        if (!type) fail(diagnosticCodes.invalid, `${label} export ${name} references missing function ${itemIndex}.`);
        return Object.freeze({ name, kind, parameters: type.parameters, results: type.results });
      }
      if (kind === 'memory') {
        const type = allMemories[itemIndex];
        if (!type) fail(diagnosticCodes.invalid, `${label} export ${name} references missing memory ${itemIndex}.`);
        return Object.freeze({ name, kind, type });
      }
      return Object.freeze({ name, kind });
    }));
    reader.done('export section');
  }

  let hasStart = false;
  if (sections.has(8)) {
    const reader = sections.get(8);
    reader.uleb('start function');
    reader.done('start section');
    hasStart = true;
  }

  const dataSegments = [];
  if (sections.has(11)) {
    const reader = sections.get(11);
    dataSegments.push(...reader.vector('data segments', (entry, index) => {
      const flags = entry.uleb(`data segment ${index} flags`);
      if (flags !== 0 && flags !== 2) {
        fail(diagnosticCodes.featureMismatch, `${label} data segment ${index} must be active with a literal offset.`);
      }
      const memoryIndex = flags === 2 ? entry.uleb(`data segment ${index} memory`) : 0;
      const offset = initExpression(entry, `data segment ${index} offset`);
      if (offset.instruction !== 'i32.const' || offset.value < 0) {
        fail(diagnosticCodes.memoryMismatch, `${label} data segment ${index} must use a non-negative literal offset.`);
      }
      const length = entry.uleb(`data segment ${index} length`);
      const payload = entry.take(length, `data segment ${index} payload`);
      return Object.freeze({
        index,
        mode: 'active',
        memoryIndex,
        offset: offset.value,
        endExclusive: offset.value + payload.length,
        bytes: payload.length,
        sha256: sha256(payload)
      });
    }));
    reader.done('data section');
  }

  return Object.freeze({
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    functions: functionTypeIndexes.length,
    globals: globals.length + importedGlobals,
    mutableGlobals: Object.freeze(globals
      .map((entry, index) => ({ ...entry, name: `global$${index}` }))
      .filter((entry) => entry.mutable)
      .map((entry) => Object.freeze({
        name: entry.name,
        type: entry.type,
        initializer: entry.initializer
      }))),
    definedMemories: definedMemories.length,
    importedMemories: importedMemories.length,
    memories: allMemories.length,
    memoryTypes: Object.freeze(allMemories),
    definedTables,
    importedTables,
    tables: definedTables + importedTables,
    hasStart,
    dataSegments: Object.freeze(dataSegments)
  });
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

function features(output) {
  return Object.freeze(output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('--enable-'))
    .map((line) => line.slice('--enable-'.length))
    .sort());
}

function safeLabel(value) {
  return String(value || 'module').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'module';
}

function inspectWasmFile(file, options = {}) {
  const label = safeLabel(options.label);
  const workDirectory = options.workDirectory;
  if (!workDirectory || !fs.existsSync(workDirectory) || !fs.statSync(workDirectory).isDirectory()) {
    fail(diagnosticCodes.invalid, 'Wasm inspection requires an existing work directory.');
  }
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    wrap(error, options.failureCode || diagnosticCodes.invalid, `${label} Wasm could not be read.`);
  }
  if (!WebAssembly.validate(bytes)) {
    fail(options.failureCode || diagnosticCodes.invalid, `${label} is not valid WebAssembly.`);
  }

  const featureOutput = path.join(workDirectory, `${label}-feature-check.wasm`);
  const watFile = path.join(workDirectory, `${label}.wat`);
  const featureResult = runTool('wasm-opt', [
    file,
    '--mvp-features',
    '--print-features',
    '-o',
    featureOutput
  ], {
    cwd: workDirectory,
    failureCode: options.featureFailureCode || diagnosticCodes.featureMismatch,
    failureMessage: `${label} uses a feature outside the MVP baseline.`
  });
  runTool('wasm-dis', [
    file,
    '--mvp-features',
    '-o',
    watFile
  ], {
    cwd: workDirectory,
    failureCode: options.failureCode || diagnosticCodes.invalid,
    failureMessage: `${label} could not be independently disassembled.`
  });
  const wat = fs.readFileSync(watFile, 'utf8');
  const parsed = parseModule(bytes, label);
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes),
    valid: true,
    imports: parsed.imports,
    exports: parsed.exports,
    functions: parsed.functions,
    globals: parsed.globals,
    mutableGlobals: parsed.mutableGlobals,
    definedMemories: parsed.definedMemories,
    importedMemories: parsed.importedMemories,
    memories: parsed.memories,
    memoryTypes: parsed.memoryTypes,
    dataSegmentCount: parsed.dataSegments.length,
    dataBytes: parsed.dataSegments.reduce((sum, segment) => sum + segment.bytes, 0),
    dataSegments: parsed.dataSegments,
    definedTables: parsed.definedTables,
    importedTables: parsed.importedTables,
    tables: parsed.tables,
    features: features(featureResult.stdout),
    hasStart: parsed.hasStart,
    instructions: Object.freeze({
      memoryGrow: count(wat, /\(memory\.grow\b/g),
      memoryCopy: count(wat, /\(memory\.copy\b/g),
      memoryFill: count(wat, /\(memory\.fill\b/g),
      memoryInit: count(wat, /\(memory\.init\b/g),
      globalSet: count(wat, /\(global\.set\b/g),
      store: count(wat, /\((?:i32|i64|f32|f64|v128)\.store(?:8|16|32)?\b/g),
      callIndirect: count(wat, /\(call_indirect\b/g)
    })
  });
}

function surfaceImport(entry) {
  if (entry.kind === 'memory') {
    return Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind, type: entry.type });
  }
  if (entry.kind === 'function') {
    return Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind, type: entry.type });
  }
  return Object.freeze({ module: entry.module, name: entry.name, kind: entry.kind });
}

function surfaceExport(entry) {
  if (entry.kind === 'function') {
    return Object.freeze({
      name: entry.name,
      kind: entry.kind,
      parameters: entry.parameters,
      results: entry.results
    });
  }
  return Object.freeze({ name: entry.name, kind: entry.kind });
}

function reportInspection(inspection) {
  return Object.freeze({
    bytes: inspection.bytes,
    sha256: inspection.sha256,
    imports: Object.freeze(inspection.imports.map(surfaceImport)),
    exports: Object.freeze(inspection.exports.map(surfaceExport)),
    definedMemories: inspection.definedMemories,
    importedMemories: inspection.importedMemories,
    memories: inspection.memories,
    memoryTypes: inspection.memoryTypes,
    features: inspection.features,
    hasStart: inspection.hasStart,
    dataSegments: Object.freeze(inspection.dataSegments.map((entry) => Object.freeze({
      memoryIndex: entry.memoryIndex,
      offset: entry.offset,
      endExclusive: entry.endExclusive,
      bytes: entry.bytes,
      sha256: entry.sha256
    }))),
    mutableGlobals: inspection.mutableGlobals,
    tables: inspection.tables,
    instructions: inspection.instructions
  });
}

module.exports = Object.freeze({
  inspectWasmFile,
  reportInspection,
  surfaceImport,
  surfaceExport
});
