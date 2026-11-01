'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const installed=process.argv.includes('--installed');
const rootDir=installed?process.cwd():path.resolve(__dirname,'../../..');
const compiler=file=>require(installed?'@pulse-compute/wasm-compiler/'+file:'../../packages/compiler/src/'+file);
function write(directory,file,data) { const filename=path.join(directory,file);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,typeof data==='string'?data:JSON.stringify(data)); }
module.exports = function fixture({name='@outside/terminal',abi='fixture_terminal',abiName='handoff',operation='transfer',version='37.4.2',productTemplate}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulse-terminal-'));
  const contractId=name.replace('@','').replace('/','.');
  const pkg=path.join(root,'node_modules',name);
  write(pkg,'package.json',{name,version,type:'module',exports:'./index.js',pulse:{contract:'./pulse.package.json'},pulsewasm:{manifest:'./pulsewasm.manifest.cjs'}});
    const product=JSON.parse(JSON.stringify(productTemplate || require('../../../packages/grip/pulse.package.json')).replaceAll('@pulse-compute/grip',name).replaceAll('pulse.grip',contractId));
    product.authoring={namespace:'transport',import:name,symbols:['transfer']};
    product.description='Independent host contribution fixture';
    product.targets.native.lowerableSubpath=name;product.targets.native.providerRequirements=[];product.lowering.trust='build-dependency';
    product.targets.javascript.entry='./index.js';product.conformance.semanticCases=['transport.transfer'];
    write(pkg,'conformance/README.md','Transport transfer conformance is exercised by the installed replay.');write(pkg,'README.md','Independent host contribution fixture.');
    write(pkg,'pulse.package.json',product);
    const manifest={version:'pulsewasm.lowerable-library-manifest.v2',kind:'pulsewasm.lowerable-library-manifest',contractId,npmPackage:name,lowerableSubpath:name,
      facade:{namespace:'transport',import:name,symbols:['transfer']},publicApi:{package:name,symbols:['transfer']},
      compiler:{version:'pulsewasm.lowerable-compiler-builder.v1',entry:'./builder.cjs',export:'build',builderOwner:name,trust:'build-dependency'},
      modes:{typescript:{entry:'./index.js'},jsEngine:{entry:'./index.js'},wasm:{mode:'wasm-sidecar',sidecar:'./support.as.ts',hostCapabilities:[],lowerings:[{tsSymbol:'transport.transfer',asSymbol:'__outside_handoff',hostCapabilities:[]}]}}};
    write(pkg,'pulsewasm.manifest.cjs','module.exports='+JSON.stringify(manifest));
    write(pkg,'index.js','export function transfer() { throw Error("not implemented for this host"); }');
    write(pkg,'support.as.ts','// generated contribution owns the host binding\n');

  const source=`@external("${abi}", "${abiName}") declare function __outside_handoff(request: i32, backend: usize, length: i32): i32\n`;
  const artifact={version:'pulse.host-extension.v1',id:name+':'+operation,kind:'host-extension',mediaType:'text/assemblyscript',package:name,contractId,
    data:{operation,target:{provider:'fastly',target:'native',targetId:'fastly-compute-native'},service:'terminal-request-backend.v1',source,
      sha256:crypto.createHash('sha256').update(source).digest('hex'),entry:'__outside_handoff',imports:[{module:abi,name:abiName,parameters:['i32','i32','i32'],results:['i32']}]}};
  write(pkg,'contributions.json',[artifact]);
  write(pkg,'builder.cjs',`exports.build = input => {
    const fs=require('node:fs'),path=require('node:path'),ts=input.typescript,source=input.sourceFile,effects=[];
    function visit(node) { if(ts.isCallExpression(node)&&node.expression.getText(source)==='transfer') {
      const offset=node.getStart(source),p=source.getLineAndCharacterOfPosition(offset),backend=node.arguments[1];
      effects.push({version:'pulse.canonical-package-effect.v1',contractId:${JSON.stringify(contractId)},package:${JSON.stringify(name)},import:${JSON.stringify(name)},
        kind:'host.extension',providerKind:'host-extension',operation:${JSON.stringify(operation)},capability:'host.extension',providerRequirements:['host.extension'],result:'host-terminal',placement:'return',
        range:{start:offset,end:node.getEnd()},loc:{file:source.fileName,start:{line:p.line+1,column:p.character+1,offset}},resource:backend&&ts.isStringLiteral(backend)?{kind:'literal',value:backend.text}:{kind:'dynamic'},payload:{}});
    } ts.forEachChild(node,visit); } visit(source);
    return {artifact:{version:'outside.builder.v9',status:'ok',contractId:${JSON.stringify(contractId)},package:${JSON.stringify(name)}},canonicalEffects:effects,
      realizationArtifacts:effects.length?JSON.parse(fs.readFileSync(path.join(__dirname,'contributions.json'),'utf8')):[],diagnostics:[],hasErrors:false};
  };`);
  function compile(body="if(ctx.req.path === '/plain') return ctx.text('plain'); return transfer(ctx, 'edge');") {
    write(root,'app.ts',`import { transfer } from '${name}'; export default async function handler(ctx) { ${body} }`);
    const {compileCanonicalProject}=compiler('canonical-project-compiler');
    const {buildCanonicalNativePlan}=compiler('canonical-native-plan');
    const compiled=compileCanonicalProject(path.join(root,'app.ts'),{rootDir:root,workspaceRoot:root,packageDirs:[pkg],requireAsync:true,strict:true,
      applicationProjectMetadata:{selectedProfile:{name:'test',source:'fixture'},strict:true,target:'native',host:'fastly',projectHash:'3'.repeat(64),configPlanHash:'4'.repeat(64),bindings:{config:[],secret:[]},fragments:{}}});
    return {compiled,plan:buildCanonicalNativePlan(compiled),artifact,options:{cwd:rootDir,bindings:{backends:{edge:'edge_backend'}},realizationArtifacts:[artifact],maxDurationMs:1000}};
  }
  return {root,pkg,name,contractId,artifact,compile,write:(file,data)=>write(pkg,file,data),close:()=>fs.rmSync(root,{recursive:true,force:true})};
};
