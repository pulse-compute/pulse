'use strict';

const { Router: LiveRouter } = require('./internal/router.js');

const RUNTIME_API_VERSION = 'pulse.runtime-authoring.v4';
const ROUTER_API_VERSION = 'pulse.router-authoring.v2';

/** Public authoring value backed by the package-internal live Router realization. */
class Router extends LiveRouter {}

module.exports = Object.freeze({ RUNTIME_API_VERSION, ROUTER_API_VERSION, Router });
