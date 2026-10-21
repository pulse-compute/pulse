'use strict';
// Finite corpus projection only. Execution uses ordinary computation/resource owners.
const PROJECT = 'examples/12-pulse-context-mcp';
const APP = `${PROJECT}/application`;
const INPUTS = [`${APP}/src/read.template.ts`, `${APP}/src/scalars.ts`, 'scripts/pulse-context-tools.json', `${APP}/src/search.template.ts`];
const J = JSON.stringify;
const size = value => Buffer.byteLength(J(value));
function projectedSize(value, version) {
  return size({resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':{name:'pulse-context',version}},isError:false,content:[{type:'text',text:J(value)}],structuredContent:value});
}
function clip(text, rawLimit, escapedLimit) {
  let raw = 0, escaped = 0, units = 0;
  for (const point of text) {
    const r = Buffer.byteLength(point), e = size(point) - 2;
    if (raw + r > rawLimit || escaped + e > escapedLimit) break;
    raw += r; escaped += e; units += point.length;
  }
  return {raw, escaped, units, truncated: units < text.length};
}
function generate(corpus, config, files, read) {
  const declarations = JSON.parse(read(INPUTS[2]));
  if (Object.keys(declarations).join() !== 'read,example,diagnostic,search') throw Error('Unexpected context tool metadata');
  const records = corpus.records, limits = config.limits;
  const projected = value => projectedSize(value, corpus.pulseVersion);
  const meta = {pulseVersion:corpus.pulseVersion,corpusSchemaVersion:corpus.schemaVersion,
    corpusHash:corpus.corpusHash,snapshotStatus:corpus.status,
    applicationVersion:config.applicationVersion,maxReplyBytes:limits.toolReplyBytes};
  const summary = r => {const {content,pulseVersion,status,...s}=r;return s;};
  const required = id => {const r=records.find(r=>r.id===id);if(!r)throw Error(`Missing context record ${id}`);return r;};
  const expression = (value, substitutions) => {
    let source=J(value);
    for(const [token,code] of Object.entries(substitutions)) {
      if(J(corpus).includes(token))throw Error('Context expression token collision');
      source=source.split(J(token)).join(code);
    }
    return source;
  };
  const emptyFields = {Search:{results:[],totalMatches:0,truncated:false},Read:{truncated:false},Example:{availableIds:[],records:[],totalRecords:0,truncated:false},Diagnostic:{}};
  const base = (type, requested=true) => expression({meta:{...meta,...(type==='Search'?{encoder:config.encoder.id}:{}),...(requested?{requestedVersion:'__REQUEST_VERSION__'}:{})},status:'ok',...emptyFields[type]}, {'__REQUEST_VERSION__':'input.version'});
  function prelude(type, field) {
    return `  let versionBytes = 0\n  for (let i = 0; i < 65 && i < input.version.length; i++) {\n    const c = input.version[i] ?? ''\n    versionBytes += c < '\\u0080' ? 1 : c < '\\u0800' ? 2 : c >= '\\udc00' && c <= '\\udfff' ? 1 : 3\n  }\n  const empty: ${type}Output = versionBytes <= 64 ? ${base(type)} : ${base(type,false)}\n`
      + `  if (input.version.length === 0 || versionBytes > 64) return {...empty,status:'invalid-input',error:{code:'invalid-version',message:'Supply an exact version of at most 64 UTF-8 bytes.'}}\n`
      + `  if (input.version !== ${J(corpus.pulseVersion)}) return {...empty,status:'version-mismatch',error:{code:'version-mismatch',message:'The requested version is not bundled. See meta.pulseVersion; no fallback was selected.'}}\n`
      + (field ? `  let nameBytes = 0\n  for (let n = 0; n < 193 && n < input.${field}.length; n++) {\n    const c = input.${field}[n] ?? ''\n    nameBytes += c < '\\u0080' ? 1 : c < '\\u0800' ? 2 : c >= '\\udc00' && c <= '\\udfff' ? 1 : 3\n  }\n` : '');
  }
  const fail=(base,status,code,message)=>`{...${base},status:${J(status)},error:{code:${J(code)},message:${J(message)}}}`;
  const tooLarge=base=>fail(base,'response-too-large','response-too-large','Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.');
  const pairs=new Set(records.filter(r=>r.category==='target').flatMap(r=>r.applicability.map(p=>p.provider+'/'+p.target)));
  function selection(rs) {
    const valid=[...pairs].filter(pair=>rs.every(r=>r.applicability.some(p=>p.provider+'/'+p.target===pair)));
    return `(input.provider === undefined && input.target === undefined)${valid.map(pair=>{const[p,t]=pair.split('/');return ` || (input.provider === ${J(p)} && input.target === ${J(t)})`;}).join('')}`;
  }
  function content(r) {
    const row=records.indexOf(r),begin=files['text.bin'].readUInt32LE(64+row*12);
    const clipped=clip(r.content,limits.readRawBytes,limits.readEscapedBytes);
    return {value:{...summary(r),content:r.content.slice(0,clipped.units),offset:0,totalBytes:Buffer.byteLength(r.content),truncated:clipped.truncated,...(clipped.truncated?{nextOffset:clipped.units}:{})},begin,clipped};
  }
  function contentExpression(r) {
    const c=content(r);
    return expression({...c.value,content:'__RECORD_TEXT__'},{'__RECORD_TEXT__':`text.readUtf8(${c.begin}, ${c.clipped.raw})`});
  }
  let readBody=prelude('Read','id');
  readBody+=`  if (nameBytes === 0 || nameBytes > 192) return ${fail('empty','invalid-input','invalid-id','Supply one nonempty bounded corpus ID.')}\n  let row = -1\n  let pageBase = 0\n  let terminalBase = 0\n`;
  records.forEach((r,n)=>{
    const record={...summary(r),content:'',offset:0,totalBytes:Buffer.byteLength(r.content),truncated:false};
    const terminal={meta:{...meta,requestedVersion:corpus.pulseVersion},status:'ok',record,truncated:false};
    const page={...terminal,record:{...record,truncated:true,nextOffset:0},truncated:true,nextOffset:0};
    readBody+=`  if (input.id === ${J(r.id)}) { row = ${n}; pageBase = ${projected(page)}; terminalBase = ${projected(terminal)} }\n`;
  });
  readBody+=`  if (row < 0) return ${fail('empty','unknown-id','unknown-id','No bundled record has that exact ID.')}\n  let applicable = false\n`;
  // Group rows with the same applicability rather than copying response machinery.
  const groups=new Map();records.forEach((r,n)=>{const key=selection([r]);(groups.get(key)||groups.set(key,[]).get(key)).push(n);});
  for(const [select,rows] of groups)readBody+=`  if (${rows.map(n=>`row === ${n}`).join(' || ')}) applicable = ${select}\n`;
  readBody+=`  if (!applicable) return ${fail('empty','unsupported-selection','record-not-applicable','The record does not apply to the requested provider/target pair.')}\n`;
  function summaryPicker(name) {
    let source=`  let ${name}: RecordSummary = ${J(summary(records[0]))}\n`;
    records.slice(1).forEach((r,n)=>{source+=`  if (row === ${n+1}) ${name} = ${J(summary(r))}\n`;});
    return source;
  }
  const pick=summaryPicker('selected');
  const substitute=(source,token,value)=>{if(source.split(token).length!==2)throw Error(`Expected one ${token} in read template`);return source.replace(token,()=>value);};
  const readSource=substitute(substitute(read(INPUTS[0]).toString(),'__READ_PRELUDE__',readBody),'__READ_SUMMARY__',pick);
  let exampleBody=prelude('Example','id');
  exampleBody+=`  if (nameBytes === 0 || nameBytes > 192) return ${fail('empty','invalid-input','invalid-id','Supply one known bounded example ID.')}\n  const text = ctx.resources.map('context.text')\n`;
  const goals=JSON.parse(read('scripts/pulse-context-start.json')).goals;
  for(const goal of goals) {
    const available=records.filter(r=>r.category==='example'&&r.id.startsWith(`example/${goal.example}/`));
    if(available.length>512)throw Error('Example record ceiling');
    const ids=available.map(r=>r.id);
    exampleBody+=`  if (input.id === ${J(goal.example)}) {\n    const listing: ExampleOutput = {...empty,availableIds:${J(ids)}}\n`;
    exampleBody+=`    if (!(${selection(available)})) return ${fail('listing','unsupported-selection','example-not-applicable','The bundled example files have an exact Node Native profile; pulse.start describes explicit adaptations.')}\n`;
    const fileError=fail('listing','unknown-id','unknown-file-id','Select one to five distinct exact IDs from availableIds; arbitrary paths and URLs are not accepted.');
    exampleBody+=`    let invalidFiles = false\n    if (input.files !== undefined) {\n      if (input.files.length < 1 || input.files.length > 5) return ${fileError}\n      for (let i = 0; i < 5 && i < input.files.length; i++) {\n        const id = input.files[i] ?? ''\n        if (id.length > 192 || (${ids.map(id=>`id !== ${J(id)}`).join(' && ')})) invalidFiles = true\n        for (let j = 0; j < 5 && j < i; j++) {\n          if (input.files[j] === id) invalidFiles = true\n        }\n      }\n    }\n    if (invalidFiles) return ${fileError}\n`;
    available.forEach((r,n)=>{exampleBody+=`    let include${n} = input.files === undefined\n    if (input.files !== undefined) {\n      for (let k = 0; k < 5 && k < input.files.length; k++) {\n        if (input.files[k] === ${J(r.id)}) include${n} = true\n      }\n    }\n`;});
    exampleBody+=`    const total = ${available.map((_,n)=>`(include${n} ? 1 : 0)`).join(' + ')}\n    const offset = (input.offset ?? 0) as number\n    if (offset < 0 || offset % 1 !== 0 || offset > total) return ${fail('listing','invalid-input','invalid-offset','Offset exceeds the selected example record count.')}\n    let page: RecordContent[] = []\n    let count = 0\n    let position = 0\n    let stopped = false\n`;
    // Exact conservative page envelope used by the v1 algorithm: truncated true,
    // nextOffset=total; account for the admitted selected-count digit width.
    const envelope=projected({meta:{...meta,requestedVersion:corpus.pulseVersion},status:'ok',...emptyFields.Example,availableIds:ids,totalRecords:1,truncated:true,nextOffset:1});
    exampleBody+=`    let replyBytes = ${envelope} + (total < 10 ? 0 : total < 100 ? 4 : 8)\n`;
    for(const[r,n]of available.map((r,n)=>[r,n])){
      const c=content(r),cost=size(c.value)+size(J(c.value))-2;
      exampleBody+=`    if (include${n}) {\n      if (position >= offset && count < 5 && !stopped) {\n        if (${c.clipped.truncated} || replyBytes + ${cost} + (count > 0 ? 2 : 0) > ${limits.toolReplyBytes}) stopped = true\n        else {\n          page = [...page,${contentExpression(r)}]\n          replyBytes += ${cost} + (count > 0 ? 2 : 0)\n          count++\n        }\n      }\n      position++\n    }\n`;
    }
    exampleBody+=`    if (count === 0 && offset < total) return ${fail('listing','response-too-large','record-requires-read','Retrieve the selected file as bounded pulse.read chunks using its corpus ID.')}\n    const next = offset + count\n    if (next < total) return {...listing,records:page,totalRecords:total,truncated:true,nextOffset:next}\n    return {...listing,records:page,totalRecords:total,truncated:false}\n  }\n`;
  }
  exampleBody+=`  return ${fail('empty','unknown-example','unknown-example','Choose a maintained example ID supplied by pulse.start.')}\n`;
  let diagnosticBody=prelude('Diagnostic','code');
  diagnosticBody+=`  if (nameBytes === 0 || nameBytes > 192) return ${fail('empty','invalid-input','invalid-code','Supply one exact bounded public diagnostic code.')}\n  const text = ctx.resources.map('context.text')\n`;
  for(const r of records.filter(r=>r.category==='diagnostic')) {
    const d=JSON.parse(r.content),related=d.category==='schema'?['contract/schema-declarations','schema/boundaries','schema/strict']:/effect|async|continuation/.test(d.category)?['contract/effects','contract/managed-async']:/provider|native|target/.test(d.category)?['contract/targets','contract/eligibility']:['contract/application','contract/project-configuration'];
    const explanation={code:d.code,summary:typeof d.summary==='string'?d.summary:'The canonical catalog has no textual summary for this code.',summaryAvailable:typeof d.summary==='string',remediation:d.remediation,diagnostic:content(r).value,contracts:related.map(id=>summary(required(id))),nextLocalChecks:[{command:'pulse doctor --json',purpose:'Inspect the local project diagnostics. This server has not run the command.',sourceId:'command/doctor'}]};
    const bytes=projected({meta:{...meta,requestedVersion:corpus.pulseVersion},status:'ok',explanation});
    const output=bytes>limits.toolReplyBytes?tooLarge('empty'):`{...empty,explanation:${expression({...explanation,diagnostic:'__DIAGNOSTIC_RECORD__'},{'__DIAGNOSTIC_RECORD__':contentExpression(r)})}}`;
    diagnosticBody+=`  if (input.code === ${J(d.code)}) return ${output}\n`;
  }
  diagnosticBody+=`  return ${fail('empty','unknown-code','unknown-code','That public diagnostic is not in the bundled snapshot; no substitute explanation was selected.')}\n`;
  const module=(type,body)=>`// Generated by scripts/pulse-context-build.cjs. Cited text stays in resources.\nimport type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'\nimport type { ${type}Input, ${type}Output, RecordContent } from './schemas.js'\nexport function compute${type}(ctx: PulseComputationContext, input: PulseReadonly<${type}Input>): ${type}Output {\n${body}}\n`;
  // Search uses scalar filters and the same finite metadata projection as read.
  const searchMeta = {...meta, encoder:config.encoder.id};
  const searchEmpty = {meta:{...searchMeta,requestedVersion:'__REQUEST_VERSION__'},status:'ok',results:[],totalMatches:0,truncated:false};
  const invalidSearch=fail('empty','invalid-input','invalid-search','Use one to eight ASCII search tokens of at most 64 bytes in a query of at most 256 bytes.');
  let searchBody = prelude('Search');
  searchBody+=`  const query = input.query
  const offset = (input.offset ?? 0) as number
  const limit = (input.limit ?? 5) as number
  if (query.length === 0 || query.length > 256 || offset < 0 || offset % 1 !== 0 || limit < 1 || limit > 5 || limit % 1 !== 0) return ${invalidSearch}
`;
  searchBody+=`  let categoryFilter = ${J('1'.repeat(records.length))}
  let pairFilter = ${J('1'.repeat(records.length))}
`;
  const categories = [...new Set(records.map(r=>r.category))].sort();
  for(const c of categories) searchBody+=`  if (input.category === ${J(c)}) categoryFilter = ${J(records.map(r=>r.category===c?'1':'0').join(''))}
`;
  searchBody+=`  if (input.category !== undefined && ${categories.map(c=>`input.category !== ${J(c)}`).join(' && ')}) return ${fail('empty','invalid-input','invalid-category','Choose a bundled corpus category.')}
`;
  for(const pair of pairs){const [provider,target]=pair.split('/');searchBody+=`  if (input.provider === ${J(provider)} && input.target === ${J(target)}) pairFilter = ${J(records.map(r=>r.applicability.some(p=>p.provider===provider&&p.target===target)?'1':'0').join(''))}
`;}
  searchBody+=`  if (!((input.provider === undefined && input.target === undefined)${[...pairs].map(pair=>{const[p,t]=pair.split('/');return ` || (input.provider === ${J(p)} && input.target === ${J(t)})`;}).join('')})) return ${fail('empty','unsupported-selection','unsupported-selection','Select one exact bundled provider/target pair.')}
`;
  let costs='';
  records.forEach((r,row)=>{
    const c=clip(r.content,384,2304);
    const hit={...summary(r),excerpt:r.content.slice(0,c.units),excerptTruncated:c.truncated,score:0};
    costs+=`  if (row === ${row}) return ${size(hit)+size(J(hit))-2}
`;
  });
  costs+='  return 24577\n';
  const zero={...searchEmpty,meta:{...searchMeta,requestedVersion:corpus.pulseVersion}};
  let searchSource=read(INPUTS[3]).toString();
  for(const[token,value]of Object.entries({__SEARCH_PRELUDE__:searchBody,__HIT_BYTES__:costs,__SEARCH_SUMMARY__:summaryPicker('record'),
    __PAGE_BASE__:String(projected({...zero,truncated:true,nextOffset:0})),__TERMINAL_BASE__:String(projected(zero))})) searchSource=substitute(searchSource,token,value);
  return {outputs:new Map([[`${APP}/src/search.ts`,Buffer.from(searchSource)],[`${APP}/src/read.ts`,Buffer.from(readSource)],[`${APP}/src/example.ts`,Buffer.from(module('Example',exampleBody))],[`${APP}/src/diagnostic.ts`,Buffer.from(module('Diagnostic',diagnosticBody))]]),declarations};
}
module.exports={INPUTS,generate,clip,projectedSize};
