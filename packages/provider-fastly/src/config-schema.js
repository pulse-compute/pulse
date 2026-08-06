'use strict';

const FASTLY_CONFIG_SCHEMA = require('./config-schema.json');

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function fastlyConfigRule(path) {
  const rule = FASTLY_CONFIG_SCHEMA.fields[path];
  if (!rule) throw new Error(`Unknown Fastly config schema field ${path}`);
  return rule;
}

function fastlyConfigDefault(path) {
  const rule = fastlyConfigRule(path);
  if (!Object.prototype.hasOwnProperty.call(rule, 'default')) throw new Error(`Fastly config schema field ${path} has no default`);
  return clone(rule.default);
}

module.exports = Object.freeze({
  FASTLY_CONFIG_SCHEMA,
  fastlyConfigRule,
  fastlyConfigDefault
});
