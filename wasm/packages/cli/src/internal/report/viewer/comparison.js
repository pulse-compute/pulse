/* Presentation only. Matching, compatibility and deltas belong to comparison.js. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const sections = [...document.querySelectorAll('[data-collection]')];
  const records = sections.flatMap(section => [...section.querySelectorAll('.compare-record')]);
  const search = $('#compare-search'), status = $('#compare-status');
  // Retain exact canonical bytes; filters and disclosures never change exports.
  const data = reportEncoding.decode(JSON.parse($('#pulse-comparison-data').textContent));
  let wire;
  const canonical = () => wire ??= reportEncoding.stringify(data) + '\n';
  $('#compare-json-disclosure').addEventListener('toggle', () => {
    if ($('#compare-json-disclosure').open) $('#compare-json').textContent = canonical();
  });
  const indexed = records.map(record => ({ record, text: record.textContent.toLowerCase() }));
  function filter() {
    const query = search.value.trim().toLowerCase();
    for (const { record, text } of indexed) record.hidden = !(status.value === 'all' || record.dataset.status === status.value) || !text.includes(query);
    for (const section of sections) section.hidden = [...section.querySelectorAll('.compare-record')].every(record => record.hidden);
    const visible = records.filter(record => !record.hidden).length;
    $('#compare-filter-status').textContent = `${visible} of ${records.length} changed records shown. Summary and export include all evidence.`;
    $('#compare-empty').hidden = visible !== 0;
  }
  search.addEventListener('input', filter);
  status.addEventListener('change', filter);
  $('#compare-reset').addEventListener('click', () => { search.value = ''; status.value = 'all'; filter(); search.focus(); });
  $('#compare-theme').addEventListener('click', () => {
    const light = document.documentElement.dataset.theme !== 'light';
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    $('#compare-theme').textContent = light ? 'Dark theme' : 'Light theme';
  });
  $('#compare-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([canonical()], { type: 'application/json' })), link = document.createElement('a');
    link.href = url; link.download = 'pulse-report-comparison.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // Links use generated local anchors only. Navigating after filtering reveals
  // the requested section; direct record links also open their disclosure.
  function revealHash() {
    const id = location.hash.slice(1);
    if (!/^(compare-[a-zA-Z]+|change-[a-zA-Z]+-\d+)$/.test(id)) return;
    const target = document.getElementById(id);
    if (!target) return;
    if (target.matches('.compare-record, [data-collection]')) {
      search.value = ''; status.value = 'all'; filter();
      if (target.matches('.compare-record')) target.open = true;
      target.scrollIntoView();
    }
  }
  window.addEventListener('hashchange', revealHash);
  $('.compare-nav').addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    // Clicking the current anchor does not emit hashchange.
    search.value = ''; status.value = 'all'; filter();
  });
  for (const selector of ['#compare-toolbar', '#compare-theme', '#compare-export']) $(selector).hidden = false;
  filter(); revealHash();
})();
