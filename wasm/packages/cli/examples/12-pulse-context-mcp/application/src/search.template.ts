import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'
import type { SearchInput, SearchOutput, SearchHit, RecordSummary } from './schemas.js'
import { digits } from './scalars.js'

// Bounds and ordering follow the reviewed sparse-lexical v1 contract.
export function computeSearch(ctx: PulseComputationContext, input: PulseReadonly<SearchInput>): SearchOutput {
__SEARCH_PRELUDE__
  const vector = ctx.resources.map('context.vector')
  const text = ctx.resources.map('context.text')
  const qids = ctx.workspace.numbers(8)
  const heap = ctx.workspace.numbers(512)
  const selected = ctx.workspace.numbers(5)
  const upper='ABCDEFGHIJKLMNOPQRSTUVWXYZ'; const lower='abcdefghijklmnopqrstuvwxyz';
  let t0='',t1='',t2='',t3='',t4='',t5='',t6='',t7='',word='';
  let rawCount=0,invalid=0;
  for(let i=0;i<257&&i<=query.length;i++) {
    let unit=query[i]??' ';
    if(i<query.length&&(unit<' '||unit>'~')&&unit!=='\t'&&unit!=='\n'&&unit!=='\r')invalid=1;
    if(unit>='A'&&unit<='Z')for(let a=0;a<26;a++){if(unit===upper[a]){unit=lower[a]??'';break;}}
    if(unit>='a'&&unit<='z'||unit>='0'&&unit<='9'||unit==='_'){word+=unit;if(word.length>64)invalid=1;}
    else if(word!==''){
      if(rawCount===0)t0=word;else if(rawCount===1)t1=word;else if(rawCount===2)t2=word;else if(rawCount===3)t3=word;
      else if(rawCount===4)t4=word;else if(rawCount===5)t5=word;else if(rawCount===6)t6=word;else if(rawCount===7)t7=word;
      rawCount+=1;word='';
    }
  }
  if(invalid===1||rawCount===0||rawCount>8)return {...empty, status:'invalid-input', error:{code:'invalid-search',message:'Use one to eight ASCII search tokens of at most 64 bytes in a query of at most 256 bytes.'}};
  const vocabulary=vector.readU32LE(24);
  let termCount=0,unknown=0;
  for(let t=0;t<8&&t<rawCount;t++){
    const token=t===0?t0:t===1?t1:t===2?t2:t===3?t3:t===4?t4:t===5?t5:t===6?t6:t7;
    let lo=0,hi=vocabulary-1,found=-1;
    for(let s=0;s<13&&lo<=hi;s++){
      const half=(lo+hi)/2;const mid=half-half%1;
      const tokenBytes=vector.readU32LE(68+mid*8);
      const other=vector.readUtf8(vector.readU32LE(64+mid*8),tokenBytes);
      if(token===other){found=mid;break;}else if(token<other)hi=mid-1;else lo=mid+1;
    }
    if(found<0)unknown=1;
    let duplicate=0;
    for(let d=0;d<8&&d<termCount;d++){if(qids[d]===found)duplicate=1;}
    if(duplicate===0){qids[termCount]=found;termCount+=1;}
  }
  if(unknown===1){if(offset>0)return {...empty,status:'invalid-input',error:{code:'invalid-offset',message:'Offset exceeds the search match count.'}};return empty;}
  
  const tCount=termCount,wantedOffset=offset,wantedLimit=limit;
  let rows=vector.readU32LE(20),rowDirectory=64+vector.readU32LE(24)*8;
  let entryDirectory=rowDirectory+rows*8;
  let heapSize=0,total=0;
  for(let r=0;r<512&&r<rows;r++){
    if(categoryFilter[r]!=='1'||pairFilter[r]!=='1')continue;
    let score=0,match=1;
    let first=vector.readU32LE(rowDirectory+r*8),count=vector.readU32LE(rowDirectory+r*8+4);
    for(let t=0;t<8&&t<tCount;t++){
      let lo=0,hi=count-1,weight=0;
      for(let s=0;s<11&&lo<=hi;s++){
        const half=(lo+hi)/2;const mid=half-half%1;
        const id=vector.readU32LE(entryDirectory+(first+mid)*8);
        if(id===qids[t]){weight=vector.readU32LE(entryDirectory+(first+mid)*8+4);break;}
        else if(id<qids[t])lo=mid+1;else hi=mid-1;
      }
      if(weight===0)match=0;score+=weight;
    }
    if(match===1){
      total+=1;const key=score*512+511-r;let pos=heapSize;heapSize+=1;
      for(let h=0;h<9&&pos>0;h++){
        const half=(pos-1)/2;const parent=half-half%1;
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
        let child=pos*2+1;if(child>=heapSize)break;
        if(child+1<heapSize&&heap[child+1]>heap[child])child+=1;
        if(heap[child]<=last)break;heap[pos]=heap[child];pos=child;
      }
      heap[pos]=last;
    }
  }
  if(offset>total)return {...empty,status:'invalid-input',error:{code:'invalid-offset',message:'Offset exceeds the search match count.'}};

  const next = offset + selectedCount
  let replyBytes = (next < total ? __PAGE_BASE__ + 2 * ((next < 10 ? 1 : next < 100 ? 2 : 3) - 1) : __TERMINAL_BASE__) + 2 * (digits(total) - 1)
  let results: SearchHit[] = []
  let oversized = false
  for (let slot = 0; slot < 5 && slot < selectedCount; slot++) {
    const key = selected[slot]
    const row = 511 - key % 512
    const score = (key - key % 512) / 512
    replyBytes += hitBytes(row) + 2 * (digits(score) - 1) + (slot > 0 ? 2 : 0)
    if (replyBytes > 24576) { oversized = true; break }
    const at = text.readU32LE(64 + row * 12)
    const length = text.readU32LE(68 + row * 12)
    let width = length < 384 ? length : 384
    for (let b = 0; b < 4 && width > 0 && width < length; b++) {
      const byte = text.readU8(at + width)
      if (byte < 128 || byte >= 192) break
      width -= 1
    }
__SEARCH_SUMMARY__
    results = [...results, {
      id: record.id, title: record.title, category: record.category, tags: record.tags,
      applicability: record.applicability, source: record.source, contentSha256: record.contentSha256,
      excerpt: text.readUtf8(at, width), excerptTruncated: width < length, score,
    }]
  }
  if (oversized) return {...empty, status:'response-too-large', error:{
      code:'response-too-large',message:'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.',
    }}
  if (next < total) return {...empty, results, totalMatches:total, truncated:true, nextOffset:next}
  return {...empty, results, totalMatches:total}
}

// Exact two-copy JSON costs derived from the same immutable corpus as resources.
function hitBytes(row: number): number {
__HIT_BYTES__
}
