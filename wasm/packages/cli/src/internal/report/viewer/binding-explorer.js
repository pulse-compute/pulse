'use strict';
function createBindingExplorer({model:m,el,button,associationDetail,useSiteLink,registrationLink,onRouting,onInspect}) {
  const local={binding:null,scope:null,query:'',pin:null,page:0,evidencePage:0,zoom:1};
  let host,graph,viewport,projection;
  const svgEl=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
  const short=(s,n=31)=>s.length>n?s.slice(0,n-1)+'…':s;
  const consumerName=g=>(m.definitionById.get(g.handlerId)?.name?m.definitionLabel(m.definitionById.get(g.handlerId)):null)||m.registrationLabel(g.registrations[0]);
  function setZoom(value){local.zoom=Math.max(.65,Math.min(1.6,value));if(graph){graph.setAttribute('width',Math.ceil(990*local.zoom));graph.setAttribute('height',Math.ceil(Number(graph.getAttribute('data-height'))*local.zoom));}const out=host.querySelector('#binding-zoom');if(out)out.textContent=Math.round(local.zoom*100)+'%';}
  function choose(pin){local.pin=pin;local.evidencePage=0;render(host);onInspect();host.querySelector('#binding-inspector-title')?.focus({preventScroll:true});}
  function draw(){
    const consumers=projection.consumers.slice(local.page*12,(local.page+1)*12),ops=projection.operations.slice(local.page*12,(local.page+1)*12);
    const height=Math.max(330,Math.max(consumers.length,ops.length)*96+100),middle=height/2;
    graph=svgEl('svg',{class:'atlas-svg binding-svg',viewBox:`0 0 990 ${height}`,width:990*local.zoom,height:height*local.zoom,'data-height':height,'aria-label':'Static consumers, logical binding and recorded operations'});
    for(const [x,t] of [[24,'CONTEXTUAL CONSUMERS'],[378,'LOGICAL BINDING'],[710,'AUTHORED OPERATIONS']])graph.append(svgEl('text',{x,y:28,class:'binding-column-title'},t));
    const edges=[];
    const edge=(d,kind,key)=>{const n=svgEl('path',{d,class:'atlas-edge binding-edge','aria-hidden':'true'});graph.append(n);edges.push({n,kind,key});};
    consumers.forEach((g,i)=>edge(`M284 ${98+i*96} C330 ${98+i*96} 330 ${middle} 365 ${middle}`,'consumer',g.key));
    ops.forEach((g,i)=>edge(`M625 ${middle} C668 ${middle} 668 ${98+i*96} 700 ${98+i*96}`,'operation',g.name));
    function highlight(pin){
      const c=projection.consumers.find(g=>pin?.kind==='consumer'&&g.key===pin.key),o=projection.operations.find(g=>pin?.kind==='operation'&&g.name===pin.key);
      for(const e of edges){const related=!pin||pin.kind==='binding'||(e.kind===pin.kind&&e.key===pin.key)||
        (c&&e.kind==='operation'&&c.rows.some(a=>m.useSiteById.get(a.useSiteId).operation===e.key))||
        (o&&e.kind==='consumer'&&projection.consumers.find(g=>g.key===e.key).rows.some(a=>m.useSiteById.get(a.useSiteId).operation===o.name));
        e.n.setAttribute('class','atlas-edge binding-edge'+(related?' atlas-ancestry':' binding-dim'));
      }
    }
    function node(x,y,title,subtitle,hint,pin){
      const chosen=local.pin?.kind===pin.kind&&local.pin?.key===pin.key;
      const n=svgEl('g',{transform:`translate(${x} ${y})`,class:'atlas-node binding-node'+(chosen?' selected':''),role:'button',tabindex:0,'aria-pressed':chosen,'aria-label':title+' · '+subtitle,'data-binding-node':pin.kind});
      n.append(svgEl('title',{},title+' · '+subtitle),svgEl('rect',{width:260,height:76,rx:12}),svgEl('text',{x:14,y:24,class:'atlas-node-title'},short(title)),svgEl('text',{x:14,y:45,class:'atlas-node-source'},short(subtitle,35)),svgEl('text',{x:14,y:64,class:'atlas-node-hint'},short(hint,42)));
      n.addEventListener('click',()=>choose(pin));n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(pin);}});
      for(const event of ['pointerenter','focus'])n.addEventListener(event,()=>highlight(pin));for(const event of ['pointerleave','blur'])n.addEventListener(event,()=>highlight(local.pin));graph.append(n);
    }
    consumers.forEach((g,i)=>node(24,60+i*96,consumerName(g),g.mount?m.registrationLabel(m.registrationById.get(g.mount)):'Application root',g.registrations.length+' instances · '+g.rows.length+' association rows',{kind:'consumer',key:g.key}));
    node(365,middle-38,projection.binding.name,projection.binding.kind+' · '+projection.binding.resolution,projection.sites.length+' use sites · '+projection.consumerCount+' consumers',{kind:'binding',key:projection.binding.id});
    ops.forEach((g,i)=>node(700,60+i*96,g.name,g.sites.length+' distinct authored use sites',g.rows.length+' association rows',{kind:'operation',key:g.name}));
    highlight(local.pin);
    viewport=el('div',{id:'binding-viewport',class:'atlas-viewport',tabindex:0,'aria-label':'Scrollable binding graph. Drag empty space to pan.'},graph);
    let drag;viewport.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0||e.target.closest('.atlas-node'))return;drag={x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(e.pointerId);});
    viewport.addEventListener('pointermove',e=>{if(drag){viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;}});for(const e of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(e,()=>drag=null);
    return viewport;
  }
  function inspector(){
    const pin=local.pin,c=projection?.consumers.find(g=>pin?.kind==='consumer'&&g.key===pin.key),o=projection?.operations.find(g=>pin?.kind==='operation'&&g.name===pin.key);
    const rows=c?.rows||o?.rows||projection?.rows||[],sites=c?projection.sites.filter(s=>c.rows.some(a=>a.useSiteId===s.id)):o?.sites||projection?.sites||[];
    const title=c?consumerName(c):o?.name||projection?.binding.name||'Binding evidence';
    const pageCount=Math.max(1,Math.ceil(rows.length/20));local.evidencePage=Math.min(local.evidencePage,pageCount-1);
    const prev=button('Previous evidence',()=>{local.evidencePage--;render(host);host.querySelector('#binding-evidence-page').focus();}),next=button('Next evidence',()=>{local.evidencePage++;render(host);host.querySelector('#binding-evidence-page').focus();});prev.disabled=local.evidencePage===0;next.disabled=local.evidencePage+1>=pageCount;
    return el('aside',{class:'atlas-selection surface panel-pad',id:'binding-inspector'},el('div',{class:'eyebrow'},'CONNECTION EVIDENCE'),el('h3',{id:'binding-inspector-title',tabindex:-1,class:'record-text'},title),
      el('p',{class:'small-note'},'Static associations, not execution or effective permissions. Counts are projected rows and distinct use sites, not request counts.'),
      c?el('div',{},el('h4',{},'Exact registration instances'),...c.registrations.map(r=>el('p',{},button('Reveal '+m.registrationLabel(r),()=>onRouting(r.id),'text-button record-text'),registrationLink(r.id)))):null,
      el('p',{class:'small-note'},rows.length+' association rows · '+sites.length+' distinct use sites'),
      el('details',{class:'details-block'},el('summary',{},'Authored operations and sources'),...sites.slice(0,20).map(s=>el('p',{class:'record-text'},useSiteLink(s.id),' · '+s.operation+' · '+m.authoredSource(s.source))),sites.length>20?el('p',{class:'small-note'},'First 20 sites shown here. All associated sites are linked from the paged evidence below; the binding inventory lists all authored sites.'):null),
      projection?el('a',{href:'#bindings/'+[...m.bindings.keys()].indexOf(projection.binding.id)},'Open full binding inventory'):null,
      ...rows.slice(local.evidencePage*20,(local.evidencePage+1)*20).map(associationDetail),
      rows.length?el('div',{class:'atlas-controls'},prev,el('span',{id:'binding-evidence-page',tabindex:-1},'Evidence '+(local.evidencePage+1)+' / '+pageCount),next):el('p',{},'No recorded association in this scope. This does not establish absence of dependencies.'));
  }
  function render(container){
    const camera=viewport?{left:viewport.scrollLeft,top:viewport.scrollTop}:null;
    host=container;const inventory=[...m.bindings.values()];
    if(!m.bindings.has(local.binding))local.binding=inventory[0]?.id||null;
    projection=local.binding?m.bindingProjection(local.binding,local.scope):null;
    const search=el('input',{id:'binding-search',type:'search',value:local.query,placeholder:'Find a binding…','aria-label':'Find a binding',on:{input:e=>{local.query=e.target.value;const caret=e.target.selectionStart;render(host);const input=host.querySelector('#binding-search');input.focus();input.setSelectionRange(caret,caret);}}});
    const picker=el('div',{class:'binding-picker','aria-label':'Logical bindings'},inventory.filter(b=>(b.name+' '+b.kind).toLowerCase().includes(local.query.toLowerCase())).map(b=>{const btt=button(b.name+' · '+b.kind,()=>{local.binding=b.id;local.pin=null;local.page=0;local.evidencePage=0;render(host);host.querySelector('#binding-summary').focus();});btt.setAttribute('aria-pressed',String(local.binding===b.id));btt.setAttribute('data-binding-id',b.id);return btt;}));
    const select=el('select',{id:'binding-select','aria-label':'Logical binding',on:{change:e=>{local.binding=e.target.value;local.pin=null;local.page=0;local.evidencePage=0;render(host);host.querySelector('#binding-select').focus();}}},inventory.map(b=>el('option',{value:b.id,selected:local.binding===b.id},b.name+' · '+b.kind)));
    const coverage=projection?.coverage||m.analyticsCoverage('associations'),scope=m.registrationById.get(local.scope);
    const coverageNote=el('p',{id:'binding-coverage',class:'binding-coverage'},el('strong',{},coverage.status==='complete'?'Static association data':coverage.status==='partial'?'Partial association data':'Association data unavailable'),' · '+m.coverageText(coverage));
    const main=el('div',{class:'atlas-main surface panel-pad'},el('div',{class:'binding-desktop-picker'},el('label',{class:'search-box'},search),picker),el('label',{class:'binding-mobile-picker'},'Binding',select),
      el('div',{class:'atlas-crumbs'},el('span',{},scope?'Scope: '+m.registrationLabel(scope):'Scope: Application'),scope?button('All consumers',()=>{local.scope=null;local.pin=null;local.page=0;local.evidencePage=0;render(host);}):null),
      el('p',{id:'binding-summary',tabindex:-1,class:'small-note'},projection?projection.consumerCount+' distinct consumers · '+projection.sites.length+' distinct authored use sites · '+projection.rows.length+' association rows':'No logical bindings recorded.'),
      el('details',{class:'binding-reading-note'},el('summary',{},'Coverage and unresolved sites'),el('p',{class:'small-note'},'Use-site coverage: '+m.coverageText(m.analyticsCoverage('useSites'))+' · '+m.useSites.filter(s=>!s.binding.bindingId&&s.binding.state!=='not-applicable').length+' sites have unresolved binding identity; they cannot be drawn as named resources.')));
    if(projection){
      if(!projection.rows.length)main.append(el('p',{class:'small-note'},'No recorded association in this scope. Missing evidence does not mean no dependencies.'));
      const pages=Math.max(1,Math.ceil(Math.max(projection.consumers.length,projection.operations.length)/12));local.page=Math.min(local.page,pages-1);
      const prev=button('Previous graph page',()=>{local.page--;render(host);host.querySelector('#binding-graph-page').focus();}),next=button('Next graph page',()=>{local.page++;render(host);host.querySelector('#binding-graph-page').focus();});prev.disabled=local.page===0;next.disabled=local.page+1>=pages;
      const fit=button('Fit binding graph',()=>{setZoom(Math.min(1,(viewport.clientWidth-24)/990,(viewport.clientHeight-24)/Number(graph.getAttribute('data-height'))));viewport.scrollLeft=0;viewport.scrollTop=0;});
      main.append(el('div',{class:'atlas-controls'},fit,button('Zoom out',()=>setZoom(local.zoom-.1)),el('span',{id:'binding-zoom'},Math.round(local.zoom*100)+'%'),button('Zoom in',()=>setZoom(local.zoom+.1)),button('Clear selection',()=>choose(null))),draw(),
        el('details',{class:'binding-reading-note'},el('summary',{},'Reading these connections'),el('p',{class:'small-note'},'Curves connect retained consumers to a binding, and the binding to authored operations. They are not a request sequence. Hover highlights related connections; select a node to inspect.')),
        pages>1?el('div',{class:'atlas-controls'},prev,el('span',{id:'binding-graph-page',tabindex:-1},'Graph page '+(local.page+1)+' / '+pages+' · up to 12 consumer groups and 12 operations per page'),next):el('span',{class:'sr-only'},'All consumer groups and operations shown.'));
    }
    host.replaceChildren(coverageNote,el('div',{class:'atlas-workspace'},main,inspector()));if(camera&&viewport){viewport.scrollLeft=camera.left;viewport.scrollTop=camera.top;}
  }
  return {render,configure({binding=null,scope=null}={}){viewport=null;local.binding=binding;local.scope=scope;local.pin=null;local.page=0;local.evidencePage=0;}};
}
if(typeof module!=='undefined')module.exports={createBindingExplorer};
