'use strict';
const { bindJavascriptDigestMac } = require('@pulse-compute/crypto/provider');
const { normalizeNodeS3 } = require('../config/s3.js');
const { readS3 } = require('../runtime/s3-reader.js');

function createNodeJavascriptS3(options, secretLookup) {
  const s3 = normalizeNodeS3(options.s3 || options.bindings && options.bindings.s3);
  return (effect, execution = {}) => {
    // This provider target explicitly selects Crypto's Web Crypto realization.
    // Native execution supplies its own Wasm exports to the same Node transport.
    let selected;
    try { selected = bindJavascriptDigestMac(['SHA-256', 'HMAC-SHA256']); }
    catch { selected = null; }
    return readS3(effect, {
      s3, signal: execution.signal, registerRedactionValue: execution.registerRedactionValue,
      fetchImplementation: options.s3FetchImplementation || options.fetchImplementation, cryptoTarget: 'javascript',
      cryptoVerifier: selected, cryptoRealization: selected && selected.realization
    }, (name) => secretLookup(name, execution));
  };
}
module.exports = { createNodeJavascriptS3 };
