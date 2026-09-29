'use strict';
const ts = require('typescript');
const { createCanonicalDiagnostic } = require('./diagnostic-authority.js');

function validateIncomingBodySource(handler, options) {
  const diagnostics = [];
  let calls = 0, marker, structuredRead = false;
  const ctx = options.ctxName || 'ctx';
  function reject(node, code, message) {
    diagnostics.push(createCanonicalDiagnostic({ ...options, node, code, message }));
  }
  function visit(node) {
    if (ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['text', 'json'].includes(node.expression.name.text)
      && ts.isPropertyAccessExpression(node.expression.expression)
      && node.expression.expression.name.text === 'req'
      && ts.isIdentifier(node.expression.expression.expression)
      && node.expression.expression.expression.text === ctx) structuredRead = true;
    const property = ts.isPropertyAccessExpression(node) && node.name.text === 'body';
    const computed = ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'body';
    if ((property || computed) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'req' && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === ctx) {
      const call = node.parent, field = call?.parent, init = field?.parent, fetch = init?.parent;
      const named = name => init && ts.isObjectLiteralExpression(init) && init.properties.find(p =>
        ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
      const method = named('method');
      calls++;
      marker = node;
      if (computed || !call || !ts.isCallExpression(call) || call.expression !== node || call.arguments.length
        || !field || !ts.isPropertyAssignment(field) || field.initializer !== call || field.name.getText(options.sourceFile) !== 'body'
        || !init || !ts.isObjectLiteralExpression(init) || init.properties.some(p => ts.isSpreadAssignment(p))
        || !fetch || !ts.isCallExpression(fetch) || fetch.arguments[1] !== init
        || !ts.isPropertyAccessExpression(fetch.expression) || !ts.isIdentifier(fetch.expression.expression)
        || fetch.expression.expression.text !== ctx || fetch.expression.name.text !== 'fetch'
        || !method || !ts.isStringLiteral(method.initializer) || method.initializer.text !== 'POST'
        || named('json') || named('schema') || calls > 1) {
        reject(node, 'PULSE_REQUEST_FORWARDING_FORM_UNSUPPORTED', 'Use one ctx.req.body() inline as the body of a literal outbound POST; markers cannot escape, be awaited, or be duplicated.');
      }
      if (options.target !== 'javascript') reject(node, 'PULSE_REQUEST_FORWARDING_UNAVAILABLE', 'Incoming forwarding is currently Node JavaScript only.');
    }
    ts.forEachChild(node, visit);
  }
  visit(handler.body || handler);
  if (marker && structuredRead) reject(marker, 'PULSE_REQUEST_BODY_OWNERSHIP', 'A forwarding handler cannot also project the incoming body as text or JSON.');
  return diagnostics;
}
module.exports = { validateIncomingBodySource };
