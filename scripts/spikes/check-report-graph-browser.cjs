#!/usr/bin/env node
'use strict';
// Optional browser qualification; uses an externally provisioned Playwright.
// No browser/runtime dependency is added to the production workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { index } = require('./graph/model.cjs');
async function main() {
  const file = process.argv[2]; if (!file) throw Error('Usage: node scripts/spikes/check-report-graph-browser.cjs <experiment.html>');
  const html = fs.readFileSync(file, 'utf8'), capsule = JSON.parse(html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]), model = index(capsule);
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--single-process'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1150 }, acceptDownloads: true }), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const start = Date.now(); await page.goto(pathToFileURL(file).href); await page.waitForSelector('#rows tr');
    const loadMs = Date.now() - start;
    if (model.a) {
      assert.equal(await page.locator('#rows tr').count(), model.registrations.length);
      const mount = model.registrations.find(r => model.children.has(r.id) && !r.mountPath.length);
      if (mount) { const before = await page.locator('.node').count(); await page.getByRole('button', { name: 'Expand ' + model.label(mount), exact: true }).click(); assert.ok(await page.locator('.node').count() > before); }
      if (await page.locator('#fit-graph').count()) await require('./check-report-graph-navigation.cjs')(page, model);
      const target = model.registrations.find(r => r.kind === 'route' && r.control?.value?.terminal) || model.registrations[0];
      await page.locator('#search').fill(target.id);
      assert.equal(await page.locator('#rows tr').count(), 1);
      await page.locator('#rows button').first().click();
      if (await page.locator('#fit-graph').count()) assert.equal(await page.locator('.wire.selected-path').count(), target.mountPath.length + 1, 'highlight shows exact selected mount ancestry');
      assert.ok((await page.locator('#details').textContent()).includes(model.label(target)));
      await page.locator('#search').fill('');
      await page.locator('[data-view="lanes"]').click();
      const links = model.neighbors(target.id);
      assert.equal(await page.locator('.wire').count(), links.incoming.length + links.outgoing.length);
      if (target.control?.value?.terminal) assert.ok((await page.locator('#view-controls').textContent()).includes('may terminate'));
      await page.locator('[data-view="dependencies"]').click();
      if (model.uses.length) {
        const key = [...model.groups.keys()].find(k => model.dependency(k).consumers.length);
        if (key) {
          await page.getByLabel('Inspect', { exact: true }).selectOption(key);
          const d = model.dependency(key), consumer = d.consumers[0];
          await page.locator('.node').filter({ hasText: '#' + model.byId.get(consumer).order + ' ' }).first().click();
          if (await page.locator('#selection-back').count() && consumer !== target.id) {
            await page.locator('#selection-back').click();
            assert.ok((await page.locator('#details').textContent()).includes(model.label(target)), 'dependency selection participates in history');
            await page.locator('#selection-forward').click();
          }
          assert.equal(await page.getByLabel('Explanation', { exact: true }).count(), 1);
          const selected = await page.getByLabel('Explanation', { exact: true }).inputValue(), row = model.associations.find(a => a.id === selected);
          assert.equal(await page.locator('.hops button').count(), row.via.length);
          assert.ok((await page.locator('#details').textContent()).includes(model.label(model.byId.get(consumer))));
          const nextOwners = page.getByRole('button', { name: 'Next Owners', exact: true });
          if (await nextOwners.isEnabled()) { await nextOwners.click(); assert.ok((await page.locator('.pager').first().textContent()).includes('9–')); }
        }
      }
      await page.locator('[data-view="atlas"]').click();
      await page.locator('.node[data-registration]').first().focus(); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); assert.equal(await page.locator('#zoom-reset').textContent(), '90%');
      await page.locator('#zoom-reset').click(); assert.equal(await page.locator('#zoom-reset').textContent(), '100%');
      await page.locator('#search').fill('unmatched-search-value'); assert.ok((await page.locator('#rows').textContent()).includes('No registrations match')); await page.locator('#search').fill('');
    } else assert.ok((await page.locator('#graph').textContent()).includes('not recorded'));
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise;
    assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), 'utf8')), capsule, 'export retains all evidence, including hidden associations');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'narrow layout confines horizontal scrolling to graph/table');
    await page.waitForFunction(() => { const v = document.getElementById('viewport').getBoundingClientRect(), n = document.querySelector('.node.selected')?.getBoundingClientRect(); return !n || (n.left >= v.left - 1 && n.right <= v.right + 1 && n.top >= v.top - 1 && n.bottom <= v.bottom + 1); });
    if (process.env.GRAPH_SCREENSHOT) await page.screenshot({ path: process.env.GRAPH_SCREENSHOT, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log(JSON.stringify({ status: 'passed', browser: await browser.version(), loadMs, registrations: model.registrations.length, exactExport: true, networkRequests: 0, browserErrors: 0, mobileWidth: 390 }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
