#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {createReportViewModel}=require('../../wasm/packages/cli/src/internal/report/viewer/model');
async function main(){
  const file=path.resolve(process.argv[2]),capsule=JSON.parse(fs.readFileSync(file,'utf8').match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]),m=createReportViewModel(capsule);
  const browser=await launchBrowser();
  try{
    const errors=[],requests=[],context=await browser.newContext({viewport:{width:1600,height:1050},acceptDownloads:true,colorScheme:'dark'});
    const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',e=>{if(e.type()==='error')errors.push(e.text());});p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});};
    const page=await context.newPage();observe(page);
    await page.goto(pathToFileURL(file).href+'#atlas');await page.locator('#atlas-workspace-toggle').click();
    assert.equal(await page.locator('#view-atlas').getAttribute('data-expanded'),'true');
    const box=await page.locator('#view-atlas').boundingBox();assert.equal(box.width,1600);assert.equal(box.height,1050);
    assert.equal(await page.locator('.masthead').isVisible(),false);
    // Camera survives expansion and view switches.
    if(m.registrations.length){await page.locator('#atlas-viewport').evaluate(n=>{n.scrollTop=80;n.scrollLeft=25;});}
    const camera=m.registrations.length?await page.locator('#atlas-viewport').evaluate(n=>({x:n.scrollLeft,y:n.scrollTop})):null;
    await page.locator('#atlas-bindings-tab').click();
    assert.ok((await page.locator('#binding-coverage').textContent()).includes(m.analyticsCoverage('associations').status));
    const binding=[...m.bindings.values()].find(b=>m.bindingProjection(b.id).rows.length)||[...m.bindings.values()][0];
    if(binding){
      await page.locator('[data-binding-id="'+binding.id+'"]').click();
      const projection=m.bindingProjection(binding.id);
      assert.ok((await page.locator('#binding-summary').textContent()).includes(projection.consumerCount+' distinct consumers'));
      assert.equal(await page.locator('[data-binding-node="consumer"]').count(),Math.min(12,projection.consumers.length));
      await page.locator('#atlas-routing-tab').click();
      if(camera)assert.deepEqual(await page.locator('#atlas-viewport').evaluate(n=>({x:n.scrollLeft,y:n.scrollTop})),camera);
      await page.locator('#atlas-bindings-tab').click();
      if(projection.rows.length){
        await page.locator('[data-binding-node="consumer"]').first().click();
        assert.equal(await page.locator('#view-atlas').getAttribute('data-inspector'),'true');
        const consumer=projection.consumers[0];assert.ok((await page.locator('#binding-inspector').textContent()).includes(consumer.rows.length+' retained association rows'));
        assert.ok((await page.locator('#binding-inspector').textContent()).includes('Conditional')||(await page.locator('#binding-inspector').textContent()).includes('Direct ownership'));
        const narrow=await page.locator('#binding-inspector').boundingBox();await page.getByRole('button',{name:'Wider details',exact:true}).click();assert.ok((await page.locator('#binding-inspector').boundingBox()).width>narrow.width);
        const r=consumer.registrations[0];await page.getByRole('button',{name:'Reveal '+m.registrationLabel(r),exact:true}).click();await page.waitForURL('**#atlas/'+m.registrationIndex.get(r.id));await page.waitForSelector('[data-atlas-registration="'+r.id+'"][aria-pressed=true]');
        await page.getByRole('button',{name:'Explore bindings',exact:true}).click();
        const selectedBinding=await page.locator('[data-binding-id][aria-pressed=true]').getAttribute('data-binding-id'),scoped=m.bindingProjection(selectedBinding,r.id);
        assert.ok((await page.locator('#binding-summary').textContent()).includes(scoped.rows.length+' retained association rows'));
        assert.ok((await page.locator('#binding-workspace .atlas-crumbs').textContent()).includes(m.registrationLabel(r)));
        await page.locator('[data-binding-node=consumer]').first().click();
        // Existing detail links must reveal routing even after exploring bindings.
        await page.locator('#binding-inspector a[href="#registrations/'+m.registrationIndex.get(r.id)+'"]').first().click();
        await page.getByRole('link',{name:'Show in execution atlas',exact:true}).click();await page.waitForSelector('#atlas-rows');
        assert.equal(await page.locator('#atlas-routing-tab').getAttribute('aria-pressed'),'true');
        await page.locator('#atlas-workspace-toggle').click();await page.getByRole('button',{name:'Explore bindings',exact:true}).click();
        await page.getByRole('button',{name:'All consumers',exact:true}).click();
        await page.locator('#atlas-inspector-toggle').click();
      }
      if(process.env.VIS05_SCREENSHOT)await page.screenshot({path:process.env.VIS05_SCREENSHOT,caret:'initial'});
      await page.keyboard.press('Escape');assert.equal(await page.locator('#view-atlas').getAttribute('data-expanded'),'false');
      assert.equal(await page.locator('#atlas-workspace-toggle').evaluate(n=>n===document.activeElement),true);
      // Inventory entry point selects the requested resource in the same workspace.
      await page.evaluate(()=>location.hash='#bindings');await page.getByRole('button',{name:'Explore '+binding.name+' graph',exact:true}).click();await page.waitForSelector('#binding-summary');
      assert.equal(await page.locator('[data-binding-id][aria-pressed=true]').getAttribute('data-binding-id'),binding.id);
    }
    const mobile=await context.newPage();observe(mobile);await mobile.setViewportSize({width:390,height:844});await mobile.goto(pathToFileURL(file).href+'#atlas');await mobile.locator('#atlas-workspace-toggle').click();await mobile.locator('#atlas-bindings-tab').click();
    if(binding){
      await mobile.locator('#binding-select').selectOption(binding.id);assert.ok((await mobile.locator('#binding-viewport').boundingBox()).height>300,'mobile graph gets real space');
      await mobile.locator('[data-binding-node=binding]').click();assert.equal(await mobile.locator('#view-atlas').getAttribute('data-inspector'),'true');
      const sheet=await mobile.locator('#binding-inspector').boundingBox();assert.ok(sheet.height<=844*.49);assert.ok(Math.abs(sheet.y+sheet.height-844)<2);
      await mobile.locator('#atlas-inspector-toggle').click();assert.equal(await mobile.locator('#binding-inspector').isVisible(),false);
      if(process.env.VIS05_MOBILE_SCREENSHOT)await mobile.screenshot({path:process.env.VIS05_MOBILE_SCREENSHOT,caret:'initial'});
    }
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    for(const p of [page,mobile])assert.deepEqual(await p.locator('[style]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML.slice(0,300))),[]);
    const download=page.waitForEvent('download');await page.locator('#export-button').click();assert.deepEqual(JSON.parse(fs.readFileSync(await(await download).path(),'utf8')),capsule);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log(JSON.stringify({status:'passed',browser:await browser.version(),bindings:m.bindings.size,expandedWorkspace:true,mobileWidth:390,exactExport:true,strictCsp:true,networkRequests:0,browserErrors:0}));
  }finally{await browser.close();}
}
function launchBrowser(){return chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote','--single-process']});}
main().catch(e=>{console.error(e);process.exitCode=1;});
