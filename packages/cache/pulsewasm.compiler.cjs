'use strict';
const {normalizeDiagnostic,sourceLoc}=require('@pulse-compute/wasm-contracts/diagnostics');
const {CANONICAL_PACKAGE_EFFECT_VERSION}=require('@pulse-compute/wasm-contracts/handler/canonical-runtime');
function buildCacheLoweringPlan(input={}) {
 const ts=input.typescript,source=input.sourceFile,aliases=new Set(),diagnostics=[],effects=[];
 const error=(node,message)=>diagnostics.push(normalizeDiagnostic({phase:'cache-lowering',severity:'error',code:'PULSEWASM_CACHE_CONTRACT',message,hint:'Use direct awaited cache.getText/putText with literal key, text and bounds.',loc:sourceLoc(source,node)}));
 for(const s of source.statements)if(ts.isImportDeclaration(s)&&s.moduleSpecifier.text==='@pulse-compute/cache'){
  const n=s.importClause?.namedBindings;
  if(!n||!ts.isNamedImports(n)){error(s,'Import the named cache facade.');continue;}
  for(const e of n.elements)if((e.propertyName||e.name).text==='cache')aliases.add(e.name.text);else error(e,'Only cache is lowerable.');
 }
 function visit(node){
  if(ts.isIdentifier(node)&&aliases.has(node.text)&&!ts.isImportSpecifier(node.parent)){
   const a=node.parent;if(!ts.isPropertyAccessExpression(a)||a.expression!==node||!ts.isCallExpression(a.parent)||a.parent.expression!==a)error(node,'Cache facade cannot escape or be aliased.');
  }
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&aliases.has(node.expression.expression.text)){
   const method=node.expression.name.text,put=method==='putText';
   if(!['getText','putText'].includes(method)){error(node,'Unknown cache operation.');return;}
   let fn=node.parent;while(fn&&!ts.isArrowFunction(fn)&&!ts.isFunctionExpression(fn)&&!ts.isFunctionDeclaration(fn))fn=fn.parent;
   const ctx=fn?.parameters[0]?.name;
   if(ctx&&aliases.has(ctx.text)){error(ctx,'Context cannot shadow the cache facade.');return;}
   if(node.arguments.length!==(put?4:3)||!ctx||!ts.isIdentifier(ctx)||!ts.isIdentifier(node.arguments[0])||node.arguments[0].text!==ctx.text){error(node,'Cache requires the current context and exact operation arguments.');return;}
   const key=node.arguments[1],text=put?node.arguments[2]:null,opts=node.arguments[put?3:2];
   if(!ts.isStringLiteralLike(key)||Buffer.byteLength(key.text)<1||Buffer.byteLength(key.text)>4096||!validUnicode(key.text)||put&&(!ts.isStringLiteralLike(text)||Buffer.byteLength(text.text)>1048576||!validUnicode(text.text))){error(node,'Cache keys (1..4096 UTF-8 bytes) and text (0..1 MiB) must be valid Unicode literals.');return;}
   const field=put?'ttlMs':'maxBytes';
   if(!ts.isObjectLiteralExpression(opts)||opts.properties.length!==1){error(opts,'Exactly one literal '+field+' option is required.');return;}
   const prop=opts.properties[0];
   if(!ts.isPropertyAssignment(prop)||(prop.name.text!==field)||!ts.isNumericLiteral(prop.initializer)){error(opts,'Invalid cache options.');return;}
   const bound=Number(prop.initializer.text);
   if(!Number.isSafeInteger(bound)||bound<1||bound>(put?86400000:1048576)){error(opts,'Cache bound is out of range.');return;}
   let placement='';const parent=node.parent;
   if(ts.isAwaitExpression(parent)&&ts.isVariableDeclaration(parent.parent))placement='variable';
   if(ts.isPropertyAssignment(parent)&&ts.isObjectLiteralExpression(parent.parent)){const c=parent.parent.parent;if(ts.isCallExpression(c)&&ts.isPropertyAccessExpression(c.expression)&&c.expression.expression.text===ctx.text&&c.expression.name.text==='parallel'&&ts.isAwaitExpression(c.parent))placement='statement';}
   if(!placement){error(node,'Await into a const local or a direct keyed ctx.parallel member.');return;}
   effects.push({version:CANONICAL_PACKAGE_EFFECT_VERSION,contractId:'pulse.cache',package:'@pulse-compute/cache',import:'@pulse-compute/cache',kind:'cache.'+method,capability:'cache.'+method,providerKind:'cache',operation:method,result:'json',placement,range:{start:node.getStart(source),end:node.getEnd()},resource:{kind:'literal',value:key.text},payload:{key:key.text,[field]:bound,...(put?{text:text.text}:{})},runtimeInputs:[],providerRequirements:['cache.'+method],schemaReferences:[],redaction:['key','text'],loc:sourceLoc(source,node)});return;
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
 return {artifact:{version:'pulse.cache-lowering-plan.v1',contractId:'pulse.cache',package:'@pulse-compute/cache',lowerableSubpath:'@pulse-compute/cache',status:diagnostics.length?'error':'ok',canonicalEffects:effects},canonicalEffects:effects,diagnostics,hasErrors:diagnostics.length>0};
}
function validUnicode(s){for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const d=s.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;}
module.exports={buildCacheLoweringPlan};
