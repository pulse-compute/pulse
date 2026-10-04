'use strict';

// Private planning facts about the existing, normalized S3GetTextResult contract.
// They never change an effect envelope or validate an arbitrary object by shape.
function bind(local, effect) {
  return local.declaration === 'const' && effect.kind === 's3.getText'
    && effect.declaredResult === 's3-get-text-result'
    ? { ...local, textResult: { invalidated: false }, textFound: false } : local;
}

function refine(test, truth, scope) {
  if (test.kind === 'unary' && test.operator === '!') return refine(test.value, !truth, scope);
  if (test.kind !== 'binary') return;
  if (test.operator === (truth ? '&&' : '||')) {
    refine(test.left, truth, scope);
    refine(test.right, truth, scope);
    return;
  }
  if (!['===', '!=='].includes(test.operator) || truth !== (test.operator === '===')) return;
  const read = test.left.kind === 'literal' && test.left.value === 'found' ? test.right
    : test.right.kind === 'literal' && test.right.value === 'found' ? test.left : undefined;
  if (read?.kind !== 'property' || read.property !== 'status' || read.object.kind !== 'local') return;
  const local = scope.get(read.object.name);
  if (local?.id === read.object.id && local.textResult && !local.textResult.invalidated) {
    scope.set(local.name, { ...local, textFound: true });
  }
}

function propertyKind(object, property, scope) {
  if (object.kind !== 'local' || property !== 'text') return;
  const local = scope.get(object.name);
  if (local?.id === object.id && local.textFound && !local.textResult.invalidated) return 'string';
}

function join(scope, thenScope, elseScope, thenReturns, elseReturns) {
  for (const [name, local] of scope) {
    if (!local.textResult || local.textResult.invalidated) continue;
    const yes = thenScope.get(name)?.textFound;
    const no = elseScope.get(name)?.textFound;
    if (thenReturns && no || elseReturns && yes || yes && no) scope.set(name, { ...local, textFound: true });
  }
}

// Property writes may use aliases. Conservatively retire all live result facts,
// including sibling scopes sharing the record, instead of assuming no aliasing.
function invalidate(scope) {
  for (const local of scope.values()) if (local.textResult) local.textResult.invalidated = true;
}

module.exports = { bind, refine, propertyKind, join, invalidate };
