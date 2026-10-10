'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {inspectWasm}=require('../../../wasm/packages/build-support/src/wasm-evidence');
const {appendAssemblyScriptOptimizationArgs}=require('../../../wasm/packages/build-support/src/native-optimization');
const {reader,stripMap,codeBodies,decode}=require('./locations.cjs');
function exportsByName(bytes){const section=inspectWasm(bytes).sections.find(row=>row.id===7),r=reader(bytes,section.offset+1);r.uint();const n=r.uint(),out=new Map();for(let i=0;i<n;i++){const name=r.text(),kind=bytes[r.at++],index=r.uint();if(kind===0)out.set(name,index);}return out;}
function counterexample(directory){
 const source='export function left(value:i32):i32 { return value + 7; }\n'
  +'export function right(value:i32):i32 { return value + 7; }\n'
  +'export function eliminated(value:i32):i32 {\n  if (false) return value * 991;\n  return value + 3;\n}\n';
 fs.writeFileSync(path.join(directory,'alias.ts'),source);
 const asc=path.join(path.dirname(require.resolve('assemblyscript/package.json',{paths:[path.resolve(__dirname,'../../../wasm')]})),'bin/asc.js');
 function compile(mapped){const output=path.join(directory,mapped?'mapped.wasm':'baseline.wasm');
  const args=[asc,'alias.ts','--runtime','stub','--noAssert','--optimize','--outFile',output];
  appendAssemblyScriptOptimizationArgs(args,'experimental-native-bounded-size');
  if(mapped)args.push('--sourceMap','rpt817.map');
  execFileSync(process.execPath,args,{cwd:directory,timeout:30000,stdio:'pipe'});return fs.readFileSync(output);
 }
 const baseline=compile(false),mapped=compile(true),stripped=stripMap(mapped);
 assert.deepEqual(stripped.bytes,baseline);
 const exports=exportsByName(mapped),bodies=codeBodies(mapped),body=bodies.find(row=>row.index===exports.get('left'));
 assert.equal(exports.get('left'),exports.get('right'),'two distinct source owners share one optimized body');
 const sourceMap=JSON.parse(fs.readFileSync(path.join(directory,'rpt817.map'),'utf8')),points=decode(sourceMap);
 const lines=[...new Set(points.filter(row=>row.offset>=body.start&&row.offset<body.end&&row.source!==null).map(row=>row.line))];
 assert.equal(lines.length,1,'existing metadata retains only one representative source line');
 assert.ok(lines[0]===0||lines[0]===1);
 assert.ok(!points.some(row=>row.source!==null&&row.line===3),'eliminated expression has no location anchors');
 const instance=new WebAssembly.Instance(new WebAssembly.Module(stripped.bytes));
 assert.equal(instance.exports.left(5),12);assert.equal(instance.exports.right(5),12);assert.equal(instance.exports.eliminated(5),8);
 // Source maps are point mappings, not ownership ranges. Keep missing origins
 // unknown instead of treating the sole representative as an exclusive owner.
 return {byteIdentical:true,mergedSourceOwners:2,physicalBodiesForPair:1,representedSourceOwners:lines.length,
  eliminatedBranchHasAnchors:false,exactExclusiveOwnershipProven:false,sourceMapAloneSufficient:false};
}
module.exports={counterexample};
