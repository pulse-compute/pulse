'use strict';
// Internal proof frontend, deliberately not an authoring export. This adapts a
// parameter binding, then delegates the whole body to ordinary admission/lowering.
const ts = require('typescript');
const crypto = require('node:crypto');
const { compileCanonicalSource } = require('./canonical-api-compiler');
const { buildCanonicalNativePlan, validateCanonicalNativePlan, stableStringify } = require('./canonical-native-plan');
const { VERSION } = require('./callable-plan');
function seal(plan) {
  delete plan.planHash;
  plan.planHash = crypto.createHash('sha256').update(stableStringify(plan)).digest('hex');
  validateCanonicalNativePlan(plan);
  return plan;
}
function compileCallable(source, { inputSchema, outputSchema, schemaBundle, binaryResources, fileName = 'callable.ts' }) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fn = sf.statements[0];
  if (sf.statements.length !== 1 || !ts.isFunctionDeclaration(fn) || !fn.name || !fn.body || fn.asteriskToken || fn.typeParameters?.length
    || fn.parameters.length !== 2 || fn.parameters.some(p => !ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken)
    || fn.parameters[0].name.text === fn.parameters[1].name.text) throw new TypeError('Callable proof requires one named (ctx, input) function; imports and nested calls are not yet admitted.');
  const ctx = fn.parameters[0].name.text, input = fn.parameters[1].name.text;
  const printer = ts.createPrinter();
  const body = fn.body.statements.map(s => printer.printNode(ts.EmitHint.Unspecified, s, sf)).join('\n');
  const compiled = compileCanonicalSource(`export default async function handler(${ctx}) { const ${input} = undefined;\n${body}\n}`, { fileName, target:'native', strict:true, schemaBundle });
  const plan = JSON.parse(JSON.stringify(buildCanonicalNativePlan(compiled, { binaryResources })));
  const binding = plan.entry.body[0];
  if (binding.kind !== 'local' || binding.name !== input || binding.value.kind !== 'undefined') throw new Error('Callable parameter normalization drift');
  binding.value = { kind:'callable-input', valueKind:'object' };
  binding.valueKind = 'object';
  plan.locals.find(l => l.id === binding.localId).valueKind = 'object';
  const visit = n => { if (!n || typeof n !== 'object') return; if (n.kind === 'local' && n.id === binding.localId) n.valueKind = 'object'; for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v); };
  visit(plan.entry);
  plan.callable = { version:VERSION, inputLocalId:binding.localId, inputSchema, outputSchema };
  return seal(plan);
}
module.exports = { compileCallable, seal };
