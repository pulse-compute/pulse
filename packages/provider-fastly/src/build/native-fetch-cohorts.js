'use strict';
const fs=require('node:fs'),path=require('node:path');
const {resourceAdmission:admission}=require('@pulse-compute/wasm-contracts/provider/toolchain');
const {resourceLedgerSource}=require('@pulse-compute/wasm-runtime-core-as/compiler/canonical-native');
const {CANONICAL_EFFECT_INVOCATION_POLICY:policy}=require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
function profile(plan,bindings,C){
  if(!plan.effects.length || plan.effects.some(e=>e.kind!=='fetch') || plan.capabilities.includes('request.body.forward')
    || plan.packages?.application || plan.callables?.length || plan.routing?.entries?.some(e=>e.kind==='error') || bindings.dynamicBackends
    || !Number.isInteger(bindings.maxDurationMs)||bindings.maxDurationMs<1||bindings.maxDurationMs>30000)return null;
  const B=plan.schemas?.registry?.maxBytes;
  if(!Number.isInteger(B)||B<1||B>1073741823||!Number.isInteger(C)||C<9||C>1073741823)return null;
  const fields=o=>o?.kind==='object'&&o.entries.every(e=>e.kind==='property'&&e.key?.kind==='literal'&&typeof e.key.value==='string')&&new Set(o.entries.map(e=>e.key.value)).size===o.entries.length?new Map(o.entries.map(e=>[e.key.value,e.value])):null;
  const proof=require('./native-fetch-bounds.js').create(plan,C,B);
  let encoding=0,caseBytes=0;
  const literal=value=>({kind:'literal',value});
  for(let i=0;i<plan.effects.length;i++){
    const e=plan.effects[i],url=e.inputs.find(x=>x.name==='url')?.value,init=e.inputs.find(x=>x.name==='init')?.value;
    const f=init&&init.kind!=='undefined'?fields(init):new Map(),backend=bindings.backends.find(b=>b.index===i)?.backend;
    if(!f||[...f.keys()].some(k=>!['method','body','json','headers','timeoutMs'].includes(k))||!backend)return null;
    const u=proof.string(url),method=proof.string(f.get('method')||literal('GET'));
    if(!u||!method)return null;
    const headers=f.has('headers')?fields(f.get('headers')):new Map();if(!headers)return null;
    const values=[...headers.values()].map(v=>proof.string(v));if(values.some(v=>!v))return null;
    const timeout=f.get('timeoutMs');if(timeout&&(timeout.kind!=='literal'||!Number.isSafeInteger(timeout.value)||timeout.value<=0))return null;
    let body=proof.string(f.get('body')||literal('')),materialization=f.has('body')&&f.get('body').kind!=='literal'?128:0,extraHeader=0;
    const json=f.has('body')&&!body?f.get('body'):!f.has('body')&&f.has('json')?f.get('json'):null;
    if(json){const j=proof.json(json);if(!j)return null;body={chars:j.chars,bytes:3*j.chars};
      // Quote buffers + quoted strings + final join, geometric parts-array
      // growth, and a conservative pinned numeric formatter allowance.
      materialization=8*j.chars+128*j.nodes+128+1024*j.numbers;
      if(f.has('json')){extraHeader=Buffer.byteLength('content-typeapplication/json; charset=utf-8');materialization+=[...headers.keys()].reduce((n,k)=>n+4*k.length,0);}
    }
    if(!body)return null;
    encoding=Math.max(encoding,u.bytes+Buffer.byteLength(backend)+(f.has('method')?9*method.chars:3)+body.bytes+extraHeader+[...headers.keys()].reduce((n,k)=>n+Buffer.byteLength(k),0)+values.reduce((n,v)=>n+v.bytes,0));
    caseBytes=Math.max(caseBytes,(f.has('method')?6*method.chars:0)+materialization);
  }
  const headerNames=new Set(plan.schemas.registry.contentTypePolicy==='require-json'?['content-type']:[]);
  let repeated=false,unsupported=false;
  function visit(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}
    if(/loop|while|for|map/.test(v.kind||'')||['helper-call','stage-call'].includes(v.kind))repeated=true;
    if(v.kind==='method-call'&&v.receiver?.valueKind==='fetch-response'&&v.method==='header'){
      const name=v.arguments?.[0];if(name?.kind!=='literal'||typeof name.value!=='string')unsupported=true;else headerNames.add(name.value);
    }
    Object.values(v).forEach(visit);
  }
  visit(plan.entry);visit(plan.handlers);visit(plan.helpers);visit(plan.stages);if(unsupported)return null;
  const count=Math.min(policy.defaultMaxEffects,repeated?policy.defaultMaxEffects:plan.effects.length),header=[...headerNames].sort();
  // Each response owns one cached decode per admitted name. Lowercase admission
  // is also cached; repeated aliases never allocate another fetch-service copy.
  const headerBytes=header.reduce((n,k)=>n+3*C+Buffer.byteLength(k)+11+(k==='content-type'?4*(C-1):0),0)+(header.length?48*header.length+32:0);
  const scratch=12*count+(36+4*plan.effects.length)*count+52+count;
  const backing=scratch+count*(encoding+caseBytes+3*B+5+headerBytes)+64;
  const handles=5*count+2,records=handles+5,steps=5*count+2;
  if(!Number.isSafeInteger(backing)||backing>9007199254740991)return null;
  const fixed=(id,bytes)=>({id,kind:'fixed',bytes,copies:1});
  const work={handles:[{namespace:'http.request',count},{namespace:'http.body',count:2*count},{namespace:'http.pending',count},{namespace:'http.response',count}],allocations:[fixed('service-scratch',scratch),fixed('encodings',count*(encoding+caseBytes)),fixed('reader-and-headers',count*(3*B+5+headerBytes))],records:1,cleanupSteps:0};
  const exit={handles:[{namespace:'http.response',count:1},{namespace:'http.body',count:1}],allocations:[fixed('error-text',64)],records:0,cleanupSteps:2};
  const limits={handles,backingBytes:backing,records,cleanupSteps:steps,effects:count};
  const realization='fastly.native.fetch.cohorts-v1';
  const result=admission.createPlan({version:admission.VERSION,realization,selected:[{site:'fetch-invocation',count:1,profile:{version:admission.PROFILE_VERSION,owner:'provider-fastly',operation:'bounded-fetch-invocation',realization,effects:count,work,cleanup:{handles:[],allocations:[],records:0,cleanupSteps:5*count},exclusions:['application-values','json-parser-and-schema-materialization','incoming-request-context','diagnostic-storage','driver-identity-storage','successful-downstream-response','allocator-metadata']}}],exit,occupied:Object.fromEntries(admission.DIMENSIONS.map(k=>[k,0])),limits});
  if(!result.admitted||admission.DIMENSIONS.some(k=>result.required[k]!==limits[k]))throw Error('Fetch cohort profile drift');
  return Object.freeze({...result,selection:'canonical-fetch-cohorts',executionIdentity:'private-single-invocation-wasm-instance',unprofiled:'unproved-inputs-dynamic-backends-mixed-capabilities-error-recovery-application-packages-child-graphs-and-other-targets',count,headerNames:header,headerBytes,scratchBytes:scratch,encodingBytes:count*(encoding+caseBytes),readerBytes:count*(3*B+5+headerBytes),storageBytes:1024+128*records,durationNs:bindings.maxDurationMs*1000000});
}
function source(p){return resourceLedgerSource(true)+`\nconst __FCA_COUNT:i32=${p.count};\nconst __FCA_HANDLES:i32=${p.required.handles};\nconst __FCA_RECORDS:i32=${p.required.records};\nconst __FCA_BACKING:u64=${p.required.backingBytes};\nconst __FCA_STORAGE:u32=${p.storageBytes};\nconst __FCA_DURATION:u64=${p.durationNs};\nconst __FCA_SCRATCH:u64=${p.scratchBytes};\nconst __FCA_ENCODING:u64=${p.encodingBytes};\nconst __FCA_READER:u64=${p.readerBytes};\nfunction __fca_header_id(name:string):i32 { ${p.headerNames.map((s,i)=>`if(name==${JSON.stringify(s)})return ${i};`).join('')} return -1; }\n`+fs.readFileSync(path.join(__dirname,'native-fetch-cohorts.as.ts'),'utf8');}
module.exports={profile,source};
