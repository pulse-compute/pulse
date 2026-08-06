'use strict';

function match(value) {
  return { status: 'match', value };
}

function reject(diagnostic) {
  return { status: 'reject', diagnostic };
}

function unknown() {
  return { status: 'unknown' };
}

module.exports = { match, reject, unknown };
