'use strict';
const ts = require('typescript');
// Namespace compiler-generated symbols token-wise; never rewrite string payloads,
// resource bytes, schema property names, or source text supplied by an application.
function namespaceSource(source, prefix, hostPrefix) {
  const sf = ts.createSourceFile('callable.as.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const node of sf.statements) {
    if (node.name && ts.isIdentifier(node.name) && !node.name.text.startsWith('host_')) names.add(node.name.text);
    if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
  }
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let out = '', last = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenPos(), end = scanner.getTextPos(), text = source.slice(start,end);
    if (token === ts.SyntaxKind.ExportKeyword || token === ts.SyntaxKind.Identifier && (names.has(text) || hostPrefix && text.startsWith('host_'))) {
      out += source.slice(last,start) + (token === ts.SyntaxKind.ExportKeyword ? '' : (text.startsWith('host_') ? hostPrefix : prefix) + text); last = end;
    }
  }
  return out + source.slice(last);
}
function generateCallableSources(callables, options = {}) {
  const { generateCanonicalNativeAssemblyScript } = require('./canonical-native');
  const fragments = [];
  callables.forEach((plan,index) => {
    const prefix = `__call_${index}_`;
    const generated = generateCanonicalNativeAssemblyScript(plan);
    // Caller owns schema exports; schema text operations use the existing host
    // codec boundary. Dead private generated codecs disappear during Wasm DCE.
    let source = namespaceSource(generated.source,prefix);
    source = source.replace(/^import .*\n/gm,'').replace(/^@external\("pulse_host",.*\n/gm,'');
    const clear = plan.locals.map((_,i) => `${prefix}__pulse_local_${i} = 0`).join('; ');
    fragments.push(source, `
let __pulse_callable_active_${index}: bool = false
function __pulse_callable_${index}(input: i32): i32 {
  if (__pulse_callable_active_${index}) abort('Recursive callable', 'callable', 0, 0)
  if (host_resource_check(0.0, 0, 0) < 0) return 0
  __pulse_callable_active_${index} = true
  // A bounded schema round trip gives the callee an owned input graph. No HTTP.
  const inputText = host_schema_encode(input, __pulse_callable_string(${JSON.stringify(plan.callable.inputSchema)}))
  ${prefix}__pulse_callable_input = host_schema_decode(inputText, __pulse_callable_string(${JSON.stringify(plan.callable.inputSchema)}))
  ${clear}
  ${prefix}__pulse_started = 0
  const status = ${prefix}pulse_start()
  if (status != 0) abort('Callable failed', 'callable', 0, 0)
  const resultText = host_schema_encode(${prefix}pulse_result_handle(), __pulse_callable_string(${JSON.stringify(plan.callable.outputSchema)}))
  const result = host_schema_decode(resultText, __pulse_callable_string(${JSON.stringify(plan.callable.outputSchema)}))
  ${clear}
  ${prefix}__pulse_result = 0; ${prefix}__pulse_callable_input = 0
  __pulse_callable_active_${index} = false
  if (host_resource_check(0.0, 0, 0) < 0) return 0
  return result
}
function __pulse_callable_json_${index}(input: string): string {
  const value = host_schema_decode(__pulse_callable_string(input), __pulse_callable_string(${JSON.stringify(plan.callable.inputSchema)}))
  return changetype<string>(host_value_json(__pulse_callable_${index}(value)))
}`);
  });
  if (!callables.length) return '';
  let output = 'function __pulse_callable_string(value: string): i32 { return host_value_string(changetype<i32>(value), value.length) }\n' + fragments.join('\n');
  if (options.packageApplication) {
    const { CANONICAL_NATIVE_IMPORTS } = require('@pulse-compute/wasm-contracts/handler/canonical-native-runtime');
    const imports = CANONICAL_NATIVE_IMPORTS.map(([name,parameters,results]) => `@external("pulse_host", "${name}") declare function host_${name}(${parameters.map((t,i)=>`arg${i}: ${t}`).join(', ')}): ${results[0] || 'void'}`).join('\n');
    output = namespaceSource(imports + '\n' + output, '', '__pulse_callable_');
  }
  return output;
}
module.exports = { generateCallableSources, namespaceSource };
