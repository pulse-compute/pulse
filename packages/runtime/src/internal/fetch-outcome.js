'use strict';

// Only admitted transport failures become application data. Never copy provider
// messages, URLs, causes or diagnostic detail into a collected outcome.
const codes = new Map([
  ['PULSE_FETCH_TIMEOUT', 'PULSE_FETCH_TIMEOUT'],
  ['PULSE_FETCH_NETWORK', 'PULSE_FETCH_NETWORK'],
  ['PULSE_FASTLY_FETCH_NETWORK', 'PULSE_FETCH_NETWORK']
]);
function fulfilled(value) { return Object.freeze({ status: 'fulfilled', value }); }
function rejected(error) {
  const code = error?.code === 'PULSE_BODY_UNAVAILABLE' && error.detail?.reason === 'read-failed'
    ? 'PULSE_FETCH_NETWORK' : codes.get(error && error.code);
  if (!code) throw error;
  return Object.freeze({ status: 'rejected', error: Object.freeze({ code }) });
}
module.exports = Object.freeze({ fulfilled, rejected });
