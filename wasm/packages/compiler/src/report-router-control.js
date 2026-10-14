'use strict';

// Project only accepted canonical operations. No AST text, predicates, provider
// values or generated positions enter the report, and no runtime IR is changed.
function projectRouterControl(entry, rawEntry, ir) {
  const unavailable = { state: 'unavailable', value: null, reason: 'not-recorded' };
  const value = { pattern: null, eligibility: Boolean(rawEntry.eligibility),
    normal: false, error: false, terminal: false, basis: 'canonical-router-control' };
  if (entry.kind === 'route' || entry.kind === 'mount' || entry.kind === 'use' && entry.scoped) {
    if (!rawEntry.pattern?.normalized) return unavailable;
    value.pattern = rawEntry.pattern.normalized;
  }
  if (entry.kind === 'mount' || !entry.handlerId) value.normal = true;
  else {
    if (!ir?.body) return unavailable;
    let known = true;
    function visit(operation) {
      if (!operation) return;
      switch (operation.kind) {
        case 'block': operation.statements.forEach(visit); break;
        case 'if': visit(operation.thenOperation); visit(operation.elseOperation); break;
        case 'router-guard': visit(operation.body); break;
        case 'router-transfer':
          if (operation.clearNormalMode) value.normal = true;
          else if (operation.errorExpression) value.error = true;
          else known = false;
          break;
        case 'source-statement':
          if (operation.role === 'router-return') value.terminal = true;
          else if (operation.role !== 'router-source') known = false;
          break;
        default: known = false;
      }
    }
    visit(ir.body);
    if (entry.kind === 'event') value.terminal = true; // Accepted void fallthrough.
    if (!known || !value.normal && !value.error && !value.terminal) return unavailable;
  }
  return { state: 'available', value, reason: null };
}

module.exports = { projectRouterControl };
