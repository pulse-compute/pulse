'use strict';

// Observational projection of canonical text-response sites, after emission.
// Never evaluate application expressions or expose literal contents/hashes.
function collectResponsePayloads(plan, entryIds, helperConsumers) {
  const sites = [];
  const unique = values => [...new Set(values)].sort();
  const literal = value => value?.kind === 'literal' && typeof value.value === 'string' ? value.value : null;
  const objectFields = value => value?.kind === 'object' && value.entries.every(row => row.kind === 'property'
    && row.key?.kind === 'literal' && typeof row.key.value === 'string') ? value.entries : null;
  const field = (rows, key) => rows?.filter(row => row.key.value === key).at(-1)?.value;
  function mediaType(options) {
    if (!options || options.kind === 'undefined') return 'text/plain';
    const fields = objectFields(options);
    if (!fields) return null;
    const headers = field(fields, 'headers');
    if (!headers) return 'text/plain';
    const values = objectFields(headers);
    if (!values) return null;
    const types = values.filter(row => row.key.value.toLowerCase() === 'content-type');
    if (!types.length) return 'text/plain';
    // Case variants can be merged by the runtime header adapter; do not guess.
    if (types.length !== 1) return null;
    const type = literal(types[0].value)?.split(';')[0].trim().toLowerCase();
    return ['text/plain', 'text/css', 'text/html', 'text/javascript', 'application/javascript'].includes(type) ? type : null;
  }
  function scan(body, owner, consumers) {
    const constants = new Map();
    function visit(value, fn, path = 'body') {
      if (!value || typeof value !== 'object') return;
      fn(value, path);
      for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((row, i) => visit(row, fn, path + '.' + key + '[' + i + ']'));
        else visit(child, fn, path + '.' + key);
      }
    }
    visit(body, node => {
      if (node.kind === 'local' && node.declaration === 'const' && literal(node.value) !== null)
        constants.set(node.localId, node.value.value);
    });
    visit(body, (node, path) => {
      if (node.kind !== 'intrinsic' || node.name !== 'response.text') return;
      const input = node.arguments[0];
      const value = literal(input) ?? (input?.kind === 'local' ? constants.get(input.id) : null);
      const known = typeof value === 'string';
      const state = known ? 'resolved' : !input || ['literal', 'undefined'].includes(input.kind) ? 'unknown' : 'dynamic';
      const valid = unique(consumers.filter(id => entryIds.has(id)));
      sites.push(Object.freeze({ canonicalId: JSON.stringify([owner, path]),
        state, inputBytes: known ? Buffer.byteLength(value, 'utf8') : null,
        mediaType: mediaType(node.arguments[1]), entryIds: Object.freeze(valid),
        entriesComplete: consumers.length > 0 && consumers.every(id => entryIds.has(id)) }));
    });
  }
  scan(plan.entry.body, 'entry', plan.entry.kind === 'router' ? [] : ['default']);
  for (const row of plan.handlers || []) scan(row.body, 'handler:' + row.id, [row.id]);
  for (const row of plan.stages || []) scan(row.body, 'stage:' + row.id, row.registrations.map(item => item.entryId));
  for (const row of plan.helpers || []) scan(row.body, 'helper:' + row.id, [...(helperConsumers.get(row.id) || [])]);
  sites.sort((a, b) => a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0);
  return Object.freeze({ version: 'pulse.report-text-responses.v1', sites: Object.freeze(sites) });
}

module.exports = { collectResponsePayloads };
