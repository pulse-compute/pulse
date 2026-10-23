'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileCanonicalProject, packageRealizationArtifactsForCompiled } = require('../../packages/compiler/src/canonical-project-compiler');
const { buildCanonicalNativePlan } = require('../../packages/compiler/src/canonical-native-plan');
const platform = require('../../../packages/provider-fastly/src/build/native-platform-capabilities');
const target = require('../../../packages/provider-fastly/src/toolchain').createDriver().targets.native;
module.exports = function(template) {
  const root = fs.mkdtempSync(path.join(__dirname,'.hex02-external-'));
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
      modes:{typescript:{entry:'./index.js'},jsEngine:{entry:'./index.js'},wasm:{mode:'wasm-sidecar',sidecar:'./support.as.ts',hostCapabilities:[],lowerings:[{tsSymbol:'transport.transfer',asSymbol:'__grip_fanout',hostCapabilities:[]}]}}};
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
          kind:'host.extension',providerKind:'host-extension',operation:'transfer',capability:'host.extension',result:'host-terminal',placement:'return',
          range:{start:offset,end:node.getEnd()},loc:{file:source.fileName,start:{line:p.line+1,column:p.character+1,offset}},resource:{kind:'literal',value:'fanout'},payload:{}});
      } ts.forEachChild(node,visit); } visit(source);
      return {artifact:{version:'outside.builder.v9',status:'ok',contractId:${JSON.stringify(contractId)},package:${JSON.stringify(name)}},canonicalEffects:effects,
        realizationArtifacts:effects.length?JSON.parse(fs.readFileSync(path.join(__dirname,'contributions.json'),'utf8')):[],diagnostics:[],hasErrors:false};
    };`);
    write(root,'app.ts',`import { transfer } from '${name}';\nexport default async function handler(ctx) { return transfer('fanout'); }\n`);
    const compile=()=>compileCanonicalProject(path.join(root,'app.ts'),{rootDir:root,workspaceRoot:root,target:'native',packageTargetDescriptor:target});
    const compiled=compile();
    assert.deepEqual(compiled.packageReachability.selectedContracts,[contractId]);
    const native=platform.compileFastlyNativePlatformCapabilitiesPlan(buildCanonicalNativePlan(compiled),{cwd:path.resolve(__dirname,'../../..'),canonicalBuild:true,
      bindings:{backends:{fanout:'fanout_backend'}},realizationArtifacts:packageRealizationArtifactsForCompiled(compiled)});
    assert.equal(native.manifest.hostExtensions[0].package,name);
    assert.equal(native.manifest.hostExtensions[0].operation,'transfer');
    const run=require('../../../docs/internal/host-extensions/injected-host.cjs').execute(native);
    assert.equal(run.state,3);assert.equal(run.trace.length,1);assert.equal(run.trace[0].call,'handoff');
    const overlap=structuredClone(artifact);overlap.id+='-overlap';
    for(const artifacts of [[artifact,overlap],[overlap,artifact]]) {
      write(pkg,'contributions.json',artifacts);
      assert.throws(compile,error=>{assert.equal(error.code,'PULSE_HOST_EXTENSION_CONFLICT');assert.equal(error.detail.loc.start.line,2);return true;});
    }
    // Lowerer code stays package-contained; neither lexical nor symlink escapes
    // may redirect its declared builder to a file outside the package.
    const {loadLowerableCompilerBuilder}=require('../../packages/library-kit/src/compiler/handler-library-contracts');
    const {discoverLowerableLibraryManifests}=require('../../packages/library-kit/src/compiler/handler-library-contracts');
    const record=discoverLowerableLibraryManifests({cwd:root,workspaceRoot:root,packageDirs:[pkg]})[0];
    write(root,'outside.cjs','throw Error("escaped builder executed");');
    assert.throws(()=>loadLowerableCompilerBuilder({...record,manifest:{...manifest,compiler:{...manifest.compiler,entry:'../../../outside.cjs'}}}),/package-relative/);
    fs.symlinkSync(path.join(root,'outside.cjs'),path.join(pkg,'escape.cjs'));
    assert.throws(()=>loadLowerableCompilerBuilder({...record,manifest:{...manifest,compiler:{...manifest.compiler,entry:'./escape.cjs'}}}),/inside its package/);
    console.log('ok - HEX-02 authored independently versioned external lowerer, injected host execution, conflict location and builder containment');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
};
