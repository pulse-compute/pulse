'use strict';
const { normalizeDiagnostic, sourceLoc } = require('@pulse-compute/wasm-contracts/diagnostics');
const { CANONICAL_PACKAGE_EFFECT_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
const { PACKAGE_CRYPTO_REQUIREMENT_VERSION } = require('@pulse-compute/wasm-contracts/package/package-contract');
const PACKAGE = '@pulse-compute/crypto';
function buildCryptoLoweringPlan(input = {}) {
  const ts = input.typescript || require('typescript');
  const source = input.sourceFile || ts.createSourceFile(input.sourcePath || 'index.ts', input.sourceText || '', ts.ScriptTarget.ES2022, true);
  const namespaces = new Set(), direct = new Set(), diagnostics = [], effects = [];
  const error = (node, suffix, message) => diagnostics.push(normalizeDiagnostic({
    phase: 'crypto-lowering', severity: 'error', code: `PULSEWASM_CRYPTO_DIGEST_${suffix}`, message,
    hint: 'Await crypto.digestText(ctx, text) into a local variable or use it as a direct keyed ctx.parallel member.', loc: sourceLoc(source, node)
  }));
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== PACKAGE || statement.importClause?.isTypeOnly) continue;
    if (statement.importClause?.name) namespaces.add(statement.importClause.name.text);
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const entry of named.elements) {
      if (entry.isTypeOnly) continue;
      const name = (entry.propertyName || entry.name).text;
      if (name === 'crypto') namespaces.add(entry.name.text);
      if (name === 'digestText') direct.add(entry.name.text);
    }
  }
  function checkBinding(name) {
    if (ts.isIdentifier(name)) {
      if (namespaces.has(name.text) || direct.has(name.text)) error(name, 'SHADOWED', 'Imported Crypto bindings cannot be shadowed.');
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) checkBinding(element.name);
    }
  }
  function isDigest(expression) {
    return ts.isIdentifier(expression) && direct.has(expression.text)
      || ts.isPropertyAccessExpression(expression) && expression.name.text === 'digestText'
        && ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text);
  }
  // Verification remains an ordinary JavaScript API. Its existing facade
  // aliases and helpers must not acquire digest-specific authoring restrictions.
  let hasDigestUse = false;
  function findDigestUse(node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (isDigest(node)
      || ts.isPropertyAccessExpression(node) && node.name.text === 'digestText'
      || ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'digestText') hasDigestUse = true;
    ts.forEachChild(node, findDigestUse);
  }
  findDigestUse(source);
  function visit(node) {
    if (ts.isTypeNode(node)) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) checkBinding(node.name);
    if (ts.isIdentifier(node) && namespaces.has(node.text)
      && !ts.isImportClause(node.parent) && !ts.isImportSpecifier(node.parent)
      && !(ts.isPropertyAccessExpression(node.parent))) error(node, 'DETACHED', 'The Crypto facade cannot be detached or accessed dynamically.');
    if (isDigest(node) && !ts.isImportSpecifier(node.parent)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && (!ts.isCallExpression(node.parent) || node.parent.expression !== node)) error(node, 'DETACHED', 'Digest operations cannot be detached or aliased.');
    if (ts.isCallExpression(node) && isDigest(node.expression)) {
      let fn = node.parent;
      while (fn && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
      const ctx = fn && fn.parameters[0] && fn.parameters[0].name;
      if (node.arguments.length !== 2 || !ctx || !ts.isIdentifier(ctx)
        || !ts.isIdentifier(node.arguments[0]) || node.arguments[0].text !== ctx.text) {
        error(node, 'ARGUMENTS', 'Digest requires the current handler context and one text input.'); return;
      }
      let placement = '';
      const parent = node.parent;
      if (ts.isAwaitExpression(parent) && ts.isVariableDeclaration(parent.parent)) placement = 'variable';
      if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
        const call = parent.parent.parent;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
          && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === ctx.text
          && call.expression.name.text === 'parallel' && ts.isAwaitExpression(call.parent)) placement = 'statement';
      }
      if (!placement) { error(node, 'PLACEMENT', 'Digest must be directly awaited or grouped.'); return; }
      effects.push({ version: CANONICAL_PACKAGE_EFFECT_VERSION, contractId: 'pulse.crypto', package: PACKAGE, import: PACKAGE,
        kind: 'crypto.digestText', capability: 'crypto.digestText', result: 'text-digest-result', providerKind: 'crypto', operation: 'digestText', placement,
        range: { start: node.getStart(source), end: node.getEnd() }, resource: {}, payload: {},
        runtimeInputs: [{ name: 'text', argumentIndex: 1, source: 'package-call-argument' }],
        providerRequirements: ['crypto.digestText'], schemaReferences: [], redaction: ['text', 'sha256'], loc: sourceLoc(source, node) });
    }
    ts.forEachChild(node, visit);
  }
  if (hasDigestUse) visit(source);
  const cryptoRequirements = effects.length ? [{ version: PACKAGE_CRYPTO_REQUIREMENT_VERSION, algorithms: ['SHA-256'], reachable: true, requestedBy: PACKAGE, semanticOwner: PACKAGE }] : [];
  return { artifact: { version: 'pulse.crypto-text-lowering-plan.v1', contractId: 'pulse.crypto', package: PACKAGE, lowerableSubpath: PACKAGE,
    status: diagnostics.length ? 'error' : 'ok', canonicalEffects: effects, cryptoRequirements },
    canonicalEffects: effects, cryptoRequirements, diagnostics, hasErrors: diagnostics.length > 0 };
}
module.exports = { buildCryptoLoweringPlan };
