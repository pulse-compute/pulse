'use strict';
// Geometry uses SVG attributes, never inline style or a second evidence payload.
function createReportAtlas({model:m,el,button,select,registrationLink,definitionLink,associationDetail,useSiteLink,pointLink,bindingLink,onClose}) {
  const local={scope:null,query:'',expanded:new Set(),page:0,zoom:1,graph:true,mode:'routing',full:true,inspector:false,camera:null};
  let host,viewport,svg,layout,nodes=new Map(),expanders=new Map();
  const bindingExplorer=createBindingExplorer({model:m,el,button,associationDetail,useSiteLink,registrationLink,pointLink,bindingLink,
    onRouting:id=>{local.mode='routing';local.graph=true;select(id);render(host);center(id,true);},
    onInspect:()=>{local.inspector=true;applyWorkspace();},onDismiss:dismiss,onPanelOpen:()=>{local.inspector=false;applyWorkspace();}});
  function rememberCamera(){if(viewport)local.camera={left:viewport.scrollLeft,top:viewport.scrollTop};}
  function applyWorkspace(){
    document.body.classList.toggle('atlas-expanded',local.full);
    host?.setAttribute('role','dialog');host?.setAttribute('aria-modal','true');host?.setAttribute('aria-label','Execution Explorer');
    host?.setAttribute('data-expanded','true');host?.setAttribute('data-inspector',String(local.inspector));
    if(local.inspector)for(const panel of host?.querySelectorAll('.atlas-table-disclosure,.binding-reading-note')||[])panel.open=false;
    const inspect=host?.querySelector('#atlas-inspector-toggle');if(inspect){inspect.textContent=local.inspector?'Hide details':'Show details';inspect.setAttribute('aria-expanded',String(local.inspector));}
  }
  function dismiss(){local.inspector=false;applyWorkspace();host.querySelector('#atlas-inspector-toggle')?.focus({preventScroll:true});}
  function bindings(options){
    rememberCamera();local.mode='bindings';
    const selection=m.state.selectedRegistration;
    if(!options&&local.bindingSelection!==selection)options={scope:selection||local.scope};
    if(options){if(options.scope&&!options.binding)options={...options,binding:[...m.bindings.keys()].find(id=>m.bindingProjection(id,options.scope).rows.length)||null};bindingExplorer.configure(options);}
    local.bindingSelection=selection;if(host)render(host);
  }
  function toolbar(){
    const routing=button('Routing',()=>{local.mode='routing';render(host);host.querySelector('#atlas-routing-tab').focus({preventScroll:true});});routing.id='atlas-routing-tab';routing.setAttribute('aria-pressed',String(local.mode==='routing'));
    const binding=button('Bindings',()=>{bindings();host.querySelector('#atlas-bindings-tab').focus({preventScroll:true});});binding.id='atlas-bindings-tab';binding.setAttribute('aria-pressed',String(local.mode==='bindings'));
    const details=button(local.inspector?'Hide details':'Show details',()=>{local.inspector=!local.inspector;applyWorkspace();});details.id='atlas-inspector-toggle';
    const close=button('Close',()=>onClose(local.mode));close.id='atlas-close';close.setAttribute('aria-label','Close Explorer');
    return el('div',{class:'atlas-toolbar'},el('strong',{},'Explorer'),el('div',{class:'atlas-controls'},routing,binding,details,close));
  }
  const selected=()=>m.registrationById.get(m.state.selectedRegistration);
  const label=r=>r?m.registrationLabel(r):'Application';
  const short=(s,n=32)=>s.length>n?s.slice(0,n-1)+'…':s;
  const compactLabel=r=>r?.match?.state==='available'?[r.kind==='route'?'HTTP':r.kind,r.match.value.method,r.match.value.path,r.match.value.eventType].filter(Boolean).join(' ')||label(r):label(r);
  const source=r=>r?.source?.state==='available'?r.source.value.file+':'+r.source.value.start.line:'Source unavailable';
  function element(tag,attrs={},text) {
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));
    if(text!==undefined)node.textContent=text;return node;
  }
  function control(r) { const c=r.control;return c?.state!=='available'?'Control unavailable':[
    c.value.normal&&'may continue',c.value.error&&'may transfer error',c.value.terminal&&'may terminate',c.value.eligibility&&'eligibility gate'].filter(Boolean).join(' · ')||'No recorded outcome'; }
  function zoom(value) { local.zoom=Math.max(.65,Math.min(1.6,value));if(svg){svg.setAttribute('width',Math.ceil(layout.width*local.zoom));svg.setAttribute('height',Math.ceil(layout.height*local.zoom));}const output=host.querySelector('#atlas-zoom');if(output)output.textContent=Math.round(local.zoom*100)+'%'; }
  function center(id=m.state.selectedRegistration,focus=false) {
    if(!id||local.mode!=='routing')return;
    if(!viewport){if(focus)host.querySelector('#atlas-selected-title')?.focus({preventScroll:true});return;}
    let p=layout?.points.find(p=>p.id===id);
    if(!p){local.query=id;local.page=0;render(host);p=layout.points.find(p=>p.id===id);}
    if(!p)return;
    viewport.scrollLeft=Math.max(0,(p.x+126)*local.zoom-viewport.clientWidth/2);viewport.scrollTop=Math.max(0,(p.y+36)*local.zoom-viewport.clientHeight/2);
    if(focus)nodes.get(id)?.focus({preventScroll:true});
  }
  function redraw(id,focus=false) {render(host);if(id)center(id,focus);}
  function scope(id) {local.scope=id;local.query='';local.page=0;local.expanded.clear();redraw(id);host.querySelector('#atlas-scope').focus({preventScroll:true});}
  function toggle(r) {if(local.expanded.has(r.id))local.expanded.delete(r.id);else local.expanded.add(r.id);redraw(r.id,true);expanders.get(r.id)?.focus({preventScroll:true});}
  function choose(r) {local.inspector=true;select(r.id);applyWorkspace();}
  function keyboard(e,r) {
    const visible=layout.points.filter(p=>p.r).map(p=>p.r).sort((a,b)=>a.order-b.order),at=visible.findIndex(n=>n.id===r.id);let target;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(r);return;}
    if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();
    if(e.key==='ArrowDown')target=visible[at+1];if(e.key==='ArrowUp')target=visible[at-1];
    if(e.key==='Home')target=visible[0];if(e.key==='End')target=visible.at(-1);
    if(e.key==='ArrowRight'){if(r.kind==='mount'&&!local.query&&!local.expanded.has(r.id)&&r.id!==local.scope){toggle(r);return;}target=m.registrationChildren(r.id).find(c=>nodes.has(c.id));}
    if(e.key==='ArrowLeft'){if(!local.query&&local.expanded.has(r.id)&&r.id!==local.scope){toggle(r);return;}target=m.registrationById.get(r.mountPath.at(-1));}
    if(target)choose(target);
  }
  function drawGraph() {
    nodes=new Map();expanders=new Map();svg=element('svg',{class:'atlas-svg',viewBox:`0 0 ${layout.width} ${layout.height}`,width:layout.width*local.zoom,height:layout.height*local.zoom,'aria-label':'Mount containment graph'});
    const ancestry=new Set([selected()?.id,...(selected()?.mountPath||[])]);
    for(const [a,b] of layout.edges)svg.append(element('path',{d:`M${a.x+252} ${a.y+36} C${a.x+280} ${a.y+36} ${b.x-28} ${b.y+36} ${b.x} ${b.y+36}`,class:'atlas-edge'+(ancestry.has(b.id)?' atlas-ancestry':''),'aria-hidden':'true'}));
    for(const p of layout.points) {
      const r=p.r,chosen=r&&r.id===m.state.selectedRegistration;
      const group=element('g',{transform:`translate(${p.x} ${p.y})`,class:'atlas-node '+(r?.kind||'root')+(chosen?' selected':''),role:'button',tabindex:0,'aria-label':label(r)+(r?' · '+source(r):''),'aria-pressed':!!chosen});
      if(r){group.setAttribute('data-atlas-registration',r.id);nodes.set(r.id,group);group.addEventListener('keydown',e=>keyboard(e,r));group.addEventListener('click',()=>choose(r));}
      else {group.addEventListener('click',()=>scope(null));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();scope(null);}});}
      group.append(element('title',{},label(r)),element('rect',{width:252,height:72,rx:9}),
        element('text',{x:13,y:22,class:'atlas-node-title'},short(r?.match?.state==='available'?[r.kind==='event'?'Event':r.match.value.method,r.match.value.path,r.match.value.eventType].filter(Boolean).join(' ')||label(r):label(r),r?.kind==='mount'?23:28)),
        element('text',{x:13,y:43,class:'atlas-node-source'},r?short(r.kind==='mount'&&p.children[0]?.source?.state==='available'?'First child: '+p.children[0].source.value.file.split('/').at(-1):(m.definitionById.get(r.handlerId)?.name&&!m.definitionById.get(r.handlerId).name.startsWith('<')?m.definitionById.get(r.handlerId).name:source(r))): 'Root registrations'),
        element('text',{x:13,y:61,class:'atlas-node-hint'},r?.kind==='mount'?p.children.length+' direct children · '+(local.expanded.has(r.id)||local.scope===r.id?'expanded':'collapsed'):r?short(r.kind+' · '+control(r),42):'Curves mean containment'));
      svg.append(group);
      if(r?.kind==='mount'&&p.children.length&&r.id!==local.scope&&!local.query){
        const expanded=local.expanded.has(r.id),action=element('g',{transform:`translate(${p.x+208} ${p.y+8})`,class:'atlas-expand-node',role:'button',tabindex:0,'aria-label':(expanded?'Collapse ':'Expand ')+label(r),'aria-expanded':expanded,'data-expand-registration':r.id});
        action.append(element('rect',{width:36,height:36,rx:7}),element('text',{x:18,y:24,'text-anchor':'middle'},expanded?'−':'+'));
        action.addEventListener('click',()=>toggle(r));action.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(r);}});svg.append(action);expanders.set(r.id,action);
      }
    }
    viewport=el('div',{id:'atlas-viewport',class:'atlas-viewport',tabindex:0,'aria-label':'Scrollable graph. Drag empty space to pan; Control or Command plus wheel to zoom.'},svg);
    let drag;
    viewport.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0||e.target.closest('.atlas-node,.atlas-expand-node'))return;drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);});
    viewport.addEventListener('pointermove',e=>{if(drag){viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;}});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(event,()=>{drag=null;});
    viewport.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const box=viewport.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top,old=local.zoom,left=viewport.scrollLeft,top=viewport.scrollTop;zoom(old+(e.deltaY<0?.1:-.1));viewport.scrollLeft=(left+x)*local.zoom/old-x;viewport.scrollTop=(top+y)*local.zoom/old-y;},{passive:false});
    return viewport;
  }
  function selectionPanel() {
    const r=selected();
    const dismissButton=button('Dismiss details',dismiss);
    if(!r)return el('aside',{class:'atlas-selection surface panel-pad'},dismissButton,el('h3',{},'Select a registration'),el('p',{class:'small-note'},'Select inspects one exact instance. The + button expands a mount.'));
    const h=m.definitionById.get(r.handlerId),branch=r.kind==='mount'?r.id:r.mountPath.at(-1),context=m.entryPointById.has(r.id)?m.entryPointContext(r.id):null;
    const point=pointLink(r.id);point.textContent=m.entryPointById.has(r.id)?'Open Entry Point':'Open registration';const definition=h?definitionLink(h.id):null;if(definition)definition.textContent='View authored source / details';
    return el('aside',{class:'atlas-selection surface panel-pad'},dismissButton,el('div',{class:'eyebrow'},r.kind.toUpperCase()),el('h3',{id:'atlas-selected-title',tabindex:-1,class:'record-text'},compactLabel(r)),
      el('p',{class:'small-note'},'Mount containment · '+control(r)),
      el('p',{class:'small-note'},context?'Admission: '+(context.admission?m.coverageText(context.admission.coverage):'unavailable · historical representation')+' · Binding associations: '+m.coverageText(context.coverage):'Registration coverage: '+m.coverageText(m.analyticsCoverage('registrations'))),
      el('p',{},point),definition?el('p',{},definition):null,
      button('Explore bindings',()=>bindings({scope:r.id})),branch?button('Focus owning subrouter',()=>scope(branch)):null,
      el('details',{class:'details-block'},el('summary',{},'Advanced exact details'),
        el('p',{},registrationLink(r.id)),el('h4',{},'Registration source'),el('p',{class:'record-text'},m.authoredSource(r.source)),
        el('h4',{},'Mount ancestry'),r.mountPath.length?r.mountPath.map(id=>button(label(m.registrationById.get(id)),()=>choose(m.registrationById.get(id)),'text-button record-text')):el('p',{},'Application root'),
        context?el('p',{},'Open Entry Point for all possible preceding handlers and bindings, with exact relationship evidence.'):null));
  }
  function render(container) {
    host=container;
    if(local.mode==='bindings'){
      const content=el('div',{id:'binding-workspace'});host.replaceChildren(toolbar(),content);bindingExplorer.render(content);applyWorkspace();return;
    }
    const r=selected();
    if(r){if(local.scope&&r.id!==local.scope&&!r.mountPath.includes(local.scope))local.scope=null;}
    layout=m.atlasLayout(local);local.page=Math.min(local.page,Math.max(0,Math.ceil(layout.matches.length/50)-1));
    const coverage=m.analyticsCoverage('registrations'),missing=coverage.status==='unavailable';
    const search=el('input',{id:'atlas-search',type:'search',value:local.query,placeholder:'Find a path, handler or source…','aria-label':'Search atlas registrations',on:{input:e=>{local.query=e.target.value;const start=e.target.selectionStart,end=e.target.selectionEnd;local.page=0;render(host);const input=host.querySelector('#atlas-search');input.focus({preventScroll:true});input.setSelectionRange(start,end);}}});
    const crumbs=el('nav',{id:'atlas-scope',tabindex:-1,'aria-label':'Atlas scope',class:'atlas-crumbs'},button('Application',()=>scope(null),'text-button'));
    if(local.scope)for(const id of [...m.registrationById.get(local.scope).mountPath,local.scope]){const b=button(label(m.registrationById.get(id)),()=>scope(id),'text-button');if(id===local.scope)b.setAttribute('aria-current','location');crumbs.append(el('span',{},'/'),b);}
    const controls=el('div',{class:'atlas-controls'});
    const branch=r?.kind==='mount'?r.id:r?.mountPath.at(-1),focus=button('Focus subrouter',()=>scope(branch));focus.id='atlas-focus';focus.disabled=!branch||branch===local.scope;
    const expand=button('Open one level',()=>{const closed=layout.points.filter(p=>p.r&&p.children.length&&!local.expanded.has(p.id)&&p.id!==local.scope),depth=Math.min(...closed.map(p=>p.depth));closed.filter(p=>p.depth===depth).forEach(p=>local.expanded.add(p.id));redraw();});expand.id='atlas-expand';expand.disabled=!!local.query||!layout.points.some(p=>p.r&&p.children.length&&!local.expanded.has(p.id)&&p.id!==local.scope);
    const collapse=button('Collapse mounts',()=>{local.expanded.clear();redraw();});collapse.disabled=!!local.query;

    const rows=layout.matches.slice(local.page*50,(local.page+1)*50).map(row=>el('tr',{'data-atlas-row':row.id,class:row.id===r?.id?'atlas-active':''},
      el('td',{},row.order+1),el('td',{},el('a',{href:'#atlas/'+m.registrationIndex.get(row.id),on:{click:e=>{e.preventDefault();choose(row);}}},label(row))),el('td',{class:'record-text'},m.definitionById.get(row.handlerId)?.name||'No authored definition'),el('td',{},control(row))));
    const table=el('div',{class:'atlas-table-scroll',tabindex:0,'aria-label':'Scoped registration table'},el('table',{class:'atlas-table'},el('caption',{class:'sr-only'},'Exact registration instances in the current atlas scope'),el('thead',{},el('tr',{},['#','Registration / match','Definition','Control'].map(t=>el('th',{},t)))),el('tbody',{id:'atlas-rows'},rows.length?rows:el('tr',{},el('td',{colspan:4},missing?'Registration analytics unavailable · '+coverage.reason:'No matching registrations.')))));
    const prev=button('Previous page',()=>{local.page--;redraw();host.querySelector('#atlas-page').focus({preventScroll:true});}),next=button('Next page',()=>{local.page++;redraw();host.querySelector('#atlas-page').focus({preventScroll:true});});prev.disabled=local.page===0;next.disabled=(local.page+1)*50>=layout.matches.length;
    const page=el('div',{class:'atlas-controls'},prev,el('span',{id:'atlas-page',tabindex:-1},'Page '+(local.page+1)+' of '+Math.max(1,Math.ceil(layout.matches.length/50))),next);
    const main=el('div',{class:'atlas-main'},el('div',{class:'atlas-search-row'},search,crumbs),
      el('p',{id:'atlas-count',class:'small-note','aria-live':'polite'},missing?'Registration analytics unavailable · '+coverage.reason:layout.matches.length+' matching / '+layout.scoped.length+' in scope / '+m.registrations.length+' retained registrations'));
    viewport=null;svg=null;
    if(local.graph&&!missing){const fit=button('Fit scope',()=>{zoom(Math.min(1,(viewport.clientWidth-24)/layout.width,(viewport.clientHeight-24)/layout.height));viewport.scrollLeft=0;viewport.scrollTop=0;}),centerButton=button('Center selection',()=>{if(r){local.query='';r.mountPath.forEach(id=>local.expanded.add(id));redraw(r.id);}});centerButton.disabled=!r;
      const zoomOut=button('−',()=>zoom(local.zoom-.1)),zoomIn=button('+',()=>zoom(local.zoom+.1));zoomOut.setAttribute('aria-label','Zoom out');zoomIn.setAttribute('aria-label','Zoom in');
      controls.append(fit,centerButton,zoomOut,el('span',{id:'atlas-zoom'},Math.round(local.zoom*100)+'%'),zoomIn,focus,expand,collapse);main.append(controls,drawGraph(),
        el('p',{class:'atlas-status small-note'},'Containment · Select to inspect · + expands a mount · '+layout.points.filter(p=>p.r).length+' registration nodes shown'+(layout.truncated?' · graph display limited to 300 nodes; narrow the scope or search. All matches remain in table pages.':'.')));
    }
    main.append(el('details',{class:'atlas-table-disclosure',open:!!local.tableOpen,on:{toggle:e=>{local.tableOpen=e.target.open;if(e.target.open){local.inspector=false;applyWorkspace();}}}},el('summary',{},'Table / help'),
      el('p',{class:'small-note'},'All scoped registrations are paged here, including nodes outside the graph display cap. Curves mean mount containment, not execution or admission. Arrow keys navigate nodes; drag empty space to pan. Fit keeps text at 65% or larger; scroll to explore.'),table,page));
    host.replaceChildren(toolbar(),el('div',{class:'atlas-workspace'},main,selectionPanel()));
    applyWorkspace();if(viewport&&local.camera){viewport.scrollLeft=local.camera.left;viewport.scrollTop=local.camera.top;local.camera=null;}
  }
  // The graph opens only after an explicit Explorer navigation.
  function open(container) {
    local.graph=true;
    if(selected()&&local.query&&!m.atlasLayout({query:local.query}).matches.some(r=>r.id===selected().id))local.query='';
    if(selected()&&local.revealedSelection!==selected().id){selected().mountPath.forEach(id=>local.expanded.add(id));local.revealedSelection=selected().id;}
    render(container);
    if(local.mode!=='routing')return;
    const at=layout.matches.findIndex(r=>r.id===m.state.selectedRegistration);
    if(at>=0&&local.page!==Math.floor(at/50)){local.page=Math.floor(at/50);render(container);}
    center();
    const row=host.querySelector('.atlas-active'),table=host.querySelector('.atlas-table-scroll');
    if(row&&table)table.scrollTop+=row.getBoundingClientRect().top-table.getBoundingClientRect().top-40;
  }
  return {open,center,bindings,focusEntry(id){local.inspector=false;local.explicit=true;local.mode='routing';local.graph=true;local.scope=m.registrationById.get(id)?.mountPath.at(-1)||null;local.query='';local.page=0;local.camera=null;local.expanded.clear();local.revealedSelection=null;},resume(){applyWorkspace();},routing(){local.mode='routing';},leave(){document.body.classList.remove('atlas-expanded');},escape(){for(const panel of host?.querySelectorAll('.atlas-table-disclosure,.binding-reading-note')||[]){if(panel.open){panel.open=false;local.tableOpen=false;panel.querySelector('summary')?.focus();return true;}}if(local.inspector){dismiss();return true;}onClose(local.mode);return true;}};
}
if(typeof module!=='undefined')module.exports={createReportAtlas};
