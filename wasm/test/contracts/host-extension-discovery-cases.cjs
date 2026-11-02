'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { recognizeProjectPackageOperations, lowerCanonicalPackageOperations } = require('../../packages/compiler/src/spine/package-operation-seam');
const { buildReachableProjectGraph } = require('../../packages/compiler/src/project/reachable-graph-builder');
const host = require('../../packages/contracts/src/provider/toolchain').hostExtensions;
module.exports = function(template, target) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'pulse-host-extension-discovery-'));
  const name='@external-fixture/transport', contractId='external-fixture.transport';
  const pkg=path.join(root,'node_modules',name);
  function write(directory,file,data) { const filename=path.join(directory,file);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,typeof data==='string'?data:JSON.stringify(data)); }
  try {
    write(pkg,'package.json',{name,version:'37.4.2',type:'module',exports:'./index.js',pulse:{contract:'./pulse.package.json'},pulsewasm:{manifest:'./pulsewasm.manifest.cjs'}});
    const product=JSON.parse(JSON.stringify(require('../../../packages/grip/pulse.package.json')).replaceAll('@pulse-compute/grip',name).replaceAll('pulse.grip',contractId));
    product.authoring={namespace:'transport',import:name,symbols:['transfer']};
    product.description='Independent host contribution fixture';
    product.targets.native.lowerableSubpath=name;product.targets.native.providerRequirements=[];product.lowering.trust='build-dependency';
    product.targets.javascript.entry='./index.js';product.conformance.semanticCases=['transport.transfer'];
    fs.mkdirSync(path.join(pkg,'conformance'));write(pkg,'README.md','Independent host contribution fixture.');
    write(pkg,'pulse.package.json',product);
    const manifest={version:'pulsewasm.lowerable-library-manifest.v2',kind:'pulsewasm.lowerable-library-manifest',contractId,npmPackage:name,lowerableSubpath:name,
      facade:{namespace:'transport',import:name,symbols:['transfer']},publicApi:{package:name,symbols:['transfer']},
      compiler:{version:'pulsewasm.lowerable-compiler-builder.v1',entry:'./builder.cjs',export:'build',builderOwner:name,trust:'build-dependency'},
      modes:{typescript:{entry:'./index.js'},jsEngine:{entry:'./index.js'},wasm:{mode:'wasm-sidecar',sidecar:'./support.as.ts',hostCapabilities:[],lowerings:[{tsSymbol:'transport.transfer',asSymbol:'__outside_handoff',hostCapabilities:[]}]}}};
    write(pkg,'pulsewasm.manifest.cjs','module.exports='+JSON.stringify(manifest));
    write(pkg,'index.js','export function transfer() { throw Error("not implemented for this host"); }');
    write(pkg,'support.as.ts','// generated contribution owns the host binding\n');
    const artifact=structuredClone(template);
    Object.assign(artifact,{package:name,contractId,id:name+':transfer'});artifact.data.operation='transfer';
    write(pkg,'contributions.json',[artifact]);
    write(pkg,'builder.cjs',`exports.build = input => {
      const fs=require('node:fs'),path=require('node:path'),ts=input.typescript,source=input.sourceFile,effects=[];
      function visit(node) { if(ts.isCallExpression(node)&&node.expression.getText(source)==='transfer') {
        const offset=node.getStart(source),p=source.getLineAndCharacterOfPosition(offset);
        effects.push({version:'pulse.canonical-package-effect.v1',contractId:${JSON.stringify(contractId)},package:${JSON.stringify(name)},import:${JSON.stringify(name)},
          kind:'host.extension',providerKind:'host-extension',operation:'transfer',capability:'host.extension',providerRequirements:['host.extension'],result:'host-terminal',placement:'return',
          range:{start:offset,end:node.getEnd()},loc:{file:source.fileName,start:{line:p.line+1,column:p.character+1,offset}},resource:{kind:'literal',value:'fanout'},payload:{}});
      } ts.forEachChild(node,visit); } visit(source);
      return {artifact:{version:'outside.builder.v9',status:'ok',contractId:${JSON.stringify(contractId)},package:${JSON.stringify(name)}},canonicalEffects:effects,
        realizationArtifacts:effects.length?JSON.parse(fs.readFileSync(path.join(__dirname,'contributions.json'),'utf8')):[],diagnostics:[],hasErrors:false};
    };`);
    write(root,'app.ts',`import { transfer } from '${name}';\nexport default async function handler(ctx) { return transfer('fanout'); }\n`);
    const entry = path.join(root,'app.ts');
    const graph = buildReachableProjectGraph(entry, {rootDir:root,workspaceRoot:root});
    const recognize = () => recognizeProjectPackageOperations(entry, {rootDir:root,workspaceRoot:root,
      packageDirs:[pkg],selectedContracts:graph.packageReachability.selectedContracts});
    const recognized = recognize();
    assert.deepEqual(recognized.selectedContracts,[contractId]);
    assert.equal(recognized.operations.length,1);
    assert.equal(recognized.realizationArtifacts[0].id,name+':transfer');
    const effects = recognized.operations.map(op => op.canonicalEffect);
    const bundle = lowerCanonicalPackageOperations(recognized);
    assert.deepEqual(bundle.realizationArtifacts, recognized.realizationArtifacts);
    assert(bundle.requiredProviderCapabilities.includes('host.extension'));
    const selected = host.select(effects,bundle.realizationArtifacts,target);
    assert.equal(selected[0].package,name);
    assert.equal(selected[0].data.operation,'transfer');
    assert.equal(recognized.policy.externalRegistration,false);
    const overlap=structuredClone(artifact);overlap.id+='-overlap';
    for(const artifacts of [[artifact,overlap],[overlap,artifact]]) {
      write(pkg,'contributions.json',artifacts);
      const recognized = recognize();
      assert.throws(() => host.select(effects,recognized.realizationArtifacts,target), error => error.code === 'PULSE_HOST_EXTENSION_CONFLICT');
    }
    write(pkg,'contributions.json',[{...artifact,contractId:'forged.owner'}]);
    assert.throws(recognize, /owner|authority|contribution/i);
    // Independently bumped npm version remains compatible with the same protocol.
    const packageJson=JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8'));
    write(pkg,'package.json',{...packageJson,version:'91.0.0'});
    write(pkg,'contributions.json',[artifact]);
    assert.equal(recognize().realizationArtifacts[0].id,artifact.id);
    // Lowerer code stays package-contained; neither lexical nor symlink escapes
    // may redirect its declared builder to a file outside the package.
    const {loadLowerableCompilerBuilder}=require('../../packages/library-kit/src/compiler/handler-library-contracts');
    const {discoverLowerableLibraryManifests}=require('../../packages/library-kit/src/compiler/handler-library-contracts');
    const record=discoverLowerableLibraryManifests({cwd:root,workspaceRoot:root,packageDirs:[pkg]})[0];
    write(root,'outside.cjs','throw Error("escaped builder executed");');
    assert.throws(()=>loadLowerableCompilerBuilder({...record,manifest:{...manifest,compiler:{...manifest.compiler,entry:'../../../outside.cjs'}}}),/package-relative/);
    fs.symlinkSync(path.join(root,'outside.cjs'),path.join(pkg,'escape.cjs'));
    assert.throws(()=>loadLowerableCompilerBuilder({...record,manifest:{...manifest,compiler:{...manifest.compiler,entry:'./escape.cjs'}}}),/inside its package/);
    console.log('ok - P15 graph-selected external package at independent npm versions, owned carrier, admission conflicts and builder containment');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
};
