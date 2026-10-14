#!/usr/bin/env node
'use strict';
// Optional browser validation of the supported renderer; no production dependency.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
async function main(){
  const file=process.argv[2];if(!file)throw Error('Usage: node scripts/spikes/check-integrated-atlas-browser.cjs <report.html>');
  const html=fs.readFileSync(file,'utf8'),capsule=JSON.parse(html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const records=capsule.analytics?.registrations||[],index=id=>records.findIndex(r=>r.id===id);
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-gpu','--no-zygote','--single-process']});
  try{
    const errors=[],requests=[],context=await browser.newContext({viewport:{width:1600,height:1150},acceptDownloads:true,colorScheme:'dark'}),page=await context.newPage();
    const observe=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});};observe(page);
    const start=Date.now();await page.goto(pathToFileURL(path.resolve(file)).href+'#atlas');await page.waitForSelector('#atlas-rows');const loadMs=Date.now()-start;
    assert.ok((await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).includes("style-src-attr 'none'"));
    assert.equal(await page.locator('[style]').count(),0);
    if(records.length){
      const mount=records.filter(r=>r.kind==='mount'&&!r.mountPath.length).sort((a,b)=>records.filter(r=>r.mountPath.includes(b.id)).length-records.filter(r=>r.mountPath.includes(a.id)).length)[0];assert.ok(mount);
      const node=r=>page.locator('[data-atlas-registration="'+r.id+'"]');
      const select=async r=>{await page.locator('#atlas-search').fill(r.id);await page.locator('#atlas-rows a').click();await page.waitForURL('**#atlas/'+index(r.id));await page.waitForSelector('[data-atlas-registration="'+r.id+'"][aria-pressed="true"]');};
      await node(mount).click();await page.locator('#atlas-focus').click();
      const scoped=records.filter(r=>r.id===mount.id||r.mountPath.includes(mount.id));
      assert.ok((await page.locator('#atlas-count').textContent()).includes(scoped.length+' in scope'));
      assert.equal(await page.locator('#atlas-rows tr').count(),Math.min(50,scoped.length));
      const route=scoped.find(r=>r.kind==='route'&&r.handlerId)||scoped.find(r=>r.handlerId);assert.ok(route);
      await select(route);assert.equal(await node(route).getAttribute('aria-pressed'),'true');
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-atlas-registration')),route.id);
      assert.ok(await page.locator('.atlas-selection').textContent().then(t=>t.includes(route.source.value?.file||'unavailable')));
      await page.locator('#atlas-search').fill('');
      // Keep caret position while replacing the search DOM, including typing in its middle.
      await page.locator('#atlas-search').fill('zz');await page.locator('#atlas-search').press('Home');await page.keyboard.type('x');assert.equal(await page.locator('#atlas-search').inputValue(),'xzz');
      await page.locator('#atlas-search').fill('');
      await page.getByRole('button',{name:'Fit scope',exact:true}).click();assert.ok(parseInt(await page.locator('#atlas-zoom').textContent())>=65);
      await page.getByRole('button',{name:'Zoom in',exact:true}).click();
      await page.getByRole('button',{name:'Center selection',exact:true}).click();
      const rect=await node(route).boundingBox(),v=await page.locator('#atlas-viewport').boundingBox();assert.ok(rect.x>=v.x-2&&rect.x+rect.width<=v.x+v.width+2);
      await node(route).focus();await page.keyboard.press('ArrowLeft');await page.waitForURL('**#atlas/'+index(route.mountPath.at(-1)));await page.waitForSelector('[data-atlas-registration="'+route.mountPath.at(-1)+'"][aria-pressed="true"]');
      const parent=records[index(route.mountPath.at(-1))];assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-atlas-registration')),parent.id);
      await page.goBack();await page.waitForURL('**#atlas/'+index(route.id));await page.waitForSelector('[data-atlas-registration="'+route.id+'"][aria-pressed="true"]');assert.equal(await node(route).getAttribute('aria-pressed'),'true');
      await page.locator('.atlas-selection a[href="#registrations/'+index(route.id)+'"]').click();await page.waitForSelector('#registration-title');
      await page.getByRole('link',{name:'Show in execution atlas',exact:true}).click();await page.waitForSelector('#atlas-rows');assert.equal(await node(route).getAttribute('aria-pressed'),'true');
      await page.locator('.atlas-selection a[href^="#handlers/"]').click();await page.waitForSelector('#definition-title');await page.goBack();await page.waitForSelector('#atlas-rows');
      const allRows=[];await page.getByRole('button',{name:'Application',exact:true}).click();
      for(;;){allRows.push(...await page.locator('#atlas-rows tr[data-atlas-row]').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-atlas-row'))));const next=page.getByRole('button',{name:'Next page',exact:true});if(!await next.isEnabled())break;await next.click();}
      assert.deepEqual(allRows,records.slice().sort((a,b)=>a.order-b.order).map(r=>r.id),'all retained records remain reachable through table pages');
      const first=records.find(r=>r.kind==='route');await select(first);await page.locator('#atlas-search').fill('');
      if(process.env.ATLAS_SCREENSHOT){await page.locator('#view-atlas').screenshot({path:process.env.ATLAS_SCREENSHOT});}
      await page.locator('#theme-button').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    }else assert.ok((await page.locator('#view-atlas').textContent()).includes('unavailable'));
    const download=page.waitForEvent('download');await page.locator('#export-button').click();assert.deepEqual(JSON.parse(fs.readFileSync(await(await download).path(),'utf8')),capsule);
    const mobile=await context.newPage();observe(mobile);await mobile.setViewportSize({width:390,height:844});await mobile.goto(pathToFileURL(path.resolve(file)).href+'#atlas');await mobile.waitForSelector('#atlas-rows');assert.equal(await mobile.locator('.atlas-node').count(),0,'narrow view starts list-first');
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(records.length){await mobile.locator('#atlas-rows a').first().click();await mobile.waitForURL('**#atlas/*');await mobile.locator('#atlas-toggle').click();assert.ok(await mobile.locator('.atlas-node').count()>0);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log(JSON.stringify({status:'passed',browser:await browser.version(),loadMs,registrations:records.length,exactExport:true,strictCsp:true,networkRequests:0,browserErrors:0,mobileWidth:390}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
