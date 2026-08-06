'use strict';

function isTopLevelDefineConfigCall(ts, sourceFile, call) {
  const parent = call.parent;
  if (!parent) return false;
  if (ts.isExportAssignment(parent)) return true;
  if (ts.isVariableDeclaration(parent)) {
    const declList = parent.parent;
    const varStmt = declList && declList.parent;
    return Boolean(varStmt && ts.isVariableStatement(varStmt) && varStmt.parent === sourceFile);
  }
  return false;
}

function collectDefineConfigCalls(ts, sourceFile) {
  const calls = [];
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineConfig') {
      calls.push(node);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return calls;
}

module.exports = {
  collectDefineConfigCalls,
  isTopLevelDefineConfigCall
};
