'use strict';
// Independent proof fixture producer. Production workflow/admission is B10-MCP-03.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const digest = b => createHash('sha256').update(b).digest('hex');
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const tokens = text => text.replace(/[A-Z]/g, c => c.toLowerCase()).match(/[a-z0-9_]+/g) || [];
function corpus() {
  const source = fs.readFileSync(path.join(root, 'examples/12-pulse-context-mcp/context-corpus.ts'), 'utf8');
  return JSON.parse(source.slice(source.indexOf('export const contextCorpus = freeze(') + 'export const contextCorpus = freeze('.length, source.lastIndexOf(' as const);')));
}
function fixture(c = corpus()) {
  const records = [...c.records].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const rows = records.map(r => {
    const row = new Map();
    [r.id,r.title,r.tags.join(' '),r.content].forEach((field,i)=>{for(const token of new Set(tokens(field)))row.set(token,(row.get(token)||0)+[8,6,4,1][i]);});return row;
  });
  const terms = [...new Set(rows.flatMap(r=>[...r.keys()]))].sort(), ids = new Map(terms.map((t,i)=>[t,i]));
  const entries = rows.map(r=>[...r].map(([t,w])=>[ids.get(t),w]).sort((a,b)=>a[0]-b[0]));
  const total = entries.reduce((n,r)=>n+r.length,0), dictionaryBytes = terms.reduce((n,t)=>n+t.length,0);
  if(records.length>512 || terms.length>4096 || entries.some(r=>r.length>1024) || terms.some(t=>t.length>64))throw Error('proof fixture exceeds the selected envelope');
  const header = (bytes, magic) => {const b=Buffer.alloc(bytes);b.write(magic);[1,64,bytes,records.length].forEach((v,i)=>b.writeUInt32LE(v,8+i*4));Buffer.from(c.corpusHash,'hex').copy(b,32);return b;};
  const vector = header(64+terms.length*8+records.length*8+total*8+dictionaryBytes,'PCTXV001');
  vector.writeUInt32LE(terms.length,24);vector.writeUInt32LE(total,28);
  let at=64+terms.length*8+records.length*8+total*8;
  terms.forEach((t,i)=>{vector.writeUInt32LE(at,64+i*8);vector.writeUInt32LE(t.length,68+i*8);at+=vector.write(t,at,'ascii');});
  let cursor=0;
  entries.forEach((r,i)=>{vector.writeUInt32LE(cursor,64+terms.length*8+i*8);vector.writeUInt32LE(r.length,68+terms.length*8+i*8);for(const [id,w]of r){const p=64+terms.length*8+records.length*8+cursor++*8;vector.writeUInt32LE(id,p);vector.writeUInt32LE(w,p+4);}});
  function pack(magic,width,values) {
    const buffers=values.map(v=>Buffer.from(v,'utf8')), b=header(64+records.length*width+buffers.reduce((n,v)=>n+v.length,0),magic);let offset=64+records.length*width;
    buffers.forEach((bytes,i)=>{b.writeUInt32LE(offset,64+i*width);b.writeUInt32LE(bytes.length,68+i*width);if(width===12)b.writeUInt32LE(values[i].length,72+i*width);bytes.copy(b,offset);offset+=bytes.length;});return b;
  }
  const text=pack('PCTXT001',12,records.map(r=>r.content));
  const metadata=pack('PCTXM001',8,records.map(({content,...r})=>JSON.stringify(canonical(r))));
  return { records, rows, terms, entries:total, corpusHash:c.corpusHash, pulseVersion:c.pulseVersion,
    files:[{id:'context.vector',path:'/vector.bin',bytes:vector},{id:'context.text',path:'/text.bin',bytes:text},{id:'context.metadata',path:'/metadata.bin',bytes:metadata}] };
}
function source(data) {
  const categories=['contract','guide','package','target','command','diagnostic','example'];
  const filters=categories.map(category=>data.records.map(r=>r.category===category?'1':'0').join(''));
  const pairs=[['node','native'],['node','javascript'],['fastly','native'],['fastly','javascript'],['none','native']];
  const selections=pairs.map(([provider,target])=>data.records.map(r=>r.applicability.some(p=>p.provider===provider&&p.target===target)?'1':'0').join(''));
  return `export default async function handler(ctx) {
  const vector=ctx.resources.map('context.vector');
  const text=ctx.resources.map('context.text');
  const metadata=ctx.resources.map('context.metadata');
  const qids=ctx.workspace.numbers(11);
  const eligible=ctx.workspace.numbers(512);
  const heap=ctx.workspace.numbers(512);
  const selected=ctx.workspace.numbers(5);
  const query=ctx.req.header('query')??'';
  const version=ctx.req.header('version')??'';
  const category=ctx.req.header('category')??'';
  const provider=ctx.req.header('provider')??'';
  const target=ctx.req.header('target')??'';
  const offset=+(ctx.req.header('offset')??'0');
  const limit=+(ctx.req.header('limit')??'5');
  if(version!==${JSON.stringify(data.pulseVersion)}) return ctx.json({status:'version-mismatch'});
  const readRow=+(ctx.req.header('read-row')??'-1');
  if(readRow>=0){
    const wanted=+(ctx.req.header('read-offset')??'0');
    if(readRow%1!==0||readRow>=text.readU32LE(20)||wanted<0||wanted%1!==0)return ctx.json({status:'invalid-input'});
    const start=text.readU32LE(64+readRow*12),size=text.readU32LE(68+readRow*12);
    let at=0,units=0;
    for(let block=0;block<24&&units<wanted&&at<size;block++)for(let i=0;i<1024&&units<wanted&&at<size;i++){
      const b=text.readU8(start+at);const width=b<128?1:b<224?2:b<240?3:4;at+=width;units+=width===4?2:1;
    }
    if(units!==wanted)return ctx.json({status:'invalid-offset'});
    const begin=at;let escaped=0,stopped=0;
    for(let block=0;block<12&&at<size&&stopped===0;block++)for(let i=0;i<1024&&at<size&&stopped===0;i++){
      const b=text.readU8(start+at);const width=b<128?1:b<224?2:b<240?3:4;
      const cost=b===34||b===92?2:b<32?(b===8||b===9||b===10||b===12||b===13?2:6):width;
      if(at+width-begin>12288||escaped+cost>16384)stopped=1;else{at+=width;escaped+=cost;units+=width===4?2:1;}
    }
    const chunk=text.readUtf8(start+begin,at-begin);
    return ctx.text(ctx.encodeJson({chunk,nextOffset:units,done:at===size,totalBytes:size},'context.Page'));
  }
  if(query.length===0||query.length>256||offset<0||offset>512||offset%1!==0||limit<1||limit>5||limit%1!==0) return ctx.json({status:'invalid-input'});
  let categoryFilter=${JSON.stringify('1'.repeat(data.records.length))};
  let pairFilter=${JSON.stringify('1'.repeat(data.records.length))};
  ${categories.map((c,i)=>`${i?'else ':''}if(category===${JSON.stringify(c)}) categoryFilter=${JSON.stringify(filters[i])};`).join('\n')}
  else if(category!=='')return ctx.json({status:'invalid-input'});
  ${pairs.map(([p,t],i)=>`${i?'else ':''}if(provider===${JSON.stringify(p)}&&target===${JSON.stringify(t)}) pairFilter=${JSON.stringify(selections[i])};`).join('\n')}
  else if(provider!==''||target!=='')return ctx.json({status:'unsupported-selection'});
  const upper='ABCDEFGHIJKLMNOPQRSTUVWXYZ'; const lower='abcdefghijklmnopqrstuvwxyz';
  let t0='',t1='',t2='',t3='',t4='',t5='',t6='',t7='',word='';
  let rawCount=0,invalid=0;
  for(let i=0;i<257&&i<=query.length;i++) {
    let unit=query[i]??' ';
    if(i<query.length&&(unit<' '||unit>'~')&&unit!=='\\t'&&unit!=='\\n'&&unit!=='\\r')invalid=1;
    if(unit>='A'&&unit<='Z')for(let a=0;a<26;a++){if(unit===upper[a]){unit=lower[a]??'';break;}}
    if(unit>='a'&&unit<='z'||unit>='0'&&unit<='9'||unit==='_'){word+=unit;if(word.length>64)invalid=1;}
    else if(word!==''){
      if(rawCount===0)t0=word;else if(rawCount===1)t1=word;else if(rawCount===2)t2=word;else if(rawCount===3)t3=word;
      else if(rawCount===4)t4=word;else if(rawCount===5)t5=word;else if(rawCount===6)t6=word;else if(rawCount===7)t7=word;
      rawCount+=1;word='';
    }
  }
  if(invalid===1||rawCount===0||rawCount>8)return ctx.json({status:'invalid-input'});
  const vocabulary=vector.readU32LE(24);
  let termCount=0,unknown=0,dictionaryComparisons=0,dictionaryBytes=0;
  for(let t=0;t<8&&t<rawCount;t++){
    const token=t===0?t0:t===1?t1:t===2?t2:t===3?t3:t===4?t4:t===5?t5:t===6?t6:t7;
    let lo=0,hi=vocabulary-1,found=-1;
    for(let s=0;s<13&&lo<=hi;s++){
      const half=(lo+hi)/2;const mid=half-half%1;
      const tokenBytes=vector.readU32LE(68+mid*8);dictionaryBytes+=tokenBytes;dictionaryComparisons+=1;
      const other=vector.readUtf8(vector.readU32LE(64+mid*8),tokenBytes);
      if(token===other){found=mid;break;}else if(token<other)hi=mid-1;else lo=mid+1;
    }
    if(found<0)unknown=1;
    let duplicate=0;
    for(let d=0;d<8&&d<termCount;d++){if(qids[d]===found)duplicate=1;}
    if(duplicate===0){qids[termCount]=found;termCount+=1;}
  }
  if(unknown===1){if(offset>0)return ctx.json({status:'invalid-offset'});return ctx.json({status:'ok',totalMatches:0,results:[]});}
  qids[8]=termCount;qids[9]=offset;qids[10]=limit;
  for(let r=0;r<512&&r<eligible.length;r++){eligible[r]=categoryFilter[r]==='1'&&pairFilter[r]==='1'?1:0;}
  let tCount=qids[8],wantedOffset=qids[9],wantedLimit=qids[10];
  let rows=vector.readU32LE(20),rowDirectory=64+vector.readU32LE(24)*8;
  let entryDirectory=rowDirectory+rows*8;
  let heapSize=0,total=0,comparisons=0,heapSteps=0;
  for(let r=0;r<512&&r<rows;r++){
    if(eligible[r]===0)continue;
    let score=0,match=1;
    let first=vector.readU32LE(rowDirectory+r*8),count=vector.readU32LE(rowDirectory+r*8+4);
    for(let t=0;t<8&&t<tCount;t++){
      let lo=0,hi=count-1,weight=0;
      for(let s=0;s<11&&lo<=hi;s++){
        const half=(lo+hi)/2;const mid=half-half%1;
        const id=vector.readU32LE(entryDirectory+(first+mid)*8);comparisons+=1;
        if(id===qids[t]){weight=vector.readU32LE(entryDirectory+(first+mid)*8+4);break;}
        else if(id<qids[t])lo=mid+1;else hi=mid-1;
      }
      if(weight===0)match=0;score+=weight;
    }
    if(match===1){
      total+=1;const key=score*512+511-r;let pos=heapSize;heapSize+=1;
      for(let h=0;h<9&&pos>0;h++){
        heapSteps+=1;const half=(pos-1)/2;const parent=half-half%1;
        if(heap[parent]>=key)break;heap[pos]=heap[parent];pos=parent;
      }
      heap[pos]=key;
    }
  }
  let selectedCount=0;
  for(let p=0;p<512&&p<wantedOffset+wantedLimit&&heapSize>0;p++){
    const key=heap[0];heapSize-=1;
    if(p>=wantedOffset){selected[selectedCount]=key;selectedCount+=1;}
    if(heapSize>0){
      const last=heap[heapSize];let pos=0;
      for(let h=0;h<9;h++){
        heapSteps+=1;let child=pos*2+1;if(child>=heapSize)break;
        if(child+1<heapSize&&heap[child+1]>heap[child])child+=1;
        if(heap[child]<=last)break;heap[pos]=heap[child];pos=child;
      }
      heap[pos]=last;
    }
  }
  if(offset>total)return ctx.json({status:'invalid-offset'});
  let output='{"status":"ok","totalMatches":'+total+',"comparisons":'+comparisons+',"heapSteps":'+heapSteps+',"dictionaryComparisons":'+dictionaryComparisons+',"dictionaryBytes":'+dictionaryBytes+',"results":[';
  ${Array.from({length:5},(_,slot)=>`if(selectedCount>${slot}){
    const key=selected[${slot}],row=511-key%512,score=(key-key%512)/512;
    const at=text.readU32LE(64+row*12),length=text.readU32LE(68+row*12);
    let width=length<384?length:384;
    for(let b=0;b<4&&width>0&&width<length;b++){const byte=text.readU8(at+width);if(byte<128||byte>=192)break;width-=1;}
    const record=ctx.decodeJson(metadata.readUtf8(metadata.readU32LE(64+row*8),metadata.readU32LE(68+row*8)),'context.Metadata');
    const excerpt=text.readUtf8(at,width);
    const hit=ctx.encodeJson({record,excerpt,score},'context.Hit');
    output+=${slot===0?"''":"','"}+hit;
  }`).join('\n')}
  output+='],"corpusHash":'+${JSON.stringify(JSON.stringify(data.corpusHash))}+'}';
  let responseBytes=0;
  for(let block=0;block<32;block++){for(let i=0;i<1024;i++){
    const at=block*1024+i;if(at>=output.length)break;const unit=output[at]??'';
    if(unit<'\\u0080')responseBytes+=1;else if(unit<'\\u0800')responseBytes+=2;
    else if(unit>='\\udc00'&&unit<='\\udfff')responseBytes+=1;else responseBytes+=3;
  }}
  if(output.length>32768||responseBytes>24576)return ctx.json({status:'response-too-large'});
  return ctx.text(output);
}`;
}
function schemaBundle() {
  const { normalizeSchemaRegistry } = require('../../packages/contracts/src/schema-json/registry');
  const { buildCanonicalSchemaBundle } = require('../../packages/schema-json/src/compiler/canonical-schema-codecs');
  const location={file:'context-native-proof.ts',line:1,column:1};
  const string={kind:'string'},number={kind:'f64'};
  const object=fields=>({kind:'object',fields:Object.entries(fields).map(([name,value])=>({name,required:true,value}))});
  const metadata=object({id:string,title:string,category:string,tags:{kind:'array',element:string},applicability:{kind:'array',element:object({provider:string,target:string})},pulseVersion:string,status:string,source:object({path:string,selection:string,sha256:string,url:string}),contentSha256:string});
  metadata.fields.find(f=>f.name==='source').value.fields.push(...['startLine','endLine'].map(name=>({name,required:false,value:number})));
  return buildCanonicalSchemaBundle(normalizeSchemaRegistry({source:location,schemas:[{id:'context.Metadata',typeName:'Metadata',source:location,root:metadata},{id:'context.Hit',typeName:'Hit',source:location,root:object({record:metadata,excerpt:string,score:number})},{id:'context.Page',typeName:'Page',source:location,root:object({chunk:string,nextOffset:number,done:{kind:'boolean'},totalBytes:number})}]}));
}
module.exports={root,digest,tokens,corpus,fixture,source,schemaBundle};
