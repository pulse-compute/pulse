'use strict';
const { normalizeDiagnostic, sourceLoc } = require('@pulse-compute/wasm-contracts/diagnostics');
const { CANONICAL_PACKAGE_EFFECT_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
const { PACKAGE_CRYPTO_REQUIREMENT_VERSION } = require('@pulse-compute/wasm-contracts/package/package-contract');
const { normalizeMacTextOptions } = require('./src/provider.cjs');
const PACKAGE = '@pulse-compute/crypto';
function buildCryptoLoweringPlan(input = {}) {
  const ts = input.typescript || require('typescript');
  const source = input.sourceFile || ts.createSourceFile(input.sourcePath || 'index.ts', input.sourceText || '', ts.ScriptTarget.ES2022, true);
  const namespaces = new Set(), direct = new Map(), diagnostics = [], effects = [];
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
      if (['digestText', 'verifyMacText'].includes(name)) direct.set(entry.name.text, name);
    }
  }
  function checkBinding(name) {
    if (ts.isIdentifier(name)) {
      if (namespaces.has(name.text) || direct.has(name.text)) error(name, 'SHADOWED', 'Imported Crypto bindings cannot be shadowed.');
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) checkBinding(element.name);
    }
  }
  function operation(expression) {
    if (ts.isIdentifier(expression)) return direct.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
      && namespaces.has(expression.expression.text) && ['digestText', 'verifyMacText'].includes(expression.name.text)) return expression.name.text;
    return null;
  }
  const isTextOperation = expression => !!operation(expression);
  function staticObject(node, depth = 0) {
    if (depth > 1 || !node || !ts.isObjectLiteralExpression(node)) return null;
    const result = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return null;
      const name = property.name.text;
      if (Object.hasOwn(result, name)) return null;
      const value = property.initializer;
      result[name] = ts.isStringLiteral(value) ? value.text : staticObject(value, depth + 1);
    }
    return result;
  }
  const macError = (node, suffix, message) => diagnostics.push(normalizeDiagnostic({
    phase: 'crypto-lowering', severity: 'error', code: `PULSEWASM_CRYPTO_MAC_TEXT_${suffix}`, message,
    hint: 'Await crypto.verifyMacText(ctx, message, tag, { algorithm: "HS256", key: { type: "secret", binding: "NAME" } }) into a local.', loc: sourceLoc(source, node)
  }));
  // Raw-byte verification remains ordinary JavaScript. Only the request-owned
  // text operations acquire these import-identity restrictions.
  let hasTextUse = false;
  function findTextUse(node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
    if (isTextOperation(node)
      || ts.isPropertyAccessExpression(node) && ['digestText', 'verifyMacText'].includes(node.name.text)
      || ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && ['digestText', 'verifyMacText'].includes(node.argumentExpression.text)) hasTextUse = true;
    ts.forEachChild(node, findTextUse);
  }
  findTextUse(source);
  function visit(node) {
    if (ts.isTypeNode(node)) return;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) checkBinding(node.name);
    if (ts.isIdentifier(node) && namespaces.has(node.text)
      && !ts.isImportClause(node.parent) && !ts.isImportSpecifier(node.parent)
      && !(ts.isPropertyAccessExpression(node.parent))) error(node, 'DETACHED', 'The Crypto facade cannot be detached or accessed dynamically.');
    if (isTextOperation(node) && !ts.isImportSpecifier(node.parent)
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && (!ts.isCallExpression(node.parent) || node.parent.expression !== node)) error(node, 'DETACHED', 'Crypto text operations cannot be detached or aliased.');
    if (ts.isCallExpression(node) && isTextOperation(node.expression)) {
      const isMac = operation(node.expression) === 'verifyMacText';
      const report = isMac ? macError : error;
      let fn = node.parent;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      const supportedFunction = fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn));
      const ctx = supportedFunction && fn.parameters[0] && fn.parameters[0].name;
      if (node.arguments.length !== (isMac ? 4 : 2) || !ctx || !ts.isIdentifier(ctx)
        || !ts.isIdentifier(node.arguments[0]) || node.arguments[0].text !== ctx.text) {
        report(node, 'ARGUMENTS', isMac ? 'MAC verification requires the current handler context, message, tag and static options.' : 'Digest requires the current handler context and one text input.'); return;
      }
      let placement = '';
      const parent = node.parent;
      if (ts.isAwaitExpression(parent) && ts.isVariableDeclaration(parent.parent)) placement = 'variable';
      if (!isMac && ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
        const call = parent.parent.parent;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
          && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === ctx.text
          && call.expression.name.text === 'parallel' && ts.isAwaitExpression(call.parent)) placement = 'statement';
      }
      if (!placement) { report(node, 'PLACEMENT', isMac ? 'MAC verification must be directly awaited into a local.' : 'Digest must be directly awaited or grouped.'); return; }
      if (isMac) {
        const options = normalizeMacTextOptions(staticObject(node.arguments[3]));
        if (!options) { macError(node, 'OPTIONS', 'MAC verification requires exact static HS256 options and a bounded named secret descriptor.'); return; }
        effects.push({ version: CANONICAL_PACKAGE_EFFECT_VERSION, contractId: 'pulse.crypto', package: PACKAGE, import: PACKAGE,
          kind: 'crypto.verifyMacText', capability: 'crypto.verifyMacText', result: 'mac-text-verification', providerKind: 'crypto', operation: 'verifyMacText', placement,
          range: { start: node.getStart(source), end: node.getEnd() }, resource: { keyType: 'secret', secretBinding: options.key.binding }, payload: options,
          runtimeInputs: [{ name: 'message', argumentIndex: 1, source: 'package-call-argument' }, { name: 'tag', argumentIndex: 2, source: 'package-call-argument' }],
          providerRequirements: ['crypto.verifyMacText', 'secret.get'], schemaReferences: [], redaction: ['message', 'tag', 'key'], loc: sourceLoc(source, node) });
        return;
      }
      effects.push({ version: CANONICAL_PACKAGE_EFFECT_VERSION, contractId: 'pulse.crypto', package: PACKAGE, import: PACKAGE,
        kind: 'crypto.digestText', capability: 'crypto.digestText', result: 'text-digest-result', providerKind: 'crypto', operation: 'digestText', placement,
        range: { start: node.getStart(source), end: node.getEnd() }, resource: {}, payload: {},
        runtimeInputs: [{ name: 'text', argumentIndex: 1, source: 'package-call-argument' }],
        providerRequirements: ['crypto.digestText'], schemaReferences: [], redaction: ['text', 'sha256'], loc: sourceLoc(source, node) });
    }
    ts.forEachChild(node, visit);
  }
  if (hasTextUse) visit(source);
  const cryptoRequirements = effects.length ? [{ version: PACKAGE_CRYPTO_REQUIREMENT_VERSION, algorithms: [...new Set(effects.map(effect => effect.operation === 'verifyMacText' ? 'HS256' : 'SHA-256'))].sort(), reachable: true, requestedBy: PACKAGE, semanticOwner: PACKAGE }] : [];
  return { artifact: { version: 'pulse.crypto-text-lowering-plan.v1', contractId: 'pulse.crypto', package: PACKAGE, lowerableSubpath: PACKAGE,
    status: diagnostics.length ? 'error' : 'ok', canonicalEffects: effects, cryptoRequirements },
    canonicalEffects: effects, cryptoRequirements, diagnostics, hasErrors: diagnostics.length > 0 };
}
module.exports = { buildCryptoLoweringPlan };
