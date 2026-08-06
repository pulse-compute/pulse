'use strict';

const { defineConfig } = require('@pulse-compute/wasm-contracts/project/config-factory');
const { Pulse } = require('./internal/application.js');

const PULSE_APPLICATION_API_VERSION = 'pulse.application-authoring.v3';

module.exports = Object.freeze({ defineConfig, Pulse, PULSE_APPLICATION_API_VERSION });
