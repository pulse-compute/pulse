'use strict';

const { isConfigFactory } = require('@pulse-compute/wasm-contracts/project/config-factory');
const { Router } = require('@pulse-compute/runtime');
const {
  addEventRegistration,
  bindEventRegistrationReader,
  createEventRegistrationTable,
  eventRegistrationEntries
} = require('./event-registration.js');

const APPLICATION_STATE = new WeakMap();
const EVENT_REGISTRATION_STATE = new WeakMap();
const PROFILE_TOKEN_STATE = new WeakMap();
const PROFILE_TOKEN_BRAND = Symbol('pulse.profile-token');

function isAutoOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === 'auto' && value.auto === true;
}

class Pulse extends Router {
  constructor(options) {
    super();
    if (!isAutoOptions(options) && !isConfigFactory(options)) {
      throw new TypeError('Pulse requires new Pulse({ auto: true }) or one defineConfig(...) factory.');
    }
    const token = {};
    Object.defineProperty(token, PROFILE_TOKEN_BRAND, { enumerable: false, value: true });
    Object.freeze(token);
    const state = Object.freeze({
      mode: isAutoOptions(options) ? 'auto' : 'explicit',
      options,
      profileToken: token
    });
    APPLICATION_STATE.set(this, state);
    const eventRegistrations = createEventRegistrationTable();
    EVENT_REGISTRATION_STATE.set(this, eventRegistrations);
    bindEventRegistrationReader(this, eventRegistrations);
    PROFILE_TOKEN_STATE.set(token, Object.freeze({ application: this }));
  }

  on(type, declaration, handler) {
    addEventRegistration(EVENT_REGISTRATION_STATE.get(this), type, declaration, handler);
    return this;
  }

  profile() {
    return APPLICATION_STATE.get(this).profileToken;
  }
}

function applicationState(application) {
  const state = APPLICATION_STATE.get(application);
  if (!state) throw new TypeError('Expected a Pulse application.');
  return state;
}

function profileTokenOwner(token) {
  return PROFILE_TOKEN_STATE.get(token)?.application;
}

function eventRegistrations(application) {
  const table = EVENT_REGISTRATION_STATE.get(application);
  if (!table) throw new TypeError('Expected a Pulse application.');
  return eventRegistrationEntries(table);
}

module.exports = Object.freeze({
  Pulse,
  applicationState,
  eventRegistrations,
  profileTokenOwner
});
