'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');
const f = require('./report-fixtures.cjs');
const { compareCapsules, serializeComparison } = require(path.join(f.reportRoot, 'comparison'));
const { renderComparison } = require(path.join(f.reportRoot, 'viewer'));
const payload = html => html.match(/<script id="pulse-comparison-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
function fixture(mode = 'changed') {
  const before = require('./report-build-cases.cjs').fixture(), after = structuredClone(before);
  before.application.name = after.application.name = 'Catalog';
  for (const c of [before, after]) c.routes.forEach((row, index) => { row.path = index ? '/api/status' : '/api/items'; });
  if (mode === 'changed' || mode === 'incompatible') {
    after.routes[0].path = '/api/v2/items';
    after.routes[1].handlerName = 'updatedHandler';
    const measure = after.measurements.find(row => row.subjectId === after.routes[1].id && row.metric === 'handler-body');
    measure.fact = f.unavailable('unsupported-mapping'); measure.bodyIds = []; measure.mappedChunks = 0;
    after.schemas[0].source.line++;
    after.build.compilers[0].optimization.converge = true;
    after.build.compilers[0].flags.push({ name: '--converge', value: null });
    after.provenance.revision = 'b'.repeat(40);
  }
  if (mode === 'unknown') { delete before.build; delete after.build; }
  if (mode === 'incompatible') { after.context.host = 'fastly'; after.artifacts.forEach(row => { row.host = 'fastly'; }); }
  if (mode === 'missing') { for (const c of [before, after]) for (const name of ['routes', 'schemas']) c.coverage[name] = { status: 'partial', observed: c[name].length, expected: null, reason: 'upstream-partial' }; }
  if (mode === 'ambiguous') {
    for (const c of [before, after]) c.routes.forEach(row => { row.path = '/same'; });
    after.routes.forEach(row => { row.canonicalId = 'changed-' + row.canonicalId; });
  }
  if (mode === 'hostile') {
    after.application.name = '</script><script>globalThis.injected=true</script><img src=x onerror=alert(1)>\u2028\u2029&"';
    after.routes[0].path = '/' + after.application.name;
  }
  return compareCapsules(f.createCapsule(before), f.createCapsule(after));
}
module.exports = function comparisonViewerCases() {
  for (const mode of ['changed', 'same', 'unknown', 'incompatible', 'missing', 'ambiguous', 'hostile']) {
    const comparison = fixture(mode), before = serializeComparison(comparison), html = renderComparison(comparison);
    assert.equal(html, renderComparison(comparison), 'deterministic HTML');
    assert.equal(serializeComparison(JSON.parse(payload(html))), before, 'complete comparison survives HTML');
    const raw = html.match(/<pre id="compare-json">([\s\S]*?)<\/pre>/)[1].replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
    assert.equal(raw, before, 'HTML text used by download preserves exact canonical bytes, including hostile text');
    assert.equal(serializeComparison(comparison), before, 'presentation never changes the result');
    assert.equal((html.match(/<script\b/g) || []).length, 2);
    assert.ok(!/[<>&\u2028\u2029]/.test(payload(html)), 'payload cannot escape its container');
    assert.ok(!html.includes('<script>globalThis.injected=true'));
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    new vm.Script(script);
    for (const content of [script, css]) assert.ok(html.includes("'sha256-" + crypto.createHash('sha256').update(content).digest('base64') + "'"));
    assert.match(html, /connect-src 'none'/); assert.match(html, /style-src-attr 'none'/);
    assert.ok(!/\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|Worker|importScripts)\s*\(|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\.style[.=]/.test(script));
    assert.ok(!/<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=/.test(html));
    assert.ok(!/@import|url\(/i.test(css));
    assert.ok(!/<[^>]*\s(?:on\w+|style)=/.test(html.slice(0, html.indexOf('<script id='))));
    assert.match(html, /aria-label="Comparison summary"/); assert.match(html, /<h2>Routes<\/h2>/); assert.match(html, /<h2>Schemas<\/h2>/);
    assert.ok(html.includes(comparison.sources.before.artifact.sha256)); assert.ok(html.includes(comparison.sources.after.capsuleHash));
    assert.equal((html.match(/class="compare-record"/g) || []).length, comparison.sections.reduce((n, row) => n + row.changes.length, 0));
    for (const section of comparison.sections) assert.ok(html.includes(`id="compare-${section.collection}"`));
    for (const name of ['routes', 'entries', 'schemas', 'resources']) if (!comparison.sections.some(row => row.collection === name)) assert.ok(!html.includes(`id="compare-${name}"`));
    // Report remains readable with script disabled: summary, provenance, values
    // and native disclosures are server rendered; only enhancement controls hide.
    assert.match(html, /<details class="compare-json|<details class="surface compare-json/);
    assert.ok(!html.includes('class="compare-record" open'));
  }
  const changed = renderComparison(fixture());
  assert.match(changed, /\+1 added/); assert.match(changed, /−1 removed/); assert.match(changed, /0 net/);
  assert.match(changed, /Build settings & provenance/); assert.match(changed, /--converge/);
  assert.match(changed, /No byte delta: missing evidence/);
  assert.match(changed, /Row sizes can overlap and are not additive/);
  assert.match(renderComparison(fixture('incompatible')), /No byte delta · incompatible artifacts/);
  assert.match(renderComparison(fixture('same')), /No changed detail in the retained inventories/);
  assert.match(renderComparison(fixture('missing')), /Net change unknown/);
  assert.match(renderComparison(fixture('unknown')), /Build evidence is incomplete/);
  assert.match(renderComparison(fixture('ambiguous')), /ambiguous identity/);
  assert.match(renderComparison(fixture('ambiguous')), /not a proven addition or removal/);
  interactionCases(fixture());
  const bad = structuredClone(fixture()); bad.sources.before.application.name = 'tampered';
  assert.throws(() => renderComparison(bad), { code: 'REPORT_COMPARISON_HASH' });
  console.log('ok - CMP8-02 comparison rendering: sparse details, zero-net anchors, missing evidence, compatibility, full provenance, exact payload and CSP');
};
function interactionCases(comparison) {
  // Focused DOM recorder: executes the actual enhancement script. Browser
  // layout/CSP enforcement and native disclosure behavior require browser QA.
  class Element {
    constructor(text = '') { this.textContent = text; this.hidden = false; this.value = ''; this.dataset = {}; this.events = {}; }
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() { document.activeElement = this; }
    append() {} click() { this.clicked = true; } remove() {} scrollIntoView() { this.scrolled = true; }
  }
  const sections = comparison.sections.map(section => {
    const node = new Element(); node.id = 'compare-' + section.collection;
    node.records = section.changes.map((row, index) => {
      const record = new Element(row.label + ' ' + JSON.stringify(row.fields)); record.id = 'change-' + section.collection + '-' + index;
      record.dataset.status = row.status; record.matches = selector => selector.includes('.compare-record'); return record;
    });
    node.querySelectorAll = () => node.records; node.matches = selector => selector.includes('[data-collection]'); return node;
  });
  const controls = Object.fromEntries(['compare-search', 'compare-status', 'compare-json', 'compare-filter-status', 'compare-empty', 'compare-reset', 'compare-theme', 'compare-export', 'compare-toolbar'].map(id => ['#' + id, new Element()]));
  controls['#compare-status'].value = 'all'; controls['#compare-json'].textContent = serializeComparison(comparison);
  controls['.compare-nav'] = new Element();
  let download, link;
  const document = { activeElement: null, documentElement: new Element(), body: new Element(), querySelector: selector => controls[selector], querySelectorAll: () => sections,
    getElementById: id => [...sections, ...sections.flatMap(row => row.records)].find(row => row.id === id), createElement: () => (link = new Element()) };
  const window = new Element(), location = { hash: '' };
  const html = renderComparison(comparison), script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document, window, location, Blob: class { constructor(parts) { download = parts.join(''); } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout: fn => fn() });
  const records = sections.flatMap(row => row.records), shown = () => records.filter(row => !row.hidden);
  const search = controls['#compare-search'], status = controls['#compare-status'];
  assert.equal(shown().length, records.length);
  search.value = 'no-such-change'; search.events.input(); assert.equal(shown().length, 0); assert.equal(controls['#compare-empty'].hidden, false);
  controls['#compare-export'].events.click(); assert.equal(download, serializeComparison(comparison)); assert.equal(link.download, 'pulse-report-comparison.json'); assert.equal(link.clicked, true);
  controls['.compare-nav'].events.click({ target: { closest: () => ({}) } }); assert.equal(shown().length, records.length, 'same-anchor click clears filters');
  status.value = 'removed'; status.events.change(); assert.ok(shown().length); assert.ok(shown().every(row => row.dataset.status === 'removed'));
  controls['#compare-reset'].events.click(); assert.equal(document.activeElement, search); assert.equal(shown().length, records.length);
  search.value = '/api/status'; search.events.input(); assert.ok(shown().every(row => row.textContent.toLowerCase().includes('/api/status')));
  location.hash = '#' + records[0].id; window.events.hashchange(); assert.equal(records[0].open, true); assert.equal(shown().length, records.length);
  controls['#compare-theme'].events.click(); assert.equal(document.documentElement.dataset.theme, 'light');
  controls['#compare-theme'].events.click(); assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(controls['#compare-toolbar'].hidden, false);
}
module.exports.fixture = fixture;
if (require.main === module) module.exports();
