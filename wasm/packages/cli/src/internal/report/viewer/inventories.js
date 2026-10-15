'use strict';
// Two execution inventories; physical attribution and authored records remain
// separate destinations. All links resolve exact capsule identities.
function createReportInventories({model:m,el,button,replace,heading,note,kv,tag,definitionLink,registrationLink,useSiteLink,entryLink,evidenceCards,exploreEntry,exploreBinding,exploreInventory,methodTag,bytes}) {
  const link=(kind,id,label)=>el('a',{href:m.detailHash(kind,id),class:'record-text',title:label},label);
  const pointLink=p=>link('entry-points',p.id,p.label);
  const bindingLink=b=>link('bindings',b.id,b.name+' · '+b.kind);
  const contextCache=new Map();
  const context=p=>{if(!contextCache.has(p.id))contextCache.set(p.id,m.entryPointContext(p.id));return contextCache.get(p.id);};
  function viewSwitch(kind) {
    const table=button('Table',()=>{},'view-mode active');table.setAttribute('aria-pressed','true');
    const explore=button('Explore',()=>exploreInventory(kind),'view-mode');explore.id=kind+'-explore';explore.setAttribute('aria-pressed','false');
    return el('div',{class:'view-switch',role:'group','aria-label':(kind==='bindings'?'Bindings':'Entry Points')+' view'},table,explore);
  }
  function pointTable(rows,label='Entry points') {
    return el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':label},el('table',{class:'inventory-table compact-route-table'},
      el('caption',{class:'sr-only'},label),el('thead',{},el('tr',{},['Method / type','Route / event','Source','Schemas','Possible bindings','Handler bytes'].map(t=>el('th',{},t)))),
      el('tbody',{},rows.map(p=>{const c=context(p),size=p.route?m.factValue(m.measurement(p.route,'handler-body')?.fact):null;
        return el('tr',{'data-entry-point-id':p.id,class:p.id===m.state.selectedEntryPoint?'selected':'',on:{click:e=>{if(!e.target.closest('a,button'))location.hash=m.detailHash('entry-points',p.id);}}},
          el('td',{},p.type==='event'?tag('Event'):methodTag(p.method||'HTTP')),
          el('td',{},link('entry-points',p.id,p.path||p.eventType||p.label)),el('td',{class:'route-source',title:p.source},p.source),
          el('td',{class:'numeric',title:'Recorded schema references; missing references do not establish no use'},p.route?.schemaIds.length||'—'),
          el('td',{class:'numeric',title:m.coverageText(c.coverage)},c.bindings.length||'—'),
          el('td',{class:'numeric',title:p.route?m.measurementIssue(p.route,'handler-body'):'No HTTP size measurement'},size===null?'—':bytes(size)));
      }))));
  }
  function pages(rows,render,label,size=20,asTable=false) {
    let page=0;const host=el('div',{});
    function draw(){const count=Math.max(1,Math.ceil(rows.length/size)),status=el('span',{tabindex:-1,role:'status',class:'inventory-page-status'},label+' · page '+(page+1)+' / '+count);
      const prev=button('Previous '+label,()=>{page--;draw();host.querySelector('.inventory-page-status')?.focus({preventScroll:true});});
      const next=button('Next '+label,()=>{page++;draw();host.querySelector('.inventory-page-status')?.focus({preventScroll:true});});
      prev.disabled=page===0;next.disabled=page+1>=count;
      host.replaceChildren(asTable?pointTable(rows.slice(page*size,(page+1)*size),label):el('ul',{class:'analytics-links'},rows.slice(page*size,(page+1)*size).map(row=>el('li',{},render(row)))),
        ...(rows.length>size?[el('div',{class:'atlas-controls'},prev,status,next)]:[]));
    }draw();return host;
  }
  function pointDetail(p) {
    const r=p.registration,c=m.entryPointContext(p.id),handler=m.definitionById.get(r?.handlerId||p.route?.handlerId||p.entry?.handlerId);
    return el('article',{class:'surface panel-pad subsection'},el('h3',{id:'entry-point-title',tabindex:-1,class:'record-text'},p.label),
      el('p',{},tag(p.type==='event'?'Event':'HTTP'),r?button('Explore execution',()=>exploreEntry(r.id)):null),
      kv([['Type',p.type==='event'?'Event':'HTTP'],...(p.type==='event'?[['Event type / trigger',p.eventType||'Not recorded']]:[['Method',p.method||'Not recorded'],['Path',p.path||'Not recorded']]),
        ['Registration order',p.order===null?'Not recorded':String(p.order+1)],['Handler',handler?definitionLink(handler.id):'Handler definition unavailable'],['Authored source',r?m.authoredSource(r.source):p.source]]),
      el('h4',{},'Recorded schemas'),p.route?.schemaIds.length?el('div',{class:'route-chips'},p.route.schemaIds.map(id=>link('schemas',id,m.schemas.get(id)?.schemaId||id))):note('No schema references recorded for this entry point. Usage may be incomplete.'),
      el('h4',{},'Recorded binding references'),p.route?.bindingIds.length?el('div',{class:'route-chips'},p.route.bindingIds.map(id=>bindingLink(m.bindings.get(id)))):el('p',{class:'small-note'},'No direct binding references recorded. Possible associations follow below.'),
      el('h4',{},'Possible preceding handlers'),c.admission?el('div',{},el('p',{class:'small-note'},m.coverageText(c.admission.coverage)),
        pages(c.admission.relations,relation=>registrationLink(relation.owner),'predecessors'),c.admission.relations.length?null:el('p',{},'No predecessors observed within this coverage.')):
        note('Admission evidence unavailable in this historical representation. Retained association paths remain in exact registration details.'),
      el('h4',{},'Possible bindings'),el('p',{class:'small-note'},m.coverageText(c.coverage)),
      c.bindings.length?pages(c.bindings,bindingLink,'bindings'):note('No binding association observed. Partial or unavailable evidence cannot establish no use.'),
      el('h4',{},'Authored operations'),pages(c.sites,s=>el('div',{},useSiteLink(s.id),' · '+s.operation+' · '+(m.bindings.get(s.binding.bindingId)?.name||s.binding.state),el('p',{class:'small-note record-text'},m.sourceLocation(s.source))),'operations'),
      c.sites.length?null:note('Operation evidence: '+m.coverageText(m.analyticsCoverage('useSites'))+'. No observed operations is not proof of non-use.'),
      el('details',{class:'details-block'},el('summary',{},'Control, provenance and exact records'),r?registrationLink(r.id):null,p.entry?entryLink(p.entry.id):null,
        p.route?el('p',{},link('routes',p.route.id,'HTTP size attribution and route evidence')):null,
        el('p',{class:'small-note'},'Registration coverage: '+m.coverageText(m.analyticsCoverage('registrations')))),
      note('Static candidates, not observed execution or effective host authorization.'));
  }
  function renderEntryPoints(host) {
    const state=m.state,p=m.entryPointById.get(state.selectedEntryPoint);
    const search=el('input',{id:'entry-point-search',type:'search',value:state.entryPointSearch,placeholder:'Find an HTTP route, event, handler or source…','aria-label':'Search entry points',on:{input:e=>{state.entryPointSearch=e.target.value.toLowerCase();state.entryPointPage=0;draw();}}});
    const filter=(id,label,value,values,change)=>el('label',{},label,el('select',{id,'aria-label':label,on:{change:e=>{change(e.target.value);state.entryPointPage=0;draw();}}},values.map(([key,text])=>el('option',{value:key,selected:key===value},text))));
    const filters=el('div',{class:'analytics-filters'},filter('entry-point-type','Entry point type',state.entryPointType,[['all','HTTP and events'],['http','HTTP'],['event','Events']],v=>{state.entryPointType=v;state.entryPointMethod='all';state.entryPointEvent='all';renderEntryPoints(host);host.querySelector('#entry-point-type').focus();}),
      state.entryPointType==='http'?filter('entry-point-method','HTTP method',state.entryPointMethod,[['all','All methods'],...[...new Set(m.entryPoints.map(p=>p.method).filter(Boolean))].sort().map(v=>[v,v])],v=>state.entryPointMethod=v):null,
      state.entryPointType==='event'?filter('entry-point-event','Event type',state.entryPointEvent,[['all','All event types'],...[...new Set(m.entryPoints.map(p=>p.eventType).filter(Boolean))].sort().map(v=>[v,v])],v=>state.entryPointEvent=v):null);
    const list=el('div',{id:'entry-point-list'}),status=el('p',{id:'entry-point-count',tabindex:-1,role:'status',class:'small-note'});
    const previous=button('Previous entry points',()=>{state.entryPointPage--;draw();status.focus();}),next=button('Next entry points',()=>{state.entryPointPage++;draw();status.focus();});
    function draw(){const all=m.filteredEntryPoints(),pages=Math.max(1,Math.ceil(all.length/50));state.entryPointPage=Math.min(state.entryPointPage,pages-1);
      status.textContent=all.length+' matching / '+m.entryPoints.length+' observed entry points · page '+(state.entryPointPage+1)+' / '+pages;
      previous.disabled=state.entryPointPage===0;next.disabled=state.entryPointPage+1>=pages;
      list.replaceChildren(pointTable(all.slice(state.entryPointPage*50,(state.entryPointPage+1)*50)),
        ...(all.length?[]:[note('No matching entry points. Check filters and inventory coverage before interpreting absence.')]));
    }
    replace(host,el('div',{class:'inventory-heading'},heading('Entry Points','HTTP routes and events. Select a row for details.',m.entryPoints.length),viewSwitch('entry-points')),
      p?pointDetail(p):null,el('div',{class:'surface table-surface'},el('div',{class:'inventory-toolbar'},el('label',{class:'search-box'},search),filters),el('div',{class:'inventory-pagination'},status,el('div',{class:'atlas-controls'},previous,next)),list),
      el('details',{class:'details-block'},el('summary',{},'Inventory coverage and contextual records'),
        el('p',{},'HTTP routes: '+m.coverageText(m.routeCoverage)),el('p',{},'Entries: '+m.coverageText(m.entryCoverage)),el('p',{},'Registrations: '+m.coverageText(m.analyticsCoverage('registrations'))),
        el('p',{},el('a',{href:'#handlers'},'Search handlers, middleware and helpers'),' · ',el('a',{href:'#entries'},'All retained entry records'))));draw();
  }
  function bindingDetail(b,index) {
    const projection=m.bindingProjection(b.id,null,true),coverage=projection.coverage||m.analyticsCoverage('associations');
    const consumers=[...new Map(projection.consumers.flatMap(g=>g.registrations).filter(r=>m.entryPointById.has(r.id)).map(r=>[r.id,m.entryPointById.get(r.id)])).values()];
    return el('article',{class:'surface panel-pad subsection'},el('h3',{id:'binding-title-'+index,tabindex:-1},b.name),button('Explore consumers',()=>exploreBinding(b.id)),
      kv([['Kind',b.kind],['Declared',String(b.declared)],['Referenced',String(b.referenced)],['Resolution',b.resolution]]),
      el('h4',{},'Possible entry-point consumers'),el('p',{id:'binding-consumer-coverage',class:'small-note'},m.coverageText(coverage)),pages(consumers,pointLink,'consumers',20,true),
      consumers.length?null:note('No entry-point association observed within this coverage. This does not establish no use.'),
      el('h4',{},'Authored use sites'),el('p',{class:'small-note'},m.coverageText(m.analyticsCoverage('useSites'))),pages(m.bindingSites(b.id),s=>el('div',{},useSiteLink(s.id),' · '+s.operation+' · ',definitionLink(s.ownerId),el('p',{class:'small-note record-text'},m.sourceLocation(s.source))),'use sites'),
      el('details',{class:'details-block'},el('summary',{},'Retained references and binding evidence'),
        el('p',{},'Inventory references are separate from possible consumer relationships.'),pages(b.entryIds,entryLink,'entry references'),
        ...b.routeIds.map(id=>el('p',{},link('routes',id,'HTTP route evidence'))),...evidenceCards(b.evidenceIds)));
  }
  function renderBindings(host) {
    const inventory=[...m.bindings.values()],selected=m.bindings.get(m.state.selectedBinding),list=el('div',{id:'binding-inventory-list'});
    function draw(){const shown=inventory.filter(b=>(b.name+' '+b.kind+' '+b.resolution).toLowerCase().includes(m.state.bindingSearch));
      list.replaceChildren(el('div',{class:'table-wrap',tabindex:0,role:'region','aria-label':'Bindings'},el('table',{class:'inventory-table compact-route-table binding-inventory-table'},
        el('thead',{},el('tr',{},['Binding','Kind','Resolution','Authored use sites'].map(t=>el('th',{},t)))),el('tbody',{},shown.map(b=>el('tr',{'data-binding-record':b.id},
          el('td',{},link('bindings',b.id,b.name)),el('td',{},b.kind),el('td',{},b.resolution),el('td',{class:'numeric'},m.bindingSites(b.id).length)))))));
      if(!shown.length)list.append(note('No matching binding records. Inventory coverage: '+m.coverageText(m.bindingCoverage)));}
    const unresolved=m.useSites.filter(s=>!s.binding.bindingId&&s.binding.state!=='not-applicable');
    replace(host,el('div',{class:'inventory-heading'},heading('Bindings','Logical identities, possible consumers and authored operations.',inventory.length),viewSwitch('bindings')),
      note('Static usage is not effective host authorization. Bound does not establish per-entry authority or current deployment health.'),selected?bindingDetail(selected,inventory.indexOf(selected)):null,
      el('label',{class:'search-box inventory-search'},el('input',{id:'binding-inventory-search',type:'search',value:m.state.bindingSearch,'aria-label':'Search bindings',placeholder:'Find a binding by name, kind or resolution…',on:{input:e=>{m.state.bindingSearch=e.target.value.toLowerCase();draw();}}})),list,
      el('details',{class:'details-block'},el('summary',{},'Unresolved binding identities · '+unresolved.length+' observed sites'),note('Dynamic or unknown identities are not named bindings. Use-site coverage: '+m.coverageText(m.analyticsCoverage('useSites'))),pages(unresolved,s=>el('div',{},useSiteLink(s.id),' · '+s.binding.state+' · '+(s.binding.reason||'unresolved')),'unresolved sites')));draw();
  }
  return {renderEntryPoints,renderBindings,pointLink,bindingLink};
}
if(typeof module!=='undefined')module.exports={createReportInventories};
