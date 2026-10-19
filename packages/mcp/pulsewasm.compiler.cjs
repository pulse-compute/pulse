'use strict';
const entities = require('@pulse-compute/entities/pulsewasm/compiler');
const { pulseConfiguration } = require('./src/pulse-config.js');
const { projectLocalCatalog } = require('./src/catalog.js');
const manifest = require('./pulsewasm.manifest.cjs');
const { hash } = require('./pulsewasm.plan.cjs');
function buildMcpPackage(inputs = {}) {
  const ts = inputs.typescript || inputs.ts || require('typescript');
  const source = inputs.sourceFile || ts.createSourceFile(inputs.sourcePath || 'index.ts', inputs.sourceText || '', ts.ScriptTarget.ES2022, true);
  const fail = message => { throw new TypeError('PULSE_MCP_STATIC_BINDING_REQUIRED: ' + message); };
  const names = new Set();
  for (const s of source.statements) if (ts.isImportDeclaration(s) && s.moduleSpecifier.text === manifest.lowerableSubpath) {
    for (const e of s.importClause?.namedBindings?.elements || []) if ((e.propertyName || e.name).text === 'mcp') names.add(e.name.text);
  }
  function literal(node) {
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isStringLiteral(node) ? node.text : Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const out = {};
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p) || !p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || Object.hasOwn(out, p.name.text)) fail('Use unique static object fields.');
        Object.defineProperty(out, p.name.text, { value: literal(p.initializer), enumerable: true });
      }
      return out;
    }
    return fail('Options must be literal data.');
  }
  let binding;
  const accepted = new Set();
  for (const s of source.statements) if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
    const call = d.initializer;
    if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !names.has(call.expression.text)) continue;
    if (binding || !(s.declarationList.flags & ts.NodeFlags.Const) || !ts.isIdentifier(d.name) || call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0])) fail('Declare one module-level const server = mcp({ router, ...literalOptions }).');
    const fields = call.arguments[0].properties;
    let routerId;
    const options = {}, seen = new Set();
    for (const p of fields) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || seen.has(p.name.text)) fail('Use explicit unique static fields.');
      const key = p.name.text; seen.add(key);
      if (key === 'router') { if (!ts.isIdentifier(p.initializer)) fail('router must name the local EntityRouter.'); routerId = p.initializer.text; }
      else Object.defineProperty(options, key, { value: literal(p.initializer), enumerable: true });
    }
    if (!routerId) fail('router is required.');
    binding = { declaration: call, name: d.name.text, routerId, options: pulseConfiguration(options), calls: [] };
    accepted.add(call);
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && names.has(node.expression.text) && !accepted.has(node)) fail('Dynamic MCP construction is unsupported.');
      if (binding && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === binding.name) {
        if (node.expression.name.text !== 'handle') fail('Only the terminal handle(ctx) binding is supported.');
        binding.calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!binding || binding.calls.length !== 1) fail('Exactly one terminal MCP binding is required.');
  let fn = binding.calls[0].parent;
  while (fn && !ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
  const exported = fn && (ts.isFunctionDeclaration(fn) && fn.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
    || ts.isArrowFunction(fn) && ts.isExportAssignment(fn.parent));
  if (!exported || !fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
    || (ts.isBlock(fn.body) && (fn.body.statements.length !== 1 || !ts.isReturnStatement(fn.body.statements[0])))) fail('The default async handler must contain only the terminal MCP return.');
  const result = entities.composeEntityRouterBinding({ ...inputs, sourceFile: source, manifest }, {
    symbols: ['mcp'], bindings: [{ routerId: binding.routerId, call: binding.calls[0] }]
  });
  if (result.hasErrors) return result;
  if (result.entries.some(entry => entry.range.start > binding.declaration.getStart(source))) fail('Register every operation before binding the router.');
  const projected = projectLocalCatalog(result.artifact.catalog, inputs.schemaBundle?.registry?.schemas || [], binding.routerId, 'fastly-native', binding.options.limits);
  const plan = { version: 'pulse.mcp-binding-plan.v1', options: binding.options, entities: result.artifact.plan, tools: projected.list };
  plan.planHash = hash(plan);
  const canonicalIntrinsics = result.canonicalIntrinsics.map(intrinsic => ({ ...intrinsic,
    contractId: 'pulse.mcp', package: '@pulse-compute/mcp', import: manifest.lowerableSubpath,
    kind: 'mcp.handle', intrinsic: 'pulse.mcp.handle.v1', packageIntrinsic: 'pulse.mcp.handle.v1', compilerName: '__pulse_mcp_handle', staticArguments: [plan]
  }));
  const inspectionArtifacts = [{ version: 'pulse.package-inspection-artifact.v1', id: 'pulse.mcp-catalog.v1', contractId: 'pulse.mcp', package: '@pulse-compute/mcp', kind: 'deterministic-catalog', mediaType: 'application/json', file: 'mcp-catalog.json', data: { version: 'pulse.mcp-catalog.v1', planHash: plan.planHash, tools: plan.tools } }];
  return { ...result, manifest, canonicalIntrinsics, realizationArtifacts: [], inspectionArtifacts,
    artifact: { ...result.artifact, version: plan.version, contractId: 'pulse.mcp', package: '@pulse-compute/mcp', plan, canonicalIntrinsics, realizationArtifacts: [] } };
}
function createMcpPackageCompilerBuilder(inputs = {}) {
  try { return buildMcpPackage(inputs); }
  catch (cause) {
    const error = new TypeError(cause.message);
    error.code = 'PULSE_MCP_STATIC_BINDING_REQUIRED';
    throw error;
  }
}
module.exports = { createMcpPackageCompilerBuilder,
  buildMcpNativeApplication(input) { return require('./pulsewasm.native.cjs').buildMcpNativeApplication(input); } };
