'use strict';

const core = require('../diagnostics.js');

function createDiagnosticReporter(defaults = {}) {
  return {
    report(sourceFile, node, code, message, hint, options = {}) {
      return core.diagnostic(sourceFile, node, code, message, hint, { ...defaults, ...options });
    },
    push(diagnostics, sourceFile, node, code, message, hint, options = {}) {
      const diag = this.report(sourceFile, node, code, message, hint, options);
      diagnostics.push(diag);
      return diag;
    }
  };
}

module.exports = {
  createDiagnosticReporter
};
