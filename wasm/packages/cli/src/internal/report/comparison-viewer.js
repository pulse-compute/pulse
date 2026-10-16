'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateComparison } = require('./comparison');
const { fail } = require('./data');
const read = name => fs.readFileSync(path.join(__dirname, 'viewer', name), 'utf8');
const digest = text => crypto.createHash('sha256').update(text).digest('base64');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = { handlers: 'Authored handlers & linked helpers', registrations: 'Registration instances', useSites: 'Capability & binding use sites', helperCalls: 'Linked helper calls', associations: 'Contextual associations', routes: 'Routes', entries: 'Entries', schemas: 'Schemas', bindings: 'Bindings', resources: 'Resources', implementations: 'Helpers & implementations', declarations: 'Declarations', references: 'References', evidence: 'Evidence', observations: 'Observations' };
const statuses = { added: ['+', 'Added'], removed: ['−', 'Removed'], modified: ['~', 'Modified'], 'coverage-changed': ['?', 'Coverage changed'], unresolved: ['?', 'Unresolved'] };
const words = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
const number = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const bytes = value => number(value) + ' B';
const sign = value => value > 0 ? '+' : value < 0 ? '−' : '';
const delta = (value, unit = '') => value === null ? 'Not comparable' : sign(value) + number(Math.abs(value)) + unit;
const badge = status => `<span class="compare-badge ${status}">${statuses[status][0]} ${statuses[status][1]}</span>`;
const fieldName = field => field.path === '/' ? 'Recorded details' : field.path.slice(1).split('/').map(part => words(part.replace(/~1/g, '/').replace(/~0/g, '~'))).join(' / ');
const reason = value => words(value || 'not recorded');
const definition = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value ?? 'Not recorded')}</dd></div>`;
function formatted(value) {
  if (!value.recorded) return '<span class="compare-muted">Not recorded</span>';
  const row = value.value;
  if (row === null) return '<span class="compare-muted">Not recorded</span>';
  if (row && typeof row === 'object' && Object.hasOwn(row, 'state') && Object.hasOwn(row, 'basis') && Object.hasOwn(row, 'value')) {
    const label = row.state === 'available' ? bytes(row.value) : words(row.state);
    return `<strong class="mono">${escape(label)}</strong><p class="compare-qualification">${escape([row.basis, row.coverage, row.method, row.stage, row.reason].filter(x => x !== null && x !== undefined).map(words).join(' · '))}</p>`;
  }
  if (typeof row !== 'object') return `<span class="compare-value">${escape(row)}</span>`;
  return `<pre>${escape(JSON.stringify(row, null, 2))}</pre>`;
}
function fieldRow(field) {
  return `<div class="compare-field"><div class="compare-field-heading"><h4>${escape(fieldName(field))}</h4>${field.kind === 'coverage' ? '<span class="compare-coverage">Coverage change</span>' : ''}${field.delta !== null ? `<span class="compare-delta">${delta(field.delta, ' B')}</span>` : ''}</div>
    <div class="compare-pair"><div class="compare-before"><span class="compare-side">− Before</span>${formatted(field.before)}</div><div class="compare-after"><span class="compare-side">+ After</span>${formatted(field.after)}</div></div>
    ${field.deltaReason ? `<p class="compare-qualification">No byte delta: ${escape(reason(field.deltaReason))}.</p>` : ''}</div>`;
}
function sourceCard(source, side) {
  return `<article class="compare-source surface"><span class="eyebrow">${side}</span><h2>${escape(source.application.name)}</h2><p>${escape(source.context.profile)} · ${escape(source.context.host)} · ${escape(source.context.target)}</p>
    <dl>${definition('Revision', source.provenance.revision)}${definition('Working tree', source.provenance.dirty === null ? 'Not recorded' : source.provenance.dirty ? 'Dirty' : 'Clean')}${definition('Artifact', source.artifact.sha256)}</dl>
    <details><summary>Full provenance</summary><dl>${definition('Capsule SHA-256', source.capsuleHash)}${definition('Artifact ID', source.artifact.id)}${definition('Artifact bytes', bytes(source.artifact.bytes))}${definition('Artifact stage', source.artifact.stage)}${definition('Artifact target / host', source.artifact.target + ' / ' + source.artifact.host)}${definition('Representation', source.artifact.representation)}${definition('Pulse / reporter', source.producer.pulseVersion + ' / ' + source.producer.reporterVersion)}${definition('Source fingerprint', source.provenance.sourceFingerprint)}${definition('Build evidence', source.provenance.buildEvidenceId)}</dl><h3>Recorded recipe and toolchain</h3><pre>${escape(JSON.stringify({ recipe: source.provenance.recipe, toolchain: source.provenance.toolchain }, null, 2))}</pre><h3>Recorded build metadata</h3>${source.build ? `<pre>${escape(JSON.stringify(source.build, null, 2))}</pre>` : '<p>Not recorded</p>'}</details></article>`;
}
function inventoryCard(row) {
  const count = side => row[side].status === 'unavailable' ? 'Unavailable' : number(row[side].observed) + (row[side].status === 'complete' ? '' : ' observed');
  return `<article class="compare-stat surface"><h2>${names[row.collection]}</h2><div class="compare-stat-values"><span>${count('before')}</span><span class="compare-arrow" aria-label="to">→</span><strong>${count('after')}</strong></div><p>${row.delta === null ? 'Net change unknown' : delta(row.delta) + ' net'}</p><div class="compare-counts"><span class="added">+${row.counts.added} added</span><span class="removed">−${row.counts.removed} removed</span><span>${row.counts.modified} modified</span><span>${row.counts.coverageChanged} coverage</span></div><p class="compare-qualification">${row.counts.unchanged} unchanged · ${row.counts.unresolvedBefore} / ${row.counts.unresolvedAfter} unresolved (before / after)</p></article>`;
}
function coverageLine(row) {
  const describe = c => `${c.status} · ${c.observed} observed / ${c.expected ?? 'unknown'} expected${c.reason ? ' · ' + reason(c.reason) : ''}`;
  const identity = row.identityCoverage ? `<div class="compare-inventory"><strong>Comparison identity coverage</strong><span>Before: ${escape(describe(row.identityCoverage.before))}</span><span>After: ${escape(describe(row.identityCoverage.after))}</span></div>` : '';
  return `<div class="compare-inventory"><strong>${names[row.collection]}</strong><span>Before: ${escape(describe(row.before))}</span><span>After: ${escape(describe(row.after))}</span></div>` + identity;
}
function changeRow(change, id) {
  return `<details class="compare-record" id="${id}" data-status="${change.status}"><summary>${badge(change.status)}<strong>${escape(change.label)}</strong><span class="compare-record-count">${change.status === 'unresolved' ? change.beforeIds.length + ' before / ' + change.afterIds.length + ' after' : change.fields.length + ' changed field' + (change.fields.length === 1 ? '' : 's')}</span></summary><div class="compare-record-body">
    ${change.reason ? `<p class="compare-uncertain">${escape(reason(change.reason))}. This is unresolved evidence, not a proven addition or removal.</p>` : ''}
    ${change.fields.map(fieldRow).join('')}<details class="compare-identities"><summary>Record identities and matching basis</summary><p>${escape(words(change.basis))}</p><dl>${definition('Before IDs', change.beforeIds.join('\n') || 'None recorded')}${definition('After IDs', change.afterIds.join('\n') || 'None recorded')}${definition('Comparison key', change.key)}</dl></details></div></details>`;
}
function renderComparison(input) {
  const comparison = validateComparison(input), wire = require('./encoding').store(comparison);
  const payload = wire.trimEnd().replace(/[<>&\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  const css = read('viewer.css') + '\n' + read('comparison.css'), script = read('../encoding.js') + '\n' + read('comparison.js');
  const { before, after } = comparison.sources, total = comparison.summary.artifactBytes;
  const title = before.application.name === after.application.name ? after.application.name : before.application.name + ' → ' + after.application.name;
  const compatibilityText = { compatible: 'Recorded build settings match. Byte differences describe retained measurements.', 'different-build': 'Build settings or context differ. Byte differences cannot be attributed to source changes alone.', incompatible: 'Artifact domains differ. Byte deltas are suppressed.', unknown: 'Build evidence is incomplete. Equal settings and comparable build conditions cannot be established.' };
  const checks = comparison.compatibility.checks.filter(row => row.status !== 'same');
  const sectionLinks = comparison.sections.map(row => `<a href="#compare-${row.collection}">${names[row.collection]} <span>${row.changes.length}</span></a>`).join('');
  const sections = comparison.sections.map(section => `<section class="compare-section" id="compare-${section.collection}" data-collection="${section.collection}" aria-labelledby="heading-${section.collection}"><div class="section-heading"><h2 id="heading-${section.collection}">${names[section.collection]} <span class="count-pill">${section.changes.length}</span></h2><a href="#main" class="compare-back">Back to summary ↑</a></div><div class="surface">${section.changes.map((change, index) => changeRow(change, 'change-' + section.collection + '-' + index)).join('')}</div></section>`).join('');
  const shell = `<a class="skip-link" href="#main">Skip to comparison</a><header class="masthead compare-masthead"><a class="compare-brand" href="#main">pulse <span>report / compare</span></a><div class="top-actions"><button id="compare-theme" class="button" hidden>Light theme</button><button id="compare-export" class="button export" hidden>Export comparison</button></div></header>
  <main id="main" class="compare-main" tabindex="-1"><div class="report-heading"><div><div class="eyebrow">APPLICATION COMPARISON</div><div class="title-line"><h1>${escape(title)}</h1></div><p class="report-description">Before → After · Retained evidence · Offline</p></div><a href="#compare-provenance" class="button">Artifact provenance ↓</a></div>
  <section class="compare-compatibility ${comparison.compatibility.status}" aria-label="Build compatibility"><strong>${escape(words(comparison.compatibility.status))}</strong><p>${compatibilityText[comparison.compatibility.status]}</p>${checks.length ? `<details><summary>${checks.length} changed or unknown compatibility checks</summary>${checks.map(check => `<div class="compare-check"><h3>${escape(fieldName(check))} · ${check.status} · ${check.impact}</h3><div class="compare-pair"><div><span class="compare-side">Before</span>${formatted(check.before)}</div><div><span class="compare-side">After</span>${formatted(check.after)}</div></div></div>`).join('')}</details>` : ''}</section>
  <section class="compare-stats" aria-label="Comparison summary"><article class="compare-stat surface"><h2>Wasm artifact</h2><div class="compare-stat-values"><span>${bytes(total.before)}</span><span class="compare-arrow" aria-label="to">→</span><strong>${bytes(total.after)}</strong></div><p class="compare-size-delta ${total.delta === null ? 'unresolved' : total.delta < 0 ? 'added' : total.delta > 0 ? 'modified' : ''}">${total.delta === null ? 'No byte delta · incompatible artifacts' : total.delta === 0 ? 'No byte change' : delta(total.delta, ' B')}</p><p class="compare-qualification">Whole artifact. Row sizes can overlap and are not additive.</p></article>${['routes', 'schemas'].map(name => inventoryCard(comparison.summary.inventories.find(row => row.collection === name))).join('')}</section>
  ${comparison.matchingVersion === 'pulse.report-matching.v2' ? `<section aria-label="Authored analytics comparison"><div class="section-heading"><h2>Authored analytics</h2></div><p class="compare-section-note">Semantic inventories are independent of artifact bytes and optimization recipes. Static associations are not execution traces or effective grants. Retained identity and authored source slot are distinct matching bases; a source-slot match does not prove unchanged code. Graph-format reports compare the canonical registration/control, ownership, use-site and helper facts; they do not persist a contextual row inventory. Comparing that inventory with v1 is unavailable, never a deletion. Moved, renamed or ambiguous records can remain unresolved. Source hash changes describe provenance, not a capability change.</p><div class="compare-stats">${comparison.summary.inventories.filter(row => row.identityCoverage).map(inventoryCard).join('')}</div></section>` : ''}
  <section id="compare-provenance" aria-label="Artifact provenance"><div class="section-heading"><h2>Artifact provenance</h2><span class="subtle-label">Historical claims from each capsule</span></div><div class="compare-sources">${sourceCard(before, 'Before')}${sourceCard(after, 'After')}</div></section>
  <details class="compare-coverage-summary surface"><summary>Inventory coverage · all ${comparison.summary.inventories.length} inventories</summary>${comparison.summary.inventories.map(coverageLine).join('')}</details>
  ${comparison.metadataChanges.length ? `<section class="compare-section" id="compare-metadata" aria-labelledby="heading-metadata"><div class="section-heading"><h2 id="heading-metadata">Build settings & provenance <span class="count-pill">${comparison.metadataChanges.length}</span></h2></div><p class="compare-section-note">Changed recorded metadata. Build durations are observations, not performance regressions.</p><details class="surface compare-metadata"><summary>Review changed settings and metadata</summary>${comparison.metadataChanges.map(fieldRow).join('')}</details></section>` : ''}
  <section class="compare-changes-heading" aria-label="Changed details"><div class="section-heading"><div><h2>Changed details</h2><p>Unchanged records and fields are omitted. Missing evidence is never zero.</p></div></div><nav class="compare-nav" aria-label="Changed inventories">${sectionLinks}</nav><div class="compare-toolbar" id="compare-toolbar" hidden><label>Find changes<input id="compare-search" type="search" placeholder="Route, schema, field or record ID…"></label><label>Change type<select id="compare-status"><option value="all">All changes</option>${Object.entries(statuses).map(([key, labels]) => `<option value="${key}">${labels[1]}</option>`).join('')}</select></label><button id="compare-reset" class="button">Reset</button></div><p id="compare-filter-status" class="compare-qualification" role="status" aria-live="polite"></p></section>
  ${sections}<p id="compare-empty" class="surface compare-empty"${comparison.sections.length ? ' hidden' : ''}>${comparison.sections.length ? 'No matching changes. Reset the filters to see all recorded changes.' : 'No changed detail in the retained inventories. Check coverage and build metadata above; this does not prove unchanged implementation.'}</p>
  <details id="compare-json-disclosure" class="surface compare-json"><summary>Complete comparison JSON</summary><pre id="compare-json">Enable JavaScript to display or export the complete JSON.</pre></details><footer class="page-footer"><span>Comparison v1 · ${escape(comparison.matchingVersion)} · Before → After</span><span>Self-contained · No network requests</span></footer></main>`;
  const policy = `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(css)}'; style-src-attr 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';`;
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="pulse-comparison-viewer" content="1"><title>Pulse Report · Comparison</title><style>${css}</style></head><body>${shell}<script id="pulse-comparison-data" type="application/json">${payload}</script><script>${script}</script></body></html>\n`;
  if (Buffer.byteLength(html) > 64 * 1024 * 1024) fail('REPORT_LIMIT');
  return html;
}
module.exports = { renderComparison };
