import type { PulseComputationContext, PulseReadonly } from '@pulse-compute/pulse'
import type { SearchInput, SearchOutput, SearchHit, SearchRecord } from './schemas.js'
import { digits } from './scalars.js'

// Bounds and ordering follow the reviewed sparse-lexical v1 contract.
export function computeSearch(ctx: PulseComputationContext, input: PulseReadonly<SearchInput>): SearchOutput {
  let versionBytes = 0
  for (let i = 0; i < 65 && i < input.version.length; i++) {
    const c = input.version[i] ?? ''
    versionBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
  const empty: SearchOutput = versionBytes <= 64 ? {"meta":{"pulseVersion":"1.0.0-beta.9","corpusSchemaVersion":"pulse.context-corpus.v1","corpusHash":"a722a32539c9c31bb3887a9ac829a2a240a7bdbdb1e8e4116fd8ad75b8d3fa97","snapshotStatus":"candidate","applicationVersion":"pulse.context-application.v2","maxReplyBytes":24576,"encoder":"pulse.context-sparse-lexical.v1","requestedVersion":input.version},"status":"ok","results":[],"totalMatches":0,"truncated":false} : {"meta":{"pulseVersion":"1.0.0-beta.9","corpusSchemaVersion":"pulse.context-corpus.v1","corpusHash":"a722a32539c9c31bb3887a9ac829a2a240a7bdbdb1e8e4116fd8ad75b8d3fa97","snapshotStatus":"candidate","applicationVersion":"pulse.context-application.v2","maxReplyBytes":24576,"encoder":"pulse.context-sparse-lexical.v1"},"status":"ok","results":[],"totalMatches":0,"truncated":false}
  if (input.version.length === 0 || versionBytes > 64) return {...empty,status:'invalid-input',error:{code:'invalid-version',message:'Supply an exact version of at most 64 UTF-8 bytes.'}}
  if (input.version !== "1.0.0-beta.9") return {...empty,status:'version-mismatch',error:{code:'version-mismatch',message:'The requested version is not bundled. See meta.pulseVersion; no fallback was selected.'}}
  let nameBytes = 0
  for (let n = 0; n < 193 && n < input.query.length; n++) {
    const c = input.query[n] ?? ''
    nameBytes += c < '\u0080' ? 1 : c < '\u0800' ? 2 : c >= '\udc00' && c <= '\udfff' ? 1 : 3
  }
  const query = input.query
  const offset = (input.offset ?? 0) as number
  const limit = (input.limit ?? 5) as number
  if (query.length === 0 || query.length > 256 || offset < 0 || offset % 1 !== 0 || limit < 1 || limit > 5 || limit % 1 !== 0) return {...empty,status:"invalid-input",error:{code:"invalid-search",message:"Use one to eight ASCII search tokens of at most 64 bytes in a query of at most 256 bytes."}}
  let categoryFilter = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
  let pairFilter = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
  if (input.category === "command") categoryFilter = "11111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  if (input.category === "contract") categoryFilter = "00000000011111111111111111100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
  if (input.category === "diagnostic") categoryFilter = "00000000000000000000000000011111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000"
  if (input.category === "example") categoryFilter = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111111111111111111111110000000000000000000000000000"
  if (input.category === "guide") categoryFilter = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001111000000000000000111111111"
  if (input.category === "package") categoryFilter = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111111111111000000000000"
  if (input.category === "target") categoryFilter = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111000000000"
  if (input.category !== undefined && input.category !== "command" && input.category !== "contract" && input.category !== "diagnostic" && input.category !== "example" && input.category !== "guide" && input.category !== "package" && input.category !== "target") return {...empty,status:"invalid-input",error:{code:"invalid-category",message:"Choose a bundled corpus category."}}
  if (input.provider === "fastly" && input.target === "javascript") pairFilter = "10111111111011111111101111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000111111010111100111111111"
  if (input.provider === "fastly" && input.target === "native") pairFilter = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000111111010111100111111111"
  if (input.provider === "node" && input.target === "javascript") pairFilter = "10111111111011111111101111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000001101111111101111010111111111"
  if (input.provider === "node" && input.target === "native") pairFilter = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111011111111001111010111111111"
  if (input.provider === "none" && input.target === "native") pairFilter = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111100000000000000000000000000000111111000111001111111111"
  if (!((input.provider === undefined && input.target === undefined) || (input.provider === "fastly" && input.target === "javascript") || (input.provider === "fastly" && input.target === "native") || (input.provider === "node" && input.target === "javascript") || (input.provider === "node" && input.target === "native") || (input.provider === "none" && input.target === "native"))) return {...empty,status:"unsupported-selection",error:{code:"unsupported-selection",message:"Select one exact bundled provider/target pair."}}

  const vector = ctx.resources.map('context.vector')
  const text = ctx.resources.map('context.text')
  const metadata = ctx.resources.map('context.metadata')
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
  let replyBytes = (next < total ? 1091 + 2 * (digits(next) - 1) : 1061) + 2 * (digits(total) - 1)
  let results: SearchHit[] = []
  for (let slot = 0; slot < 5 && slot < selectedCount; slot++) {
    const key = selected[slot]
    const row = 511 - key % 512
    const score = (key - key % 512) / 512
    replyBytes += hitBytes(row) + 2 * (digits(score) - 1) + (slot > 0 ? 2 : 0)
    if (replyBytes > 24576) return {...empty, status:'response-too-large', error:{
      code:'response-too-large',message:'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.',
    }}
    const at = text.readU32LE(64 + row * 12)
    const length = text.readU32LE(68 + row * 12)
    let width = length < 384 ? length : 384
    for (let b = 0; b < 4 && width > 0 && width < length; b++) {
      const byte = text.readU8(at + width)
      if (byte < 128 || byte >= 192) break
      width -= 1
    }
    const record = ctx.decodeJson<SearchRecord>(metadata.readUtf8(
      metadata.readU32LE(64 + row * 8), metadata.readU32LE(68 + row * 8)), 'context.SearchRecord')
    results = [...results, {
      id: record.id, title: record.title, category: record.category, tags: record.tags,
      applicability: record.applicability, source: record.source, contentSha256: record.contentSha256,
      excerpt: text.readUtf8(at, width), excerptTruncated: width < length, score,
    }]
  }
  if (next < total) return {...empty, results, totalMatches:total, truncated:true, nextOffset:next}
  return {...empty, results, totalMatches:total}
}

// Exact two-copy JSON costs derived from the same immutable corpus as resources.
function hitBytes(row: number): number {
  if (row === 0) return 2402
  if (row === 1) return 2230
  if (row === 2) return 2386
  if (row === 3) return 2419
  if (row === 4) return 2414
  if (row === 5) return 2409
  if (row === 6) return 2433
  if (row === 7) return 2425
  if (row === 8) return 2376
  if (row === 9) return 2546
  if (row === 10) return 2438
  if (row === 11) return 2294
  if (row === 12) return 2382
  if (row === 13) return 2511
  if (row === 14) return 2434
  if (row === 15) return 2508
  if (row === 16) return 2438
  if (row === 17) return 2483
  if (row === 18) return 2536
  if (row === 19) return 2479
  if (row === 20) return 2499
  if (row === 21) return 2332
  if (row === 22) return 2433
  if (row === 23) return 2460
  if (row === 24) return 2499
  if (row === 25) return 2448
  if (row === 26) return 2422
  if (row === 27) return 2745
  if (row === 28) return 2611
  if (row === 29) return 2631
  if (row === 30) return 2648
  if (row === 31) return 2542
  if (row === 32) return 2596
  if (row === 33) return 2612
  if (row === 34) return 2590
  if (row === 35) return 2650
  if (row === 36) return 2632
  if (row === 37) return 2624
  if (row === 38) return 2589
  if (row === 39) return 2553
  if (row === 40) return 2589
  if (row === 41) return 2581
  if (row === 42) return 2608
  if (row === 43) return 2644
  if (row === 44) return 2636
  if (row === 45) return 2587
  if (row === 46) return 2689
  if (row === 47) return 2687
  if (row === 48) return 2597
  if (row === 49) return 2625
  if (row === 50) return 2656
  if (row === 51) return 2753
  if (row === 52) return 2760
  if (row === 53) return 2716
  if (row === 54) return 2688
  if (row === 55) return 2677
  if (row === 56) return 2663
  if (row === 57) return 2737
  if (row === 58) return 2662
  if (row === 59) return 2491
  if (row === 60) return 2595
  if (row === 61) return 2627
  if (row === 62) return 2611
  if (row === 63) return 2672
  if (row === 64) return 2691
  if (row === 65) return 2643
  if (row === 66) return 2577
  if (row === 67) return 2564
  if (row === 68) return 2596
  if (row === 69) return 2691
  if (row === 70) return 2687
  if (row === 71) return 2675
  if (row === 72) return 2691
  if (row === 73) return 2659
  if (row === 74) return 2672
  if (row === 75) return 2691
  if (row === 76) return 2533
  if (row === 77) return 2642
  if (row === 78) return 2774
  if (row === 79) return 2722
  if (row === 80) return 2643
  if (row === 81) return 2665
  if (row === 82) return 2644
  if (row === 83) return 2709
  if (row === 84) return 2733
  if (row === 85) return 2751
  if (row === 86) return 2762
  if (row === 87) return 2677
  if (row === 88) return 2663
  if (row === 89) return 2675
  if (row === 90) return 2689
  if (row === 91) return 2713
  if (row === 92) return 2554
  if (row === 93) return 2688
  if (row === 94) return 2590
  if (row === 95) return 2584
  if (row === 96) return 2640
  if (row === 97) return 2561
  if (row === 98) return 2575
  if (row === 99) return 2760
  if (row === 100) return 2775
  if (row === 101) return 2752
  if (row === 102) return 2740
  if (row === 103) return 2742
  if (row === 104) return 2782
  if (row === 105) return 2722
  if (row === 106) return 2722
  if (row === 107) return 2712
  if (row === 108) return 2728
  if (row === 109) return 2746
  if (row === 110) return 2691
  if (row === 111) return 2750
  if (row === 112) return 2726
  if (row === 113) return 2731
  if (row === 114) return 2759
  if (row === 115) return 2710
  if (row === 116) return 2806
  if (row === 117) return 2669
  if (row === 118) return 2615
  if (row === 119) return 2664
  if (row === 120) return 2669
  if (row === 121) return 2659
  if (row === 122) return 2664
  if (row === 123) return 2647
  if (row === 124) return 2660
  if (row === 125) return 2748
  if (row === 126) return 2702
  if (row === 127) return 2701
  if (row === 128) return 2838
  if (row === 129) return 2648
  if (row === 130) return 2667
  if (row === 131) return 2736
  if (row === 132) return 2656
  if (row === 133) return 2699
  if (row === 134) return 2668
  if (row === 135) return 2684
  if (row === 136) return 2519
  if (row === 137) return 2640
  if (row === 138) return 2509
  if (row === 139) return 2697
  if (row === 140) return 2737
  if (row === 141) return 2639
  if (row === 142) return 2628
  if (row === 143) return 2674
  if (row === 144) return 2674
  if (row === 145) return 2706
  if (row === 146) return 2629
  if (row === 147) return 2635
  if (row === 148) return 2655
  if (row === 149) return 2622
  if (row === 150) return 2630
  if (row === 151) return 2587
  if (row === 152) return 2630
  if (row === 153) return 2554
  if (row === 154) return 2675
  if (row === 155) return 2587
  if (row === 156) return 2640
  if (row === 157) return 2651
  if (row === 158) return 2664
  if (row === 159) return 2733
  if (row === 160) return 2637
  if (row === 161) return 2663
  if (row === 162) return 2728
  if (row === 163) return 2734
  if (row === 164) return 2752
  if (row === 165) return 2727
  if (row === 166) return 2665
  if (row === 167) return 2655
  if (row === 168) return 2557
  if (row === 169) return 2634
  if (row === 170) return 2704
  if (row === 171) return 2758
  if (row === 172) return 2576
  if (row === 173) return 2744
  if (row === 174) return 2688
  if (row === 175) return 2718
  if (row === 176) return 2641
  if (row === 177) return 2618
  if (row === 178) return 2579
  if (row === 179) return 2532
  if (row === 180) return 2523
  if (row === 181) return 2594
  if (row === 182) return 2718
  if (row === 183) return 2694
  if (row === 184) return 2670
  if (row === 185) return 2734
  if (row === 186) return 2606
  if (row === 187) return 2600
  if (row === 188) return 2570
  if (row === 189) return 2635
  if (row === 190) return 2583
  if (row === 191) return 2627
  if (row === 192) return 2642
  if (row === 193) return 2618
  if (row === 194) return 2610
  if (row === 195) return 2677
  if (row === 196) return 2577
  if (row === 197) return 2535
  if (row === 198) return 2696
  if (row === 199) return 2647
  if (row === 200) return 2694
  if (row === 201) return 2695
  if (row === 202) return 2719
  if (row === 203) return 2687
  if (row === 204) return 2695
  if (row === 205) return 2679
  if (row === 206) return 2682
  if (row === 207) return 2695
  if (row === 208) return 2676
  if (row === 209) return 2620
  if (row === 210) return 1990
  if (row === 211) return 2226
  if (row === 212) return 1867
  if (row === 213) return 2104
  if (row === 214) return 1850
  if (row === 215) return 2122
  if (row === 216) return 2088
  if (row === 217) return 2254
  if (row === 218) return 2049
  if (row === 219) return 2085
  if (row === 220) return 2130
  if (row === 221) return 1882
  if (row === 222) return 1695
  if (row === 223) return 2118
  if (row === 224) return 2274
  if (row === 225) return 2112
  if (row === 226) return 2166
  if (row === 227) return 1906
  if (row === 228) return 1719
  if (row === 229) return 2102
  if (row === 230) return 2263
  if (row === 231) return 2093
  if (row === 232) return 2138
  if (row === 233) return 1890
  if (row === 234) return 2201
  if (row === 235) return 2170
  if (row === 236) return 2096
  if (row === 237) return 2048
  if (row === 238) return 2166
  if (row === 239) return 2549
  if (row === 240) return 2515
  if (row === 241) return 2526
  if (row === 242) return 2561
  if (row === 243) return 2548
  if (row === 244) return 2535
  if (row === 245) return 2193
  if (row === 246) return 2311
  if (row === 247) return 2243
  if (row === 248) return 2527
  if (row === 249) return 2570
  if (row === 250) return 2544
  if (row === 251) return 1763
  if (row === 252) return 1679
  if (row === 253) return 1541
  if (row === 254) return 2445
  if (row === 255) return 2428
  if (row === 256) return 2399
  if (row === 257) return 2472
  if (row === 258) return 2349
  if (row === 259) return 2377
  if (row === 260) return 2441
  if (row === 261) return 2276
  if (row === 262) return 2353
  return 24577

}
