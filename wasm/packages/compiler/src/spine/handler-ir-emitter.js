'use strict';

const ts = require('typescript');
const { positionFor } = require('./diagnostic-authority.js');
const {
  HANDLER_IR_VERSION,
  ROUTER_HANDLER_IR_KIND
} = require('./handler-ir.js');
const {
  ROUTER_CURSOR_IDENTIFIER: CURSOR,
  ROUTER_MODE_IDENTIFIER: MODE,
  ROUTER_ERROR_IDENTIFIER: ERROR
} = require('./router-control-contract.js');

const HANDLER_IR_EMITTER_VERSION = 'pulse.canonical-handler-ir-emitter.v1';

function literalProperty(factory, name, value) {
  return factory.createPropertyAssignment(factory.createIdentifier(name), value);
}

function stringLiteral(factory, value) {
  return factory.createStringLiteral(String(value));
}

function sourceExpression(factory, sourceFile, node) {
  const pos = positionFor(sourceFile, node);
  return factory.createObjectLiteralExpression([
    literalProperty(factory, 'file', stringLiteral(factory, sourceFile.fileName)),
    literalProperty(factory, 'line', factory.createNumericLiteral(pos.line)),
    literalProperty(factory, 'column', factory.createNumericLiteral(pos.column))
  ], false);
}

function fetchEffectExpression(factory, sourceFile, site, chain) {
  const pos = positionFor(sourceFile, chain.fetchCall);
  const init = chain.init || factory.createIdentifier('undefined');
  const properties = [
    literalProperty(factory, 'kind', stringLiteral(factory, 'fetch')),
    literalProperty(factory, 'id', stringLiteral(factory, site.id))
  ];
  if (site.groupKey !== undefined) properties.push(literalProperty(factory, 'groupKey', stringLiteral(factory, site.groupKey)));
  properties.push(
    literalProperty(factory, 'responseMode', stringLiteral(factory, chain.decoder ? 'structured' : 'opaque')),
    literalProperty(factory, 'projection', stringLiteral(factory, chain.decoder || 'response')),
    literalProperty(factory, 'url', chain.url),
    literalProperty(factory, 'init', init),
    literalProperty(factory, 'source', factory.createObjectLiteralExpression([
      literalProperty(factory, 'file', stringLiteral(factory, sourceFile.fileName)),
      literalProperty(factory, 'line', factory.createNumericLiteral(pos.line)),
      literalProperty(factory, 'column', factory.createNumericLiteral(pos.column))
    ], false))
  );
  return factory.createObjectLiteralExpression(properties, false);
}

function providerEffectExpression(factory, sourceFile, site, providerOperation) {
  const properties = [
    literalProperty(factory, 'kind', stringLiteral(factory, providerOperation.kind)),
    literalProperty(factory, 'id', stringLiteral(factory, site.id))
  ];
  if (site.groupKey !== undefined) properties.push(literalProperty(factory, 'groupKey', stringLiteral(factory, site.groupKey)));
  if (providerOperation.kind === 'config.get' || providerOperation.kind === 'secret.get') {
    properties.push(literalProperty(factory, 'name', providerOperation.name));
  } else if (providerOperation.providerKind === 'kv') {
    properties.push(literalProperty(factory, 'store', providerOperation.store));
    properties.push(literalProperty(factory, 'key', providerOperation.key));
    if (providerOperation.generation) properties.push(literalProperty(factory, 'generation', providerOperation.generation));
    if (providerOperation.value) properties.push(literalProperty(factory, 'value', providerOperation.value));
  } else if (providerOperation.kind === 'event.emit') {
    properties.push(literalProperty(factory, 'type', providerOperation.type));
    properties.push(literalProperty(factory, 'emission', providerOperation.emission));
  }
  properties.push(literalProperty(factory, 'source', sourceExpression(factory, sourceFile, providerOperation.call)));
  return factory.createObjectLiteralExpression(properties, false);
}

function staticValueExpression(factory, value) {
  if (value === undefined) return factory.createIdentifier('undefined');
  if (value === null) return factory.createNull();
  if (typeof value === 'string') return factory.createStringLiteral(value);
  if (typeof value === 'number') return factory.createNumericLiteral(Number.isFinite(value) ? value : 0);
  if (typeof value === 'boolean') return value ? factory.createTrue() : factory.createFalse();
  if (Array.isArray(value)) return factory.createArrayLiteralExpression(value.map((entry) => staticValueExpression(factory, entry)), false);
  if (value && typeof value === 'object') {
    return factory.createObjectLiteralExpression(
      Object.entries(value).map(([key, entry]) => factory.createPropertyAssignment(factory.createStringLiteral(key), staticValueExpression(factory, entry))),
      false
    );
  }
  throw new TypeError(`Unsupported canonical package effect literal: ${typeof value}`);
}

function packageEffectSourceExpression(factory, sourceFile, effect, call) {
  const start = effect && effect.loc && effect.loc.start;
  const file = effect && effect.loc && effect.loc.file;
  if (file && start && String(file).replace(/\\/g, '/') !== String(sourceFile.fileName).replace(/\\/g, '/')) {
    return factory.createObjectLiteralExpression([
      literalProperty(factory, 'file', stringLiteral(factory, String(file).replace(/\\/g, '/'))),
      literalProperty(factory, 'line', factory.createNumericLiteral(Number(start.line || 1))),
      literalProperty(factory, 'column', factory.createNumericLiteral(Number(start.column || 1)))
    ], false);
  }
  return sourceExpression(factory, sourceFile, call);
}

function packageEffectExpression(factory, sourceFile, site, effect, call, rewriteExpression = (expression) => expression) {
  const properties = [
    literalProperty(factory, 'kind', stringLiteral(factory, effect.kind)),
    literalProperty(factory, 'id', stringLiteral(factory, site.id))
  ];
  if (site.groupKey !== undefined) properties.push(literalProperty(factory, 'groupKey', stringLiteral(factory, site.groupKey)));
  properties.push(
    literalProperty(factory, 'package', stringLiteral(factory, effect.package)),
    literalProperty(factory, 'contractId', stringLiteral(factory, effect.contractId)),
    literalProperty(factory, 'providerKind', stringLiteral(factory, effect.providerKind || 'package')),
    literalProperty(factory, 'operation', stringLiteral(factory, effect.operation)),
    literalProperty(factory, 'capability', stringLiteral(factory, effect.capability || effect.kind)),
    literalProperty(factory, 'result', stringLiteral(factory, effect.result || 'value')),
    literalProperty(factory, 'resource', staticValueExpression(factory, effect.resource || {})),
    literalProperty(factory, 'payload', staticValueExpression(factory, effect.payload || {}))
  );
  const runtimeInputs = Array.isArray(effect.runtimeInputs) ? effect.runtimeInputs : [];
  if (runtimeInputs.length > 0) {
    properties.push(literalProperty(
      factory,
      'invocation',
      factory.createObjectLiteralExpression(runtimeInputs.map((input) => {
        const argument = call && call.arguments && call.arguments[Number(input.argumentIndex)];
        return factory.createPropertyAssignment(
          factory.createStringLiteral(String(input.name)),
          rewriteExpression(argument || factory.createIdentifier('undefined'))
        );
      }), false)
    ));
  }
  properties.push(literalProperty(factory, 'source', packageEffectSourceExpression(factory, sourceFile, effect, call)));
  return factory.createObjectLiteralExpression(properties, false);
}

function callPulse(factory, method, args) {
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(factory.createIdentifier('__pulse'), method),
    undefined,
    args
  );
}

function decodedExpression(factory, responseExpression, decoder, decoderArgs = []) {
  if (!decoder) return responseExpression;
  return factory.createCallExpression(factory.createPropertyAccessExpression(responseExpression, decoder), undefined, [...decoderArgs]);
}

function declarationFlags(statement) {
  return statement.declarationList.flags;
}

function parallelMemberEffectExpression(factory, sourceFile, site, member, rewriteExpression) {
  if (member.kind === 'fetch') return fetchEffectExpression(factory, sourceFile, site, member.chain);
  if (member.kind === 'provider') return providerEffectExpression(factory, sourceFile, site, member.operation);
  if (member.kind === 'package') return packageEffectExpression(factory, sourceFile, site, member.effect, member.call, rewriteExpression);
  throw new TypeError(`Unsupported ctx.parallel member kind: ${member.kind}`);
}

function parallelMemberResultExpression(factory, temporary, member) {
  if (member.kind === 'fetch') return decodedExpression(factory, temporary, member.chain.decoder, member.chain.decoderArgs);
  return temporary;
}

function bindingKey(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function parallelResultStatements(factory, candidate, temporaryNames) {
  const binding = candidate.declaration.name;
  if (ts.isObjectBindingPattern(binding)) {
    const memberIndexes = new Map(candidate.members.map((member, index) => [member.key, index]));
    return binding.elements.map((element) => {
      const key = bindingKey(element.propertyName || element.name);
      const index = memberIndexes.get(key);
      if (index === undefined || !ts.isIdentifier(element.name) || element.dotDotDotToken || element.initializer) {
        throw new TypeError('Unsupported ctx.parallel result binding reached canonical emission.');
      }
      const initializer = parallelMemberResultExpression(factory, temporaryNames[index], candidate.members[index]);
      return factory.createVariableStatement(candidate.statement.modifiers, factory.createVariableDeclarationList([
        factory.createVariableDeclaration(element.name, undefined, undefined, initializer)
      ], declarationFlags(candidate.statement)));
    });
  }
  const resultObject = factory.createObjectLiteralExpression(candidate.members.map((member, index) =>
    factory.createPropertyAssignment(
      factory.createStringLiteral(member.key),
      parallelMemberResultExpression(factory, temporaryNames[index], member)
    )), true);
  const declaration = factory.updateVariableDeclaration(
    candidate.declaration,
    candidate.declaration.name,
    undefined,
    candidate.declaration.type,
    resultObject
  );
  return [factory.updateVariableStatement(
    candidate.statement,
    candidate.statement.modifiers,
    factory.updateVariableDeclarationList(candidate.statement.declarationList, [declaration])
  )];
}

function emitCanonicalHandlerGenerator(ir) {
  if (!ir || ir.version !== HANDLER_IR_VERSION) throw new TypeError(`emitCanonicalHandlerGenerator requires ${HANDLER_IR_VERSION}.`);
  const factory = ts.factory;
  const sourceFile = ir.sourceFile;
  const packageIntrinsicsByStart = new Map(
    (ir.packageIntrinsics || []).map((intrinsic) => [Number(intrinsic.range && intrinsic.range.start), intrinsic])
  );

  function canonicalContextIntrinsic(intrinsic, args) {
    if (intrinsic.intrinsic !== 'request.header') return null;
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier(ir.ctxName),
          'req'
        ),
        'header'
      ),
      undefined,
      args
    );
  }

  function rewritePackageIntrinsics(node) {
    if (!node || packageIntrinsicsByStart.size === 0) return node;
    const transformed = ts.transform(node, [
      (context) => {
        function visit(current) {
          if (ts.isCallExpression(current)) {
            let start = NaN;
            try { start = current.getStart(sourceFile); } catch {}
            const intrinsic = packageIntrinsicsByStart.get(start);
            if (intrinsic) {
              const indexes = Array.isArray(intrinsic.argumentIndexes) ? intrinsic.argumentIndexes : [];
              const staticArguments = Array.isArray(intrinsic.staticArguments) ? intrinsic.staticArguments : [];
              const args = [
                ...staticArguments.map((argument) => staticValueExpression(factory, argument)),
                ...indexes.map((index) => current.arguments[index]).filter(Boolean).map((argument) => ts.visitNode(argument, visit))
              ];
              const canonicalIntrinsic = canonicalContextIntrinsic(intrinsic, args);
              if (canonicalIntrinsic) return canonicalIntrinsic;
              return factory.createCallExpression(factory.createIdentifier(String(intrinsic.compilerName)), undefined, args);
            }
          }
          return ts.visitEachChild(current, visit, context);
        }
        return (root) => ts.visitNode(root, visit);
      }
    ]);
    const output = transformed.transformed[0];
    transformed.dispose();
    return output;
  }

  function emitOperation(entry) {
    switch (entry.kind) {
      case 'source-statement':
        return rewritePackageIntrinsics(entry.statement);
      case 'block':
        return factory.updateBlock(entry.statement, entry.statements.flatMap((child) => {
          const emitted = emitOperation(child);
          return Array.isArray(emitted) ? emitted : [emitted];
        }).filter(Boolean));
      case 'if':
        return factory.updateIfStatement(
          entry.statement,
          rewritePackageIntrinsics(entry.expression),
          emitOperation(entry.thenOperation),
          entry.elseOperation ? emitOperation(entry.elseOperation) : undefined
        );
      case 'fetch-single': {
        const { candidate, site, continuation } = entry;
        const marker = fetchEffectExpression(factory, sourceFile, site, candidate.chain);
        const yieldExpression = factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, continuation.id)]));
        const initializer = decodedExpression(factory, factory.createParenthesizedExpression(yieldExpression), candidate.chain.decoder, candidate.chain.decoderArgs);
        const declaration = factory.updateVariableDeclaration(candidate.declaration, candidate.declaration.name, undefined, candidate.declaration.type, initializer);
        return factory.updateVariableStatement(candidate.statement, candidate.statement.modifiers, factory.updateVariableDeclarationList(candidate.statement.declarationList, [declaration]));
      }
      case 'fetch-group': {
        const { candidates, sites, continuation } = entry;
        const tempNames = sites.map((site) => factory.createIdentifier(`__pulse_response_${site.id.replace(/[^a-z0-9_]/gi, '_')}`));
        const binding = factory.createArrayBindingPattern(tempNames.map((name) => factory.createBindingElement(undefined, undefined, name, undefined)));
        const effectsArray = factory.createArrayLiteralExpression(sites.map((site, index) => fetchEffectExpression(factory, sourceFile, site, candidates[index].chain)), false);
        const groupYield = factory.createYieldExpression(undefined, callPulse(factory, 'group', [effectsArray, stringLiteral(factory, continuation.id)]));
        const groupDeclaration = factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(binding, undefined, undefined, groupYield)
        ], ts.NodeFlags.Const));
        const declarations = candidates.map((candidate, index) => {
          const initializer = decodedExpression(factory, tempNames[index], candidate.chain.decoder, candidate.chain.decoderArgs);
          return factory.createVariableStatement(candidate.statement.modifiers, factory.createVariableDeclarationList([
            factory.createVariableDeclaration(candidate.declaration.name, undefined, candidate.declaration.type, initializer)
          ], declarationFlags(candidate.statement)));
        });
        return [groupDeclaration, ...declarations];
      }
      case 'parallel-group': {
        const { candidate, sites, continuation } = entry;
        const temporaryNames = sites.map((site) => factory.createIdentifier(`__pulse_parallel_${site.id.replace(/[^a-z0-9_]/gi, '_')}`));
        const binding = factory.createArrayBindingPattern(temporaryNames.map((name) => factory.createBindingElement(undefined, undefined, name, undefined)));
        const effectsArray = factory.createArrayLiteralExpression(
          sites.map((site, index) => parallelMemberEffectExpression(factory, sourceFile, site, candidate.members[index], rewritePackageIntrinsics)),
          false
        );
        const groupYield = factory.createYieldExpression(undefined, callPulse(factory, 'group', [effectsArray, stringLiteral(factory, continuation.id)]));
        if (candidate.discard) return factory.createExpressionStatement(groupYield);
        const groupDeclaration = factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(binding, undefined, undefined, groupYield)
        ], ts.NodeFlags.Const));
        return [groupDeclaration, ...parallelResultStatements(factory, candidate, temporaryNames)];
      }
      case 'provider-variable': {
        const { candidate, site, continuation } = entry;
        const marker = providerEffectExpression(factory, sourceFile, site, candidate.operation);
        const initializer = factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, continuation.id)]));
        const declaration = factory.updateVariableDeclaration(candidate.declaration, candidate.declaration.name, undefined, candidate.declaration.type, initializer);
        return factory.updateVariableStatement(candidate.statement, candidate.statement.modifiers, factory.updateVariableDeclarationList(candidate.statement.declarationList, [declaration]));
      }
      case 'provider-expression': {
        const { candidate, site, continuation } = entry;
        const marker = providerEffectExpression(factory, sourceFile, site, candidate.operation);
        return factory.createExpressionStatement(factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, continuation.id)])));
      }
      case 'package-effect': {
        const marker = packageEffectExpression(factory, sourceFile, entry.site, entry.effect, entry.call, rewritePackageIntrinsics);
        const yielded = factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, entry.continuation.id)]));
        return entry.returnResult ? factory.createReturnStatement(yielded) : factory.createExpressionStatement(yielded);
      }
      case 'package-variable': {
        const marker = packageEffectExpression(factory, sourceFile, entry.site, entry.candidate.effect, entry.candidate.call, rewritePackageIntrinsics);
        const yielded = factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, entry.continuation.id)]));
        const declaration = factory.updateVariableDeclaration(entry.candidate.declaration, entry.candidate.declaration.name, undefined, entry.candidate.declaration.type, yielded);
        return factory.updateVariableStatement(entry.candidate.statement, entry.candidate.statement.modifiers, factory.updateVariableDeclarationList(entry.candidate.statement.declarationList, [declaration]));
      }
      case 'package-result-adapter':
        return factory.updateReturnStatement(entry.statement, rewritePackageIntrinsics(entry.resultExpression));
      case 'opaque-fetch-return': {
        const marker = fetchEffectExpression(factory, sourceFile, entry.site, entry.chain);
        return factory.updateReturnStatement(entry.statement, factory.createYieldExpression(undefined, callPulse(factory, 'effect', [marker, stringLiteral(factory, entry.continuation.id)])));
      }
      default:
        throw new TypeError(`Unsupported canonical Handler IR operation during emission: ${entry.kind}`);
    }
  }

  const transformedBody = emitOperation(ir.body);
  const generator = factory.createFunctionDeclaration(
    undefined,
    factory.createToken(ts.SyntaxKind.AsteriskToken),
    factory.createIdentifier('__pulse_handler'),
    undefined,
    [
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(ir.ctxName), undefined, undefined, undefined),
      factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier('__pulse'), undefined, undefined, undefined)
    ],
    undefined,
    transformedBody
  );

  return Object.freeze({
    version: HANDLER_IR_EMITTER_VERSION,
    generator,
    ctxName: ir.ctxName,
    effectSites: ir.effectSites,
    continuationSites: ir.continuationSites
  });
}

function assignmentStatement(factory, name, expression) {
  return factory.createExpressionStatement(factory.createBinaryExpression(
    factory.createIdentifier(name),
    factory.createToken(ts.SyntaxKind.EqualsToken),
    expression
  ));
}

function emitCanonicalRouterHandlerBody(ir) {
  if (!ir || ir.version !== HANDLER_IR_VERSION || ir.kind !== ROUTER_HANDLER_IR_KIND) {
    throw new TypeError(`emitCanonicalRouterHandlerBody requires ${HANDLER_IR_VERSION} ${ROUTER_HANDLER_IR_KIND}.`);
  }
  const factory = ts.factory;

  function emitOperation(entry) {
    switch (entry.kind) {
      case 'source-statement':
        return entry.statement;
      case 'block':
        return factory.createBlock((entry.statements || []).flatMap((child) => {
          const emitted = emitOperation(child);
          return Array.isArray(emitted) ? emitted : [emitted];
        }).filter(Boolean), true);
      case 'if':
        return factory.createIfStatement(
          entry.expression,
          emitOperation(entry.thenOperation),
          entry.elseOperation ? emitOperation(entry.elseOperation) : undefined
        );
      case 'router-transfer': {
        const statements = [];
        if (entry.clearNormalMode) statements.push(assignmentStatement(factory, MODE, factory.createNumericLiteral(0)));
        if (entry.errorExpression) {
          statements.push(assignmentStatement(factory, ERROR, entry.errorExpression));
          statements.push(assignmentStatement(factory, MODE, factory.createNumericLiteral(1)));
        }
        statements.push(assignmentStatement(factory, CURSOR, factory.createNumericLiteral(entry.nextIndex)));
        statements.push(assignmentStatement(factory, entry.transferFlag, factory.createTrue()));
        return statements;
      }
      case 'router-guard':
        return factory.createIfStatement(
          factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, factory.createIdentifier(entry.transferFlag)),
          emitOperation(entry.body),
          undefined
        );
      default:
        throw new TypeError(`Unsupported Router Handler IR operation during emission: ${entry.kind}`);
    }
  }

  const body = emitOperation(ir.body);
  const bodyStatements = body && ts.isBlock(body) ? [...body.statements] : [];
  const transferFlag = ir.transferFlag;
  const statements = ir.role === 'event'
    ? [
        ...bodyStatements,
        ...(ir.summary && ir.summary.flow && ir.summary.flow.mustTerminate
          ? []
          : [factory.createReturnStatement(factory.createIdentifier('undefined'))])
      ]
    : [
        factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
          factory.createVariableDeclaration(factory.createIdentifier(transferFlag), undefined, undefined, factory.createFalse())
        ], ts.NodeFlags.Let)),
        ...bodyStatements
      ];
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return Object.freeze({
    version: HANDLER_IR_EMITTER_VERSION,
    statements: Object.freeze(statements),
    sourceText: statements.map((statement) => printer.printNode(ts.EmitHint.Unspecified, statement, ir.sourceFile)).join('\n')
  });
}

module.exports = Object.freeze({
  HANDLER_IR_EMITTER_VERSION,
  emitCanonicalHandlerGenerator,
  emitCanonicalRouterHandlerBody
});
