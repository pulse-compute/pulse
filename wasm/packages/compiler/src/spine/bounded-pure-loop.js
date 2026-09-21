'use strict';

const ts = require('typescript');
function loadContract() {
  try { return require('@pulse-compute/wasm-contracts/handler/canonical-native-plan'); }
  catch (error) {
    if (error && ['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) return require('../../../contracts/src/handler/canonical-native-plan.js');
    throw error;
  }
}
const { CANONICAL_PURE_LOOP_LIMITS, CANONICAL_READ_LOOP_CONTRACT } = loadContract();

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
}
function number(node, expected) {
  node = unwrap(node);
  return node && ts.isNumericLiteral(node) && Number(node.text) === expected;
}
function named(node, name) { node = unwrap(node); return node && ts.isIdentifier(node) && node.text === name; }
function firstConjunct(node) {
  node = unwrap(node);
  while (node && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) node = unwrap(node.left);
  return node;
}

// Shared admission for original-source JavaScript and generated Native plans.
// The literal bound is the first conjunct, so the terminating test cannot run
// extra application expressions after the counter reaches its cap.
function inspectBoundedPureLoop(statement, options = {}) {
  const errors = [];
  let loopDepth = 0;
  let effectCount = 0;
  let checkingHeader = false;
  const readBody = () => options.readLoop === true && loopDepth === 1 && !checkingHeader;
  const protectedNames = new Set(options.readLoop ? [options.ctxName, ...(options.namespaceAliases || [])] : []);
  function fail(node, message) { errors.push({ node, message }); }
  function expression(input, counters, mutation = true, effectRoot = false) {
    let node = unwrap(input);
    if (!node) return;
    if (readBody() && effectRoot && ts.isAwaitExpression(node)) node = unwrap(node.expression);
    if (ts.isIdentifier(node)) {
      if (node.text === options.ctxName) fail(node, 'Read context values before entering a pure loop.');
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)
      || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return;
    if (ts.isPropertyAccessExpression(node)) {
      if (node.questionDotToken) fail(node, 'Optional access is outside the bounded pure loop subset.');
      expression(node.expression, counters, mutation); return;
    }
    if (ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) fail(node, 'Optional access is outside the bounded pure loop subset.');
      expression(node.expression, counters, mutation); expression(node.argumentExpression, counters, mutation); return;
    }
    if (ts.isCallExpression(node)) {
      const target = unwrap(node.expression);
      const effect = readBody() && options.effectForCall && options.effectForCall(node);
      if (effect) {
        if (!effectRoot || !CANONICAL_READ_LOOP_CONTRACT.effectKinds.includes(effect.kind)) {
          fail(node, 'Read loops admit only directly bound or discarded sequential s3.getText, kv.getVersioned and crypto.digestText effects.'); return;
        }
        effectCount += 1;
        for (const argument of node.arguments) {
          // Package facades receive the context as their first argument.
          if (!named(argument, options.ctxName)) expression(argument, counters, false);
        }
        // A direct KV namespace expression is also evaluated at the call site.
        if (ts.isPropertyAccessExpression(target) && ts.isCallExpression(unwrap(target.expression))) {
          for (const argument of unwrap(target.expression).arguments) expression(argument, counters, false);
        }
        return;
      }
      if (readBody() && ts.isPropertyAccessExpression(target) && named(target.expression, options.ctxName)
        && ['decodeJson', 'encodeJson', 'text', 'json', 'response'].includes(target.name.text) && !node.questionDotToken && !target.questionDotToken) {
        for (const argument of node.arguments) expression(argument, counters, mutation);
        return;
      }
      if (!ts.isPropertyAccessExpression(target) || target.name.text !== 'trim' || node.arguments.length || node.questionDotToken || target.questionDotToken) {
        fail(node, 'Pure loops admit only zero-argument string .trim() calls; effects, helpers and callbacks are separate contracts.'); return;
      }
      expression(target.expression, counters, false); return;
    }
    if (ts.isBinaryExpression(node)) {
      const assignment = node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      const target = unwrap(node.left);
      if (assignment && !ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) fail(node, 'Destructuring assignment is outside the pure loop subset.');
      if (assignment && (!mutation || [...counters, ...protectedNames].some(name => named(node.left, name)))) fail(node, 'Loop tests cannot mutate values, and active counters or context/namespace aliases cannot be assigned in the body.');
      expression(node.left, counters, mutation); expression(node.right, counters, mutation); return;
    }
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      const update = node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken;
      if (update && (!mutation || [...counters, ...protectedNames].some(name => named(node.operand, name)))) fail(node, 'Loop tests cannot mutate values, and active counters or context/namespace aliases cannot be updated in the body.');
      expression(node.operand, counters, mutation); return;
    }
    if (ts.isConditionalExpression(node)) {
      expression(node.condition, counters, mutation); expression(node.whenTrue, counters, mutation); expression(node.whenFalse, counters, mutation); return;
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) { expression(node.expression, counters, mutation); return; }
    if (ts.isArrayLiteralExpression(node)) {
      for (const item of node.elements) expression(ts.isSpreadElement(item) ? item.expression : item, counters, mutation);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) expression(item.expression, counters, mutation);
        else if (ts.isShorthandPropertyAssignment(item)) expression(item.name, counters, mutation);
        else if (ts.isPropertyAssignment(item)) {
          if (ts.isComputedPropertyName(item.name)) expression(item.name.expression, counters, mutation);
          expression(item.initializer, counters, mutation);
        } else fail(item, 'Methods and accessors are outside pure loop values.');
      }
      return;
    }
    if (ts.isTemplateExpression(node)) { for (const span of node.templateSpans) expression(span.expression, counters, mutation); return; }
    fail(node, `${ts.SyntaxKind[node.kind]} is outside bounded pure loop expressions.`);
  }
  function body(node, counters, product) {
    if (ts.isBlock(node)) { for (const child of node.statements) body(child, counters, product); return; }
    if (ts.isForStatement(node)) { loop(node, counters, product); return; }
    if (ts.isVariableStatement(node)) {
      if (!(node.declarationList.flags & ts.NodeFlags.BlockScoped)) fail(node, 'Pure loop locals must use let or const.');
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || counters.has(declaration.name.text) || protectedNames.has(declaration.name.text)) fail(declaration, 'Loop locals require identifiers and cannot shadow active counters or context/namespace aliases.');
        if (declaration.initializer) expression(declaration.initializer, counters, true, readBody() && node.declarationList.declarations.length === 1);
      }
      return;
    }
    if (ts.isIfStatement(node)) {
      expression(node.expression, counters); body(node.thenStatement, counters, product);
      if (node.elseStatement) body(node.elseStatement, counters, product); return;
    }
    if (ts.isExpressionStatement(node)) { expression(node.expression, counters, true, readBody()); return; }
    if (readBody() && ts.isReturnStatement(node)) { expression(node.expression, counters); return; }
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      if (node.label) fail(node, 'Pure loop break and continue must be unlabelled.');
      return;
    }
    if (ts.isEmptyStatement(node)) return;
    fail(node, 'Pure loop bodies accept locals, value assignments, if/else, nested bounded for, break and continue only.');
  }
  function loop(node, inherited, product) {
    const isReadLoop = options.readLoop === true && loopDepth === 0;
    const list = node.initializer;
    const declaration = list && ts.isVariableDeclarationList(list) && list.declarations.length === 1 && list.declarations[0];
    if (!declaration || !(list.flags & ts.NodeFlags.Let) || !ts.isIdentifier(declaration.name) || !number(declaration.initializer, 0)) {
      fail(node, 'A bounded pure loop starts with for (let index = 0; ...; index++).'); return;
    }
    const name = declaration.name.text;
    const bound = firstConjunct(node.condition);
    if (!bound || !ts.isBinaryExpression(bound) || !named(bound.left, name) || bound.operatorToken.kind !== ts.SyntaxKind.LessThanToken || !ts.isNumericLiteral(unwrap(bound.right))) {
      fail(node, 'The first loop condition must be index < a literal iteration cap.'); return;
    }
    const maxIterations = Number(unwrap(bound.right).text);
    if (!Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > (isReadLoop ? CANONICAL_READ_LOOP_CONTRACT.maxIterations : CANONICAL_PURE_LOOP_LIMITS.maxIterations) || product * Math.max(1, maxIterations) > CANONICAL_PURE_LOOP_LIMITS.maxNestedIterations) {
      fail(node, 'The literal loop cap or nested iteration product exceeds the portable limit.'); return;
    }
    const increment = unwrap(node.incrementor);
    if (!increment || !((ts.isPostfixUnaryExpression(increment) || ts.isPrefixUnaryExpression(increment)) && increment.operator === ts.SyntaxKind.PlusPlusToken && named(increment.operand, name))
      && !(ts.isBinaryExpression(increment) && increment.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken && named(increment.left, name) && number(increment.right, 1))) {
      fail(node, 'The loop increment must be index++ or index += 1.'); return;
    }
    if (inherited.has(name) || protectedNames.has(name)) fail(declaration, 'Nested loop counters cannot shadow active counters or context/namespace aliases.');
    const counters = new Set([...inherited, name]);
    // Header tests retain the pure value contract, including no effects.
    const previousHeader = checkingHeader;
    checkingHeader = true;
    expression(node.condition, counters, false);
    checkingHeader = previousHeader;
    if (!options.headerOnly) {
      loopDepth += 1;
      body(node.statement, counters, product * Math.max(1, maxIterations));
      loopDepth -= 1;
    }
    return { name, maxIterations };
  }
  const result = loop(statement, new Set(), 1);
  if (options.readLoop && !options.headerOnly && !effectCount) fail(statement, 'A bounded read loop requires at least one admitted sequential effect site.');
  return { ...result, errors, effectCount };
}

function inspectBoundedReadLoop(statement, options = {}) {
  return inspectBoundedPureLoop(statement, { ...options, readLoop: true });
}

module.exports = { inspectBoundedPureLoop, inspectBoundedReadLoop };
