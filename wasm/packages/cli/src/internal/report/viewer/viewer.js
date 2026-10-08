'use strict';
(() => {
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const P = JSON.parse($('#pulse-report-data').textContent);
  const glyphs = {
    routes:['M4 6h7M4 12h11M4 18h7','m15 3 4 3-4 3','m19 9 4 3-4 3','m15 15 4 3-4 3'],
    box:['m12 3 9 5-9 5-9-5 9-5Z','m3 8 0 9 9 5 9-5V8','M12 13v9','m7 5 9 5'],
    layers:['m12 3 10 5-10 5L2 8l10-5Z','m2 12 10 5 10-5','m2 16 10 5 10-5'],
    link:['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2','M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
    evidence:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','M14 2v6h6','M8 13h8M8 17h5'],
    code:['m8 7-5 5 5 5','m16 7 5 5-5 5','m14 4-4 16'],
    download:['M12 3v12','m7 10 5 5 5-5','M4 16v4h16v-4'],
    sun:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8','M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'],
    moon:['M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z'],
    search:['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15','m16 16 5 5'],
    filter:['M4 6h16M7 12h10M10 18h4'],
    sliders:['M4 7h6M14 7h6M4 17h10M18 17h2','M10 4v6M14 14v6'],
    info:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20','M12 11v6M12 7h.01'],
    flask:['M9 3h6M10 3v6l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 9V3','M8 14h8'],
    'arrow-up-right':['M6 18 18 6M6 6h12v12'],
    'arrow-right':['M4 12h16','m14 6 6 6-6 6'],
    'arrow-left':['M20 12H4','m10 6-6 6 6 6'],
    'arrow-down':['M12 4v16','m6 14 6 6 6-6'],
    'arrow-up':['M12 20V4','m6 10 6-6 6 6'],
    'chevron-right':['m9 5 7 7-7 7'],
    'chevron-down':['m5 9 7 7 7-7'],
    close:['m6 6 12 12M6 18 18 6'],
    lock:['M5 10h14v11H5Z','M8 10V6a4 4 0 0 1 8 0v4','M12 14v3'],
    globe:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20','M2 12h20','M12 2c6 6 6 14 0 20-6-6-6-14 0-20'],
    key:['M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3','m12 12 9 9M17 17l3-3M14 14l3-3'],
    dash:['M5 12h14'],
    question:['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20','M9.5 8a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 17h.01'],
    file:['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z','M14 2v6h6'],
    database:['M3 6c0-5 18-5 18 0s-18 5-18 0Z','M3 6v12c0 5 18 5 18 0V6','M3 12c0 5 18 5 18 0'],
    chip:['M7 7h10v10H7Z','M9 2v5M15 2v5M9 17v5M15 17v5M2 9h5M2 15h5M17 9h5M17 15h5'],
    copy:['M9 9h12v12H9Z','M15 9V3H3v12h6'],
    git:['M6 3v12a3 3 0 1 0 3 3','M6 9h8a4 4 0 0 0 4-4','M18 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6','M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
    check:['m5 12 4 4L19 6'],
    terminal:['m4 6 6 6-6 6M13 18h7'],
  };
  function icon(name) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);
    for(const d of glyphs[name]||glyphs.file){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}
    return svg;
  }
  function el(tag, attrs={}, ...children) {
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs)){
      if(value===null||value===undefined||(value===false&&!key.startsWith('aria-')))continue;
      if(key==='class')node.className=value;
      else if(key==='text')node.textContent=value;
      else if(key==='on')for(const [event,fn] of Object.entries(value))node.addEventListener(event,fn);
      else if(key==='checked')node.checked=!!value;
      else node.setAttribute(key,typeof value==='boolean'&&key.startsWith('aria-')?String(value):value===true?'':String(value));
    }
    for(const child of children.flat(Infinity))if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
    return node;
  }
  function replace(node,...children){node.replaceChildren(...children.flat(Infinity).filter(value=>value!==null&&value!==undefined));return node;}
  function bytes(value, precision=1){
    if(value===null||value===undefined)return '—';
    if(value<1024)return value+' B';
    if(value<1048576)return (value/1024).toFixed(precision).replace(/\.0$/,'')+' KiB';
    return (value/1048576).toFixed(precision).replace(/\.0$/,'')+' MiB';
  }
  const {canonicalJson,A,routes,schemas,bindings,evidence,declarations,routeIndex,schemaIndex,metrics,measurement,measurementIssue,factValue,qualifier,sourceText,inventoryCount,prefix,declarationState,declarationLabels,state,filteredRoutes,filteredSchemas} = createReportViewModel(P);
  const factText = f => f?.state === 'not-applicable' ? 'Not applicable' : factValue(f) === null ? 'Unavailable' : bytes(f.value);
  const exact = value => value == null ? 'Unavailable' : value.toLocaleString('en-US') + ' bytes';
  let visibleRoutes = [], lastDrawerFocus, lastModalFocus, toastTimer;
  const navigation = [['routes','Routes','routes'],['resources','Resources','box'],['schemas','Schemas','layers'],['bindings','Bindings','link'],['evidence','Evidence','evidence']];
  const button = (label, fn, cls='button subtle') => el('button',{type:'button',class:cls,on:{click:fn}},label);
  const note = text => el('div',{class:'plain-note'},icon('info'),el('p',{},text));
  const kv = entries => el('dl',{class:'kv-list'},entries.map(([key,value]) => el('div',{class:'kv-row'},el('dt',{},key),el('dd',{class:'record-text'},value))));
  const sectionHeading = (title, desc, count) => el('div',{class:'section-heading'},el('div',{},el('h2',{},title,count == null ? null : el('span',{class:'count-pill'},count)),el('p',{},desc)));
  const methodTag = method => el('span',{class:'method ' + (['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(method) ? 'method-' + method : '')},method);
  const tag = text => el('span',{class:'evidence-label'},text);
  const routeChips = ids => el('div',{class:'route-chips'},ids.map(id => {
    const r = routes.get(id); return r ? el('a',{class:'route-chip',href:'#routes/' + routeIndex.get(id)},r.method + ' ' + r.path) : el('span',{},'Unknown route reference');
  }));
  function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 3000); }
  function downloadCapsule() {
    const url = URL.createObjectURL(new Blob([canonicalJson],{type:'application/json;charset=utf-8'}));
    const a = el('a',{href:url,download:'pulse-report.json'}); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url),1500); toast('Complete capsule exported. View filters do not change evidence.');
  }
  function buildNavigation() {
    for (const root of [$('#desktop-nav'),$('#mobile-nav')]) replace(root,navigation.map(([id,label,glyph]) => el('a',{class:'nav-link',href:'#'+id,'data-view':id},icon(glyph),label,id === 'evidence' ? null : el('span',{class:'nav-count'},P[id].length))));
  }
  function ledger(artifact) {
    const names = {0:'Custom',1:'Type',2:'Import',3:'Function',4:'Table',5:'Memory',6:'Global',7:'Export',8:'Start',9:'Element',10:'Code',11:'Data',12:'Data count',13:'Tag'};
    return el('div',{},el('div',{class:'ledger-sections'},el('span',{},'Header ',el('code',{},'8 B')),artifact.sections.map(s => el('span',{},names[s.id] || 'Section '+s.id, ' ',el('code',{title:exact(s.bytes)},bytes(s.bytes))))),el('p',{class:'small-note'},`Physical bytes: ${exact(artifact.bytes)} · section coverage: ${artifact.sectionCoverage.status}. Sections include framing; payload bytes are separate.`));
  }
  function drawSummary() {
    for (const id of ['app-name','sidebar-app','crumb-app']) $('#'+id).textContent = P.application.name;
    document.title = P.application.name + ' · Pulse Report';
    $('#profile-name').textContent = P.context.profile; $('#host-name').textContent = P.context.host + ' · native';
    const mode = $('meta[name="pulse-report-snapshot"]').content;
    $('#snapshot-label').textContent = mode === 'current' ? 'Retained completed build · current inputs matched.' : mode === 'artifact' ? 'Completed artifact verified · current project not checked.' : 'Historical capsule replay · current project and original artifact bytes not checked.';
    $('#revision-label').textContent = 'Revision: ' + (P.provenance.revision ?? 'unknown') + ' · dirty: ' + (P.provenance.dirty === null ? 'unknown' : P.provenance.dirty ? 'yes' : 'no');
    $('#hash-button').textContent = P.evidenceHash.value.slice(0,12); $('#hash-button').title = 'SHA-256 ' + P.evidenceHash.value;
    const items = [['Wasm artifact',bytes(A.bytes),exact(A.bytes)+' · '+A.stage,'resources'],['Route registrations',inventoryCount('routes'),P.coverage.routes.status+' inventory · '+new Set(P.entries.map(e=>e.handlerId).filter(Boolean)).size+' recorded handlers','routes'],['Schemas',inventoryCount('schemas'),P.coverage.schemas.status+' structural coverage','schemas'],['Resources',inventoryCount('resources'),'Input bytes and retained payload stay distinct','resources']];
    replace($('#summary-strip'),items.map(([label,value,sub,view])=>el('a',{class:'summary-item clickable',href:'#'+view},el('div',{class:'summary-top'},label,icon(view === 'routes' ? 'routes' : 'box')),el('div',{class:'summary-value'+(value==='Unavailable'?' small':'')},value),el('div',{class:'summary-sub'},sub))));
    $('#route-total').textContent = P.routes.length;
    const mapped = P.routes.filter(r=>factValue(measurement(r,'handler-body')?.fact)!==null).length;
    $('#mapping-label').textContent = `${mapped} / ${P.routes.length} handler mappings · ${A.stage}`;
    replace($('#compact-ledger'),ledger(A));
    replace($('#compact-coverage'),['routes','schemas','resources'].map(name=>el('div',{class:'coverage-mini'},el('div',{class:'number'},P.coverage[name].status),el('span',{class:'coverage-label'},name+' inventory'))));
  }
  function populateFilters() {
    const add = (id, rows) => rows.forEach(([value,label])=>$('#'+id).append(el('option',{value},label)));
    add('filter-method',[...new Set(P.routes.map(r=>r.method))].map(x=>[x,x]));
    add('filter-declaration',Object.entries(declarationLabels)); add('filter-binding',P.bindings.map(b=>[b.id,b.name]));
    const groups = [...new Set(P.routes.map(prefix))].sort();
    const select = el('select',{id:'filter-group',class:'route-group-select','aria-label':'Filter by route path prefix',on:{change:e=>{state.group=e.target.value;renderRoutes();}}},el('option',{value:'all'},'All path prefixes'),groups.map(x=>el('option',{value:x},x)));
    replace($('#route-groups'),el('label',{},'Path prefix ',select));
  }
  function readRouteFilters() {
    state.search = $('#route-search').value.trim().toLowerCase(); state.method = $('#filter-method').value; state.declaration = $('#filter-declaration').value;
    state.binding = $('#filter-binding').value; state.availability = $('#filter-size').value; renderRoutes();
  }
  function resetRoutes() {
    Object.assign(state,{search:'',group:'all',method:'all',declaration:'all',binding:'all',availability:'all',metric:'handler-body',sort:'order',dir:'asc'});
    $('#route-search').value=''; for(const id of ['filter-group','filter-method','filter-declaration','filter-binding','filter-size']) $('#'+id).value='all'; $('#size-metric').value='handler-body';renderRoutes();
  }
  function renderRoutes() {
    visibleRoutes = filteredRoutes();
    replace($('#route-body'),visibleRoutes.map(r => {
      const m=measurement(r,state.metric),value=factValue(m?.fact);
      return el('tr',{'data-route-index':routeIndex.get(r.id)},el('td',{class:'order-col mono'},r.order+1),el('td',{},methodTag(r.method)),el('td',{},el('a',{class:'route-link mono',href:'#routes/'+routeIndex.get(r.id)},r.path),el('div',{class:'secondary mono'},r.handlerName??'Handler name unavailable')),
        el('td',{},el('span',{class:'declaration'},declarationLabels[declarationState(r)])),el('td',{},r.schemaIds.length+' refs'),el('td',{},r.bindingIds.length+' refs'),el('td',{class:'numeric',title:m?qualifier(m.fact):measurementIssue(r,state.metric)},el('div',{},value===null?factText(m?.fact):bytes(value)),el('div',{class:'secondary'},value===null?(m?.fact.reason??measurementIssue(r,state.metric)):m.fact.coverage)),el('td',{},el('a',{href:'#routes/'+routeIndex.get(r.id),'aria-label':'Open '+r.method+' '+r.path},icon('chevron-right'))));
    }));
    $('#route-empty').hidden = visibleRoutes.length!==0;
    $('#route-result-count').textContent = `${visibleRoutes.length} of ${P.routes.length} registrations · ${P.coverage.routes.status} inventory`;
    $('#size-column-label').textContent = metrics[state.metric];
    $('#sort-description').textContent = (state.sort==='size'?metrics[state.metric]:state.sort)+' · '+state.dir+' · unavailable last';
    for(const key of ['order','method','path','size']) $('#th-'+key).setAttribute('aria-sort',state.sort===key?(state.dir==='asc'?'ascending':'descending'):'none');
    $('#reset-routes').hidden = false;
  }
  const detailSection = (label,...nodes) => el('section',{class:'detail-section'},el('div',{class:'detail-label'},label),...nodes);
  const evidenceCards = ids => ids.length ? ids.map(id => {const e=evidence.get(id);return el('article',{class:'evidence-record'},el('h4',{},e.id),kv([['Producer',e.producer.name+' '+e.producer.version],['Result',e.result],['Method',e.method],['Scope',JSON.stringify(e.scope)],['Source',sourceText(e.source)],['Recorded at',e.recordedAt??'Not recorded']]),el('div',{class:'secondary'},e.artifactIds.join(', ')));}) : [el('p',{},'No evidence references recorded.')];
  function openSchema(id) { state.expandedSchemas.add(id); state.schemaSearch=schemas.get(id).schemaId.toLowerCase(); location.hash='schemas/'+schemaIndex.get(id); }
  function renderDrawer() {
    const r=routes.get(state.selected);if(!r)return;
    const index=visibleRoutes.findIndex(x=>x.id===r.id);$('#drawer-previous').disabled=index<=0;$('#drawer-next').disabled=index<0||index===visibleRoutes.length-1;
    $('#drawer-kicker').textContent='REGISTRATION '+(r.order+1)+' · '+A.stage+' artifact';
    const ids=['facts','size','evidence'];
    const tabs=el('div',{class:'drawer-tabs',role:'tablist','aria-label':'Route detail views'},[['facts','Resolved facts'],['size','Size attribution'],['evidence','Evidence trail']].map(([id,label])=>el('button',{class:'drawer-tab'+(state.drawerTab===id?' active':''),role:'tab',id:'drawer-tab-'+id,tabindex:state.drawerTab===id?0:-1,'aria-selected':state.drawerTab===id,'aria-controls':'drawer-panel',on:{click:()=>{state.drawerTab=id;renderDrawer();$('#drawer-tab-'+id).focus();}}},label)));
    tabs.addEventListener('keydown',e=>{let i=ids.indexOf(state.drawerTab);if(e.key==='ArrowRight')i=(i+1)%3;else if(e.key==='ArrowLeft')i=(i+2)%3;else if(e.key==='Home')i=0;else if(e.key==='End')i=2;else return;e.preventDefault();state.drawerTab=ids[i];renderDrawer();$('#drawer-tab-'+ids[i]).focus();});
    const panel=el('div',{id:'drawer-panel',role:'tabpanel','aria-labelledby':'drawer-tab-'+state.drawerTab,tabindex:0});
    if(state.drawerTab==='facts') panel.append(
      detailSection('Declarations',el('p',{},declarationLabels[declarationState(r)]),...r.declarationIds.map(id=>{const d=declarations.get(id);return el('p',{},d.kind+': '+d.name);}),note('Recorded declarations are not proof of effective permissions.')),
      detailSection('Resolved composition',el('ol',{class:'step-list'},r.composition.map(id=>el('li',{},el('code',{},id)))),el('p',{class:'small-note'},'Coverage: '+(r.compositionCoverage??'unavailable')+'. Static metadata is not an execution trace.')),
      detailSection('Schema references',...(r.schemaIds.length?r.schemaIds.map(id=>button(schemas.get(id).schemaId,()=>openSchema(id))):[el('p',{},'No references recorded.')])),
      detailSection('Binding references',...r.bindingIds.map(id=>{const b=bindings.get(id);return el('div',{class:'detail-ref'},b.name+' · '+b.kind+' · '+b.resolution);}),el('p',{class:'small-note'},'References are usage evidence, not host-enforced per-route grants.')),
      detailSection('Source and identity',kv([['Source',sourceText(r.source)],['Registration',r.id],['Handler',r.handlerId],['Entry',r.entryId]])));
    else if(state.drawerTab==='size') {
      panel.append(note('Shared bodies are nonadditive. Code bytes are not execution cost or guaranteed removal savings.'));
      for(const [metric,label] of Object.entries(metrics)) {const m=measurement(r,metric);panel.append(detailSection(label,el('div',{class:'size-grid-value'},factText(m?.fact)),kv([['Exact bytes',exact(factValue(m?.fact))],['Evidence',m?qualifier(m.fact):measurementIssue(r,metric)],['Method',m?.method??'unavailable'],['Mapped chunks',m?`${m.mappedChunks} / ${m.expectedChunks??'unknown'}`:'unavailable'],['Physical artifact',A.id+' · '+A.stage],['Shared body identity',m?.bodyIds.join(', ')||'unavailable']]),...evidenceCards(m?.fact.evidenceIds??[])));}
    } else panel.append(...evidenceCards(r.evidenceIds),detailSection('Traceability',kv([['Source',sourceText(r.source)],['Registration → handler',r.id+' → '+r.handlerId],['Capsule SHA-256',P.evidenceHash.value]])),el('details',{class:'details-block'},el('summary',{},'Raw route record'),el('pre',{class:'record-text'},JSON.stringify(r,null,2))));
    replace($('#drawer-content'),el('div',{class:'drawer-method-line'},methodTag(r.method),tag(prefix(r))),el('h2',{class:'drawer-title',id:'drawer-title'},r.path),el('div',{class:'drawer-handler mono'},r.handlerName??'Name unavailable'),tabs,panel);
  }
  function renderResources() {
    replace($('#view-resources'),sectionHeading('Resources & artifact sizes','Exact physical ledgers, separate from resource inputs and attribution.',P.resources.length),note('Do not add route sizes or resource input sizes to artifact bytes. Shared data is counted once physically.'),
      ...P.artifacts.map(a=>el('section',{class:'surface panel-pad subsection'},el('h3',{},a.host+' · '+a.stage+' · '+bytes(a.bytes)),el('p',{class:'small-note mono record-text'},'SHA-256 '+a.sha256),ledger(a),a.ledger?kv([['Code bodies',exact(a.ledger.codeBodyBytes)],['Code framing',exact(a.ledger.codeFramingBytes)],['Data payload',factText(a.ledger.dataPayloadBytes)+' · '+qualifier(a.ledger.dataPayloadBytes)],['Unattributed data payload',factText(a.ledger.unattributedDataPayloadBytes)+' · '+qualifier(a.ledger.unattributedDataPayloadBytes)]]):note('Detailed code/data ledger unavailable.'),el('details',{class:'details-block'},el('summary',{},'Physical section records'),el('pre',{class:'record-text'},JSON.stringify(a.sections,null,2))))),
      sectionHeading('Resource inventory','Input bytes describe source resources; retained payload requires its own measured mapping.',P.resources.length),
      ...(P.resources.length ? P.resources.map((r,i)=>el('details',{class:'surface subsection',open:state.expandedResources.has(r.id),on:{toggle:e=>{e.target.open?state.expandedResources.add(r.id):state.expandedResources.delete(r.id);}}},el('summary',{'data-resource-index':i},r.name+' · '+r.kind+' · retained '+factText(r.retainedPayloadBytes)),el('div',{},kv([['Input bytes',factText(r.inputBytes)+' · '+qualifier(r.inputBytes)],['Retained payload',factText(r.retainedPayloadBytes)+' · '+qualifier(r.retainedPayloadBytes)],['Media type',r.mediaType??'Unavailable'],['Physical artifact',r.artifactId??'Unavailable']]),routeChips(r.routeIds),...evidenceCards(r.evidenceIds)))):[note('No resource records. Inventory coverage: '+P.coverage.resources.status+'.')]));
  }
  function schemaSortHead(key,label) {return el('th',{'data-schema-sort':key,'aria-sort':state.schemaSort===key?(state.schemaDir==='asc'?'ascending':'descending'):'none'},button(label+' ↕',()=>{state.schemaDir=state.schemaSort===key?(state.schemaDir==='asc'?'desc':'asc'):(key==='name'?'asc':'desc');state.schemaSort=key;renderSchemaRows();},'schema-sort-button'));}
  function renderSchemas() {
    const search=el('input',{id:'schema-search',type:'search',value:state.schemaSearch,placeholder:'Find schemas or field names…','aria-label':'Search schemas and fields',on:{input:e=>{state.schemaSearch=e.target.value.toLowerCase();renderSchemaRows();}}});
    replace($('#view-schemas'),sectionHeading('Schema inventory','Compare structural facts and follow their recorded route references.',P.schemas.length),note('Descriptor bytes = canonical UTF-8 JSON of the normalized schema descriptor. This is not generated validator or Wasm size. Unknown and not-applicable metrics are not zero.'),el('label',{class:'search-box inventory-search'},icon('search'),search),
      el('div',{class:'surface table-surface'},el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'Scrollable schema inventory'},el('table',{class:'inventory-table schema-table'},el('caption',{class:'sr-only'},'Schema structure, normalized descriptor size and recorded route references.'),el('thead',{},el('tr',{},schemaSortHead('name','Schema'),schemaSortHead('keys','Top-level keys'),schemaSortHead('required','Required keys'),schemaSortHead('descriptor','Descriptor bytes'),schemaSortHead('refs','Routes'))),el('tbody',{id:'schema-body'}))),el('div',{class:'table-footer'},el('span',{id:'schema-count',role:'status','aria-live':'polite'}),el('span',{},'Descriptor size ≠ executable contribution'))));renderSchemaRows();
  }
  function renderSchemaRows() {
    const key=state.schemaSort, list=filteredSchemas();
    const value=(s,n)=>s.structure.keyCountsState==='not-applicable'?'N/A':s.structure[n]??'Unavailable';
    const rows=[];
    for(const s of list) {
      const i=schemaIndex.get(s.id),open=state.expandedSchemas.has(s.id),structure=s.structure;
      const expand=button((open?'▾ ':'▸ ')+s.schemaId,()=>{open?state.expandedSchemas.delete(s.id):state.expandedSchemas.add(s.id);renderSchemaRows();$('#schema-expand-'+i).focus({preventScroll:true});},'schema-expand mono');
      expand.id='schema-expand-'+i;expand.setAttribute('aria-expanded',String(open));expand.setAttribute('aria-controls','schema-detail-'+i);
      rows.push(el('tr',{'data-schema-index':i,class:open?'schema-row-open':''},el('td',{},expand,el('div',{class:'secondary schema-summary'},structure.state+(structure.reason?' · '+structure.reason:''))),el('td',{class:'numeric'},value(s,'topLevelKeys')),el('td',{class:'numeric'},value(s,'requiredKeys')),el('td',{class:'numeric',title:exact(structure.descriptorBytes)},structure.descriptorBytes===null?'Unavailable':bytes(structure.descriptorBytes)),el('td',{class:'numeric'},s.routeIds.length)));
      const detail=el('div',{class:'schema-detail',id:'schema-detail-'+i,hidden:!open},...(open?[
        el('div',{},el('h4',{},'TOP-LEVEL SHAPE'),el('p',{class:'schema-detail-desc'},'Normalized property names, types and required state. Full nesting is retained in the descriptor.'),
          structure.properties.length?el('table',{class:'schema-property-table'},el('caption',{class:'sr-only'},s.schemaId+' properties'),el('thead',{},el('tr',{},el('th',{scope:'col'},'Property'),el('th',{scope:'col'},'Type'),el('th',{scope:'col'},'Required'))),el('tbody',{},structure.properties.map(p=>el('tr',{},el('td',{},el('code',{},p.name)),el('td',{},el('code',{},p.type)),el('td',{},p.required===null?'Unavailable':p.required?'Required':'Optional'))))):el('p',{},structure.keyCountsState==='not-applicable'?'Not an object shape.':structure.state==='unavailable'?'Property structure unavailable.':'No top-level properties.'),
          el('details',{class:'details-block'},el('summary',{},'Normalized descriptor'),el('pre',{class:'record-text'},structure.descriptor===null?'Unavailable':JSON.stringify(structure.descriptor,null,2)))),
        el('div',{},el('h4',{},'REFERENCE & PROVENANCE'),kv([['Source',sourceText(s.source)],['Registry',s.registryVersion],['Representation',structure.representation],['Descriptor bytes',exact(structure.descriptorBytes)],['Generated validator bytes','Unavailable; descriptor bytes do not establish Wasm attribution']]),el('h4',{},'RECORDED ROUTE REFERENCES'),routeChips(s.routeIds),...evidenceCards(s.evidenceIds))]:[]));
      rows.push(el('tr',{hidden:!open},el('td',{colspan:5},detail)));
    }
    if(!list.length) rows.push(el('tr',{},el('td',{colspan:5},'No matching schemas. Inventory coverage: '+P.coverage.schemas.status+'.')));
    replace($('#schema-body'),rows);$('#schema-count').textContent=`${list.length} of ${P.schemas.length} schemas · ${P.coverage.schemas.status} inventory`;
    for(const th of $$('[data-schema-sort]'))th.setAttribute('aria-sort',th.dataset.schemaSort===key?(state.schemaDir==='asc'?'ascending':'descending'):'none');
  }
  function renderBindings() {
    replace($('#view-bindings'),sectionHeading('Binding inventory','Logical names and retained resolution state; no secret values or inferred grants.',P.bindings.length),note('A reference describes usage. Bound does not establish per-route authority or current deployment health.'),
      ...P.bindings.map(b=>el('article',{class:'surface panel-pad subsection'},el('h3',{},b.name),kv([['Kind',b.kind],['Declared',String(b.declared)],['Referenced',String(b.referenced)],['Resolution',b.resolution]]),routeChips(b.routeIds),el('details',{class:'details-block'},el('summary',{},'Binding evidence'),...evidenceCards(b.evidenceIds)))),
      P.bindings.length?null:note('No binding records. Inventory coverage: '+P.coverage.bindings.status+'.'));
  }
  function renderEvidence() {
    replace($('#view-evidence'),sectionHeading('Evidence & provenance','Recorded scope, availability and producer identity. No security grade or inferred pass.'),
      el('div',{class:'two-column'},el('div',{class:'surface panel-pad'},el('h3',{},'Capsule identity'),kv([['SHA-256',P.evidenceHash.value],['Profile / host',P.context.profile+' / '+P.context.host],['Recipe',P.provenance.recipe.name+' '+P.provenance.recipe.version],['Optimization',P.provenance.recipe.optimization],['Revision',P.provenance.revision??'Unknown'],['Dirty',P.provenance.dirty===null?'Unknown':String(P.provenance.dirty)]]),note('This digest identifies evidence; it is not a signature or security attestation.')),
      el('div',{class:'surface panel-pad'},el('h3',{},'Inventory coverage'),...Object.entries(P.coverage).map(([name,c])=>el('div',{class:'coverage-line'},el('div',{},name+' · '+c.status),el('p',{},`${c.observed} observed / ${c.expected??'unknown'} expected${c.reason?' · '+c.reason:''}`))))),
      sectionHeading('Recorded observations','Original producer, severity and code are retained.',P.observations.length),...P.observations.map(o=>el('article',{class:'surface panel-pad subsection'},el('h3',{},o.code),el('p',{},o.severity+' · '+o.producer.name+' '+o.producer.version),routeChips(o.subjectIds.filter(id=>routes.has(id))),...evidenceCards(o.evidenceIds))),P.observations.length?null:note('No observations recorded. Absence is not a pass.'),
      sectionHeading('Evidence records','A completed build is not a runtime parity or external-deployment claim.',P.evidence.length),...evidenceCards(P.evidence.map(e=>e.id)),
      el('details',{class:'details-block'},el('summary',{},'Provenance'),el('pre',{class:'record-text'},JSON.stringify(P.provenance,null,2))),el('details',{class:'details-block'},el('summary',{},'All entry records · '+P.entries.length),el('pre',{class:'record-text'},JSON.stringify(P.entries,null,2))));
  }
  function setPageInert(value) { $('.workspace').inert=value;$('.sidebar').inert=value; }
  function closeDrawer(update=true) {
    const id=state.selected;$('#route-drawer').hidden=true;$('#drawer-backdrop').hidden=true;state.selected=null;setPageInert(false);document.body.classList.remove('overlay-open');
    if(update) {history.replaceState(null,'','#routes');const row=id===null?null:$('[data-route-index="'+routeIndex.get(id)+'"] .route-link');(row??(lastDrawerFocus?.isConnected?lastDrawerFocus:$('#route-search')))?.focus({preventScroll:true});}
  }
  function displayDrawer(r) {
    if($('#route-drawer').hidden)lastDrawerFocus=document.activeElement;
    state.selected=r.id;renderDrawer();$('#route-drawer').hidden=false;$('#drawer-backdrop').hidden=false;setPageInert(true);document.body.classList.add('overlay-open');$('#drawer-close').focus({preventScroll:true});
  }
  function showView(view) {
    state.view=view;for(const [id] of navigation)$('#view-'+id).hidden=id!==view;
    for(const a of $$('[data-view]')){a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
    if(view==='routes')renderRoutes();else if(view==='schemas')renderSchemas();else if(view==='resources')renderResources();else if(view==='bindings')renderBindings();else renderEvidence();
  }
  function onHash() {
    if(location.hash==='#main')return;
    const match=/^#(routes|resources|schemas|bindings|evidence)(?:\/(\d+))?$/.exec(location.hash),view=match?.[1]??'routes',index=match?.[2]===undefined?null:Number(match[2]);
    closeModal();closeDrawer(false);showView(view);
    if(view==='routes'&&index!==null&&P.routes[index])displayDrawer(P.routes[index]);
    if(view==='schemas'&&index!==null&&P.schemas[index]){const s=P.schemas[index];state.expandedSchemas.add(s.id);state.schemaSearch=s.schemaId.toLowerCase();renderSchemas();$('#schema-expand-'+index).focus();}
  }
  function openModal(title,content) {
    lastModalFocus=document.activeElement;$('#modal-title').textContent=title;replace($('#modal-content'),content);$('#modal').hidden=false;$('#modal-backdrop').hidden=false;setPageInert(true);$('#route-drawer').inert=true;document.body.classList.add('overlay-open');$('#modal-close').focus();
  }
  function closeModal() {
    if($('#modal').hidden)return;$('#modal').hidden=true;$('#modal-backdrop').hidden=true;$('#route-drawer').inert=false;const open=!$('#route-drawer').hidden;setPageInert(open);document.body.classList.toggle('overlay-open',open);if(lastModalFocus?.isConnected)lastModalFocus.focus({preventScroll:true});
  }
  function openRaw() {openModal('The complete evidence capsule',[el('p',{},'One authoritative payload. Search, filters and theme never change these records.'),button('Export JSON',downloadCapsule),el('pre',{class:'raw-json',tabindex:0,'aria-label':'Complete capsule JSON'},canonicalJson)]);}
  function about() {openModal('Reading this report',[note('Build-review metadata can be operationally sensitive. Review it before public sharing.'),el('p',{},'This offline viewer consumes the embedded Report v1 capsule. The snapshot label distinguishes current matching, verified manifest replay and historical replay. No network requests, tests or live checks run here.'),el('p',{},'Declarations describe retained metadata, not effective permissions. Unavailable evidence is not zero or a pass. Normalized schema descriptor sizes are separate from generated code sizes.')]);}
  function sizeHelp() {openModal('One artifact. Different size views.',Object.entries(metrics).map(([metric,label])=>el('section',{class:'detail-section'},el('h3',{},label),el('p',{},({'handler-body':'Final mapped handler code bodies. Shared implementations may appear in several rows.',own:'Reachable bodies exclusive to one root, only when the root universe and graph are complete.',reachable:'Distinct bodies reachable under the recorded static call-graph method, including shared code.',shared:'Reachable bodies shared with other roots. Values across routes are nonadditive.'})[metric]))).concat(note('Numeric sorting uses raw bytes, keeps unavailable values last in both directions, and shows evidence coverage. No size is a guarantee of deletion savings.')));}
  function applyTheme(theme) {document.documentElement.dataset.theme=theme;replace($('#theme-button'),icon(theme==='dark'?'sun':'moon'));$('#theme-button').setAttribute('aria-label','Switch to '+(theme==='dark'?'light':'dark')+' theme');}
  $$('[data-icon]').forEach(n=>replace(n,icon(n.dataset.icon)));
  buildNavigation();drawSummary();populateFilters();applyTheme(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  $('#theme-button').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('#raw-button').addEventListener('click',openRaw);$('#export-button').addEventListener('click',downloadCapsule);$('#hash-button').addEventListener('click',()=>{location.hash='evidence';});
  $('#design-button').addEventListener('click',about);$('#fixture-about').addEventListener('click',about);$('#size-help').addEventListener('click',sizeHelp);
  $('#filter-toggle').addEventListener('click',()=>{const open=$('#route-filters').hidden;$('#route-filters').hidden=!open;$('#filter-toggle').setAttribute('aria-expanded',String(open));});
  $('#route-search').addEventListener('input',readRouteFilters);for(const id of ['filter-method','filter-declaration','filter-binding','filter-size'])$('#'+id).addEventListener('change',readRouteFilters);
  $('#size-metric').addEventListener('change',e=>{state.metric=e.target.value;renderRoutes();});
  for(const b of $$('[data-sort]'))b.addEventListener('click',()=>{const key=b.dataset.sort;state.dir=state.sort===key?(state.dir==='asc'?'desc':'asc'):(key==='size'?'desc':'asc');state.sort=key;renderRoutes();});
  $('#reset-routes').addEventListener('click',resetRoutes);$('#empty-reset').addEventListener('click',resetRoutes);
  $('#drawer-close').addEventListener('click',()=>closeDrawer());$('#drawer-backdrop').addEventListener('click',()=>closeDrawer());
  for(const [id,offset] of [['drawer-previous',-1],['drawer-next',1]])$('#'+id).addEventListener('click',()=>{const r=visibleRoutes[visibleRoutes.findIndex(r=>r.id===state.selected)+offset];if(r)location.hash='routes/'+routeIndex.get(r.id);});
  $('#modal-close').addEventListener('click',closeModal);$('#modal-backdrop').addEventListener('click',closeModal);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(!$('#modal').hidden)closeModal();else if(!$('#route-drawer').hidden)closeDrawer();}
    const active=!$('#modal').hidden?$('#modal'):!$('#route-drawer').hidden?$('#route-drawer'):null;
    if(e.key==='Tab'&&active){const nodes=$$('button:not([disabled]),a[href],input,select,summary,[tabindex="0"]',active).filter(n=>!n.hidden&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first?.focus();}}
    if(e.key==='/'&&!active&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();if(state.view!=='routes'){location.hash='routes';setTimeout(()=>$('#route-search').focus(),0);}else $('#route-search').focus();}
  });
  window.addEventListener('hashchange',onHash);onHash();
})();
