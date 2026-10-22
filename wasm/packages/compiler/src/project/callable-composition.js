'use strict';
const ts = require('typescript');

// Resolve references in one reachable callable through the ordinary project
// resolver. This only adapts bindings; helper computation uses the shared
// source admission, Handler IR, plan validation and generator.
function composeCallable(target, resolver) {
  const fn = target.functionNode, sf = target.sourceFile;
  const helpers = new Map(), locals = new Set(), written = new Set();
  function names(node, into) {
    if (ts.isIdentifier(node)) into.add(node.text);
    else ts.forEachChild(node, child => names(child, into));
  }
  function scan(node) {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      if (node.name) names(node.name, locals);
    }
    ts.forEachChild(node, scan);
  }
  scan(fn);
  function writes(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) names(node.left, written);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) names(node.operand, written);
    ts.forEachChild(node, writes);
  }
  writes(sf);
  if (written.has(target.name)) throw new TypeError('Callable target binding must be unwritten.');
  const result = ts.transform(fn, [context => {
    function visit(node) {
      if (ts.isTypeNode(node)) return node;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !locals.has(node.expression.text)) {
        const resolved = resolver.resolve(target.modulePath, node.expression.text);
        if (resolved && !resolved.packageSource) {
          if (written.has(node.expression.text) || node.questionDotToken || node.typeArguments?.length
            || node.arguments.some(ts.isSpreadElement) || ts.isAwaitExpression(node.parent)
            || node.arguments.length !== resolved.functionNode.parameters.length) throw new TypeError('Pure helper requires an unwritten synchronous static call.');
          let helper = helpers.get(resolved.identity);
          if (!helper) {
            // Generated names cannot capture authored locals or references.
            const identifiers = new Set(); names(fn, identifiers);
            let name = `__pulse_helper_${helpers.size}`;
            while (identifiers.has(name)) name += '_';
            helper = { id: `helper:${resolved.identity}`, name, pure: true,
              functionNode: resolved.functionNode, sourceFile: resolved.sourceFile,
              source: { file: resolved.modulePath, name: resolved.name },
              resolveType: node => resolver.pureType(resolved.modulePath, node) };
            helpers.set(resolved.identity, helper);
          }
          return ts.factory.updateCallExpression(node, ts.factory.createIdentifier(helper.name), undefined, node.arguments.map(arg => ts.visitNode(arg, visit)));
        }
      }
      if (ts.isShorthandPropertyAssignment(node) && !locals.has(node.name.text)) {
        const value = scalar(node.name);
        if (value) return ts.factory.createPropertyAssignment(node.name.text, value);
      }
      if (ts.isIdentifier(node) && !locals.has(node.text)
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        const value = scalar(node);
        if (value) return value;
      }
      return ts.visitEachChild(node, visit, context);
    }
    function scalar(node) {
      const value = resolver.scalar(target.modulePath, node.text);
      if (!value) return;
      if (written.has(node.text)) throw new TypeError('Scalar import must be unwritten.');
      if (ts.isStringLiteral(value)) return ts.factory.createStringLiteral(value.text);
      if (ts.isNumericLiteral(value)) return ts.factory.createNumericLiteral(value.text);
      if (ts.isPrefixUnaryExpression(value)) return ts.factory.createPrefixUnaryExpression(value.operator, ts.factory.createNumericLiteral(value.operand.text));
      return value.kind === ts.SyntaxKind.TrueKeyword ? ts.factory.createTrue() : ts.factory.createFalse();
    }
    return visit;
  }]);
  try {
    return { source: ts.createPrinter().printNode(ts.EmitHint.Unspecified, result.transformed[0], sf), helpers: [...helpers.values()] };
  } finally { result.dispose(); }
}
module.exports = { composeCallable };
