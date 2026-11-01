'use strict';
(() => {
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const P = reportEncoding.decode(JSON.parse($('#pulse-report-data').textContent));
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
  const model = createReportViewModel(P);
  const {analytics,definitions,registrations,useSites,definitionById,registrationById,useSiteById,callById,definitionIndex,registrationIndex,useSiteIndex,definitionRegistrations,definitionSites,helperCallers,helperCallees,registrationAssociations,siteAssociations,bindingSites,analyticsCoverage,coverageText,authoredFact,authoredSource,definitionLabel,registrationLabel,filteredDefinitions,A,routes,schemas,bindings,evidence,declarations,routeIndex,schemaIndex,schemaUsage,resourceIndex,representationLabels,resourceScopes,metrics,measurement,measurementResolution,measurementIssue,factValue,qualifier,sourceText,inventoryCount,prefix,declarationState,declarationLabels,state,filteredRoutes,filteredSchemas,sortedResources,composition,mappingCoverage,
    entries,entryIndex,helpers,helperIndex,helperOrigins,helperState,entryLabel,helperLabel,helperSize,routeHelpers,filteredHelpers,routeDispatchers,routeBehavior,routeCounts,handlerAttribution,containingBodies,routeContainment,entryHelpers} = model;
  const factText = f => f?.state === 'not-applicable' ? 'Not applicable' : factValue(f) === null ? 'Unavailable' : bytes(f.value);
  const exact = value => value == null ? 'Unavailable' : value.toLocaleString('en-US') + ' bytes';
  let visibleRoutes = [], lastDrawerFocus, lastModalFocus, toastTimer;
  const navigation = [['entry-points','Entry Points','routes'],['bindings','Bindings','link'],['schemas','Schemas','layers']];
  const secondaryNavigation = [['routes','HTTP size analysis','routes'],['resources','Assets & sizes','box'],['evidence','Evidence','evidence'],['handlers','Authored records','code'],['entries','All entry records','code'],['helpers','Compiled helpers','chip']];
  const viewIds = [...navigation,...secondaryNavigation,['atlas']].map(([id])=>id);
  let explorerReturn=null,activeHash='',explorerOrigin=null,restoreOrigin=false,inventorySession=null;
  const button = (label, fn, cls='button subtle') => el('button',{type:'button',class:cls,on:{click:fn}},label);
  const note = text => el('div',{class:'plain-note'},icon('info'),el('p',{},text));
  const kv = entries => el('dl',{class:'kv-list'},entries.map(([key,value]) => el('div',{class:'kv-row'},el('dt',{},key),el('dd',{class:'record-text'},value))));
  const sectionHeading = (title, desc, count) => el('div',{class:'section-heading'},el('div',{},el('h2',{},title,count == null ? null : el('span',{class:'count-pill'},count)),el('p',{},desc)));
  const methodTag = method => el('span',{class:'method ' + (['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(method) ? 'method-' + method : '')},method);
  const tag = text => el('span',{class:'evidence-label'},text);
  const byteDisplay = (value, cls='size-grid-value') => {
    if (value == null) return el('div',{class:cls+' size-unavailable'},'Unavailable');
    const [amount,unit] = bytes(value).split(' ');
    return el('div',{class:cls},amount,el('span',{class:'unit'},unit));
  };
  const measurementText = (r,metric) => measurementResolution(r,metric).variants.length > 1 ? 'Multiple measurements' : factText(measurement(r,metric)?.fact);
  const routeChips = ids => el('div',{class:'route-chips'},ids.map(id => {
    const r = routes.get(id); return r ? el('a',{class:'route-chip',href:'#routes/' + routeIndex.get(id)},r.method + ' ' + r.path) : el('span',{},'Unknown route reference');
  }));
  const entryLink = (id, compact=false) => {
    const entry = entries.get(id);
    return entry ? el('a',{class:'entry-link record-text',href:'#entries/'+entryIndex.get(id),title:entry.id},entryLabel(entry,compact))
      : el('span',{class:'record-text'},'Unknown entry reference',id ? ' · '+id : '');
  };
  const entryLinks = ids => el('div',{class:'entry-links'},ids.map(id=>el('div',{class:'helper-entry'},entryLink(id))));
  function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 3000); }
  function downloadCapsule() {
    const url = URL.createObjectURL(new Blob([model.canonicalJson],{type:'application/json;charset=utf-8'}));
    const a = el('a',{href:url,download:'pulse-report.json'}); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url),1500); toast('Complete capsule exported. View filters do not change evidence.');
  }
  function buildNavigation() {
    const item=([id,label,glyph])=>el('a',{class:'nav-link',href:'#'+id,'data-view':id},icon(glyph),label,
      id==='entry-points'?el('span',{class:'nav-count'},model.entryPoints.length):id==='bindings'?el('span',{class:'nav-count'},P.bindings.length):null);
    for(const root of [$('#desktop-nav'),$('#mobile-nav')])replace(root,navigation.map(item),
      el('details',{class:'report-sections'},el('summary',{},'More report sections'),secondaryNavigation.map(item)));
  }
  function ledger(artifact, large=false) {
    const parts=composition(artifact);
    if (!parts) return note('Composition unavailable: section coverage is '+artifact.sectionCoverage.status+'. Physical total: '+exact(artifact.bytes)+'.');
    // Numeric SVG geometry preserves exact proportions without inline styles,
    // which the fixed content policy deliberately prohibits.
    const chart=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({class:'ledger-bar',viewBox:'0 0 '+artifact.bytes+' 20',preserveAspectRatio:'none',role:'img','aria-label':'Artifact composition: '+parts.map(p=>p.label+' '+exact(p.bytes)).join(', ')})) chart.setAttribute(key,value);
    let x=0;
    for(const part of parts) {
      if(!part.bytes) continue;
      const rect=document.createElementNS(chart.namespaceURI,'rect');
      for(const [key,value] of Object.entries({x,y:0,width:part.bytes,height:20,class:'segment-'+part.id})) rect.setAttribute(key,value);
      const title=document.createElementNS(chart.namespaceURI,'title');title.textContent=part.label+': '+exact(part.bytes);rect.append(title);chart.append(rect);x+=part.bytes;
    }
    return el('div',{class:large?'ledger-large':''},chart,el('div',{class:'ledger-legend'},parts.map(p=>el('span',{class:'legend-item'},el('span',{class:'swatch segment-'+p.id}),p.label,el('span',{class:'mono'},bytes(p.bytes))))));
  }
  function drawBuild() {
    const build=P.build, compilers=build?.compilers||[];
    const duration=value=>value===null||value===undefined?'Not recorded':value<1000?value+' ms':(value/1000).toFixed(2)+' s';
    const optimization=row=>'O'+(row.optimization.optimizeLevel??'?')+' / shrink '+(row.optimization.shrinkLevel??'?')+' / convergence '+(row.optimization.converge?'on':'off');
    const compiler=compilers.find(row=>row.phase==='provider')||compilers.find(row=>row.phase==='portable');
    replace($('#build-summary'),el('h2',{},'Build'),
      kv([['Total to capture',duration(build?.totalDurationMs)],['AssemblyScript compilation',duration(build?.compilationDurationMs)],
        ['Target / profile',P.context.target+' / '+P.context.profile],['Pulse',P.producer.pulseVersion],
        ['Compiler',compiler?.compilerVersion??'Not recorded'],['Optimization',compiler?P.provenance.recipe.optimization+' · '+optimization(compiler):'Not recorded']]),
      el('p',{class:'small-note'},build?'Elapsed build time ends at inventory capture; report serialization and final publication are excluded. Compilation counts AssemblyScript invocations only and is included in the stage times.':'Build timings, effective flags and cache reuse were not recorded for this artifact.'),
      build?el('details',{class:'details-block'},el('summary',{},'Build details'),
        detailSection('Stage timings',kv(build.stages.map(row=>[row.name,duration(row.durationMs)]))),
        detailSection('Reuse',kv([['Build cache','Not recorded'],['Provider artifact',build.providerArtifactReuse.replaceAll('-',' ')]])),
        compilers.map(row=>detailSection(row.phase+' compiler',kv([['Compiler',row.compilerVersion],['Artifact',row.artifactId],
          ['Compilation',duration(row.durationMs)],['Compiler timeout',duration(row.timeoutMs)],['Optimization',optimization(row)],['Compiler cache',row.cache.replaceAll('-',' ')],
          ...row.toolchain.map(tool=>[tool.name,tool.version])]),
          el('p',{class:'small-note'},'Effective invocation flags · '+(row.flagsComplete?'complete':'partial')+' capture. Filesystem arguments use role placeholders.'),
          el('pre',{class:'record-text'},row.flags.map(flag=>flag.name+(flag.value===null?'':' '+flag.value)).join('\n'))))) : null);
  }
  function drawSummary() {
    drawBuild();
    for (const id of ['app-name','sidebar-app','crumb-app']) $('#'+id).textContent = P.application.name;
    document.title = P.application.name + ' · Pulse Report';
    $('#profile-name').textContent = P.context.profile; $('#host-name').textContent = P.context.host + ' · native';
    const mode = $('meta[name="pulse-report-snapshot"]').content;
    $('#snapshot-label').textContent = mode === 'current' ? 'Retained completed build · current inputs matched.' : mode === 'artifact' ? 'Completed artifact verified · current project not checked.' : 'Historical capsule replay · current project and original artifact bytes not checked.';
    $('#revision-label').textContent = 'Revision: ' + (P.provenance.revision ?? 'unknown') + ' · dirty: ' + (P.provenance.dirty === null ? 'unknown' : P.provenance.dirty ? 'yes' : 'no');
    $('#hash-button').textContent = P.evidenceHash.value.slice(0,12); $('#hash-button').title = 'SHA-256 ' + P.evidenceHash.value;
    const items = [['Wasm artifact',bytes(A.bytes),exact(A.bytes)+' · '+A.stage,'resources'],['Entry Points',String(model.entryPoints.length),model.entryPoints.filter(p=>p.type==='http').length+' HTTP · '+model.entryPoints.filter(p=>p.type==='event').length+' events · observed inventory','entry-points'],['Schemas',inventoryCount('schemas'),P.coverage.schemas.status+' structural coverage','schemas'],['Assets & payloads',String(model.assetResources.length),'Recorded assets and associated responses · source bytes','resources']];
    replace($('#summary-strip'),items.map(([label,value,sub,view],i)=>el('a',{class:'summary-item clickable',href:'#'+view},el('div',{class:'summary-top'},label,icon(view === 'routes' ? 'routes' : 'box')),i===0?byteDisplay(A.bytes,'summary-value'):el('div',{class:'summary-value'+(value==='Unavailable'?' small':'')},value),el('div',{class:'summary-sub'},sub))));
    $('#route-total').textContent = P.routes.length;
    $('#route-behavior-summary').textContent = `${routeCounts.distinctMethodPaths??'Unknown'} distinct method/path pairs · ${routeCounts.terminal} terminal · ${routeCounts.continuing} continuing · ${routeCounts.unknown} behavior not recorded. Continuing means a handler can transfer control, including errors; it may also respond early.`;
    const mapped = P.routes.filter(r=>factValue(measurement(r,'handler-body')?.fact)!==null).length;
    $('#mapping-label').textContent = `${mapped} / ${P.routes.length} handler mappings · ${A.stage}`;
    replace($('#compact-ledger'),ledger(A),el('div',{class:'asset-overview'},model.assetGroups().map(g=>el('a',{href:'#resources'},g.label+' · '+bytes(g.input)+' known source bytes'+(g.known<g.resources.length?' · '+(g.resources.length-g.known)+' unmeasured':'')))));
    const tests=P.evidence.filter(e=>e.kind==='test'&&e.artifactIds.includes(A.id));
    replace($('#compact-coverage'),[['handler-body','Handler mappings'],['reachable','Reachability roots']].map(([metric,label])=>{
      const c=mappingCoverage(metric);
      return el('div',{class:'coverage-mini'},el('div',{class:'number'},c.available,el('span',{},' / '+c.total)),el('span',{class:'coverage-label'},label));
    }),el('div',{class:'coverage-mini'},el('div',{class:'number coverage-state'},tests.length?String(tests.length):'Not recorded'),el('span',{class:'coverage-label'},'Scoped test records')));
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
      const m=measurement(r,state.metric),value=factValue(m?.fact),contained=routeContainment(r);
      return el('tr',{'data-route-index':routeIndex.get(r.id)},
        el('td',{class:'order-col mono'},r.order+1),el('td',{},methodTag(r.method)),
        el('td',{class:'route-identity'},el('a',{class:'route-link mono',href:'#routes/'+routeIndex.get(r.id),title:r.path},r.path),
          el('div',{class:'secondary mono'},entryLink(r.entryId,true))),
        el('td',{},el('div',{class:'route-behavior'},routeBehavior(r)),el('div',{class:'secondary declaration'},declarationLabels[declarationState(r)])),
        el('td',{class:'route-reference-counts'},el('div',{},r.schemaIds.length+' schemas'),el('div',{class:'secondary'},r.bindingIds.length+' bindings')),
        el('td',{class:'numeric metric-cell',title:m?qualifier(m.fact):measurementIssue(r,state.metric)},
          el('div',{class:'metric-value'},measurementText(r,state.metric)),
          el('div',{class:'secondary'},value===null?(m?.fact.reason??(measurementResolution(r,state.metric).variants.length>1?'Compare in size details':'missing-evidence')):m.fact.coverage)),
        el('td',{class:'numeric metric-cell containment-cell',title:exact(contained.bytes)},
          el('div',{class:'metric-value'},contained.bytes===null?'Unavailable':bytes(contained.bytes)),
          el('div',{class:'secondary'},contained.expected?(contained.partial?'Partial mapping':'Recorded chunks mapped'):'No carrier evidence'),
          el('div',{class:'secondary'},'Whole bodies · non-additive')),
        el('td',{},el('a',{class:'route-open',href:'#routes/'+routeIndex.get(r.id),'aria-label':'Open '+r.method+' '+r.path},icon('chevron-right'))));
    }));
    const union=containingBodies(visibleRoutes);
    $('#route-containment-summary').textContent = `Shown registrations: ${union.registrations} with recorded carriers; ${union.unrecorded} without carrier evidence. Containing-body union: ${exact(union.bytes)} · ${union.bodyIds.length} distinct physical bodies · ${union.mapped} / ${union.expected} recorded chunks mapped. Counted once across shown registrations; not an additive route total or isolated handler bytes. Missing mappings remain unknown.`;
    $('#route-empty').hidden = visibleRoutes.length!==0;
    $('#route-result-count').textContent = `${visibleRoutes.length} of ${P.routes.length} registrations · ${P.coverage.routes.status} inventory`;
    $('#size-column-label').textContent = metrics[state.metric];
    $('#sort-description').textContent = (state.sort==='size'?metrics[state.metric]:state.sort)+' · '+state.dir+' · unavailable last';
    for(const key of ['order','method','path','size']) $('#th-'+key).setAttribute('aria-sort',state.sort===key?(state.dir==='asc'?'ascending':'descending'):'none');
    $('#reset-routes').hidden = false;
  }
  const detailSection = (label,...nodes) => el('section',{class:'detail-section'},el('div',{class:'detail-label'},label),...nodes);
  function evidenceCards(ids) {
    if (!ids.length) return [el('p',{},'No evidence references recorded.')];
    // Group presentation only: distinct records and their scopes remain intact.
    const groups = new Map();
    for (const id of new Set(ids)) {
      const e=evidence.get(id), key=JSON.stringify([e.kind,e.producer.name,e.producer.version]);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(e);
    }
    return [...groups.values()].map(records=>{
      const first=records[0], results=new Map();
      for (const e of records) results.set(e.result,(results.get(e.result)||0)+1);
      return el('details',{class:'details-block evidence-group'},
        el('summary',{},el('span',{},el('span',{class:'evidence-group-title'},first.kind+' · '+first.producer.name+' '+first.producer.version),
          el('span',{class:'secondary'},records.length+' record'+(records.length===1?'':'s')+' · '+[...results].map(([result,count])=>count+' '+result).join(' · ')))),
        el('div',{class:'evidence-group-records'},records.map(e=>el('details',{class:'evidence-record','data-evidence-id':e.id},
          el('summary',{},e.result+' · '+e.method),
          kv([['Evidence ID',e.id],['Producer',e.producer.name+' '+e.producer.version],['Result',e.result],['Method',e.method],['Scope',JSON.stringify(e.scope)],['Source',sourceText(e.source)],['Recorded at',e.recordedAt??'Not recorded'],['Artifacts',e.artifactIds.join(', ')||'Not recorded']])))));
    });
  }
  function openSchema(id) { state.expandedSchemas.add(id); state.schemaSearch=schemas.get(id).schemaId.toLowerCase(); location.hash='schemas/'+schemaIndex.get(id); }
  function renderDrawer() {
    const r=routes.get(state.selected);if(!r)return;
    const index=visibleRoutes.findIndex(x=>x.id===r.id);$('#drawer-previous').disabled=index<=0;$('#drawer-next').disabled=index<0||index===visibleRoutes.length-1;
    $('#drawer-kicker').textContent='REGISTRATION '+(r.order+1)+' · '+A.stage+' artifact';
    const ids=['facts','size','evidence'];
    const tabs=el('div',{class:'drawer-tabs',role:'tablist','aria-label':'Route detail views'},[['facts','Resolved facts'],['size','Size attribution'],['evidence','Evidence trail']].map(([id,label])=>el('button',{class:'drawer-tab'+(state.drawerTab===id?' active':''),role:'tab',id:'drawer-tab-'+id,tabindex:state.drawerTab===id?0:-1,'aria-selected':state.drawerTab===id,'aria-controls':'drawer-panel',on:{click:()=>{state.drawerTab=id;renderDrawer();$('#drawer-tab-'+id).focus();}}},label)));
    tabs.addEventListener('keydown',e=>{let i=ids.indexOf(state.drawerTab);if(e.key==='ArrowRight')i=(i+1)%3;else if(e.key==='ArrowLeft')i=(i+2)%3;else if(e.key==='Home')i=0;else if(e.key==='End')i=2;else return;e.preventDefault();state.drawerTab=ids[i];renderDrawer();$('#drawer-tab-'+ids[i]).focus();});
    const panel=el('div',{id:'drawer-panel',role:'tabpanel','aria-labelledby':'drawer-tab-'+state.drawerTab,tabindex:0});
    if(state.drawerTab==='facts') panel.append(el('div',{class:'drawer-facts-grid'},
      detailSection('Authored handler and associations',el('p',{},el('a',{href:model.detailHash('entry-points',model.entryPointById.has(r.entryId)?r.entryId:r.id)},'Open Entry Point')),definitionById.has(r.handlerId)?definitionLink(r.handlerId):el('p',{},'Handler definition unavailable'),registrationById.has(r.entryId)?registrationLink(r.entryId):analyticsCoverageNote('registrations')),
      detailSection('Registration behavior',el('p',{},routeBehavior(r)),note(r.behavior ? 'Compiler handler IR · continuing includes conditional next() and error transfers. This is not a complete endpoint execution chain.' : 'Compiler behavior evidence was not retained. Router nesting, source names and dispatcher membership do not establish behavior.')),
      detailSection('Handler attribution',el('strong',{},handlerAttribution(r).label),el('p',{},handlerAttribution(r).detail)),
      detailSection('Declarations',el('p',{},declarationLabels[declarationState(r)]),...r.declarationIds.map(id=>{const d=declarations.get(id);return el('p',{},d.kind+': '+d.name);}),note('Recorded declarations are not proof of effective permissions.')),
      detailSection('Resolved composition',el('ol',{class:'step-list'},r.composition.map(id=>el('li',{},entryLink(id)))),el('p',{class:'small-note'},'Coverage: '+(r.compositionCoverage??'unavailable')+'. Static metadata is not an execution trace.')),
      detailSection('Schema references',...(r.schemaIds.length?r.schemaIds.map(id=>button(schemas.get(id).schemaId,()=>openSchema(id))):[el('p',{},'No references recorded.')])),
      detailSection('Binding references',...r.bindingIds.map(id=>{const b=bindings.get(id);return el('div',{class:'detail-ref'},b.name+' · '+b.kind+' · '+b.resolution);}),el('p',{class:'small-note'},'References are usage evidence, not host-enforced per-route grants.'))),
      containmentDetails(r),helperLinks(r),dispatcherDetails(r),
      detailSection('Source and identity',kv([['Source',sourceText(r.source)],['Registration',r.id],['Handler',r.handlerId],['Entry',entryLink(r.entryId)]])));
    else if(state.drawerTab==='size') {
      panel.append(detailSection('Handler attribution',el('strong',{},handlerAttribution(r).label),el('p',{},handlerAttribution(r).detail)));
      panel.append(note('Shared bodies are nonadditive. Code bytes are not execution cost or guaranteed removal savings.'));
      panel.append(el('div',{class:'size-grid'},Object.entries(metrics).map(([metric,label])=>{
        const m=measurement(r,metric),value=factValue(m?.fact);
        return el('div',{},el('div',{class:'size-grid-label'},label),value===null?el('div',{class:'size-grid-value size-unavailable'},measurementText(r,metric)):byteDisplay(value),el('div',{class:'size-grid-exact'},m?(value===null?m.fact.reason??m.fact.state:exact(value)+' · '+m.fact.coverage):measurementIssue(r,metric)));
      })));
      panel.append(note('Handler body and Reachable measure code bodies only; embedded asset and schema data are excluded. A small handler may serve a large payload.'),
        containmentDetails(r),helperLinks(r),dispatcherDetails(r),
        detailSection('Referenced resources',el('p',{},P.resources.filter(resource=>resource.routeIds.includes(r.id)).length+' recorded resources; consumer coverage may be partial.'),el('a',{href:'#resources'},'View resource inventory and byte representations')));
      for(const [metric,label] of Object.entries(metrics)) {
        const resolution=measurementResolution(r,metric);
        panel.append(el('details',{class:'details-block metric-details'},el('summary',{},label+' · '+measurementText(r,metric)),
          resolution.variants.length>1?note('These records differ in value, method, coverage or root scope. Compare them below; no single value is selected or added.'):null,
          resolution.variants.length?resolution.variants.map(m=>el('section',{class:'measurement-record'},byteDisplay(factValue(m.fact)),kv([['Exact bytes',exact(factValue(m.fact))],['Evidence',qualifier(m.fact)],['Method',m.method],['Mapped chunks',`${m.mappedChunks} / ${m.expectedChunks??'unknown'}`],['Physical artifact',A.id+' · '+A.stage],['Root set',m.rootSetId??'Not applicable'],['Root',m.rootId??'Not applicable'],['Body identities',m.bodyIds.join(', ')||'Not recorded'],['Measurement records',m.recordIds.join(', ')]]),...evidenceCards(m.fact.evidenceIds))):el('p',{class:'small-note'},'No measurement record was retained for this metric.')));
      }
    } else panel.append(...evidenceCards(r.evidenceIds),detailSection('Traceability',kv([['Source',sourceText(r.source)],['Registration → handler',r.id+' → '+r.handlerId],['Capsule SHA-256',P.evidenceHash.value]])),el('details',{class:'details-block'},el('summary',{},'Raw route record'),el('pre',{class:'record-text'},JSON.stringify(r,null,2))));
    replace($('#drawer-content'),explorerReturn?el('a',{href:explorerReturn.hash,class:'button subtle'},'Back to Explorer'):null,el('div',{class:'drawer-method-line'},methodTag(r.method),tag(prefix(r))),el('h2',{class:'drawer-title',id:'drawer-title'},r.path),el('div',{class:'drawer-handler mono'},entryLink(r.entryId)),tabs,panel);
  }
  function dispatcherDetails(route) {
    const view=routeDispatchers(route);
    const section=(...nodes)=>detailSection('Associated dispatcher bodies',...nodes);
    if(helperState!=='recorded') return section(el('p',{class:'small-note'},helperState==='not-recorded'
      ?'Dispatcher inventory was not recorded in this historical capsule. Physical associations cannot be reconstructed from unavailable route measurements.'
      :'No implementation records for the primary artifact. Prelink dispatcher records cannot establish final body sizes.'));
    if(!view.records.length) return section(el('p',{class:'small-note'},'No dispatcher associations recorded for this route. Inventory and composition coverage are incomplete; this does not prove absence.'));
    const entryRecords=ids=>ids.map(id=>{const entry=entries.get(id);return el('div',{class:'helper-entry'},
      el('strong',{},entryLink(entry.id)),el('p',{class:'small-note'},sourceText(entry.source)),
      el('code',{class:'record-text'},id),routeChips(P.routes.filter(row=>row.composition.includes(id)).map(row=>row.id)));});
    return section(
      note('A dispatcher can contain several entries in one physical function. Its whole-body size is not this route’s size. Per-route bytes inside the dispatcher remain unavailable.'),
      kv([['Distinct mapped dispatcher code',exact(view.size.bytes)],['Physical bodies',String(view.size.bodyIds.length)],
        ['Mapped carrier chunks',view.size.mapped+' / '+view.size.expected],['Artifact',A.stage+' · '+A.sha256]]),
      el('p',{class:'small-note'},'These bytes are already in the artifact and may overlap helpers or other routes. Do not add them to Handler body, Reachable, or helper totals. Missing mappings contribute unknown bytes, not zero.'),
      view.bodies.map(body=>el('details',{class:'details-block dispatcher-body'},el('summary',{},'Function '+body.index+' · '+bytes(body.bytes)+' · whole dispatcher body'),
        el('div',{class:'dispatcher-detail'},kv([['Physical body',body.id],['Whole-body bytes',exact(body.bytes)],
          ['Associated carrier chunks',body.records.flatMap(row=>row.chunks.map(chunk=>chunk.chunk)).join(', ')],
          ['Known associated entries',String(body.entryIds.length)+' · partial coverage']]),
          el('p',{class:'small-note'},'Entries below include other recorded implementations of this same physical body. Associations are static, not invocation counts or complete reachability.'),
          routeChips(body.routeIds),entryRecords(body.entryIds),
          el('details',{class:'details-block'},el('summary',{},'Carrier identity & evidence'),
            ...body.records.map(row=>el('div',{class:'record-text'},row.id)),
            ...evidenceCards([...new Set(body.records.flatMap(row=>row.evidenceIds))]))))),
      view.missing.map(row=>el('details',{class:'details-block dispatcher-body'},el('summary',{},'Carrier chunk '+row.chunks[0].chunk+' · body unavailable'),
        el('div',{class:'dispatcher-detail'},kv([['Reason',row.chunks[0].reason],['Physical size','Unavailable'],['Implementation',row.id]]),
          el('p',{class:'small-note'},'Known entry associations survive the missing body mapping. They do not identify a final function.'),
          entryRecords(row.entryIds),...evidenceCards(row.evidenceIds)))));
  }
  function containmentDetails(route) {
    const view=routeContainment(route), ownHelpers=entryHelpers(route);
    return detailSection('This registration’s containing bodies',
      note('Only carriers associated with this registration’s own entry. Whole containing-body bytes are separate from isolated Handler body bytes and cannot be added across routes. Known co-owners are observed entry associations, not proof of exclusive ownership or a complete execution chain.'),
      kv([['Entry',entryLink(route.entryId)],['Containing-body union',exact(view.bytes)],
        ['Distinct physical bodies',String(view.bodyIds.length)],['Mapped entry carrier chunks',view.mapped+' / '+view.expected],
        ['Artifact',A.stage+' · '+A.sha256]]),
      !view.expected?el('p',{class:'small-note'},helperState==='not-recorded'?'Containing-body inventory was not recorded. Unknown does not mean zero.'
        :'No carriers recorded for this entry in the primary artifact. Prelink or preceding composition entries cannot establish its containing bodies.'):null,
      view.partial?el('p',{class:'small-note'},'Partial mapping: the union includes known bodies only; missing body sizes remain unknown.'):null,
      view.bodies.map(body=>el('details',{class:'details-block containing-body'},
        el('summary',{},'Function '+body.index+' · '+bytes(body.bytes)+' · containing body'),
        el('div',{class:'dispatcher-detail'},kv([['Physical body',body.id],['Whole-body bytes',exact(body.bytes)],
          ['This entry’s carrier chunks',body.chunks.map(chunk=>chunk.chunk).join(', ')],['Known entry co-owners',String(body.entryIds.length)+' · partial coverage']]),
          body.entryIds.map(id=>el('div',{class:'helper-entry'},el('strong',{},entryLink(id)),
            el('p',{class:'small-note'},sourceText(entries.get(id).source)),
            routeChips(body.routeIds.filter(key=>routes.get(key).entryId===id)))),
          ...evidenceCards(body.evidenceIds)))),
      view.missing.map(chunk=>el('p',{class:'small-note'},'Entry carrier chunk '+chunk.chunk+' · body unavailable · '+chunk.reason)),
      el('h3',{},'This entry’s helpers & stages'),
      ownHelpers.length?el('ul',{class:'helper-links'},ownHelpers.map(row=>el('li',{},
        el('a',{href:'#helpers/'+helperIndex.get(row.id)},helperLabel(row)),el('span',{class:'secondary'},row.roles.join(', ')))))
        :el('p',{class:'small-note'},'No helper or stage association recorded for this entry; inventory coverage is partial.'),
      el('p',{class:'small-note'},'Helper links identify existing implementations. Their whole sizes may overlap containing bodies and other entries. Broader composition associations follow below.'));
  }
  function helperCoverage(row) {
    const size=helperSize([row]);
    return size.bytes===null?'No surviving body mapping':size.partial?'Partial body mapping':'All recorded chunks mapped';
  }
  function helperLinks(route) {
    const rows=routeHelpers(route),size=helperSize(rows);
    return detailSection('Associated helpers & stages',
      helperState!=='recorded'?el('p',{},helperState==='not-recorded'?'Helper inventory was not recorded in this capsule.':'No helper inventory records for the primary artifact.')
        :rows.length?[
          el('ul',{class:'helper-links'},rows.map(row=>el('li',{},el('a',{href:'#helpers/'+helperIndex.get(row.id)},helperLabel(row)),
            el('span',{class:'secondary'},row.roles.join(', ')+' · '+(helperSize([row]).bytes===null?'Unavailable':bytes(helperSize([row]).bytes))+' · '+helperCoverage(row))))),
          el('p',{class:'small-note'},'Associated mapped code: '+exact(size.bytes)+' · '+size.bodyIds.length+' distinct bodies. Missing mappings are excluded. These are shared associations, not an additional per-route size; do not add them to Handler body or Reachable.')
        ]:el('p',{},'No helper or stage associations recorded for this route. Consumer coverage is incomplete.'),
      el('a',{href:'#helpers'},'Explore Helpers'));
  }
  function helperSortHead(key,label) {
    const control=button(label+' ↕',()=>{state.helperDir=state.helperSort===key?(state.helperDir==='asc'?'desc':'asc'):(key==='name'?'asc':'desc');state.helperSort=key;renderHelperRows();$('#helper-sort-'+key).focus({preventScroll:true});},'schema-sort-button');
    control.id='helper-sort-'+key;
    return el('th',{'data-helper-sort':key,'aria-sort':'none'},control);
  }
  function renderHelpers() {
    const select=(id,label,values,key)=>el('label',{},label,el('select',{id,'aria-label':label,on:{change:e=>{state[key]=e.target.value;renderHelperRows();}}},
      [['all','All'],...values].map(([value,text])=>el('option',{value,selected:state[key]===value},text))));
    replace($('#view-helpers'),sectionHeading('Helpers','Authored helpers and consolidated stages in the primary '+A.stage+' artifact.',helperState==='recorded'?helpers.length:null),
      note('Mapped code is already part of the artifact. Shared rows overlap; the total below counts each physical body once. It is not exclusive ownership, deletion savings, or execution cost.'),
      helperState==='not-recorded'?note('Helper inventory was not recorded in this historical capsule. Sizes and consumers cannot be reconstructed from old measurements.')
        :helperState==='no-primary-records'?note('No implementation records for the primary artifact. Prelink records cannot establish final helper sizes.')
          :note('Inventory and consumer coverage are partial. Pure helpers and other generated support outside the captured inventory remain unknown. Middleware is a role; consolidation is an origin.'),
      el('div',{class:'helper-toolbar'},el('label',{class:'search-box'},icon('search'),el('input',{id:'helper-search',type:'search',value:state.helperSearch,placeholder:'Find a helper, role or route…','aria-label':'Search helpers and consumers',on:{input:e=>{state.helperSearch=e.target.value.toLowerCase();renderHelperRows();}}})),
        select('helper-origin','Implementation origin',Object.entries(helperOrigins),'helperOrigin'),
        select('helper-role','Semantic role',[...new Set(helpers.flatMap(row=>row.roles))].sort().map(role=>[role,role]),'helperRole'),
        el('label',{class:'helper-mobile-sort'},'Order',el('select',{id:'helper-order','aria-label':'Helper order',on:{change:e=>{const [key,dir]=e.target.value.split(':');state.helperSort=key;state.helperDir=dir;renderHelperRows();}}},
          [['name:asc','Implementation ↑'],['name:desc','Implementation ↓'],['size:desc','Mapped code ↓'],['size:asc','Mapped code ↑'],['consumers:desc','Known entries ↓'],['consumers:asc','Known entries ↑']].map(([value,label])=>el('option',{value,selected:value===state.helperSort+':'+state.helperDir},label))))),
      el('div',{id:'helper-summary',class:'schema-metric-strip'}),
      el('div',{class:'surface table-surface'},el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'Scrollable helper inventory'},
        el('table',{class:'inventory-table helper-table'},el('caption',{class:'sr-only'},'Helper implementations, semantic roles, mapped code and known consumers'),
          el('thead',{},el('tr',{},helperSortHead('name','Implementation'),el('th',{},'Role'),helperSortHead('size','Mapped code'),helperSortHead('consumers','Known entries'),el('th',{},'Routes'))),el('tbody',{id:'helper-body'}))),
        el('div',{class:'table-footer'},el('span',{id:'helper-count',role:'status','aria-live':'polite'}),el('span',{},'Unavailable sizes stay last'))));
    renderHelperRows();
  }
  function renderHelperRows() {
    const list=filteredHelpers(),size=helperSize(list),rows=[];
    replace($('#helper-summary'),list.length?[
      [['Distinct mapped code',size.bytes===null?'Unavailable':bytes(size.bytes)],['Mapped bodies',size.bodyIds.length],['Bodies in multiple rows',size.overlappingBodies]].map(([label,value])=>el('div',{},el('span',{class:'schema-metric-label'},label),el('strong',{},value))),
      el('p',{class:'small-note helper-total-note'},'Shown records only · '+size.mapped+' / '+size.expected+' recorded chunks mapped. Missing mappings contribute no known bytes, not zero-sized code.')
    ]:el('p',{class:'small-note'},'No mapped total available for this view.'));
    for(const row of list) {
      const i=helperIndex.get(row.id),open=state.expandedHelpers.has(row.id),size=helperSize([row]);
      const firstRoute=routes.get(row.routeIds[0]);
      const consumerHint=firstRoute?firstRoute.method+' '+firstRoute.path+(row.routeIds.length>1?' · +'+(row.routeIds.length-1)+' routes':''):'No route consumers observed';
      const expand=button((open?'▾ ':'▸ ')+helperLabel(row),()=>{open?state.expandedHelpers.delete(row.id):state.expandedHelpers.add(row.id);renderHelperRows();$('#helper-expand-'+i).focus({preventScroll:true});},'schema-expand');
      expand.id='helper-expand-'+i;expand.setAttribute('aria-expanded',String(open));expand.setAttribute('aria-controls','helper-detail-'+i);
      rows.push(el('tr',{'data-helper-index':i,class:'helper-row'+(open?' schema-row-open':'')},el('td',{'data-label':'Implementation'},expand,el('div',{class:'secondary record-text'},consumerHint)),el('td',{'data-label':'Role'},row.roles.join(', ')||'Not observed'),
        el('td',{class:'numeric','data-label':'Mapped code'},size.bytes===null?'Unavailable':bytes(size.bytes),el('div',{class:'secondary'},helperCoverage(row))),
        el('td',{class:'numeric','data-label':'Known entries'},row.entryIds.length,el('div',{class:'secondary'},'partial coverage')),el('td',{class:'numeric','data-label':'Routes'},row.routeIds.length)));
      rows.push(el('tr',{hidden:!open},el('td',{colspan:5},el('div',{id:'helper-detail-'+i,class:'helper-detail'},...(open?[
        el('div',{},el('h3',{},helperLabel(row)),kv([['Origin',helperOrigins[row.origin]],['Semantic roles',row.roles.join(', ')||'Not observed'],['Mapped code',exact(size.bytes)],['Mapping coverage',row.bodyCoverage.observed+' / '+row.bodyCoverage.expected+' chunks · '+row.bodyCoverage.status],['Physical bodies',String(size.bodyIds.length)],['Consumer coverage','Partial · expected count unknown'],['Artifact',A.stage+' · '+A.sha256]]),
          el('p',{class:'small-note'},'Labels and entry numbers are local to this capsule. An empty consumer list does not prove unused code.'),
          el('details',{class:'details-block'},el('summary',{},'Identity & body evidence'),kv([['Implementation',row.id],['Canonical identity',row.canonicalId??'Not recorded'],['Consumer basis',row.consumerBasis]]),el('pre',{class:'record-text'},JSON.stringify(row.chunks,null,2)),...evidenceCards(row.evidenceIds))),
        el('div',{},el('h3',{},'Known consumers'),el('p',{class:'small-note'},'Static associations through recorded composition; not runtime calls or complete reachability.'),
          routeChips(row.routeIds),el('details',{class:'details-block'},el('summary',{},'Consuming entries · '+row.entryIds.length),
            row.entryIds.length?row.entryIds.map(id=>{const entry=entries.get(id);return el('div',{class:'helper-entry'},el('strong',{},entryLink(entry.id)),el('p',{class:'small-note'},sourceText(entry.source)),routeChips(row.routeIds.filter(key=>routes.get(key).composition.includes(id))));}):el('p',{},'No entry consumers observed; not proven unused.')))
      ]:[])))));
    }
    if(!list.length) rows.push(el('tr',{},el('td',{colspan:5},helpers.length?'No matching helpers. Clear the search or filters.':helperState==='recorded'?'No authored helper or consolidated stage records. Inventory is partial.':'Helper inventory unavailable.')));
    replace($('#helper-body'),rows);$('#helper-count').textContent=list.length+' of '+helpers.length+' helper/stage records · '+(helperState==='recorded'?'partial inventory':'inventory unavailable');
    $('#helper-order').value=state.helperSort+':'+state.helperDir;
    for(const th of $$('[data-helper-sort]'))th.setAttribute('aria-sort',th.dataset.helperSort===state.helperSort?(state.helperDir==='asc'?'ascending':'descending'):'none');
  }
  function renderResources() {
    const sectionNames={0:'Custom',1:'Type',2:'Import',3:'Function',4:'Table',5:'Memory',6:'Global',7:'Export',8:'Start',9:'Element',10:'Code',11:'Data',12:'Data count',13:'Tag'};
    const factCell=f=>el('td',{class:'numeric'},el('div',{class:'metric-value'},factText(f)),el('div',{class:'secondary'},f.state==='available'?f.basis+' · '+f.coverage:f.reason??f.state));
    function resourceRows(resources){const rows=[];
    resources.forEach(r=>{
      const i=resourceIndex.get(r.id),g=r.generator;
      const open=state.expandedResources.has(r.id);
      const expand=button((open?'▾ ':'▸ ')+r.name,()=>{open?state.expandedResources.delete(r.id):state.expandedResources.add(r.id);renderResources();$('#resource-expand-'+i).focus({preventScroll:true});},'resource-expand mono');
      expand.id='resource-expand-'+i;expand.setAttribute('aria-expanded',String(open));expand.setAttribute('aria-controls','resource-detail-'+i);
      const firstRoute=routes.get(r.routeIds[0]);
      rows.push(el('tr',{'data-resource-index':i},el('td',{},expand,r.kind==='response-payload'?el('div',{class:'secondary record-text'},
        (r.mediaType??'Media type unresolved')+' · '+(firstRoute?firstRoute.method+' '+firstRoute.path:'Entry association unavailable')):null),el('td',{},r.kind),factCell(r.inputBytes),
        el('td',{class:'numeric'},el('div',{class:'metric-value'},factText(g?.representationBytes)),el('div',{class:'secondary'},g?representationLabels[g.representation]:'Not recorded')),
        factCell(r.retainedPayloadBytes),el('td',{},r.routeIds.length+' recorded routes')));
      rows.push(el('tr',{hidden:!open},el('td',{colspan:6},el('div',{id:'resource-detail-'+i,class:'resource-detail'},...(open?[
        el('div',{},el('h3',{},'Resource facts'),kv([[r.kind==='response-payload'?'UTF-8 response payload bytes':'Source input bytes',factText(r.inputBytes)],['Input evidence',qualifier(r.inputBytes)],
          ['Representation',g?representationLabels[g.representation]:'Not recorded'],['Representation bytes',factText(g?.representationBytes)],['Representation evidence',qualifier(g?.representationBytes)],
          ['Producer',g?g.producer.name+' · '+g.producer.version:'Not recorded'],['Entry coverage',g?`${g.entryCoverage.status} · ${g.entryCoverage.observed} / ${g.entryCoverage.expected??'unknown'}${g.entryCoverage.reason?' · '+g.entryCoverage.reason:''}`:'Not recorded'],
          ['Retained payload',exact(factValue(r.retainedPayloadBytes))],['Retained evidence',qualifier(r.retainedPayloadBytes)],['Media type',r.mediaType??'Not recorded'],['Build artifact',r.artifactId??'Not mapped']]),
          r.binary?kv([['Backing identity',r.binary.backingId],['Native selection',r.binary.selected?'Selected':'Pruned logical binding'],
            ['Shared callee owners',r.binary.calleeIds.map(id=>P.computation?.callees.find(c=>c.id===id)?.name??'Unknown').join(', ')||'None recorded'],
            ['Logical aliases',P.resources.filter(other=>other.binary?.backingId===r.binary.backingId).map(other=>other.name).join(', ')]]):null,
          g?.schemaId?button('View schema structure',()=>openSchema(g.schemaId)):null,routeChips(r.routeIds),entryLinks(r.entryIds)),
        el('div',{},el('h3',{},'Evidence'),...evidenceCards(r.evidenceIds))]:[])))));
    });
    return rows;}
    const artifactPanels=P.artifacts.map(a=>{
      const rows=[{name:'Header',bytes:8},...a.sections.map(s=>({name:sectionNames[s.id]||'Section '+s.id,bytes:s.bytes}))]
        .map(s=>el('tr',{},el('td',{},s.name),el('td',{},bytes(s.bytes)),el('td',{},exact(s.bytes))));
      rows.push(el('tr',{class:'total'},el('td',{},'Physical total'),el('td',{},bytes(a.bytes)),el('td',{},exact(a.bytes))));
      const physical=el('div',{class:'surface panel-pad'},
        el('div',{class:'panel-topline'},el('div',{},el('h3',{},a.host+' · '+a.stage),el('p',{},'Physical file accounting')),byteDisplay(a.bytes,'artifact-big')),
        ledger(a,true),el('table',{class:'ledger-table'},el('caption',{class:'sr-only'},'Physical artifact sections'),el('tbody',{},rows)));
      const inside=el('div',{class:'surface panel-pad'},el('h3',{},'Inside the artifact'),
        a.ledger?kv([['Code bodies',exact(a.ledger.codeBodyBytes)],['Code framing',exact(a.ledger.codeFramingBytes)],['Data payload',factText(a.ledger.dataPayloadBytes)+' · '+qualifier(a.ledger.dataPayloadBytes)],['Unattributed data payload',factText(a.ledger.unattributedDataPayloadBytes)+' · '+qualifier(a.ledger.unattributedDataPayloadBytes)]]):note('Detailed code/data ledger unavailable.'),
        el('p',{class:'small-note'},'Section coverage: '+a.sectionCoverage.status+'. Sections include framing; resource payloads are subsets of these bytes.'),
        el('p',{class:'small-note mono record-text'},'SHA-256 '+a.sha256),
        el('details',{class:'details-block'},el('summary',{},'Physical section records'),el('pre',{class:'record-text'},JSON.stringify(a.sections,null,2))));
      return el('section',{class:'two-column subsection'},physical,inside);
    });
    const sortHead=(key,label)=>{
      const control=button(label+' ↕',()=>{
        state.resourceDir=state.resourceSort===key?(state.resourceDir==='asc'?'desc':'asc'):(key==='name'?'asc':'desc');state.resourceSort=key;renderResources();$('#resource-sort-'+key).focus({preventScroll:true});
      },'schema-sort-button');control.id='resource-sort-'+key;
      return el('th',{'aria-sort':state.resourceSort===key?(state.resourceDir==='asc'?'ascending':'descending'):'none'},control);
    };
    const resourceTable=(rows,sortable=false)=>el('table',{class:'inventory-table resource-table'},
      el('caption',{class:'sr-only'},'Resource input and retained sizes'),
      el('thead',{},el('tr',{},sortable?sortHead('name','Resource'):el('th',{},'Resource'),el('th',{},'Category'),sortable?sortHead('input','Input bytes'):el('th',{},'Source bytes'),sortable?sortHead('representation','Representation bytes'):el('th',{},'Representation bytes'),sortable?sortHead('retained','Retained payload'):el('th',{},'Retained payload'),el('th',{},'References'))),el('tbody',{},resourceRows(rows)));
    const groups=model.assetGroups();
    const advanced=el('details',{id:'resource-advanced',class:'details-block',open:!!state.resourceAdvanced,on:{toggle:e=>{state.resourceAdvanced=e.target.open;if(e.target.open&&!advanced.querySelector('table'))advanced.append(el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'All resource evidence'},resourceTable(sortedResources().filter(r=>model.technicalResources.includes(r)),true)));}}},
      el('summary',{},'Advanced resource evidence · '+model.technicalResources.length+' records'),
      note('Packed base64 text is input encoding, not Wasm data size. Normalized descriptor bytes describe schema structure, not generated code. Dynamic expressions are unresolved, not zero. Includes unassociated text construction sites, schema descriptors and generated support. These are evidence records, not distinct assets. Equal payloads at different sites remain separate.'),
      P.resourceProducers?el('div',{},el('h3',{},'Producer coverage'),P.resourceProducers.map(row=>el('p',{class:'small-note'},resourceScopes[row.scope]+' · '+coverageText(row.coverage)))):note('Producer coverage was not recorded in this historical capsule.'),
      state.resourceAdvanced?el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'All resource evidence'},resourceTable(sortedResources().filter(r=>model.technicalResources.includes(r)),true)):null);
    replace($('#view-resources'),
      sectionHeading('Assets & sizes','Embedded assets and associated response payloads, grouped by type.',model.assetResources.length),
      P.binaryResources?el('div',{class:'surface panel-pad'},el('h3',{},'Binary resource closure'),
        kv([['Logical bindings',P.binaryResources.selectedBindingCount+' selected / '+P.binaryResources.bindingCount+' admitted'],
          ['Unique backings',P.binaryResources.selectedUniqueBackingCount+' selected / '+P.binaryResources.uniqueBackingCount+' admitted'],
          ['Raw manifest files',exact(P.binaryResources.source.decodedBytes)],['Serialized manifest',exact(P.binaryResources.source.serializedBytes)],
          ['Selected unique backing',factText(P.binaryResources.selectedBackingBytes)],['Observed raw data ranges',factText(P.binaryResources.observedBackingBytes)],
          ['Measured artifact',P.binaryResources.observedArtifactId??'Not recorded'],['Instance / process memory','Not recorded']]),
        el('p',{class:'small-note'},'Aliases and callable owners share backing identities. Raw data ranges are subsets of the named artifact, not additional bytes or runtime copy counts.'),
        kv(Object.entries(P.binaryResources.budgets).map(([key,value])=>['Admission budget: '+key,String(value)]))):null,
      P.computation?.callees.length?el('div',{class:'surface panel-pad'},el('h3',{},'Shared computations'),
        P.computation.callees.map(c=>el('details',{},el('summary',{},c.name+' · '+model.sourceLocation(c.source)),
          el('p',{},'Entry consumers: '+coverageText(c.entryCoverage)+' · body attribution: '+factText(c.bodyBytes)),entryLinks(c.entryIds),
          ...P.computation.sites.filter(s=>s.calleeId===c.id).map(s=>el('p',{class:'record-text'},'Call site: '+model.sourceLocation(s.source)+(s.managed?' · managed caller':''))),
          ...c.helpers.map(h=>el('p',{class:'record-text'},'Helper: '+h.name+' · '+model.sourceLocation(h.source)))))):null,
      note('Source-byte totals describe recorded inputs and response construction sites. They are not deduplicated physical bytes or deletion savings. Retained Wasm size remains separate.'),
      el('div',{class:'asset-groups'},groups.length?groups.map(g=>el('details',{class:'asset-group',open:state.assetGroups?.has(g.label),on:{toggle:e=>{state.assetGroups??=new Set();e.target.open?state.assetGroups.add(g.label):state.assetGroups.delete(g.label);}}},
        el('summary',{},el('strong',{},g.label),el('span',{},g.resources.length+' records · '+bytes(g.input)+' known source bytes'+(g.known<g.resources.length?' · '+(g.resources.length-g.known)+' unmeasured':''))),
        el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':g.label},resourceTable(g.resources)))):note('No embedded assets or associated response payloads recorded. This does not establish that the application has none.')),
      el('p',{class:'small-note'},model.technicalResources.length+' technical or unassociated records are available in Advanced resource evidence. Schemas are also available in the Schemas inventory.'),
      sectionHeading('Physical artifact sizes','Exact file accounting. Resource input sizes must not be added to these totals.'),artifactPanels,advanced);
  }

  function schemaSortHead(key,label) {return el('th',{'data-schema-sort':key,'aria-sort':state.schemaSort===key?(state.schemaDir==='asc'?'ascending':'descending'):'none'},button(label+' ↕',()=>{state.schemaDir=state.schemaSort===key?(state.schemaDir==='asc'?'desc':'asc'):(key==='name'?'asc':'desc');state.schemaSort=key;renderSchemaRows();},'schema-sort-button'));}
  function renderSchemas() {
    const search=el('input',{id:'schema-search',type:'search',value:state.schemaSearch,placeholder:'Find schemas or field names…','aria-label':'Search schemas and fields',on:{input:e=>{state.schemaSearch=e.target.value.toLowerCase();renderSchemaRows();}}});
    replace($('#view-schemas'),sectionHeading('Schema inventory','Compare structural facts, usage coverage and recorded route references.',P.schemas.length),note('Descriptor bytes = canonical UTF-8 JSON of the normalized schema descriptor. This is not generated validator or Wasm size. Unknown and not-applicable metrics are not zero.'),el('label',{class:'search-box inventory-search'},icon('search'),search),
      el('div',{class:'surface table-surface'},el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'Scrollable schema inventory'},el('table',{class:'inventory-table schema-table'},el('caption',{class:'sr-only'},'Schema structure, normalized descriptor size and recorded route references.'),el('thead',{},el('tr',{},schemaSortHead('name','Schema'),schemaSortHead('keys','Top-level keys'),schemaSortHead('required','Required keys'),schemaSortHead('descriptor','Descriptor bytes'),schemaSortHead('refs','Routes'))),el('tbody',{id:'schema-body'}))),el('div',{class:'table-footer'},el('span',{id:'schema-count',role:'status','aria-live':'polite'}),el('span',{},'Descriptor size ≠ executable contribution'))));renderSchemaRows();
  }
  function renderSchemaRows() {
    const key=state.schemaSort, list=filteredSchemas();
    const value=(s,n)=>s.structure.keyCountsState==='not-applicable'?'N/A':s.structure[n]??'Unavailable';
    const rows=[];
    for(const s of list) {
      const i=schemaIndex.get(s.id),open=state.expandedSchemas.has(s.id),structure=s.structure,usage=schemaUsage(s);
      const expand=button((open?'▾ ':'▸ ')+s.schemaId,()=>{open?state.expandedSchemas.delete(s.id):state.expandedSchemas.add(s.id);renderSchemaRows();$('#schema-expand-'+i).focus({preventScroll:true});},'schema-expand mono');
      expand.id='schema-expand-'+i;expand.setAttribute('aria-expanded',String(open));expand.setAttribute('aria-controls','schema-detail-'+i);
      rows.push(el('tr',{'data-schema-index':i,class:open?'schema-row-open':''},el('td',{},expand,el('div',{class:'secondary schema-summary'},usage.label),usage.externalPackages.length?el('div',{class:'secondary'},'External dependency · '+usage.externalPackages.join(', ')):null),el('td',{class:'numeric'},value(s,'topLevelKeys')),el('td',{class:'numeric'},value(s,'requiredKeys')),el('td',{class:'numeric',title:exact(structure.descriptorBytes)},structure.descriptorBytes===null?'Unavailable':bytes(structure.descriptorBytes)),el('td',{class:'numeric'},s.routeIds.length)));
      const detail=el('div',{class:'schema-detail',id:'schema-detail-'+i,hidden:!open},...(open?[
        el('div',{},el('h4',{},'TOP-LEVEL SHAPE'),el('p',{class:'schema-detail-desc'},'Normalized property names, types and required state. Full nesting is retained in the descriptor.'),
          structure.properties.length?el('table',{class:'schema-property-table'},el('caption',{class:'sr-only'},s.schemaId+' properties'),el('thead',{},el('tr',{},el('th',{scope:'col'},'Property'),el('th',{scope:'col'},'Type'),el('th',{scope:'col'},'Required'))),el('tbody',{},structure.properties.map(p=>el('tr',{},el('td',{},el('code',{},p.name)),el('td',{},el('code',{},p.type)),el('td',{},p.required===null?'Unavailable':p.required?'Required':'Optional'))))):el('p',{},structure.keyCountsState==='not-applicable'?'Not an object shape.':structure.state==='unavailable'?'Property structure unavailable.':'No top-level properties.'),
          el('details',{class:'details-block'},el('summary',{},'Normalized descriptor'),el('pre',{class:'record-text'},structure.descriptor===null?'Unavailable':JSON.stringify(structure.descriptor,null,2)))),
        el('div',{},el('h4',{},'REFERENCE & PROVENANCE'),kv([['Usage',usage.label],['Known consuming entries',String(s.entryIds.length)],...(usage.externalPackages.length?[['External dependency',usage.externalPackages.join(', ')]]:[]),['Source',sourceText(s.source)],['Registry',s.registryVersion],['Representation',structure.representation],['Descriptor bytes',exact(structure.descriptorBytes)],['Generated validator bytes','Unavailable; descriptor bytes do not establish Wasm attribution']]),el('h4',{},'RECORDED ROUTE REFERENCES'),routeChips(s.routeIds),el('h4',{},'RECORDED ENTRY REFERENCES'),entryLinks(s.entryIds),...evidenceCards(s.evidenceIds))]:[]));
      rows.push(el('tr',{hidden:!open},el('td',{colspan:5},detail)));
    }
    if(!list.length) rows.push(el('tr',{},el('td',{colspan:5},'No matching schemas. Inventory coverage: '+P.coverage.schemas.status+'.')));
    replace($('#schema-body'),rows);$('#schema-count').textContent=`${list.length} of ${P.schemas.length} schemas · ${P.coverage.schemas.status} inventory`;
    for(const th of $$('[data-schema-sort]'))th.setAttribute('aria-sort',th.dataset.schemaSort===key?(state.schemaDir==='asc'?'ascending':'descending'):'none');
  }
  // Local ordinals navigate this capsule; canonical IDs remain in record details.
  const definitionLink = id => el('a',{href:model.detailHash('handlers',id),class:'record-text'},definitionLabel(definitionById.get(id)));
  const registrationLink = id => el('a',{href:model.detailHash('registrations',id),class:'record-text'},registrationLabel(registrationById.get(id)));
  const useSiteLink = id => { const row=useSiteById.get(id); return el('a',{href:model.detailHash('use-sites',id),class:'record-text'},row.surfaceId+' · site '+(useSiteIndex.get(id)+1)); };
  const analyticsEvidence = row => el('details',{class:'details-block'},el('summary',{},'Retained record and producer evidence'),el('pre',{class:'record-text'},JSON.stringify(row,null,2)));
  const analyticsCoverageNote = key => el('p',{class:'small-note'},'Coverage: '+coverageText(analyticsCoverage(key)));
  const registrationLinks = rows => el('ul',{class:'analytics-links'},rows.map(row=>el('li',{},registrationLink(row.id))));
  const definitionLinks = rows => el('ul',{class:'analytics-links'},rows.map(row=>el('li',{},definitionLink(row.id),
    el('p',{class:'small-note record-text'},row.kind+' · '+(row.source.state==='available'?row.source.value.file+':'+row.source.value.start.line+':'+row.source.value.start.column:authoredFact(row.source))),
    el('p',{class:'small-note'},definitionRegistrations(row.id).length+' observed registrations · '+definitionSites(row.id).length+' owned use sites',
      definitionRegistrations(row.id).length?' · '+[...new Set(definitionRegistrations(row.id).map(r=>r.kind))].join(', '):null))));
  function callDetail(call) {
    return el('details',{class:'details-block'},el('summary',{class:'record-text'},definitionLabel(definitionById.get(call.callerId))+' → '+definitionLabel(definitionById.get(call.calleeId))),
      kv([['Caller',definitionLink(call.callerId)],['Linked helper',definitionLink(call.calleeId)],['Authored call source',authoredSource(call.source)]]),
      registrationLinks(call.registrationIds.map(id=>registrationById.get(id))),analyticsEvidence(call));
  }
  function associationDetail(row) {
    const condition = row.conditional === false ? 'Direct ownership · not execution' : row.conditional === true ? 'Conditional static candidate' : 'Conditionality unknown';
    return el('details',{class:'details-block'},el('summary',{class:'record-text'},useSiteById.get(row.useSiteId).surfaceId+' · '+row.lane+' · '+condition+' · '+registrationLabel(registrationById.get(row.consumerRegistrationId))),
      kv([['Consumer',registrationLink(row.consumerRegistrationId)],['Use site',useSiteLink(row.useSiteId)],['Coverage',coverageText(row.coverage)]]),
      el('ol',{class:'step-list'},row.via.map(hop=>el('li',{},hop.kind+' · ',hop.kind==='helper'?callDetail(callById.get(hop.id)):registrationLink(hop.id)))),analyticsEvidence(row));
  }
  function associationList(rows, coverage) {
    const host=el('div');let page=0;
    function draw(){
      const pages=Math.max(1,Math.ceil(rows.length/20));
      const previous=button('Previous associations',()=>{page--;draw();host.querySelector('.association-page-status').focus();});
      const next=button('Next associations',()=>{page++;draw();host.querySelector('.association-page-status').focus();});
      previous.disabled=page===0;next.disabled=page+1>=pages;
      host.replaceChildren(el('p',{class:'small-note'},'Coverage: '+coverageText(coverage)),
        ...rows.slice(page*20,(page+1)*20).map(associationDetail),
        el('div',{class:'atlas-controls'},previous,el('span',{class:'association-page-status',tabindex:-1,role:'status'},rows.length+' associations · page '+(page+1)+' / '+pages),next),
        ...(!rows.length?[el('p',{},'No observed associations. Missing evidence does not establish absence.')]:[]));
    }
    draw();return host;
  }
  function upstreamDetail(id) {
    if(!model.queries)return note('Upstream admission independent of use sites was not recorded by this historical representation.');
    const result=model.queries.upstream(id);
    return detailSection('Upstream admission candidates',el('p',{class:'small-note'},coverageText(result.coverage)),
      registrationLinks(result.relations.map(r=>registrationById.get(r.owner))),
      note('Includes predecessors with no binding operations. These are static candidates, not observed execution.'));
  }
  function siteDetail(row, focused=false) {
    const binding = bindings.get(row.binding.bindingId);
    const associations = model.queries?.site(row.id) || {rows:siteAssociations(row.id),coverage:analyticsCoverage('associations')};
    return el('article',{class:'surface panel-pad subsection'},el('h3',{id:focused?'use-site-title':undefined,tabindex:focused?-1:undefined,class:'record-text'},row.surfaceId+' · site '+(useSiteIndex.get(row.id)+1)),
      kv([['Definition owner',definitionLink(row.ownerId)],['Capability',authoredFact(row.capability)],['Operation',row.operation],['Binding state',[row.binding.state,row.binding.kind,row.binding.reason].filter(Boolean).join(' · ')],
        ['Logical binding',binding?el('a',{href:model.detailHash('bindings',binding.id)},binding.name+' · '+binding.resolution):'No resolved binding'],['Reference ID',row.binding.referenceId??'Not recorded'],['Authored use source',authoredSource(row.source)]]),
      analyticsCoverageNote('useSites'),detailSection('Contextual consumers',associationList(associations.rows,associations.coverage)),analyticsEvidence(row));
  }
  const pointLink = id => model.entryPointById.has(id)
    ? el('a',{href:model.detailHash('entry-points',id),class:'record-text'},'Open Entry Point · '+model.entryPointById.get(id).label) : registrationLink(id);
  const bindingLink = id => el('a',{href:model.detailHash('bindings',id),class:'record-text'},'Open Binding · '+bindings.get(id).name);
  const atlas=createReportAtlas({onClose:mode=>{restoreOrigin=true;location.hash=explorerOrigin?.hash||(mode==='bindings'?'#bindings':'#entry-points');},onTable:mode=>{
    if(inventorySession){
      const kind=mode==='bindings'?'bindings':'entry-points';if(inventorySession.kind!==kind){inventorySession.kind=kind;explorerOrigin.hash='#'+kind;}
      inventorySession.hash=activeHash;inventorySession.selected=state.selectedRegistration;inventorySession.focus=document.activeElement;
      const selection=atlas.inventorySelection();
      if(inventorySession.kind==='entry-points'&&model.entryPointById.has(selection)){
        const index=model.filteredEntryPoints().findIndex(p=>p.id===selection);
        if(index>=0){explorerOrigin.hash=model.detailHash('entry-points',selection);state.entryPointPage=Math.floor(index/50);}
      }else if(inventorySession.kind==='bindings'&&bindings.has(selection))explorerOrigin.hash=model.detailHash('bindings',selection);
    }
    restoreOrigin=true;location.hash=explorerOrigin?.hash||'#entry-points';
  },model,el,button,registrationLink,definitionLink,associationDetail,useSiteLink,pointLink,bindingLink,select:id=>{
    const hash=model.detailHash('explorer/entry',id);
    if(location.hash===hash)atlas.center(id,true);else {atlasFocus=true;location.hash=hash;}
  }});
  function rememberExplorerOrigin(){const focused=document.activeElement,label=focused?.textContent;explorerOrigin={hash:location.hash||'#entry-points',label,index:$$('button').filter(n=>n.textContent===label).indexOf(focused)};}
  function exploreEntry(id){inventorySession=null;rememberExplorerOrigin();explorerReturn=null;atlas.focusEntry(id);atlasFocus=true;const hash=model.detailHash('explorer/entry',id);if(location.hash!==hash)location.hash=hash;else renderAtlas();}
  function exploreBinding(id){inventorySession=null;rememberExplorerOrigin();explorerReturn=null;atlasFocus=true;atlas.bindings({binding:id});const hash=model.detailHash('explorer/binding',id);if(location.hash!==hash)location.hash=hash;else renderAtlas();}
  function inventorySignature(kind){return JSON.stringify(kind==='bindings'?[kind,state.bindingSearch,state.selectedBinding]:[kind,state.entryPointSearch,state.entryPointType,state.entryPointMethod,state.entryPointEvent,state.selectedEntryPoint]);}
  function exploreInventory(kind) {
    const signature=inventorySignature(kind);
    rememberExplorerOrigin();
    if(inventorySession?.signature===signature&&inventorySession.hash){
      explorerReturn={hash:inventorySession.hash,selected:inventorySession.selected,focus:inventorySession.focus};location.hash=inventorySession.hash;return;
    }
    explorerReturn=null;inventorySession={signature,kind};
    if(kind==='bindings'){
      const matching=[...bindings.values()].filter(b=>(b.name+' '+b.kind+' '+b.resolution).toLowerCase().includes(state.bindingSearch));
      const id=matching.find(b=>b.id===state.selectedBinding)?.id||matching[0]?.id||null;
      atlas.bindings({binding:id,query:state.bindingSearch,inventory:true});
      location.hash='#explorer/inventory/bindings';
    }else{
      const matching=model.filteredEntryPoints(),id=matching.find(p=>p.id===state.selectedEntryPoint)?.registration?.id||null;
      atlas.focusInventory(id);state.selectedRegistration=id;location.hash='#explorer/inventory/entry-points';
    }
  }
  let atlasFocus=false;
  function renderAtlas(){atlas.open($('#view-atlas'));}
  const inventories=createReportInventories({model,el,button,replace,heading:sectionHeading,note,kv,tag,definitionLink,registrationLink,useSiteLink,entryLink,evidenceCards,exploreEntry,exploreBinding,exploreInventory,methodTag,bytes});
  function renderEntryPoints(){inventories.renderEntryPoints($('#view-entry-points'));}
  function registrationDetail(row) {
    const associations = model.queries?.route(row.id) || {rows:registrationAssociations(row.id),coverage:analyticsCoverage('associations')};
    return el('article',{class:'surface panel-pad subsection'},el('h3',{id:'registration-title',tabindex:-1,class:'record-text'},registrationLabel(row)),
      el('p',{},button('Explore execution',()=>exploreEntry(row.id))),
      kv([['Definition',row.handlerId?definitionLink(row.handlerId):'No authored definition'],['Authored',String(row.authored)],['Registration source',authoredSource(row.source)],
        ['Router',row.routerId],['Router path',row.routerPath.join(' → ')],['Entry',entryLink(row.id)]]),
      detailSection('Ordered mount instances',row.mountPath.length?el('ol',{class:'step-list'},row.mountPath.map(id=>el('li',{},registrationLink(id)))):el('p',{},'No enclosing mounts recorded.')),
      detailSection('Static continuation links',kv(Object.entries(row.flow).map(([key,id])=>[key,id?registrationLink(id):'No retained link'])),
        note('Links and associations explain static dependencies. They are not a request execution trace.')),
      upstreamDetail(row.id),
      detailSection('Capability and binding associations',associationList(associations.rows,associations.coverage)),analyticsCoverageNote('registrations'),analyticsEvidence(row));
  }
  function definitionDetail(row) {
    const ownSites=definitionSites(row.id), callers=helperCallers(row.id), callees=helperCallees(row.id);
    return el('article',{class:'surface panel-pad subsection'},el('h3',{id:'definition-title',tabindex:-1,class:'record-text'},definitionLabel(row)),
      kv([['Definition kind',row.kind],['Definition ID',row.id],['Canonical ID',row.canonicalId],['Definition source',authoredSource(row.source)],
        ['Package',row.package.state==='available'?[row.package.value.name,row.package.value.version,row.package.value.sourceIdentity].join(' · '):authoredFact(row.package)]]),
      detailSection('Registration instances',analyticsCoverageNote('registrations'),registrationLinks(definitionRegistrations(row.id)),
        definitionRegistrations(row.id).length?null:el('p',{},'No direct registration observed. Linked helpers are reached through callers.')),
      detailSection('Authored capability and binding use sites',analyticsCoverageNote('useSites'),el('ul',{class:'analytics-links'},ownSites.map(site=>el('li',{},useSiteLink(site.id),
        el('p',{class:'small-note record-text'},authoredFact(site.capability)+' · '+(bindings.get(site.binding.bindingId)?.name??site.binding.state))))),
        ownSites.length?null:el('p',{},'No observed use sites.')),
      detailSection('Helper callers',analyticsCoverageNote('helperCalls'),...callers.map(callDetail),callers.length?null:el('p',{},'No observed helper callers.')),
      detailSection('Linked helper calls',analyticsCoverageNote('helperCalls'),...callees.map(callDetail),callees.length?null:el('p',{},'No observed helper calls.')),analyticsEvidence(row));
  }
  function renderHandlers() {
    const selected=definitionById.get(state.selectedDefinition), registration=registrationById.get(state.selectedRegistration), site=useSiteById.get(state.selectedUseSite);
    const search=el('input',{id:'handler-search',type:'search',value:state.definitionSearch,placeholder:'Search definitions, capabilities or bindings','aria-label':'Search handler definitions',on:{input:e=>{state.definitionSearch=e.target.value.toLowerCase();renderDefinitionList();}}});
    const filter=(id,label,value,values,change)=>el('label',{},label,el('select',{id,'aria-label':label,value,on:{change:e=>{change(e.target.value);renderDefinitionList();}}},values.map(([key,text])=>el('option',{value:key,selected:key===value},text))));
    function renderDefinitionList() {
      const shown=filteredDefinitions();
      replace($('#handler-list'),shown.length?definitionLinks(shown):el('p',{},analyticsCoverage('handlers').status==='unavailable'?'Handler definitions unavailable · '+analyticsCoverage('handlers').reason:'No matching definitions.'));
      $('#handler-count').textContent=shown.length+' shown / '+definitions.length+' observed definitions';
    }
    replace($('#view-handlers'),sectionHeading('Handlers','Authored handlers and linked helpers. Roles belong to registration instances.',analyticsCoverage('handlers').status==='unavailable'?'Unavailable':definitions.length),
      note('Static capability and binding associations describe recognized usage, not effective permissions or runtime execution. Missing evidence is not zero. Compiled helpers and byte attribution remain separate.'),
      el('details',{class:'details-block'},el('summary',{},'Analytics coverage'),kv((model.queries?['handlers','registrations','useSites','helperCalls']:['handlers','registrations','useSites','helperCalls','associations']).map(key=>[key,coverageText(analyticsCoverage(key))]))),
      selected?definitionDetail(selected):null,registration?registrationDetail(registration):null,site?siteDetail(site,true):null,
      el('details',{class:'surface panel-pad subsection',open:!selected&&!registration&&!site},el('summary',{},'Search authored records'),el('label',{class:'search-box inventory-search'},icon('search'),search),
        el('div',{class:'analytics-filters'},filter('handler-kind','Definition kind',state.definitionKind,[['all','All definitions'],['handler','Handlers'],['helper','Linked helpers']],v=>state.definitionKind=v),
          filter('handler-role','Registration role',state.definitionRole,[['all','All roles'],...['route','middleware','error','event','fallback'].map(v=>[v,v])],v=>state.definitionRole=v)),
        el('p',{id:'handler-count',class:'small-note','aria-live':'polite'}),el('div',{id:'handler-list'})),
      el('p',{},el('a',{href:'#entry-points'},'Browse Entry Points')),
      el('details',{class:'surface panel-pad'},el('summary',{},'All registration instances · '+(analyticsCoverage('registrations').status==='unavailable'?'Unavailable':registrations.length)),
        analyticsCoverageNote('registrations'),registrationLinks([...registrations].sort((a,b)=>a.order-b.order))));
    renderDefinitionList();
  }

  function renderEntries() {
    const selected = entries.get(state.selectedEntry);
    const search = el('input',{id:'entry-search',type:'search',placeholder:'Search names, IDs or source files',
      'aria-label':'Search entries',value:state.entrySearch,on:{input:e=>{
        state.entrySearch=e.target.value.toLowerCase();renderEntryList();
      }}});
    function renderEntryList() {
      const shown = P.entries.filter(entry => [entryLabel(entry),entry.id,entry.canonicalId,entry.handlerId,sourceText(entry.source)]
        .join(' ').toLowerCase().includes(state.entrySearch));
      replace($('#entry-list'),shown.length ? shown.map(entry=>el('div',{class:'helper-entry'},entryLink(entry.id),
        el('p',{class:'small-note record-text'},entry.kind+' · '+sourceText(entry.source)))) : el('p',{},'No matching entries.'));
    }
    replace($('#view-entries'),sectionHeading('Entry inventory','Recorded identities and static references. Links do not establish execution order.',P.entries.length),
      selected ? el('article',{class:'surface panel-pad subsection'},el('h3',{id:'entry-title',tabindex:-1,class:'record-text'},entryLabel(selected)),
        kv([['Kind',selected.kind],['Recorded name',selected.name??'Not recorded'],['Source',sourceText(selected.source)],['Entry ID',selected.id],['Canonical ID',selected.canonicalId],['Handler ID',selected.handlerId??'Not recorded']]),
        detailSection('Authored analytics',definitionById.has(selected.handlerId)?definitionLink(selected.handlerId):el('p',{},'Handler definition unavailable'),registrationById.has(selected.id)?registrationLink(selected.id):analyticsCoverageNote('registrations')),
        detailSection('Recorded flow references',selected.flow ? kv([
          ['Next',selected.flow.nextEntryId?entryLink(selected.flow.nextEntryId):'Not recorded'],
          ['Child',selected.flow.childEntryId?entryLink(selected.flow.childEntryId):'Not recorded'],
          ['Parent continuation',selected.flow.parentContinueEntryId?entryLink(selected.flow.parentContinueEntryId):'Not recorded']]) : el('p',{},'Not recorded')),
        detailSection('Own route registrations',routeChips(P.routes.filter(r=>r.entryId===selected.id).map(r=>r.id))),
        detailSection('Recorded composition references',routeChips(P.routes.filter(r=>r.composition.includes(selected.id)).map(r=>r.id))),
        el('details',{class:'details-block'},el('summary',{},'Complete entry record'),el('pre',{class:'record-text'},JSON.stringify(selected,null,2)))) : null,
      el('div',{class:'surface panel-pad'},el('label',{class:'search-box inventory-search'},icon('search'),search),el('div',{id:'entry-list'})));
    renderEntryList();
  }
  function renderBindings(){inventories.renderBindings($('#view-bindings'));}
  function renderEvidence() {
    replace($('#view-evidence'),sectionHeading('Evidence & provenance','Recorded scope, availability and producer identity. No security grade or inferred pass.'),
      el('div',{class:'two-column'},el('div',{class:'surface panel-pad'},el('h3',{},'Capsule identity'),kv([['SHA-256',P.evidenceHash.value],['Profile / host',P.context.profile+' / '+P.context.host],['Recipe',P.provenance.recipe.name+' '+P.provenance.recipe.version],['Optimization',P.provenance.recipe.optimization],['Revision',P.provenance.revision??'Unknown'],['Dirty',P.provenance.dirty===null?'Unknown':String(P.provenance.dirty)]]),note('This digest identifies evidence; it is not a signature or security attestation.')),
      el('div',{class:'surface panel-pad'},el('h3',{},'Inventory coverage'),...Object.entries(P.coverage).map(([name,c])=>el('div',{class:'coverage-line'},el('div',{},name+' · '+c.status),el('p',{},`${c.observed} observed / ${c.expected??'unknown'} expected${c.reason?' · '+c.reason:''}`))))),
      sectionHeading('Recorded observations','Original producer, severity and code are retained.',P.observations.length),...P.observations.map(o=>el('article',{class:'surface panel-pad subsection'},el('h3',{},o.code),el('p',{},o.severity+' · '+o.producer.name+' '+o.producer.version),routeChips(o.subjectIds.filter(id=>routes.has(id))),...evidenceCards(o.evidenceIds))),P.observations.length?null:note('No observations recorded. Absence is not a pass.'),
      sectionHeading('Host contributions','Unique package contributions and authored operation use sites are counted separately.'),
      P.hostContributions ? el('div',{},
        el('p',{},`${P.hostContributions.length} contributions · ${P.hostUseSites.length} use sites · inventory ${P.coverage.hostContributions.status}`),
        ...P.hostContributions.map(c=>el('article',{class:'surface panel-pad subsection'},el('h3',{},c.package+' · '+c.operation),
          kv([['Package version',c.packageVersion??'Not recorded'],['Contribution',c.contributionId],['Contract',c.contractId],['Protocol',c.protocol],['Service',c.service],['Implementation',c.implementation],['Target',c.target.provider+' / '+c.target.target+' / '+c.target.targetId],['Source digest',c.sourceSha256],['Import policy',c.policySha256]]),
          el('h4',{},'Declared contribution imports'),el('pre',{class:'record-text'},JSON.stringify(c.declaredImports,null,2)),
          el('h4',{},'Authored use sites'),...P.hostUseSites.filter(s=>s.contributionId===c.id).map(s=>el('p',{},sourceText(s.source)+' · '+s.sourceBasis+' · '+s.canonicalId)))),
        ...P.hostAudits.map(a=>el('article',{class:'surface panel-pad subsection'},el('h3',{},'Final Wasm import audit'),
          el('p',{},`${a.observedImports.length} observed imports · ${a.permittedImports.length} permitted imports · runtime observations unknown`),
          el('p',{},'Attachment coverage: '+a.lifecycle.coverage),
          el('details',{class:'details-block'},el('summary',{},'Observed imports, complete baseline policy and lifecycle attachment points'),el('pre',{class:'record-text'},JSON.stringify(a,null,2))))))
        : note('Host contribution and observation coverage unknown: not recorded by this historical report.'),
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
  function showView(view,restore=false) {
    if(view!=='atlas')atlas.leave();
    state.view=view;for(const id of viewIds)$('#view-'+id).hidden=id!==view;
    for(const a of $$('[data-view]')){a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
    replace($('#explorer-return'),explorerReturn&&view!=='atlas'?el('a',{href:explorerReturn.hash,class:'button subtle'},'Back to Explorer'):null);
    if(restore){atlas.resume();explorerReturn.focus?.focus({preventScroll:true});return;}
    if(view==='entry-points')renderEntryPoints();else if(view==='routes')renderRoutes();else if(view==='atlas')renderAtlas();else if(view==='handlers')renderHandlers();else if(view==='entries')renderEntries();else if(view==='helpers')renderHelpers();else if(view==='schemas')renderSchemas();else if(view==='resources')renderResources();else if(view==='bindings')renderBindings();else renderEvidence();
  }
  function onHash() {
    if(location.hash==='#main')return;
    const parts=location.hash.slice(1).split('/'),kind=parts[0];let token;
    try{token=parts[1]===undefined?null:decodeURIComponent(parts[1]);}catch{token=null;}
    const resolve=(rows,key=token)=>key===null?null:/^\d+$/.test(key)?rows[Number(key)]?.id||null:rows.find(r=>r.id===key)?.id||null;
    let view=[...viewIds,'registrations','use-sites'].includes(kind)?kind:'entry-points';
    let explorerId=null,explorerKind=null;
    const inventoryExplorer=kind==='explorer'&&parts[1]==='inventory'&&['entry-points','bindings'].includes(parts[2]);
    if(inventoryExplorer)view='atlas';
    if(kind==='explorer'&&['entry','binding'].includes(parts[1])){view='atlas';explorerKind=parts[1];try{explorerId=decodeURIComponent(parts.slice(2).join('/'));}catch{explorerId=null;}}
    let invalidExplorer=false;
    if(explorerKind&&!(explorerKind==='entry'?registrationById:bindings).has(explorerId)){invalidExplorer=true;view=explorerKind==='entry'?'entry-points':'bindings';}
    const restore=view==='atlas'&&explorerReturn?.hash===location.hash;
    if(state.view==='atlas'&&view!=='atlas')explorerReturn={hash:activeHash,selected:state.selectedRegistration,focus:document.activeElement};
    closeModal();closeDrawer(false);
    state.selectedEntryPoint=view==='entry-points'?resolve(model.entryPoints):null;
    state.selectedBinding=view==='bindings'?resolve(P.bindings):null;
    state.selectedEntry=view==='entries'?resolve(P.entries):null;
    state.selectedDefinition=view==='handlers'?resolve(definitions):null;
    state.selectedRegistration=restore?explorerReturn.selected:inventoryExplorer?state.selectedRegistration:explorerKind==='entry'?(registrationById.has(explorerId)?explorerId:null):['registrations','atlas'].includes(view)?resolve(registrations):null;
    state.selectedUseSite=view==='use-sites'?resolve(useSites):null;
    $('#navigation-status').textContent=invalidExplorer?'Requested Explorer record is unavailable in this capsule.':'';
    if(view==='atlas'&&!restore&&!inventoryExplorer){
      if(explorerKind==='binding')atlas.bindings({binding:bindings.has(explorerId)?explorerId:null});
      else {atlas.routing();if(explorerKind==='entry'&&state.view!=='atlas')atlas.focusEntry(state.selectedRegistration);}
    }
    if(inventoryExplorer&&!inventorySession){if(parts[2]==='bindings')atlas.bindings({inventory:true});else atlas.focusInventory(null);}
    showView(['registrations','use-sites'].includes(view)?'handlers':view,restore);
    activeHash=location.hash;
    if(restore)return;
    if(restoreOrigin){restoreOrigin=false;const origin=explorerOrigin;if(inventorySession)inventorySession.signature=inventorySignature(inventorySession.kind);if(!inventorySession)explorerReturn=null;replace($('#explorer-return'));const target=inventorySession?$('#'+inventorySession.kind+'-explore'):$$('button').filter(n=>n.textContent===origin?.label)[origin?.index];(target||(state.view==='bindings'?$('#binding-inventory-search'):$('#entry-point-title')||$('#entry-point-search')))?.focus({preventScroll:true});return;}
    if(state.selectedEntryPoint)$('#entry-point-title')?.focus();
    if(state.selectedDefinition)$('#definition-title').focus();
    if(state.selectedRegistration&&view==='registrations')$('#registration-title').focus();
    if(view==='atlas'&&atlasFocus){if(explorerKind==='binding')$('#binding-summary')?.focus({preventScroll:true});else atlas.center(state.selectedRegistration,true);atlasFocus=false;}
    if(state.selectedUseSite)$('#use-site-title').focus();
    if(state.selectedBinding)$('#binding-title-'+P.bindings.findIndex(b=>b.id===state.selectedBinding)).focus();
    if(state.selectedEntry)$('#entry-title').focus();
    if(view==='routes'){const id=resolve(P.routes);if(id)displayDrawer(routes.get(id));}
    if(view==='schemas'){const id=resolve(P.schemas);if(id){const s=schemas.get(id);state.expandedSchemas.add(id);state.schemaSearch=s.schemaId.toLowerCase();renderSchemas();$('#schema-expand-'+schemaIndex.get(id)).focus();}}
    if(view==='helpers'){const id=resolve(helpers);if(id){state.helperSearch='';state.helperRole='all';state.helperOrigin='all';state.expandedHelpers.add(id);renderHelpers();$('#helper-expand-'+helperIndex.get(id)).focus();}}
  }
  function openModal(title,content) {
    lastModalFocus=document.activeElement;$('#modal-title').textContent=title;replace($('#modal-content'),content);$('#modal').hidden=false;$('#modal-backdrop').hidden=false;setPageInert(true);$('#route-drawer').inert=true;document.body.classList.add('overlay-open');$('#modal-close').focus();
  }
  function closeModal() {
    if($('#modal').hidden)return;$('#modal').hidden=true;$('#modal-backdrop').hidden=true;$('#route-drawer').inert=false;const open=!$('#route-drawer').hidden;setPageInert(open);document.body.classList.toggle('overlay-open',open);if(lastModalFocus?.isConnected)lastModalFocus.focus({preventScroll:true});
  }
  function openRaw() {openModal('The complete evidence capsule',[el('p',{},'One authoritative payload. Search, filters and theme never change these records.'),button('Export JSON',downloadCapsule),el('pre',{class:'raw-json',tabindex:0,'aria-label':'Complete capsule JSON'},model.canonicalJson)]);}
  function about() {openModal('Reading this report',[note('Build-review metadata can be operationally sensitive. Review it before public sharing.'),el('p',{},'This offline viewer consumes the embedded Report v1 capsule. The snapshot label distinguishes current matching, verified manifest replay and historical replay. No network requests, tests or live checks run here.'),el('p',{},'Declarations describe retained metadata, not effective permissions. Unavailable evidence is not zero or a pass. Normalized schema descriptor sizes are separate from generated code sizes.')]);}
  function sizeHelp() {openModal('One artifact. Different size views.',Object.entries(metrics).map(([metric,label])=>el('section',{class:'detail-section'},el('h3',{},label),el('p',{},({'handler-body':'Final mapped handler code bodies only. Embedded CSS, JavaScript and other data payloads are excluded. A small handler body does not mean a small asset. Shared implementations may appear in several rows.',own:'Reachable bodies exclusive to one root, only when the root universe and graph are complete.',reachable:'Distinct bodies reachable under the recorded static call-graph method, including shared code.',shared:'Reachable bodies shared with other roots. Values across routes are nonadditive.'})[metric]))).concat(note('Numeric sorting uses raw bytes, keeps unavailable values last in both directions, and shows evidence coverage. No size is a guarantee of deletion savings.')));}
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
    if(e.key==='Escape'){if(!$('#modal').hidden)closeModal();else if(!$('#route-drawer').hidden)closeDrawer();else if(state.view==='atlas'&&atlas.escape())e.preventDefault();}
    const active=!$('#modal').hidden?$('#modal'):!$('#route-drawer').hidden?$('#route-drawer'):state.view==='atlas'?$('#view-atlas'):null;
    if(e.key==='Tab'&&active){const nodes=$$('button:not([disabled]),a[href],input,select,summary,[tabindex="0"]',active).filter(n=>!n.hidden&&n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first?.focus();}}
    if(e.key==='/'&&state.view==='atlas'&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();($('#atlas-search')||$('#binding-search'))?.focus();}
    if(e.key==='/'&&state.view!=='atlas'&&!active&&!e.ctrlKey&&!e.metaKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();const target=state.view==='bindings'?'#binding-inventory-search':state.view==='routes'?'#route-search':'#entry-point-search';if(!['bindings','routes','entry-points'].includes(state.view)){location.hash='entry-points';setTimeout(()=>$('#entry-point-search').focus(),0);}else $(target)?.focus();}
  });
  window.addEventListener('hashchange',onHash);onHash();
})();
