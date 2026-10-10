'use strict';
// Evidence-only, opt-in experiment. No production caller imports this module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { prepare, build, execute, loadObserved, chunkSymbols } = require('../../../wasm/test/cli/assert-report-entry-proof.cjs');
const { collectCanonicalReportReferences } = require('../../../wasm/packages/compiler/src/canonical-native-plan');

function prototypeControl() {
  return loadObserved('wasm/packages/runtime-core-as/src/compiler/canonical-native-control.js', (_id, value) => value, source => {
    // Deliberately fail if the owning layout changes; never silently test a no-op.
    const before = 'chunk[0].handlerId !== item.handlerId || chunk.length >= maxChunkStates';
    assert.equal(source.split(before).length, 2);
    return source.replace(before, 'chunk[0].handlerId !== item.handlerId || (!item.handlerId && blocks[chunk[0].id].entryId !== item.entryId) || chunk.length >= maxChunkStates');
  });
}

function inspect(result, target, entryIds) {
  const { artifact, layout, control, generated, capture } = result;
  assert.equal(layout.partitioned, true);
  const symbols = chunkSymbols(generated.source, layout);
  const prefix = target === 'portable' ? 'canonical-native.as/' : 'fastly-native-platform-capabilities.as/';
  const rows = layout.chunks.map((chunk, index) => {
    const blocks = chunk.map(row => control.blocks[row.id]);
    const owners = [...new Set(blocks.map(row => row.entryId || null))];
    const emitted = capture.functions.find(row => row.name === prefix + symbols[index]);
    const mapping = artifact.reportAttribution.chunkMappings.find(row => row.chunk === index);
    assert.equal(mapping.functionIndex, emitted?.index ?? null);
    assert.equal(generated.manifest.reportOwnership.bodies[index].symbol, symbols[index]);
    return { chunk:index, owners, functionIndex:emitted?.index ?? null, bytes:emitted?.bytes ?? null };
  });
  const entries = entryIds.map(entryId => {
    const selected = rows.filter(row => row.owners.includes(entryId));
    assert.ok(selected.length, 'every continuing entry has observed control states');
    // Include unowned control states as a reason to reject isolation. A single
    // observed consumer by itself is insufficient evidence of exclusive code.
    const isolated = selected.every(row => row.owners.length === 1 && row.functionIndex !== null
      && rows.filter(other => other.functionIndex === row.functionIndex).every(other => other.owners.length === 1 && other.owners[0] === entryId));
    const physical = new Map(selected.filter(row => row.functionIndex !== null).map(row => [row.functionIndex,row.bytes]));
    const rootIndices=new Set(physical.keys());
    const externalCallees=capture.graph.status==='available' ? [...new Set(capture.graph.edges
      .filter(edge=>rootIndices.has(edge.caller) && !rootIndices.has(edge.callee))
      .map(edge=>edge.callee))] : null;
    return { entryId, externalDirectCallees:externalCallees?.length ?? null, chunks:selected.length, mapped:selected.filter(row => row.functionIndex !== null).length,
      mixedChunks:selected.filter(row => row.owners.length !== 1).length,
      isolatedControlBodies:isolated, controlBodyBytes:isolated ? [...physical.values()].reduce((a,b)=>a+b,0) : null };
  });
  return { artifactSha256:capture.artifactSha256, graphStatus:capture.graph.status, artifactBytes:artifact.wasm.length, codeBodyBytes:capture.functions.reduce((sum,row)=>sum+row.bytes,0),
    chunks:rows.length, continuingEntries:entries.length, isolatedControlEntries:entries.filter(row=>row.isolatedControlBodies).length,
    missingMappings:rows.filter(row=>row.functionIndex===null).length, entries };
}

async function main() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-rpt815-'));
  try {
    const {compiled,plan}=prepare(), planBefore=JSON.stringify(plan), cells=[];
    const entries=collectCanonicalReportReferences(compiled,plan).routeBehaviors.filter(row=>row.kind==='continuing').map(row=>row.entryId);
    assert.equal(entries.length,2);
    const control=prototypeControl();
    for (const [target,optimization] of [['portable',undefined],['fastly',undefined],
      ['portable','experimental-native-bounded-size'],['fastly','experimental-native-bounded-size']]) {
      console.error('RPT8-15: '+target+' / '+(optimization||'default'));
      const start=performance.now();
      const baseline=build(plan,target,true,optimization,directory);
      const baselineMs=performance.now()-start;
      const splitStart=performance.now();
      const split=build(plan,target,true,optimization,directory,control);
      const splitMs=performance.now()-splitStart;
      assert.deepEqual(split.recipe,baseline.recipe,'same optimization and observer recipe');
      assert.deepEqual(split.control.blocks,baseline.control.blocks,'only layout changes; program counters and control states stay identical');
      assert.notEqual(split.artifact.source,baseline.artifact.source,'prototype must affect generated layout');
      const before=inspect(baseline,target,entries),after=inspect(split,target,entries);
      assert.equal(before.isolatedControlEntries,0,'baseline cannot isolate these entries');
      assert.equal(after.isolatedControlEntries,entries.length,'prototype isolates each continuing entry’s control bodies');
      assert.equal(after.missingMappings,0,'all prototype chunk declarations survive final optimization');
      const requests=await execute(baseline.artifact,target)+await execute(split.artifact,target);
      cells.push({target,optimization:optimization||'default',baseline:before,prototype:after,
        artifactDeltaBytes:after.artifactBytes-before.artifactBytes,
        artifactDeltaPercent:Number(((after.artifactBytes/before.artifactBytes-1)*100).toFixed(3)),
        compileMs:{baseline:Math.round(baselineMs),prototype:Math.round(splitMs)},requests});
    }
    assert.equal(JSON.stringify(plan),planBefore);
    console.log(JSON.stringify({status:'passed',fixture:'transfer-router',cells,
      decision:{entryControlBodyFeasibility:'go-on-bounded-fixture',productionPromotion:'no-go-without-follow-up-qualification'},
      scope:'Entry-specific control bodies only: shared expression/guard/runtime functions remain outside these bodies. No isolated full-handler-byte claim; no production change.'},null,2));
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
