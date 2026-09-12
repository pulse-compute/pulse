'use strict';
const { normalizeDiagnostic, sourceLoc } = require('@pulse-compute/wasm-contracts/diagnostics');
const { CANONICAL_PACKAGE_EFFECT_VERSION } = require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
const { PACKAGE_CRYPTO_REQUIREMENT_VERSION } = require('@pulse-compute/wasm-contracts/package/package-contract');
const { S3_PACKAGE, S3_CONTRACT_ID, S3_OPERATIONS, S3_LOWERING_PLAN_VERSION, S3_CRYPTO_ALGORITHMS } = require('@pulse-compute/wasm-contracts/s3/contracts');
const { normalizePutOptions } = require('./src/provider.js');

function buildS3LoweringPlan(input = {}) {
  const ts = input.typescript || require('typescript');
  const source = input.sourceFile || ts.createSourceFile(input.sourcePath || 'index.ts', input.sourceText || '', ts.ScriptTarget.ES2022, true);
  const namespaces = new Set();
  const diagnostics = [];
  const effects = [];
  const error = (node, suffix, message) => diagnostics.push(normalizeDiagnostic({
    phase: 's3-lowering', severity: 'error', code: `PULSEWASM_S3_${suffix}`, message,
    hint: 'Use a supported s3 call with literal binding/options and runtime key/text in an awaited handler position.', loc: sourceLoc(source, node)
  }));
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== S3_PACKAGE) continue;
    const named = statement.importClause && statement.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) { error(statement, 'IMPORT_UNSUPPORTED', 'Import the named s3 facade.'); continue; }
    for (const entry of named.elements) {
      if ((entry.propertyName || entry.name).text !== 's3') error(entry, 'IMPORT_UNSUPPORTED', 'Only the s3 facade is lowerable.');
      else namespaces.add(entry.name.text);
    }
  }
  function visit(node) {
    if (ts.isIdentifier(node) && namespaces.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      const access = node.parent;
      if (!ts.isPropertyAccessExpression(access) || access.expression !== node || !ts.isCallExpression(access.parent) || access.parent.expression !== access) {
        error(node, 'FACADE_UNSUPPORTED', 'S3 facade methods cannot be detached or aliased.');
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && namespaces.has(node.expression.expression.text)) {
      const method = node.expression.name.text;
      const op = S3_OPERATIONS[method];
      if (!op) { error(node, 'OPERATION_UNSUPPORTED', 'S3 supports head, getText and putText.'); return; }
      const put = method === 'putText';
      let fn = node.parent;
      while (fn && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
      const ctx = fn && fn.parameters[0] && fn.parameters[0].name;
      if (!(put ? [4, 5].includes(node.arguments.length) : node.arguments.length === 3) || !ctx || !ts.isIdentifier(ctx)
        || !ts.isIdentifier(node.arguments[0]) || node.arguments[0].text !== ctx.text) {
        error(node, 'ARGUMENTS_UNSUPPORTED', 'S3 requires current handler context, literal binding, runtime key and, for PUT, text with optional literal options.'); return;
      }
      const binding = node.arguments[1];
      if (!ts.isStringLiteralLike(binding) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(binding.text)) {
        error(binding, 'BINDING_UNSUPPORTED', 'S3 binding must be a valid literal logical name.'); return;
      }
      let options = {};
      if (put) {
        const nodeOptions = node.arguments[4];
        try {
          if (nodeOptions) {
            if (!ts.isObjectLiteralExpression(nodeOptions) || nodeOptions.properties.length > 1) throw new TypeError();
            for (const property of nodeOptions.properties) {
              if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) && !ts.isStringLiteralLike(property.name)
                || property.name.text !== 'contentType' || !ts.isStringLiteralLike(property.initializer)) throw new TypeError();
              options.contentType = property.initializer.text;
            }
          }
          options = normalizePutOptions(options);
        } catch { error(nodeOptions || node, 'OPTIONS_UNSUPPORTED', 'PUT options must be a literal object containing only a valid literal contentType.'); return; }
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
      if (!placement) { error(node, 'PLACEMENT_UNSUPPORTED', 'Await S3 into a local variable or a direct keyed ctx.parallel member.'); return; }
      effects.push({
        version: CANONICAL_PACKAGE_EFFECT_VERSION, contractId: S3_CONTRACT_ID, package: S3_PACKAGE, import: S3_PACKAGE,
        ...op, providerKind: 's3', operation: method, placement,
        range: { start: node.getStart(source), end: node.getEnd() },
        resource: { binding: binding.text }, payload: { binding: binding.text, ...options },
        runtimeInputs: [{ name: 'key', argumentIndex: 2, source: 'package-call-argument' }, ...(put ? [{ name: 'text', argumentIndex: 3, source: 'package-call-argument' }] : [])],
        providerRequirements: [op.kind, 'secret.get', 'time.wall-clock'], schemaReferences: [],
        redaction: ['key', 'text', 'sha256', 'etag', 'contentType'], loc: sourceLoc(source, node)
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const cryptoRequirements = effects.length ? [{ version: PACKAGE_CRYPTO_REQUIREMENT_VERSION, algorithms: S3_CRYPTO_ALGORITHMS, reachable: true, requestedBy: S3_PACKAGE, semanticOwner: '@pulse-compute/crypto' }] : [];
  return {
    artifact: { version: S3_LOWERING_PLAN_VERSION, contractId: S3_CONTRACT_ID, package: S3_PACKAGE, lowerableSubpath: S3_PACKAGE,
      status: diagnostics.length ? 'error' : 'ok', canonicalEffects: effects, cryptoRequirements },
    canonicalEffects: effects, cryptoRequirements, diagnostics, hasErrors: diagnostics.length > 0
  };
}
module.exports = { buildS3LoweringPlan };
