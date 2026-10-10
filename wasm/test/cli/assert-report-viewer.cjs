#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const f = require('./report-fixtures.cjs');
const { serializeCapsule } = require(path.join(f.reportRoot, 'capsule'));
const { renderReport } = require(path.join(f.reportRoot, 'viewer'));
const { createReportViewModel } = require(path.join(f.reportRoot, 'viewer/model'));
const { projectSchema } = require(path.join(f.reportRoot, 'schema-projection'));
const { writeHtml } = require(path.join(f.reportRoot, 'output'));
const { scan, sameSnapshot } = require(path.join(f.reportRoot, 'snapshot'));
const { sha256 } = require(path.join(f.reportRoot, 'data'));
const payload = html => html.match(/<script id="pulse-report-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
const hostile = '</script><script>alert("canary")</script><img src=x onerror=alert(1)>\u2028\u2029\u0001javascript:alert(1) & "';
for (const rich of [false, true]) {
  const input = f.fixture(rich);
  input.application.name = hostile;
  if (rich) {
    input.routes[0].path = '/' + hostile; input.routes[0].handlerName = hostile;
    input.schemas[0].schemaId = hostile; input.bindings[0].name = hostile;
    input.resources[0].name = hostile; input.evidence[0].method = hostile;
  }
  const capsule = f.createCapsule(input), json = serializeCapsule(capsule), html = renderReport(capsule);
  assert.equal(html, renderReport(capsule), 'deterministic HTML');
  assert.deepEqual(JSON.parse(payload(html)), capsule);
  assert.equal(serializeCapsule(JSON.parse(payload(html))), json);
  assert.ok(!/[<>&\u2028\u2029]/.test(payload(html)), 'data cannot escape the script container');
  assert.equal((html.match(/<script\b/g) || []).length, 2, 'one inert payload and one fixed executable script');
  assert.ok(!html.includes(hostile));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  new vm.Script(script);
  for (const content of [script, css]) assert.ok(html.includes("'sha256-" + crypto.createHash('sha256').update(content).digest('base64') + "'"));
  assert.match(html, /connect-src 'none'/); assert.match(html, /style-src-attr 'none'/);
  assert.ok(!/\b(?:eval|Function|fetch|XMLHttpRequest|WebSocket|Worker|importScripts)\s*\(|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\.style[.=]/.test(script));
  assert.ok(!/<(?:script|link|img|iframe)\b[^>]*(?:src|href)\s*=/.test(html));
  assert.ok(!/@import|url\(/i.test(css));
  assert.ok(!/\son\w+=|\sstyle=/.test(html.slice(0, html.indexOf('<script id='))), 'fixed shell has no event or style attributes');
  const model = createReportViewModel(capsule);
  model.state.search = 'no match'; model.state.expandedSchemas.add('presentation-only');
  assert.equal(model.filteredRoutes().length, 0);
  assert.equal(model.canonicalJson, json, 'view state never narrows export');
  assert.equal(model.canonicalJson, serializeCapsule(capsule));
  for (const mode of ['current', 'artifact', 'historical']) assert.match(renderReport(capsule, {snapshot:mode}), new RegExp('name="pulse-report-snapshot" content="'+mode+'"'));
}
const wrong = JSON.parse(serializeCapsule(f.createCapsule(f.fixture()))); wrong.application.name = 'modified';
assert.throws(() => renderReport(wrong), {code:'REPORT_HASH'});
// Pure view projections deliberately vary sort values; these are not claimed
// as physical artifact measurements or passed to the validated renderer.
const input = f.fixture(), route = input.routes[0];
input.routes = [9, 100, null, 2000].map((value, i) => ({...route, id:'view-'+i, order:i, method:i===1?'POST':'GET', path:i===1?'/api/update':'/api/items', handlerName:'handler-'+i, compositionCoverage:i===0?'complete':'bounded', declarationIds:i===1?['decl']:[], bindingIds:i===0?[input.bindings[0].id]:[]}));
input.measurements = [9, 100, null, 2000].map((value,i)=>({id:'measurement-'+i, subjectId:'view-'+i, artifactId:f.aid, stage:'final',metric:'handler-body',fact:value===null?f.unavailable('unsupported-mapping'):f.fact(value)}));
const duplicate = structuredClone(input); duplicate.measurements.push({...structuredClone(duplicate.measurements[0]),id:'another'});
const dm=createReportViewModel(duplicate); assert.equal(dm.measurement(duplicate.routes[0],'handler-body').fact.value,9);
assert.deepEqual(dm.measurement(duplicate.routes[0],'handler-body').recordIds,['measurement-0','another']);
assert.equal(JSON.parse(dm.canonicalJson).measurements.length,5,'equivalent records remain in full export');
for (const change of [row=>row.fact.value++,row=>row.method='different-method',row=>row.rootSetId='different-scope',row=>row.fact.coverage='bounded',row=>row.fact=f.unavailable('missing-evidence')]) {
  const conflicting=structuredClone(duplicate); change(conflicting.measurements.at(-1));
  const cm=createReportViewModel(conflicting);
  assert.equal(cm.measurement(conflicting.routes[0],'handler-body'),undefined);
  assert.equal(cm.measurementResolution(conflicting.routes[0],'handler-body').variants.length,2);
  assert.match(cm.measurementIssue(conflicting.routes[0],'handler-body'),/2 distinct measurements/);
}
const extraEvidence=structuredClone(duplicate);extraEvidence.measurements.at(-1).fact={...extraEvidence.measurements.at(-1).fact,evidenceIds:['second-evidence']};
assert.deepEqual(createReportViewModel(extraEvidence).measurement(extraEvidence.routes[0],'handler-body').fact.evidenceIds,[f.buildId,'second-evidence'].sort());
const richCapsule=f.createCapsule(f.fixture()),richModel=createReportViewModel(richCapsule);
assert.deepEqual(richModel.mappingCoverage('handler-body'),{available:2,total:2});
assert.deepEqual(richModel.mappingCoverage('reachable'),{available:1,total:2});
assert.deepEqual(richModel.mappingCoverage('own'),{available:0,total:2});
assert.equal(richModel.composition(richModel.A).reduce((n,p)=>n+p.bytes,0),richModel.A.bytes);
assert.equal(richModel.composition(richModel.A).find(p=>p.id==='other').bytes,20,'header and non-code sections count once');
assert.equal(richModel.composition({...richModel.A,sectionCoverage:{status:'partial'}}),null,'incomplete sections cannot imply a complete composition');
const allSections={...richModel.A,bytes:66,sections:[...richModel.A.sections,{id:11,bytes:20},{id:0,bytes:10}]};
assert.deepEqual(richModel.composition(allSections).map(p=>p.bytes),[16,20,10,20]);
// Exercise the real rendering functions with a small element recorder. This
// checks generated structure and text, not layout, CSP enforcement or a browser.
function renderedTree(capsule) {
  class Element {
    constructor(tag,namespaceURI) {this.tag=tag;this.namespaceURI=namespaceURI;this.attrs={};this.children=[];this.events={};}
    setAttribute(k,v){this.attrs[k]=String(v);}
    set id(v){this.attrs.id=v;} get id(){return this.attrs.id;}
    set className(v){this.attrs.class=v;}
    set textContent(v){this.children=[String(v)];}
    get textContent(){return this.children.map(n=>typeof n==='string'?n:n.textContent).join('');}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(event,fn){this.events[event]=fn;}
    focus(){}
  }
  const shell=fs.readFileSync(path.join(f.reportRoot,'viewer/shell.html'),'utf8');
  const roots=[...shell.matchAll(/\bid="([^"]+)"/g)].map(m=>{const n=new Element('div');n.id=m[1];return n;});
  const descendants=node=>[node,...node.children.filter(n=>n instanceof Element).flatMap(descendants)];
  const nodes=()=>roots.flatMap(descendants);
  const get=id=>nodes().find(n=>n.id===id);
  const data=new Element('script');data.id='pulse-report-data';data.textContent=JSON.stringify(capsule);roots.push(data);
  const document={querySelector:selector=>selector.startsWith('#')?get(selector.slice(1)):{content:'historical'},querySelectorAll:()=>[],createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>new Element(tag,ns),createTextNode:text=>String(text)};
  const script=fs.readFileSync(path.join(f.reportRoot,'viewer/viewer.js'),'utf8');
  const context={document,Node:Element,createReportViewModel,location:{hash:''}};
  vm.runInNewContext(script.slice(0,script.indexOf("  $$('[data-icon]')"))+"  globalThis.renderers={drawSummary,renderResources,renderSchemas,renderHelpers,renderDrawer,state};\n})();",context);
  context.renderers.drawSummary();context.renderers.renderResources();
  Object.assign(context.renderers.state,{selected:capsule.routes[0].id,drawerTab:'size'});context.renderers.renderDrawer();
  return {get,nodes,renderers:context.renderers};
}
const tree=renderedTree(richCapsule);
require('./report-helper-viewer-cases.cjs')({renderedTree});
require('./report-dispatcher-viewer-cases.cjs')({renderedTree});
const responseCapsule=require('./report-response-payload-cases.cjs').responseFixture().capsule;
const responseTree=renderedTree(responseCapsule), responseModel=createReportViewModel(responseCapsule);
assert.match(responseTree.get('view-resources').textContent,/Canonical text-response sites · complete/);
assert.match(responseTree.get('view-resources').textContent,/Dynamic expressions are unresolved, not zero/);
const responseIndex=responseCapsule.resources.findIndex(row=>row.kind==='response-payload'&&row.inputBytes.value===0);
responseTree.get('resource-expand-'+responseIndex).events.click();
assert.match(responseTree.get('resource-detail-'+responseIndex).textContent,/UTF-8 response payload bytes0 B/);
assert.match(responseTree.get('resource-detail-'+responseIndex).textContent,/Native string storage \(unmapped\)/);
assert.match(responseTree.get('resource-detail-'+responseIndex).textContent,/Retained payloadUnavailable/);
for(const dir of ['asc','desc']) {
  Object.assign(responseModel.state,{resourceSort:'input',resourceDir:dir});
  assert.equal(responseModel.sortedResources().at(-1).inputBytes.value,null);
}
assert.equal(responseModel.canonicalJson,serializeCapsule(responseCapsule));
const usageInput=structuredClone(richCapsule), usageSchema=usageInput.schemas[0];
usageSchema.entryIds=[];
assert.equal(createReportViewModel(usageInput).schemaUsage(usageSchema).label,'Usage tracing not recorded');
usageInput.references=[];
assert.equal(createReportViewModel(usageInput).schemaUsage(usageSchema).label,'No observed use · not proven unused');
usageInput.references=[{kind:'schema',targetId:usageSchema.id,entryCoverage:{status:'unavailable'},externalPackages:['@pulse-compute/jwt']}];
assert.equal(createReportViewModel(usageInput).schemaUsage(usageSchema).label,'Referenced · consumer unresolved');
const usageTree=renderedTree(usageInput);
usageTree.renderers.renderSchemas();
assert.match(usageTree.get('schema-body').textContent,/External dependency · @pulse-compute\/jwt/);
assert.match(usageTree.get('schema-body').textContent,/Referenced · consumer unresolved/);
usageTree.get('schema-expand-0').events.click();
assert.match(usageTree.get('schema-detail-0').textContent,/Known consuming entries0/);
usageSchema.entryIds=['known'];usageInput.references[0].entryCoverage.status='partial';
assert.equal(createReportViewModel(usageInput).schemaUsage(usageSchema).label,'Used · consumer coverage incomplete');
usageInput.references[0].entryCoverage.status='complete';
assert.equal(createReportViewModel(usageInput).schemaUsage(usageSchema).label,'Used');
assert.match(tree.get('compact-coverage').textContent,/2 \/ 2Handler mappings1 \/ 2Reachability roots/);
assert.equal(tree.nodes().filter(n=>n.tag==='svg'&&n.attrs.class==='ledger-bar').length,2,'composition chart in summary and resources');
for(const chart of tree.nodes().filter(n=>n.tag==='svg'&&n.attrs.class==='ledger-bar')) {
  assert.equal(chart.children.reduce((sum,r)=>sum+Number(r.attrs.width),0),richModel.A.bytes);
  assert.ok(chart.children.every(r=>r.tag==='rect'&&r.attrs.style===undefined));
}
assert.equal(tree.nodes().filter(n=>n.attrs.class==='size-grid')[0].children.length,4);
assert.match(tree.get('view-resources').textContent,/Input bytes.*Representation bytes.*Retained payload/);
assert.match(tree.get('view-resources').textContent,/Physical total36 B36 bytes/);
tree.get('resource-expand-0').events.click();
assert.equal(tree.get('resource-expand-0').attrs['aria-expanded'],'true');
assert.match(tree.get('resource-detail-0').textContent,/unsupported-mapping/);
assert.match(tree.get('drawer-content').textContent,/code bodies only; embedded asset and schema data are excluded/);
const generated=f.fixture();
require(path.join(f.reportRoot,'resource-inventory')).addResourceInventory(generated,{
  reportReferences:{version:'pulse.compiler-report-references.v1',references:[{kind:'resource',state:'resolved',canonicalId:'asset',resource:{encodedBytes:16}}]},
  native:{manifest:{schemaCodecs:{codecs:[{id:'app.UpdateInput'}]},packageRealizationArtifacts:{version:'pulse.package-realization-artifact-set.v1',count:0}},guestUnits:[]}
},[f.buildId]);
for(const resource of generated.resources)resource.routeIds=generated.routes.filter(route=>route.composition.some(id=>resource.entryIds.includes(id))).map(row=>row.id);
generated.coverage.resources={status:'partial',observed:generated.resources.length,expected:null,reason:'incomplete-mapping'};
const generatedCapsule=f.createCapsule(generated),generatedTree=renderedTree(generatedCapsule);
assert.match(generatedTree.get('view-resources').textContent,/Packed base64 text/);
assert.match(generatedTree.get('view-resources').textContent,/Normalized descriptor/);
assert.match(generatedTree.get('view-resources').textContent,/Package realization records · complete0 recorded \/ 0 expected/);
assert.match(generatedTree.get('view-resources').textContent,/Other generated support · unavailable0 recorded \/ unknown expected/);
generatedTree.get('resource-sort-representation').events.click();
assert.equal(generatedTree.renderers.state.resourceSort,'representation');
const schemaResource=generatedCapsule.resources.findIndex(row=>row.kind==='schema-validator');
generatedTree.get('resource-expand-'+schemaResource).events.click();
assert.match(generatedTree.get('resource-detail-'+schemaResource).textContent,/Source input bytesNot applicable/);
generatedTree.nodes().find(node=>node.tag==='button'&&node.textContent==='View schema structure').events.click();
assert.ok(generatedTree.renderers.state.expandedSchemas.has(generatedCapsule.schemas[0].id));
const conflictCapsule=structuredClone(richCapsule);
const original=conflictCapsule.measurements.find(m=>m.subjectId===conflictCapsule.routes[0].id&&m.metric==='handler-body');
conflictCapsule.measurements.push({...original,id:f.id('measurement','second-body'),fact:{...original.fact,value:2},bodyIds:['body:'+f.hash+':2']});
const conflictTree=renderedTree(f.createCapsule(conflictCapsule));
assert.match(conflictTree.get('drawer-content').textContent,/Multiple measurements/);
assert.match(conflictTree.get('drawer-content').textContent,/2 bytes/);
assert.match(conflictTree.get('drawer-content').textContent,/4 bytes/);
assert.equal(conflictTree.nodes().filter(n=>n.attrs.class==='measurement-record').length,4,'both conflicting handler records remain inspectable alongside reachable and own');
const m = createReportViewModel(input), ids = () => m.filteredRoutes().map(r=>r.id);
Object.assign(m.state,{sort:'size',dir:'asc'}); assert.deepEqual(ids(), ['view-0','view-1','view-3','view-2']);
m.state.dir='desc'; assert.deepEqual(ids(), ['view-3','view-1','view-0','view-2']);
m.state.availability='unavailable'; assert.deepEqual(ids(), ['view-2']);
m.state.metric='own'; assert.equal(ids().length,4, 'unknown sizes never become zero');
Object.assign(m.state,{metric:'handler-body',availability:'all',sort:'order',dir:'asc',method:'POST'}); assert.deepEqual(ids(), ['view-1']);
m.state.search='handler-0'; assert.deepEqual(ids(), [], 'filters compose');
Object.assign(m.state,{method:'all',search:'',declaration:'not-declared'}); assert.deepEqual(ids(), ['view-0']);
m.state.declaration='recorded'; assert.deepEqual(ids(), ['view-1']);
m.state.declaration='unavailable'; assert.deepEqual(ids(), ['view-2','view-3']);
Object.assign(m.state,{declaration:'all',binding:input.bindings[0].id}); assert.deepEqual(ids(), ['view-0']);
Object.assign(m.state,{binding:'all',group:'/api/update'}); assert.deepEqual(ids(), ['view-1']);
Object.assign(m.state,{group:'all',search:'handler-3'}); assert.deepEqual(ids(), ['view-3']);
assert.equal(JSON.parse(m.canonicalJson).routes.length, 4, 'filtered records retained in export');
const shapes = [
  {kind:'object',fields:[{name:'update',required:true,value:{kind:'string'}},{name:'optional',required:false,value:{kind:'boolean'}}]},
  {kind:'string'}, {kind:'object',fields:[]}, {kind:'unsupported-reference'}
];
const schemaInput=f.fixture();
schemaInput.schemas=shapes.map((root,i)=>({...schemaInput.schemas[0],id:'schema-'+i,schemaId:'Update'+i,structure:projectSchema({root}),routeIds:i===0?schemaInput.schemas[0].routeIds:[]}));
const sm=createReportViewModel(schemaInput);
for(const sort of ['keys','required','descriptor','refs','name']) for(const dir of ['asc','desc']) {
  Object.assign(sm.state,{schemaSort:sort,schemaDir:dir});
  const rows=sm.filteredSchemas(); assert.equal(rows.length,4);
  if(sort==='keys'||sort==='required') assert.deepEqual(rows.slice(-2).map(s=>s.id),['schema-1','schema-3'], 'N/A and unavailable remain last');
}
sm.state.schemaSearch='optional'; assert.deepEqual(sm.filteredSchemas().map(s=>s.id),['schema-0']);
assert.equal(sm.filteredSchemas()[0].structure.properties.find(p=>p.name==='optional').required,false);
assert.equal(sm.canonicalJson.includes('schema-3'),true);
const unknown=f.fixture(false);
for(const c of Object.values(unknown.coverage)) Object.assign(c,{status:'unavailable',reason:'missing-evidence',expected:null});
assert.equal(createReportViewModel(f.createCapsule(unknown)).inventoryCount('schemas'),'Unavailable');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-viewer-'));
try {
  fs.writeFileSync(path.join(directory,'input.html'),'ordinary source');
  const baseline=scan(directory), html=renderReport(f.createCapsule(f.fixture()));
  const destinations=['.pulse/reports/pulse-report.html','reviews/custom.html'];
  for(const destination of destinations) {
    writeHtml(directory,destination,html,{recordOutput:true});
    sameSnapshot(baseline,scan(directory));
    writeHtml(directory,destination,html,{recordOutput:true});
    sameSnapshot(baseline,scan(directory));
    const file=path.join(directory,destination), marker=path.join(path.dirname(file),'.pulse-report-outputs');
    assert.equal(fs.readdirSync(marker).length,1);
    const receiptFile=path.join(marker,fs.readdirSync(marker)[0]), receipt=JSON.parse(fs.readFileSync(receiptFile));
    assert.equal(receipt.file,path.basename(file)); assert.deepEqual(receipt.hashes,[sha256(html)]);
    fs.appendFileSync(file,'edited');
    assert.throws(()=>sameSnapshot(baseline,scan(directory)),{code:'REPORT_STALE_INPUTS'});
    fs.writeFileSync(file,html);
    const rename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to===file)throw Error('injected HTML replacement failure');return rename(from,to);};
    try { assert.throws(()=>writeHtml(directory,destination,html+'new',{recordOutput:true}),{code:'PULSE_REPORT_OUTPUT_FAILED'}); }
    finally {fs.renameSync=rename;}
    assert.equal(fs.readFileSync(file,'utf8'),html); sameSnapshot(baseline,scan(directory));
    assert.equal(fs.readdirSync(path.dirname(file)).some(name=>/^\.pulse-report-[a-f0-9]/.test(name)),false);
    fs.writeFileSync(receiptFile,'{}'); assert.throws(()=>scan(directory),{code:'REPORT_INPUT_UNBOUND'});
    fs.writeFileSync(receiptFile,JSON.stringify(receipt));
    fs.renameSync(marker,marker+'-saved'); fs.symlinkSync(marker+'-saved',marker);
    assert.throws(()=>scan(directory),{code:'REPORT_PATH'}); fs.unlinkSync(marker); fs.renameSync(marker+'-saved',marker);
  }
  assert.throws(()=>writeHtml(directory,'input.html',html,{recordOutput:true,inputFiles:baseline.records.map(row=>row.file)}),{code:'PULSE_REPORT_OUTPUT_UNSAFE'});
  assert.equal(fs.readFileSync(path.join(directory,'input.html'),'utf8'),'ordinary source');
  // Even a matching receipt cannot silently remove an already recorded input.
  const receiptRoot=path.join(directory,'.pulse-report-outputs');fs.mkdirSync(receiptRoot);
  fs.writeFileSync(path.join(receiptRoot,sha256('input.html')+'.json'),JSON.stringify({kind:'pulse.report-output',version:1,file:'input.html',hashes:[sha256('ordinary source')]}));
  assert.throws(()=>sameSnapshot(baseline,scan(directory)),{code:'REPORT_STALE_INPUTS'});
  fs.rmSync(receiptRoot,{recursive:true});
  fs.writeFileSync(path.join(directory,'unrelated.html'),'not a generated report');
  assert.ok(scan(directory).records.some(row=>row.file==='unrelated.html'));
  assert.ok(scan(directory,{packageFiles:true}).records.some(row=>row.file==='reviews/custom.html'), 'package bytes cannot be receipt-excluded');
} finally {fs.rmSync(directory,{recursive:true,force:true});}
console.log('ok - offline HTML encoding/CSP, exact export, route/schema projections, unknown states, safe repeatable outputs; browser qualification remains separate');
