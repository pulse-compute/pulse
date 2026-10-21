'use strict';
// Deliberately direct record scanning and sorting: no resource decoder, sparse
// encoder, heap or generator cost formula is shared with the implementation.
const tokens = value => value.replace(/[A-Z]/g,c=>c.toLowerCase()).match(/[a-z0-9_]+/g)||[];
const wholeBytes=(value,version)=>Buffer.byteLength(JSON.stringify({resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':{name:'pulse-context',version}},isError:false,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}));
function search(corpus,config,input) {
  const {version,query,category,provider,target}=input;
  const meta={pulseVersion:corpus.pulseVersion,corpusSchemaVersion:corpus.schemaVersion,corpusHash:corpus.corpusHash,snapshotStatus:corpus.status,applicationVersion:config.applicationVersion,maxReplyBytes:24576,encoder:config.encoder.id,...(Buffer.byteLength(version)<=64?{requestedVersion:version}:{})};
  const empty={meta,status:'ok',results:[],totalMatches:0,truncated:false};
  const fail=(status,code,message)=>({...empty,status,error:{code,message}});
  if(!version||Buffer.byteLength(version)>64)return fail('invalid-input','invalid-version','Supply an exact version of at most 64 UTF-8 bytes.');
  if(version!==corpus.pulseVersion)return fail('version-mismatch','version-mismatch','The requested version is not bundled. See meta.pulseVersion; no fallback was selected.');
  const offset=input.offset??0,limit=input.limit??5;
  const invalid=()=>fail('invalid-input','invalid-search','Use one to eight ASCII search tokens of at most 64 bytes in a query of at most 256 bytes.');
  if(!query||query.length>256||offset<0||!Number.isInteger(offset)||!Number.isInteger(limit)||limit<1||limit>5)return invalid();
  if(category!==undefined&&!corpus.records.some(r=>r.category===category))return fail('invalid-input','invalid-category','Choose a bundled corpus category.');
  if(!(provider===undefined&&target===undefined)&&!corpus.records.some(r=>r.category==='target'&&r.applicability.some(p=>p.provider===provider&&p.target===target)))return fail('unsupported-selection','unsupported-selection','Select one exact bundled provider/target pair.');
  const raw=tokens(query);
  if(/[^\x20-\x7e\t\n\r]/.test(query)||raw.length<1||raw.length>8||raw.some(t=>t.length>64))return invalid();
  const terms=[...new Set(raw)];
  const matches=[];
  for(const r of corpus.records){
    if(category!==undefined&&r.category!==category)continue;
    if(provider!==undefined&&!r.applicability.some(p=>p.provider===provider&&p.target===target))continue;
    const fields=[r.id,r.title,r.tags.join(' '),r.content].map(s=>new Set(tokens(s)));
    const weights=terms.map(t=>fields.reduce((n,f,i)=>n+(f.has(t)?[8,6,4,1][i]:0),0));
    if(weights.some(n=>n===0))continue;
    let excerpt='';for(const point of r.content){if(Buffer.byteLength(excerpt+point)>384)break;excerpt+=point;}
    const {content,pulseVersion,status,...record}=r;
    matches.push({...record,excerpt,excerptTruncated:excerpt.length<content.length,score:weights.reduce((a,b)=>a+b,0)});
  }
  matches.sort((a,b)=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0));
  if(offset>matches.length)return fail('invalid-input','invalid-offset','Offset exceeds the search match count.');
  const results=matches.slice(offset,offset+limit),next=offset+results.length,truncated=next<matches.length;
  const value={...empty,results,totalMatches:matches.length,truncated,...(truncated?{nextOffset:next}:{})};
  if(wholeBytes(value,version)>24576)return fail('response-too-large','response-too-large','Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.');
  return value;
}
module.exports={search,tokens,wholeBytes};
