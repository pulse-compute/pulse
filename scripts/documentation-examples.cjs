'use strict';

// Opt-in composition inside the existing docs:sync pipeline. Authors retain the
// section prose; snippets and command-result bindings keep their existing owners.
const MARKER = '<!-- pulse-example-template:v1 -->';
const CODE = ['Handler', 'Application', 'Router application', 'Entity application', 'Project config', 'Schemas'];
const WORKFLOW = ['Install', 'Workflow', 'JavaScript workflow', 'Node Native workflow', 'Fastly profiles'];
const EVIDENCE = ['Clean installed acceptance', 'Test result', 'Test harness', 'Wasm size', 'Maintaining the snapshot'];
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/`/g, '&#96;').replace(/\r?\n/g, '\\n');
// HTML code spans decode escaped table delimiters/entities without changing values.
const code = value => '<code>' + escape(typeof value === 'string' ? value : JSON.stringify(value)) + '</code>';
function requestTable(cases) {
  if (!cases.length || cases.some(entry => !['http', 'event'].includes(entry.kind))) throw new Error('Example request table requires nonempty HTTP or event harness cases');
  const rows = cases.map(entry => {
    const request = entry.kind === 'event'
      ? ['Event: ' + code(entry.event)]
      : [code(`${entry.request.method} ${entry.request.path}`)];
    if (entry.request?.headers?.length) request.push(`Headers: ${code(entry.request.headers)}`);
    if (entry.request?.body !== undefined) request.push(`Body: ${code(entry.request.body)}`);
    // Preserve all expectations, including errors/headers, without inferring status.
    return `| ${[escape(entry.name || entry.kind), ...request].join('<br>')} | ${code(entry.expect)} |`;
  });
  return 'Generated from the executable test harness below; these are tested requests or event frames, not an exhaustive application specification. Expected errors and emitted events are included; fixtures and provider setup remain in the harness.\n\n| Request | Expected response |\n|---|---|\n' + rows.join('\n');
}
function renderExampleTemplate(markdown, loadCases) {
  if (!markdown.split('\n').includes(MARKER)) return markdown;
  if (markdown.split(MARKER).length !== 2) throw new Error('Duplicate example template marker');
  const input = markdown.replace(/<!-- pulse-example-view:code -->\n## Code\n\n/g, '');
  const sections = new Map(); let lead = '', current = null, fence = null;
  for (const line of input.split('\n')) {
    const boundary = /^\s*(`{3,}|~{3,})/.exec(line);
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (fence[0] === boundary[1][0] && boundary[1].length >= fence.length && /^\s*(`+|~+)\s*$/.test(line)) fence = null;
    }
    const heading = !fence && /^(#{2,3}) (.+)$/.exec(line);
    if (heading && (heading[1].length === 2 || CODE.includes(heading[2]))) {
      current = heading[2];
      if (sections.has(current)) throw new Error(`Duplicate example section: ${current}`);
      sections.set(current, '');
    } else if (current) sections.set(current, sections.get(current) + line + '\n');
    else lead += line + '\n';
  }
  // Protocol examples may document a concise live request instead of an HTTP
  // harness table. Their executable documentation gate owns that evidence.
  if (markdown.split('\n').includes('<!-- pulse-example-requests:authored -->')) {
    if (!sections.get('Request and response')?.trim()) throw new Error('Authored example requires Request and response');
  } else sections.set('Request and response', requestTable(loadCases()));
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
  for (const name of ['Inspect', 'Doctor', 'Report', ...WORKFLOW]) emit(name);
  // Keep walkthroughs and limits ahead of repetitive evidence, without a
  // per-example template. Installation always precedes executable workflows.
  for (const name of [...sections.keys()].filter(name => !EVIDENCE.includes(name))) emit(name);
  for (const name of EVIDENCE) emit(name);
  return output.join('\n\n') + '\n';
}
module.exports = { MARKER, requestTable, renderExampleTemplate };
