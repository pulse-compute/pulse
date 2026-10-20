'use strict';
// Internal proof frontend, deliberately not an authoring export. This adapts a
// parameter binding, then delegates the whole body to ordinary admission/lowering.
const ts = require('typescript');
const crypto = require('node:crypto');
const { compileCanonicalSource } = require('./canonical-api-compiler');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('./canonical-native-plan');
function seal(plan) {
  delete plan.planHash;
  plan.planHash = crypto.createHash('sha256').update(stableStringify(plan)).digest('hex');
  validateCanonicalNativePlan(plan);
  return plan;
}
function compileCallable(source, { inputSchema, outputSchema, schemaBundle, binaryResources, fileName = 'callable.ts', helpers = [] }) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = sf.statements[0];
  if (sf.statements.length !== 1 || !ts.isFunctionDeclaration(fn) || !fn.name || !fn.body || fn.asteriskToken || fn.typeParameters?.length
    || fn.parameters.length !== 2 || fn.parameters.some(p => !ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken)
    || fn.parameters[0].name.text === fn.parameters[1].name.text) throw new TypeError('Callable proof requires one named (ctx, input) function; the project linker supplies admitted helpers separately.');
  const ctx = fn.parameters[0].name.text, input = fn.parameters[1].name.text;
  const printer = ts.createPrinter();
  const body = fn.body.statements.map(s => printer.printNode(ts.EmitHint.Unspecified, s, sf)).join('\n');
  let synthetic = `export default async function handler(${ctx}) { `;
  const descriptors = [];
  for (const helper of helpers) {
    const emitted = require('./spine/pure-helper-source').emitPureHelper(helper, synthetic.length);
    synthetic += emitted.source;
    descriptors.push(emitted.descriptor);
  }
  synthetic += `const ${input} = undefined;\n${body}\n}`;
  const compiled = compileCanonicalSource(synthetic, { fileName, target: 'native', strict: true, schemaBundle,
    ...(helpers.length ? { internalGeneratedHandler: true, metadataExtensions: { sourceHelpers: descriptors } } : {}) });
  return buildCanonicalNativePlan(compiled, { binaryResources, callableBoundary: { inputName: input, inputSchema, outputSchema } });
}
module.exports = { compileCallable, seal };
