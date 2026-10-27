'use strict';
// Provider-local proof over canonical values. Unknown is not a zero allowance.
// Input materialization remains with the existing value/schema owners; this
// proves the strings and serializer copies consumed by the fetch service.
function create(plan,C,B){
  const locals=new Map(),effects=new Map();let mutable=false;
  const walk=(v,fn)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(x=>walk(x,fn));return;}fn(v);Object.values(v).forEach(x=>walk(x,fn));};
  walk(plan.entry,scan);walk(plan.handlers,scan);walk(plan.helpers,scan);walk(plan.stages,scan);
  function scan(v){if(v.kind==='local'&&v.declaration==='const'&&v.value)locals.set(v.localId,v.value);if(/assign|update/.test(v.kind||'')||v.kind==='method-call'&&['push','pop','shift','unshift','splice'].includes(v.method))mutable=true;}
  for(const e of plan.effects)if(e.kind==='fetch'&&e.result?.localId&&e.result.valueKind!=='fetch-response'&&e.decoder==='text')effects.set(e.result.localId,{chars:B,bytes:3*B});
  function string(v,seen=new Set()){
    if(!v)return null;
    if(v.kind==='literal'&&typeof v.value==='string')return{chars:v.value.length,bytes:Buffer.byteLength(v.value)};
    if(v.kind==='local'){
      if(mutable)return null;
      if(effects.has(v.id))return effects.get(v.id);
      if(seen.has(v.id))return null;seen=new Set(seen);seen.add(v.id);return string(locals.get(v.id),seen);
    }
    if(v.kind==='context-read'&&v.path?.[0]==='req'&&['method','url','path'].includes(v.path[1]))return{chars:C,bytes:3*C};
    if(v.kind==='intrinsic'&&v.name==='request.header')return{chars:C,bytes:3*C};
    if(v.kind==='intrinsic'&&v.name==='request.text')return{chars:B,bytes:3*B};
    if(v.kind==='method-call'&&v.receiver?.valueKind==='fetch-response'&&v.method==='text')return{chars:B,bytes:3*B};
    if(v.kind==='binary'&&['+','||','??'].includes(v.operator)){
      const a=string(v.left,seen),b=string(v.right,seen);if(!a||!b)return null;
      return v.operator==='+'?{chars:a.chars+b.chars,bytes:a.bytes+b.bytes}:{chars:Math.max(a.chars,b.chars),bytes:Math.max(a.bytes,b.bytes)};
    }
    return null;
  }
  function json(v,seen=new Set()){
    if(!v)return null;
    if(v.kind==='local'){
      if(mutable||seen.has(v.id))return null;seen=new Set(seen);seen.add(v.id);return json(locals.get(v.id),seen);
    }
    const s=string(v,seen);if(s)return{chars:6*s.chars+2,nodes:1,numbers:0};
    if(v.kind==='literal'&&(v.value===null||typeof v.value==='boolean'))return{chars:5,nodes:1,numbers:0};
    if(v.kind==='literal'&&typeof v.value==='number')return{chars:32,nodes:1,numbers:1};
    let children;
    if(v.kind==='array')children=v.items;
    else if(v.kind==='object'&&v.entries.every(e=>e.kind==='property'&&e.key?.kind==='literal'&&typeof e.key.value==='string'))children=v.entries.flatMap(e=>[e.key,e.value]);
    else return null;
    if(!Array.isArray(children))return null;
    const parts=children.map(x=>json(x,seen));if(parts.some(x=>!x))return null;
    return parts.reduce((a,b)=>({chars:a.chars+b.chars+1,nodes:a.nodes+b.nodes,numbers:a.numbers+b.numbers}),{chars:2,nodes:1,numbers:0});
  }
  return{string,json};
}
module.exports={create};
