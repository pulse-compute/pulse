'use strict';

// Opt-in composition inside the existing docs:sync pipeline. Authors retain the
// section prose; snippets and command-result bindings keep their existing owners.
const MARKER = '<!-- pulse-example-template:v1 -->';
const CODE = ['Handler', 'Project config', 'Schemas'];
const LOWER = ['Workflow', 'Test result', 'Test harness', 'Wasm size'];
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/\r?\n/g, '\\n');
const code = value => '`' + escape(typeof value === 'string' ? value : JSON.stringify(value)) + '`';
function requestTable(cases) {
  if (!cases.length || cases.some(entry => entry.kind !== 'http')) throw new Error('Example request table requires nonempty HTTP harness cases');
  const rows = cases.map(entry => {
    const request = [code(`${entry.request.method} ${entry.request.path}`)];
    if (entry.request.headers?.length) request.push(`Headers: ${code(entry.request.headers)}`);
    if (entry.request.body !== undefined) request.push(`Body: ${code(entry.request.body)}`);
    // Preserve all expectations, including errors/headers, without inferring status.
    return `| ${request.join('<br>')} | ${code(entry.expect)} |`;
  });
  return 'Generated from the executable test harness below; these are tested cases, not an exhaustive route specification.\n\n| Request | Expected response |\n|---|---|\n' + rows.join('\n');
}
function renderExampleTemplate(markdown, loadCases) {
  if (!markdown.split('\n').includes(MARKER)) return markdown;
  if (markdown.split(MARKER).length !== 2) throw new Error('Duplicate example template marker');
  const input = markdown.replace(/<!-- pulse-example-view:code -->\n## Code\n\n/g, '');
  const sections = new Map(); let lead = '', current = null, fence = null;
  for (const line of input.split('\n')) {
    const boundary = /^\s*(`{3,}|~{3,})/.exec(line);
    if (boundary) { if (!fence) fence = boundary[1][0]; else if (fence === boundary[1][0]) fence = null; }
    const heading = !fence && /^(#{2,3}) (.+)$/.exec(line);
    if (heading && (heading[1].length === 2 || CODE.includes(heading[2]))) {
      current = heading[2];
      if (sections.has(current)) throw new Error(`Duplicate example section: ${current}`);
      sections.set(current, '');
    } else if (current) sections.set(current, sections.get(current) + line + '\n');
    else lead += line + '\n';
  }
  sections.set('Request and response', requestTable(loadCases()));
  const output = [lead.trimEnd()];
  const emit = (name, depth = 2) => {
    if (!sections.has(name)) return;
    const body = sections.get(name).trim();
    if (!body) throw new Error(`Empty example section: ${name}`);
    output.push(`${'#'.repeat(depth)} ${name}\n\n${body}`); sections.delete(name);
  };
  emit('Request and response');
  if (CODE.some(name => sections.has(name))) {
    output.push('<!-- pulse-example-view:code -->\n## Code');
    CODE.forEach(name => emit(name, 3));
  }
  for (const name of ['Inspect', 'Doctor', 'Report', ...LOWER]) emit(name);
  // Additional example-specific limitations remain intact; no mass conversion.
  for (const name of [...sections.keys()]) emit(name);
  return output.join('\n\n') + '\n';
}
module.exports = { MARKER, requestTable, renderExampleTemplate };
