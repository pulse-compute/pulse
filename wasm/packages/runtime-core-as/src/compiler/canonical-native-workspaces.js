'use strict';
function prepareNativeWorkspaces(plan) {
  const records = plan.numericWorkspaces || [];
  const base = id => '__pulse_workspace_' + records.findIndex(r => r.id === id);
  const capacity = id => records.find(r => r.id === id).capacity;
  const source = records.map(r => `const ${base(r.id)}: usize = memory.data(${r.capacity * 8})`);
  if (records.length) source.push(`function __pulse_workspace_read(base: usize, capacity: i32, offset: f64): f64 {
  const at = host_workspace_check(offset, capacity, 0.0);
  return at < 0 ? 0.0 : load<f64>(base + <usize>at * 8);
}
function __pulse_workspace_write(base: usize, capacity: i32, offset: f64, value: f64): f64 {
  const at = host_workspace_check(offset, capacity, value);
  if (at < 0) return 0.0;
  store<f64>(base + <usize>at * 8, value);
  return value;
}`);
  return { source,
    clear: () => records.map(r => `memory.fill(${base(r.id)}, 0, ${r.capacity * 8})`),
    init: e => `if (host_workspace_check(0.0, ${capacity(e.workspaceId)}, 0.0) >= 0) memory.fill(${base(e.workspaceId)}, 0, ${capacity(e.workspaceId) * 8})`,
    read: (e, offset) => e.offset ? `__pulse_workspace_read(${base(e.workspaceId)}, ${capacity(e.workspaceId)}, ${offset})` : `(<f64>${capacity(e.workspaceId)} + <f64>(host_workspace_check(0.0, ${capacity(e.workspaceId)}, 0.0) * 0))`,
    write: (e, offset, value) => `__pulse_workspace_write(${base(e.workspaceId)}, ${capacity(e.workspaceId)}, ${offset}, ${value})`
  };
}
module.exports = { prepareNativeWorkspaces };
