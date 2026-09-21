'use strict';

module.exports = {
  admission: { ...require('./admission.js'), ...require('./admission-text.js') },
  v1: require('./v1.js'),
  v2: require('./v2.js'),
  compile: require('./compile.js'),
  genericParser: require('./generic-parser.js'),
  registry: require('./registry.js'),
  semanticTrace: require('./semantic-trace.js')
};
