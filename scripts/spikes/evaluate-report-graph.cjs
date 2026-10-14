#!/usr/bin/env node
'use strict';
// Optional VIS-03 walkthrough. Scenario IDs and outputs may contain private data;
// keep them outside the repository. Uses an externally provisioned Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { parseCapsule } = require('../../wasm/packages/cli/src/internal/report/capsule');
const { index, atlasLayout } = require('./graph/model.cjs');

async function main() {
  const [input, scenarioFile, output] = process.argv.slice(2);
  if (!input || !scenarioFile || !output || process.argv.length !== 5) throw Error('Usage: node scripts/spikes/evaluate-report-graph.cjs <experiment.html> <scenario.json> <new-output-directory>');
  const html = fs.readFileSync(input, 'utf8');
  const payload = html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)?.[1];
  if (!payload) throw Error('Expected a report graph experiment');
  const capsule = parseCapsule(payload), model = index(capsule), scenario = JSON.parse(fs.readFileSync(scenarioFile));
  assert.ok(model.a, 'walkthrough requires retained analytics; use the browser smoke for historical absence');
  const byOrder = order => { const r = model.registrations.find(r => r.order === order); assert.ok(r, 'scenario order exists: ' + order); return r; };
  const scope = byOrder(scenario.scopeOrder), route = byOrder(scenario.routeOrder), reused = byOrder(scenario.reuseOrder);
  assert.equal(scope.kind, 'mount'); assert.ok(route.mountPath.includes(scope.id));
  const instances = model.instances.get(reused.handlerId); assert.ok(instances.length > 1);
  const association = model.associations.find(a => a.id === scenario.associationId); assert.ok(association);
  const use = model.useById.get(association.useSiteId); assert.equal(use.binding.bindingId, scenario.bindingId);
  const laneRecords = scenario.laneOrders.map(byOrder); assert.ok(laneRecords.length > 1);
  for (let i = 1; i < laneRecords.length; i++) assert.equal(laneRecords[i - 1].flow.next, laneRecords[i].id, 'walkthrough follows retained next candidates');
  fs.mkdirSync(output); // Refuse overwrite; failed attempts remain inspectable.
  const result = {
    status: 'running', capsuleHash: capsule.evidenceHash.value,
    htmlSha256: crypto.createHash('sha256').update(html).digest('hex'), htmlBytes: Buffer.byteLength(html),
    scenario, coverage: model.a.coverage, counts: {
      registrations: model.registrations.length, definitions: model.handlers.length,
      mounts: model.registrations.filter(r => r.kind === 'mount').length,
      useSites: model.uses.length, associations: model.associations.length,
      retainedConsumers: new Set(model.associations.map(a => a.consumerRegistrationId)).size,
      reusedDefinitions: [...model.instances.values()].filter(rows => rows.length > 1).length,
      unavailableCapabilities: model.uses.filter(u => u.capability.state !== 'available').length,
      unresolvedBindings: model.uses.filter(u => !['resolved', 'not-applicable'].includes(u.binding.state)).length,
      events: model.registrations.filter(r => r.kind === 'event').length
    }, observations: {}, timingsMs: {}, screenshots: [], browserErrors: [], networkRequests: []
  };
  const save = () => fs.writeFileSync(path.join(output, 'evaluation.json'), JSON.stringify(result, null, 2) + '\n');
  save(); let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--single-process'] });
    result.browser = await browser.version(); result.viewport = { width: 1600, height: 1150 };
    const page = await browser.newPage({ viewport: result.viewport, acceptDownloads: true });
    page.on('pageerror', e => result.browserErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') result.browserErrors.push(m.text()); });
    page.on('request', r => { if (/^https?:/.test(r.url())) result.networkRequests.push(r.url()); });
    // These are single local automation observations, including actionability
    // and two animation frames. They are not user task timings or percentiles.
    const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function timed(name, action) { const start = performance.now(); await action(); await settled(); result.timingsMs[name] = Math.round(performance.now() - start); }
    async function shot(name, fullPage = false) { await page.screenshot({ path: path.join(output, name + '.png'), fullPage }); result.screenshots.push(name + '.png'); }
    const graphNode = r => page.locator('.node[data-registration="' + r.id + '"]').first();
    async function select(r) { await page.locator('#search').fill(r.id); await page.locator('#rows button').click(); await page.locator('#search').fill(''); await settled(); }
    const view = name => page.locator('[data-view="' + name + '"]').click();
    await timed('load', async () => { await page.goto(pathToFileURL(path.resolve(input)).href); await page.waitForSelector('.node'); });
    result.observations.collapsedNodes = await page.locator('.node').count(); await shot('01-overview');
    await timed('focusScope', async () => { await graphNode(scope).click(); await page.locator('#focus-branch').click(); });
    const scoped = model.registrations.filter(r => r.id === scope.id || r.mountPath.includes(scope.id));
    assert.equal(await page.locator('#rows tr').count(), scoped.length);
    result.observations.scope = { order: scope.order, label: model.label(scope), registrations: scoped.length, visibleNodes: await page.locator('.node').count() };
    await shot('02-focused-atlas');
    await timed('findRoute', () => select(route));
    assert.equal(await graphNode(route).count(), 1);
    assert.ok((await page.locator('#details').textContent()).includes(model.filename(model.definitions.get(route.handlerId).source)));
    result.observations.route = { order: route.order, match: model.match(route), control: route.control, mountOrders: route.mountPath.map(id => model.byId.get(id).order), source: model.definitions.get(route.handlerId).source };
    await shot('03-route-evidence');
    await view('lanes'); await select(laneRecords[0]);
    result.observations.candidateWalk = [];
    for (const r of laneRecords) {
      await timed('candidate-' + r.order, () => graphNode(r).click());
      const neighbors = model.neighbors(r.id);
      assert.equal(await page.locator('.wire').count(), neighbors.incoming.length + neighbors.outgoing.length);
      result.observations.candidateWalk.push({ order: r.order, label: model.label(r), nextOrder: model.byId.get(r.flow.next)?.order ?? null });
      if (r.id === laneRecords[1].id) await shot('04-candidate-lanes');
    }
    const terminal = model.registrations.find(r => r.control?.value?.terminal && !r.control.value.normal && r.flow.next);
    if (terminal) { await select(terminal); assert.ok((await page.locator('#view-controls').textContent()).includes('terminal outcome stops')); result.observations.terminalWithNextCandidate = terminal.order; }
    await select(reused);
    assert.ok((await page.locator('#details').textContent()).includes(instances.length + ' registration instances'));
    result.observations.reuse = { definition: reused.handlerId, orders: instances.map(r => r.order), distinctMountPaths: new Set(instances.map(r => JSON.stringify(r.mountPath))).size };
    await page.locator('#details button').filter({ hasText: '↗ #' + instances.find(r => r.id !== reused.id).order + ' ' }).click();
    await view('dependencies');
    await timed('bindingLens', () => page.getByLabel('Inspect', { exact: true }).selectOption('binding:' + scenario.bindingId));
    const consumer = model.byId.get(association.consumerRegistrationId);
    // Find the chosen consumer on bounded pages; never change evidence to make
    // an attractive example or infer missing consumers from authored ownership.
    while (!(await graphNode(consumer).count())) { const next = page.getByRole('button', { name: 'Next Consumers', exact: true }); assert.ok(await next.isEnabled()); await next.click(); }
    await graphNode(consumer).click(); await page.getByLabel('Explanation', { exact: true }).selectOption(association.id);
    assert.equal(await page.locator('.hops button').count(), association.via.length);
    result.observations.dependency = { bindingId: scenario.bindingId, owners: model.dependency('binding:' + scenario.bindingId).owners.length, consumers: model.dependency('binding:' + scenario.bindingId).consumers.length, selectedConsumerOrder: consumer.order, association, useSite: use };
    await shot('05-dependency-lens'); await page.locator('#explanation').screenshot({ path: path.join(output, '06-explanation.png') }); result.screenshots.push('06-explanation.png');
    await view('atlas'); await page.getByRole('button', { name: 'Application', exact: true }).click();
    await timed('expandAll', async () => { while (await page.locator('#expand-level').isEnabled()) await page.locator('#expand-level').click(); });
    const all = atlasLayout(model, { open: new Set(model.registrations.filter(r => r.kind === 'mount').map(r => r.id)) });
    assert.equal(await page.locator('.node').count(), all.placements.length);
    await page.locator('#fit-graph').click(); await settled();
    result.observations.expanded = { nodes: all.placements.length, width: all.width, height: all.height, fit: await page.locator('#zoom-reset').textContent(), viewportHeight: await page.locator('#viewport').evaluate(e => e.clientHeight), scrollHeight: await page.locator('#viewport').evaluate(e => e.scrollHeight) };
    await shot('07-expanded-fit');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
    assert.deepEqual(JSON.parse(fs.readFileSync(await (await downloadPromise).path(), 'utf8')), capsule); result.exactExport = true;
    await page.setViewportSize({ width: 390, height: 844 }); await select(route); await settled();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot('08-mobile', true); result.mobileWidth = 390;
    assert.deepEqual(result.browserErrors, []); assert.deepEqual(result.networkRequests, []);
    result.status = 'passed'; save(); console.log(JSON.stringify({ status: result.status, output, counts: result.counts, timingsMs: result.timingsMs }));
  } catch (error) { result.status = 'failed'; result.error = error.stack; save(); throw error; }
  finally { if (browser) await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
