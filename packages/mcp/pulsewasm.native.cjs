'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildEntitiesNativeComponents } = require('@pulse-compute/entities/pulsewasm-native');
const { pulseConfiguration } = require('./src/pulse-config.js');
const { hash } = require('./pulsewasm.plan.cjs');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function buildMcpNativeApplication(input) {
  if (!input || Object.keys(input).some(key => !['plan', 'managedHandlerNativeBundle', 'schemaBundle'].includes(key))) throw new TypeError('Invalid MCP Native input');
  const { plan } = input;
  if (!plan || plan.version !== 'pulse.mcp-binding-plan.v1' || hash(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planHash'))) !== plan.planHash) throw new TypeError('Invalid MCP plan');
  const options = pulseConfiguration(plan.options);
  const component = buildEntitiesNativeComponents({ ...input, plan: plan.entities });
  const entities = plan.entities.routers[0].entities;
  const constants = `\nconst MCP_PATH: string = ${JSON.stringify(options.path)}\nconst MCP_INFO: string = ${JSON.stringify(JSON.stringify(options.serverInfo))}\nconst MCP_TOOLS: string = ${JSON.stringify(JSON.stringify(plan.tools))}\nconst MCP_LEGACY: bool = ${!!options.legacyProtocol}\nconst MCP_REQUEST_BYTES: i32 = ${options.limits.maxRequestBytes}\nconst MCP_RESPONSE_BYTES: i32 = ${options.limits.maxResponseBytes}\nconst MCP_DEPTH: i32 = ${options.limits.maxDepth}\nfunction mcp_tool_index(name: string): i32 {\n${entities.map((entity,index) => `  if (name == ${JSON.stringify(entity.discriminator)}) return ${index}`).join('\n')}\n  return -1\n}\nfunction mcp_tool_no_output(index: i32): bool { return ${entities.map((entity,index) => entity.outputSchema === null ? `index == ${index}` : null).filter(Boolean).join(' || ') || 'false'} }\n`;
  const source = component.source + constants + fs.readFileSync(path.join(__dirname, 'as/mcp.as.ts'), 'utf8');
  return { ...component, version: 'pulse.package-native-application.v2', contractId: 'pulse.mcp', package: '@pulse-compute/mcp', intrinsic: 'pulse.mcp.handle.v1',
    source, sourceHash: sha(source), planHash: plan.planHash,
    terminalFailure: 'package-http-v1',
    requestLimits: { maxDurationMs: options.limits.deadlineMs, maxRequestBytes: options.limits.maxRequestBytes },
    manifest: { ...component.manifest, generatorVersion: 'pulse.mcp-native-source.v1' } };
}
function buildMcpNativeSource(input) {
  const application = buildMcpNativeApplication(input);
  return { version: 'pulse.mcp-native-source.v1', id: 'pulse-mcp-native-as', owner: '@pulse-compute/mcp',
    packageVersion: require('./package.json').version, kind: 'package-generated-source', language: 'assemblyscript',
    license: 'Apache-2.0', origin: 'package-source+reachable-lowering', sourceIncluded: true, sourceFile: 'as/mcp.as.ts',
    source: application.source, sourceBytes: Buffer.byteLength(application.source), sourceSha256: application.sourceHash,
    planHash: application.planHash, managedHandlerNativeBundleHash: application.managedHandlerNativeBundleHash,
    semanticOwnership: ['mcp-http-admission', 'mcp-discovery', 'mcp-tool-framing'],
    providerAuthorities: ['request', 'effect-execution', 'logging', 'response-transport'],
    policy: { javascriptRuntime: false, automaticFallback: false } };
}
module.exports = { buildMcpNativeApplication, buildMcpNativeSource };
