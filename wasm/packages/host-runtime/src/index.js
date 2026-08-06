'use strict';

const compiler = require('./compiler');
const runtime = require('./runtime');

module.exports = {
  compiler,
  runtime,
  ...compiler,
  ...runtime
};
