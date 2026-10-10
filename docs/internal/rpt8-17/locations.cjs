'use strict';
const assert=require('node:assert/strict'),ts=require('typescript');
const {inspectWasm}=require('../../../wasm/packages/build-support/src/wasm-evidence');
function reader(bytes,at){return {at,uint(){let n=0,s=0,b;do{assert.ok(this.at<bytes.length&&s<35);b=bytes[this.at++];n+=(b&127)*2**s;s+=7;}while(b&128);return n;},text(){const n=this.uint(),s=this.at;this.at+=n;assert.ok(this.at<=bytes.length);return bytes.subarray(s,this.at).toString('utf8');}};}
function stripMap(bytes){
 const census=inspectWasm(bytes),removed=[];
 const parts=census.sections.flatMap(section=>{
  if(section.id===0){const r=reader(bytes,section.offset+1);r.uint();if(r.text()==='sourceMappingURL'){removed.push(section);return [];}}
  return [bytes.subarray(section.offset,section.offset+section.bytes)];
 });
 return {bytes:Buffer.concat([bytes.subarray(0,8),...parts]),removed};
}
function codeBodies(bytes){
 const census=inspectWasm(bytes),code=census.sections.find(s=>s.id===10),r=reader(bytes,code.offset+1);r.uint();
 const n=r.uint(),rows=[];for(let i=0;i<n;i++){const size=r.uint(),start=r.at;r.at+=size;rows.push({index:census.importedFunctions+i,start,end:r.at});}return rows;
}
function decode(map){
 assert.equal(map.version,3);assert.ok(!map.mappings.includes(';'),'Wasm offsets occupy one generated line');
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 let offset=0,source=0,line=0,column=0;const points=[];
 for(const segment of map.mappings.split(',')){
  if(!segment)continue;let n=0,shift=0;const values=[];
  for(const char of segment){const digit=alphabet.indexOf(char);assert.ok(digit>=0&&shift<35);n+=(digit&31)*2**shift;
   if(digit&32)shift+=5;else{values.push((n&1)?-Math.floor(n/2):n/2);n=0;shift=0;}}
  assert.equal(shift,0);assert.ok([1,4,5].includes(values.length));offset+=values[0];assert.ok(offset>=0);
  if(values.length===1){points.push({offset,source:null});continue;}
  source+=values[1];line+=values[2];column+=values[3];assert.ok(source>=0&&source<map.sources.length&&line>=0&&column>=0);
  points.push({offset,source,line,column});
 }
 return points;
}
// Source-case origins are hints, not instruction ownership. No interval between
// adjacent map anchors is assigned to the preceding entry.
function locate(map,artifact,source,blocks,plan){
 const parsed=ts.createSourceFile('generated.ts',source,ts.ScriptTarget.Latest,true),cases=[];
 const stages=new Map(plan.stages.map(stage=>[stage.id,stage.registrations.map(row=>row.entryId)]));
 const entries=new Set(plan.routing.entries.map(row=>row.stableId));
 function visit(node){
  if(ts.isSwitchStatement(node)&&node.expression.getText(parsed)==='__pulse_pc')for(const clause of node.caseBlock.clauses){
   if(!ts.isCaseClause(clause)||!ts.isNumericLiteral(clause.expression))continue;
   const block=blocks[Number(clause.expression.text)];assert.ok(block);
   const owners=block.entryId?[block.entryId]:stages.get(block.handlerId)||(entries.has(block.handlerId)?[block.handlerId]:[]);
   cases.push({start:clause.getStart(parsed),end:clause.end,owners});
  }
  ts.forEachChild(node,visit);
 }
 visit(parsed);
 const bodies=codeBodies(artifact),points=decode(map),counts={singleEntryHint:0,sharedEntryHint:0,generatedControlHint:0,unknownOrigin:0},located=new Set();
 for(const point of points){
  assert.ok(point.offset<=artifact.length);
  if(!bodies.some(body=>point.offset>=body.start&&point.offset<body.end))continue;
  let region;
  if(point.source!==null&&/^(?:canonical-native|fastly-native-platform-capabilities)\.as\.ts$/.test(map.sources[point.source])){
   const starts=parsed.getLineStarts();if(point.line<starts.length){const pos=starts[point.line]+point.column;region=cases.find(row=>pos>=row.start&&pos<row.end);}
  }
  const label=!region?'unknownOrigin':!region.owners.length?'generatedControlHint':region.owners.length===1?'singleEntryHint':'sharedEntryHint';
  counts[label]++;if(region)region.owners.forEach(id=>located.add(id));
 }
 return {locationAnchors:counts,entriesWithCaseLocations:[...located],exactExclusiveBytes:null,exactSharedBytes:null,
  exactGeneratedBytes:null,byteOwnership:'unknown-source-locations-are-not-owner-sets'};
}
module.exports={reader,stripMap,codeBodies,decode,locate};
