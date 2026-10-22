'use strict';
function validateNumericWorkspaces(plan, fail, walkExpression) {
  const records = plan.numericWorkspaces || [];
  if (!Array.isArray(records) || records.length > 4) { fail('workspace table must contain at most four records'); return; }
  const ids = new Set();
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || !Number.isInteger(r.capacity) || r.capacity < 1 || r.capacity > 1024) fail('invalid numeric workspace capacity or identity');
    ids.add(r?.id);
  }
  const initialized = new Set();
  function expression(e, live, initializer = false) {
    walkExpression(e, node => {
      if (['assignment', 'update'].includes(node.kind) && node.target?.kind === 'workspace-read') fail('workspace writes require their dedicated operation');
      if (!['workspace-init', 'workspace-read', 'workspace-write'].includes(node.kind)) return;
      if (node.version !== 'pulse.numeric-workspace.v1' || !ids.has(node.workspaceId)
        || node.valueKind !== (node.kind === 'workspace-init' ? 'undefined' : 'number')) fail('invalid workspace operation contract');
      if (node.kind === 'workspace-init') {
        if (!initializer || node !== e || initialized.has(node.workspaceId) || node.offset || node.value) fail('workspace initialization must be unique and direct');
        initialized.add(node.workspaceId); live.add(node.workspaceId);
      } else {
        if (!live.has(node.workspaceId)) fail('workspace read/write is not dominated by its own initialization');
        if (node.kind === 'workspace-write' && (!node.offset || !node.value)) fail('workspace write requires index and value');
        if (node.offset && !['number', 'unknown'].includes(node.offset.valueKind)) fail('workspace index must be numeric');
        if (node.kind === 'workspace-write' && !['number', 'unknown'].includes(node.value?.valueKind)) fail('workspace value must be numeric');
        if (node.kind === 'workspace-read' && node.value) fail('workspace read cannot contain a write value');
      }
    });
  }
  function body(statements, live = new Set(), loop = false, helper = false) {
    for (const s of statements || []) {
      expression(s.value || s.expression || s.test, live, !loop && !helper && s.kind === 'expression' && s.expression?.kind === 'workspace-init');
      for (const argument of s.arguments || []) expression(argument, live);
      for (const value of [s.input, s.initial, s.increment]) expression(value, live);
      if (s.kind === 'if') {
        const yes = body(s.then, new Set(live), loop, helper), no = body(s.else, new Set(live), loop, helper);
        for (const id of yes) if (no.has(id)) live.add(id);
      } else if (['pure-loop', 'read-loop'].includes(s.kind)) body(s.body, new Set(live), true, helper);
    }
    return live;
  }
  for (const s of [plan.entry, ...(plan.handlers || []), ...(plan.stages || [])]) body(s?.body);
  for (const h of plan.helpers || []) body(h.body, new Set(), false, true);
  for (const e of plan.effects || []) {
    for (const i of e.inputs || []) expression(i.value, new Set());
    for (const a of e.result?.decoder?.arguments || []) expression(a, new Set());
  }
  if (initialized.size !== ids.size) fail('workspace table contains an unowned allocation');
}
module.exports = { validateNumericWorkspaces };
