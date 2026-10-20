'use strict';
// Aggregate only callers selected by the existing Router/managed frontends.
const ts = require('typescript');
const { projectFunctionResolver } = require('./router-module-linker');
const { admitCallableSource, CallableSourceAdmissionError } = require('../callable-source-admission');
function createCallableCollection(graphBuild, options) {
  const resolver = projectFunctionResolver(graphBuild);
  const callees = [], sites = [], callers = new Map(), byNode = new WeakMap(), occurrences = new Map();
  let totalSites = 0;
  function admit(entry, { managed = false, rewrite = false, contextIndex = 0 } = {}) {
    const fn = entry.functionNode;
    const parameter = fn.parameters[contextIndex];
    let referencesCall = false;
    function scan(node) {
      if (parameter && ts.isIdentifier(parameter.name)
        && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && ts.isIdentifier(node.expression) && node.expression.text === parameter.name.text
        && (ts.isPropertyAccessExpression(node) ? node.name.text === 'call'
          : ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'call')) referencesCall = true;
      ts.forEachChild(node, scan);
    }
    if (fn.body) scan(fn.body);
    // Keep ordinary JavaScript and unused non-simple context forms on their
    // existing path. Admission is required only when opting into ctx.call.
    if (!referencesCall && (options.target === 'javascript' || !parameter
      || !ts.isIdentifier(parameter.name) || parameter.initializer || parameter.questionToken || parameter.dotDotDotToken)) return [];

    const key = `${entry.modulePath}:${fn.pos}`;
    if (callers.has(key)) {
      const selected = callers.get(key);
      if (totalSites + selected.length > 16) throw new CallableSourceAdmissionError('PULSE_CALL_SOURCE_LIMIT',
        'At most 16 reachable source call occurrences are admitted.', fn, entry.sourceFile);
      totalSites += selected.length;
      for (const site of selected) occurrences.set(site, occurrences.get(site) + 1);
      return selected;
    }
    const admitted = admitCallableSource(graphBuild, { ...options, resolver, entry,
      parameterCount: fn.parameters.length, contextIndex });
    const selected = [];
    for (const site of admitted.callSites) {
      let index = callees.findIndex(callee => callee.identity === site.target);
      const callee = admitted.callees.find(callee => callee.identity === site.target);
      const fail = (code, message) => { throw new CallableSourceAdmissionError(code, message, site.callNode, entry.sourceFile); };
      if (index >= 0 && (callees[index].inputSchema !== callee.inputSchema || callees[index].outputSchema !== callee.outputSchema))
        fail('PULSE_CALL_SOURCE_SCHEMA_CONFLICT', 'A target must use one consistent schema pair across callers.');
      if (totalSites >= 16) fail('PULSE_CALL_SOURCE_LIMIT', 'At most 16 reachable source call sites are admitted.');
      if (index < 0) { index = callees.length; callees.push(callee); }
      const marker = rewrite ? `__pulse_call_site_${sites.length}` : undefined;
      const record = Object.freeze({ ...site, index, ...(marker ? { marker } : {}), ...(managed ? { managed: true } : {}) });
      sites.push(record); selected.push(record); occurrences.set(record, 1); totalSites++; byNode.set(site.callNode, record);
    }
    callers.set(key, selected);
    return selected;
  }
  return {
    resolver, admit,
    forCall(node) { return byNode.get(ts.getOriginalNode(node)); },
    get consumedRuntimeImports() { return resolver.consumedRuntimeImports(); },
    snapshot() {
      if (!sites.length) return undefined;
      return Object.freeze({ version: 'pulse.call-source-admission.v1', callees: Object.freeze([...callees]),
        sites: Object.freeze(sites.map(record => {
          const { callNode, argumentNode, index, ...site } = record;
          return Object.freeze({ ...site, ...(occurrences.get(record) > 1 ? { maxCalls: occurrences.get(record) } : {}) });
        })) });
    }
  };
}
module.exports = { createCallableCollection };
