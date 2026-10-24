'use strict';
const fs = require('node:fs'), path = require('node:path');
const { root, PACKAGE, CONTRACT, artifacts } = require('./prototype.cjs');
function create(directory) {
  const pkg = path.join(directory, 'node_modules', PACKAGE);
  const write = (base, name, data) => { const file=path.join(base,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='string'?data:JSON.stringify(data,null,2)); };
  const product = JSON.parse(JSON.stringify(require(path.join(root,'packages/grip/pulse.package.json'))).replaceAll('@pulse-compute/grip',PACKAGE).replaceAll('pulse.grip',CONTRACT));
  product.authoring={namespace:'observations',import:PACKAGE,symbols:['snapshot','tls']};
  product.targets.native.providerRequirements=[];product.targets.native.lowerableSubpath=PACKAGE;
  product.lowering.trust='build-dependency'; product.targets.javascript.entry='./index.js';
  product.conformance.semanticCases=['snapshot','tls'];
  write(pkg,'package.json',{name:PACKAGE,version:'0.0.0-spike',type:'module',exports:'./index.js',pulse:{contract:'./pulse.package.json'},pulsewasm:{manifest:'./pulsewasm.manifest.cjs'}});
  write(pkg,'pulse.package.json',product);write(pkg,'README.md','Investigation fixture; not a supported package.');
  fs.mkdirSync(path.join(pkg,'conformance'));
  write(pkg,'index.js','export const metrics = { snapshot() { throw Error("not implemented for this host"); } }; export const downstream = { tls() { throw Error("not implemented for this host"); } };');
  write(pkg,'support.as.ts','// Selected contributions carry source.\n');
  write(pkg,'contributions.json',artifacts());
  write(pkg,'pulsewasm.manifest.cjs','module.exports='+JSON.stringify({version:'pulsewasm.lowerable-library-manifest.v2',kind:'pulsewasm.lowerable-library-manifest',contractId:CONTRACT,npmPackage:PACKAGE,lowerableSubpath:PACKAGE,
    facade:{namespace:'observations',import:PACKAGE,symbols:['snapshot','tls']},publicApi:{package:PACKAGE,symbols:['metrics','downstream']},
    compiler:{version:'pulsewasm.lowerable-compiler-builder.v1',entry:'./builder.cjs',export:'build',builderOwner:PACKAGE,trust:'build-dependency'},
    modes:{typescript:{entry:'./index.js'},jsEngine:{entry:'./index.js'},wasm:{mode:'wasm-sidecar',sidecar:'./support.as.ts',hostCapabilities:[],lowerings:[{tsSymbol:'metrics.snapshot',asSymbol:'__obs_snapshot',hostCapabilities:[]},{tsSymbol:'downstream.tls',asSymbol:'__obs_tls',hostCapabilities:[]}]}}}));
  write(pkg,'builder.cjs',`exports.build = input => {
    const ts=input.typescript,source=input.sourceFile,effects=[];
    function visit(node) {
      if(ts.isCallExpression(node) && ['metrics.snapshot','downstream.tls'].includes(node.expression.getText(source))) {
        if(node.arguments.length!==1 || node.arguments[0].getText(source)!=='ctx') throw Error('This fixture requires the current ctx');
        const operation=node.expression.getText(source).split('.')[1],offset=node.getStart(source),p=source.getLineAndCharacterOfPosition(offset);
        effects.push({version:'pulse.canonical-package-effect.v1',contractId:${JSON.stringify(CONTRACT)},package:${JSON.stringify(PACKAGE)},import:${JSON.stringify(PACKAGE)},kind:'host.extension',providerKind:'host-extension',operation,capability:'host.extension',result:'json',placement:ts.isAwaitExpression(node.parent)&&ts.isVariableDeclaration(node.parent.parent)?'variable':'statement',range:{start:offset,end:node.end},loc:{file:source.fileName,start:{line:p.line+1,column:p.character+1,offset}},payload:{}});
      } ts.forEachChild(node,visit);
    } visit(source);
    return {artifact:{version:'hex.observation-builder.v0',status:'ok',contractId:${JSON.stringify(CONTRACT)},package:${JSON.stringify(PACKAGE)}},canonicalEffects:effects,realizationArtifacts:effects.length?require('./contributions.json'):[],diagnostics:[],hasErrors:false};
  };`);
  return { file: path.join(directory,'app.ts'), write(source) { write(directory,'app.ts',source); } };
}
module.exports = { create };
