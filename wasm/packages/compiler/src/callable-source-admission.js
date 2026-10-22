'use strict';
// Private source admission; caller expressions still pass ordinary lowering.
const ts = require('typescript');
const { projectFunctionResolver } = require('./project/router-module-linker');
const { compileCallable } = require('./canonical-callable');
const { createHash } = require('node:crypto');

// Original authored coordinates, retained only in the observational source
// collection. Adapted computation coordinates are not authored source maps.
function reportSource(node, sf, file) {
  const position = offset => { const p = sf.getLineAndCharacterOfPosition(offset);
    return { offset, line: p.line + 1, column: p.character + 1 }; };
  return { file, sha256: createHash('sha256').update(sf.text).digest('hex'),
    start: position(node.getStart(sf)), end: position(node.getEnd()) };
}

class CallableSourceAdmissionError extends Error {
  constructor(code, message, node, sourceFile, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CallableSourceAdmissionError';
    this.code = code;
    const point = node ? sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)) : {line:0,character:0};
    this.diagnostics = [{ code, severity:'error', message, file:sourceFile.fileName,
      position:{line:point.line+1,column:point.character+1} }];
  }
}

function admitCallableSource(graphBuild, { schemaBundle, binaryResources, resolver = projectFunctionResolver(graphBuild), entry = resolver.entry, parameterCount = 1, contextIndex = 0 } = {}) {
  if (!entry || entry.packageSource || !ts.isFunctionLike(entry.functionNode)) {
    throw new CallableSourceAdmissionError('PULSE_CALL_SOURCE_ENTRY',
      'Callable source admission requires a selected project handler.',undefined,{fileName:graphBuild.entryKey});
  }
  const fn = entry.functionNode, sf = entry.sourceFile;
  const fail = (code, message, node = fn, cause) => { throw new CallableSourceAdmissionError(code,message,node,sf,cause); };
  if (!fn.body || fn.parameters.length !== parameterCount || !fn.parameters[contextIndex] || !ts.isIdentifier(fn.parameters[contextIndex].name)
    || fn.parameters[contextIndex].dotDotDotToken || fn.parameters[contextIndex].initializer || fn.parameters[contextIndex].questionToken) {
    fail('PULSE_CALL_SOURCE_CONTEXT', 'Expected a simple context parameter at the selected caller position.');
  }
  const ctxName = fn.parameters[contextIndex].name.text;
  const sites = [], callees = new Map();
  function bindingContains(node, name) {
    if (!node) return false;
    if (ts.isIdentifier(node)) return node.text === name;
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      return node.elements.some(e => ts.isBindingElement(e) && bindingContains(e.name,name));
    }
    return false;
  }
  // Match ordinary helper admission's conservative unshadowed-binding policy,
  // including destructured declarations and writes to the context/target.
  function shadowedOrWritten(name) {
    let found = false;
    function visit(node) {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && bindingContains(node.name,name)) found=true;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        function lhs(n) { if(ts.isIdentifier(n) && n.text===name)found=true; ts.forEachChild(n,lhs); }
        lhs(node.left);
      }
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && [ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator)
        && ts.isIdentifier(node.operand) && node.operand.text===name) found=true;
      ts.forEachChild(node,visit);
    }
    visit(fn.body);
    return found;
  }
  function schemaPair(node) {
    if (!node || !ts.isObjectLiteralExpression(node)) fail('PULSE_CALL_SOURCE_SCHEMAS','Call schemas must be a literal object.',node || fn);
    const values = new Map();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        || !ts.isStringLiteral(property.initializer) || !['inputSchema','outputSchema'].includes(property.name.text)
        || values.has(property.name.text)) fail('PULSE_CALL_SOURCE_SCHEMAS','Expected unique literal inputSchema/outputSchema IDs.',property);
      values.set(property.name.text,property.initializer.text);
    }
    if (values.size !== 2) fail('PULSE_CALL_SOURCE_SCHEMAS','Both schema IDs are required.',node);
    for (const id of values.values()) if (!schemaBundle?.registry?.schemas?.some(s=>s.id===id)) {
      fail('PULSE_CALL_SOURCE_SCHEMA_UNKNOWN',`Unknown callable schema ${id}.`,node);
    }
    return Object.fromEntries(values);
  }
  function visit(node, nested = false, inLoop = false, inCall = false) {
    let recognizedCall = false;
    if (ts.isCallExpression(node)) {
      const access = node.expression;
      const receiver = (ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) && access.expression;
      if (receiver && ts.isIdentifier(receiver) && receiver.text === ctxName
        && (ts.isElementAccessExpression(access) || access.name.text === 'call')) {
        recognizedCall = true;
        if (!ts.isPropertyAccessExpression(access) || node.questionDotToken || access.questionDotToken || node.typeArguments?.length
          || node.arguments.length !== 3 || node.arguments.some(ts.isSpreadElement) || !ts.isIdentifier(node.arguments[0])) {
          fail('PULSE_CALL_SOURCE_FORM','Expected ctx.call(identifier, input, literalSchemas).',node);
        }
        let wrapped = node;
        while (wrapped.parent && (ts.isParenthesizedExpression(wrapped.parent) || ts.isAsExpression(wrapped.parent)
          || ts.isTypeAssertionExpression(wrapped.parent) || ts.isNonNullExpression(wrapped.parent) || ts.isSatisfiesExpression(wrapped.parent))) wrapped=wrapped.parent;
        if (nested || inLoop || inCall || ts.isAwaitExpression(wrapped.parent)) fail('PULSE_CALL_SOURCE_PLACEMENT','Calls must be synchronous in the entry body, outside loops, nested calls and nested functions.',node);
        if (sites.length >= 16) fail('PULSE_CALL_SOURCE_LIMIT','At most 16 source call sites are admitted.',node);
        const targetName = node.arguments[0].text;
        if (shadowedOrWritten(ctxName) || shadowedOrWritten(targetName)) fail('PULSE_CALL_SOURCE_BINDING','Context and target references must be unshadowed and unwritten.',node);
        const target = resolver.resolve(entry.modulePath,targetName);
        if (!target?.imported || target.packageSource || target.modulePath === entry.modulePath
          || !ts.isFunctionDeclaration(target.functionNode) || !target.functionNode.name
          || target.functionNode.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)) {
          fail('PULSE_CALL_SOURCE_TARGET','Expected an imported named synchronous project function.',node.arguments[0]);
        }
        const pair = schemaPair(node.arguments[2]);
        let callee = callees.get(target.identity);
        if (callee && (callee.inputSchema!==pair.inputSchema || callee.outputSchema!==pair.outputSchema)) {
          fail('PULSE_CALL_SOURCE_SCHEMA_CONFLICT','A target must use one consistent schema pair.',node);
        }
        if (!callee) {
          if (callees.size >= 16) fail('PULSE_CALL_SOURCE_TARGET_LIMIT','At most 16 resolved targets are admitted.',node);
          let plan, reportHelpers;
          try {
            const composition = require('./project/callable-composition').composeCallable(target, resolver);
            reportHelpers = composition.helpers.map(helper => ({ name: helper.source.name,
              source: reportSource(helper.functionNode, helper.sourceFile, helper.source.file) }));
            plan=compileCallable(composition.source,{...pair,schemaBundle,binaryResources,fileName:target.modulePath,helpers:composition.helpers});
          }
          catch (error) { fail('PULSE_CALL_SOURCE_CALLEE','Callee failed ordinary computation admission.',node.arguments[0],error); }
          callee=Object.freeze({identity:target.identity,modulePath:target.modulePath,name:target.name,...pair,plan,
            reportSource: reportSource(target.functionNode, target.sourceFile, target.modulePath), reportHelpers });
          callees.set(target.identity,callee);
        }
        const point=sf.getLineAndCharacterOfPosition(node.getStart(sf));
        sites.push(Object.freeze({target:target.identity,localName:targetName,...pair,source:{file:entry.modulePath,line:point.line+1,column:point.character+1},
          reportSource: reportSource(node, sf, entry.modulePath), caller: entry.identity,
          callNode:node,argumentNode:node.arguments[1]}));
      }
    }
    const childNested=nested || ts.isFunctionLike(node);
    const childLoop=inLoop || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
    ts.forEachChild(node,child=>visit(child,childNested,childLoop,inCall || recognizedCall));
  }
  visit(fn.body);
  const recognized = new Set(sites.map(site => site.callNode.expression));
  let usesCall = false;
  function checkReference(node) {
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && ts.isIdentifier(node.expression) && node.expression.text === ctxName
      && (ts.isPropertyAccessExpression(node) ? node.name.text === 'call'
        : ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'call')) {
      usesCall = true;
      if (!recognized.has(node)) fail('PULSE_CALL_SOURCE_FORM', 'Computation calls require direct static ctx.call sites.', node);
    }
    ts.forEachChild(node, checkReference);
  }
  checkReference(fn.body);
  if (usesCall) {
    const checkContext = node => {
      if (ts.isIdentifier(node) && node.text === ctxName
        && !((ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node)
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
        fail('PULSE_CALL_SOURCE_BINDING', 'A callable context cannot escape through aliases or arguments.', node);
      }
      ts.forEachChild(node, checkContext);
    };
    checkContext(fn.body);
  }
  // An unreferenced named project function import cannot contribute executable
  // behavior. Resolve it with the ordinary linker, but never compile its body.
  // Other imports/references retain ordinary strict import validation.
  for (const module of resolver.modules) for (const statement of module.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      let referenced = false;
      function reference(node) {
        if (node === statement || ts.isTypeNode(node)) return;
        if (ts.isIdentifier(node) && node.text === binding.name.text) referenced = true;
        ts.forEachChild(node, reference);
      }
      reference(module.sourceFile);
      if (!referenced) resolver.resolve(module.modulePath, binding.name.text);
    }
  }
  return Object.freeze({version:'pulse.call-source-admission.v1',callerValidated:false,runtimeWired:false,
    entry:entry.identity,consumedRuntimeImports:resolver.consumedRuntimeImports(),
    callees:Object.freeze([...callees.values()]),callSites:Object.freeze(sites)});
}

module.exports = { admitCallableSource, CallableSourceAdmissionError };
