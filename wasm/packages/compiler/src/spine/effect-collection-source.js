'use strict';

const ts = require('typescript');
const { unwrapExpression, extractParallelCall } = require('./handler-surface-authority.js');

function collectionDeclaration(statement, ctxName) {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return;
  const declaration = statement.declarationList.declarations[0];
  const call = declaration.initializer && unwrapExpression(declaration.initializer);
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
    || !ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== ctxName || call.expression.name.text !== 'effects') return;
  return { statement, declaration, call };
}

// The build region is deliberately straight-line: declaration, one for-of,
// immediate flush. This owns source admission, not a general loop scheduler.
function inspectCollection(statements, index, ctxName) {
  const found = collectionDeclaration(statements[index], ctxName);
  if (!found) return;
  const { statement, declaration, call } = found;
  const bad = message => ({ ...found, error: message });
  if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !ts.isIdentifier(declaration.name)) return bad('Collection requires a local const identifier.');
  const options = call.arguments[0];
  const maxField = options && ts.isObjectLiteralExpression(options) && options.properties.length === 1 && options.properties[0];
  const max = maxField && ts.isPropertyAssignment(maxField) && maxField.name.getText() === 'max' && ts.isNumericLiteral(maxField.initializer) && Number(maxField.initializer.text);
  if (call.arguments.length !== 1 || !Number.isInteger(max) || max < 1 || max > 32) return bad('Collection max must be a literal integer from 1 to 32.');
  const loop = statements[index + 1], flush = statements[index + 2];
  if (!loop || !ts.isForOfStatement(loop) || loop.awaitModifier || !ts.isVariableDeclarationList(loop.initializer)
    || !(loop.initializer.flags & ts.NodeFlags.Const) || loop.initializer.declarations.length !== 1 || !ts.isIdentifier(loop.initializer.declarations[0].name)) return bad('Collection requires one direct const for-of build loop.');
  const input = unwrapExpression(loop.expression);
  function path(node) { return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) && path(node.expression); }
  if (!path(input)) return bad('Collection input must be an already available array local or property path.');
  const body = ts.isBlock(loop.statement) ? loop.statement.statements : [loop.statement];
  const add = body.length === 1 && ts.isExpressionStatement(body[0]) && body[0].expression;
  const name = declaration.name.text;
  if (!add || !ts.isCallExpression(add) || add.arguments.length !== 1 || !ts.isPropertyAccessExpression(add.expression)
    || !ts.isIdentifier(add.expression.expression) || add.expression.expression.text !== name || add.expression.name.text !== 'add') return bad('Collection loop requires exactly one direct inline add and no other statements.');
  let unsafe = false;
  function argumentsOnly(node) {
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
      || ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      || ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) unsafe = true;
    if (ts.isCallExpression(node)) {
      // Only the member receiver chain may call; argument calls require a
      // separate evaluation before entering this bounded build region.
      for (const arg of node.arguments) {
        function scan(n) { if (ts.isCallExpression(n)) unsafe = true; ts.forEachChild(n, scan); }
        scan(arg);
      }
    }
    ts.forEachChild(node, argumentsOnly);
  }
  argumentsOnly(add.arguments[0]);
  if (unsafe) return bad('Collection member arguments cannot await, mutate or call helpers.');
  const result = flush && ts.isVariableStatement(flush) && flush.declarationList.declarations.length === 1 && flush.declarationList.declarations[0];
  const parallel = result?.initializer && extractParallelCall(result.initializer, ctxName, { unwrap: true, unwrapAwait: true });
  if (!result || !(flush.declarationList.flags & ts.NodeFlags.Const) || !ts.isIdentifier(result.name) || !parallel
    || parallel.argumentCount !== 1 || !ts.isIdentifier(parallel.record) || parallel.record.text !== name) return bad('Collection must be flushed once into a const result immediately after the build loop.');
  return { ...found, name, max, loop, input, item: loop.initializer.declarations[0].name.text, add, flush, result, parallel };
}

function collectRegions(root, ctxName, options = {}) {
  const regions = [], errors = [], declarations = new Set();
  function visit(node) {
    if (ts.isBlock(node)) for (let i = 0; i < node.statements.length; i++) {
      const region = inspectCollection(node.statements, i, ctxName);
      if (!region) continue;
      declarations.add(region.call);
      if (region.error) errors.push({ node: region.statement, message: region.error });
      else {
        regions.push(region);
        if (options.requireAwait !== false && !ts.isAwaitExpression(unwrapExpression(region.result.initializer))) errors.push({ node: region.flush, message: 'Collection flush must be explicitly awaited.' });
        const allowed = new Set([region.declaration.name, region.add.expression.expression, region.parallel.record]);
        function refs(n) {
          if (ts.isIdentifier(n) && n.text === region.name && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !allowed.has(n)) errors.push({ node: n, message: 'Collection handles cannot escape or be reused.' });
          ts.forEachChild(n, refs);
        }
        refs(node);
        i += 2;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  function unmatched(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === ctxName
      && node.expression.name.text === 'effects' && !declarations.has(node)) {
      errors.push({ node, message: 'Collection creation requires a local const build region.' });
    }
    ts.forEachChild(node, unmatched);
  }
  unmatched(root);
  return { regions, errors };
}

function substituteItem(expression, item, input, index) {
  const transformed = ts.transform(expression, [context => root => {
    function visit(node) {
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === item) {
        return ts.factory.createPropertyAssignment(node.name,
          ts.factory.createElementAccessExpression(input, ts.factory.createNumericLiteral(index)));
      }
      if (ts.isIdentifier(node) && node.text === item
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        return ts.factory.createElementAccessExpression(input, ts.factory.createNumericLiteral(index));
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(root, visit);
  }]);
  const result = transformed.transformed[0]; transformed.dispose(); return result;
}
module.exports = { collectionDeclaration, inspectCollection, collectRegions, substituteItem };
