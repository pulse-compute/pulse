'use strict';

const HANDLER_TABLE_VERSION = 'pulsewasm.handler-table.v1';
const HANDLER_STABLE_INPUT_VERSION = 'pulsewasm.handler-stable-input.v1';

const HANDLER_STABLE_ID_POLICY = Object.freeze({
  algorithm: 'sha256',
  prefix: 'handler',
  input: 'file + kind + local/export name for declarations, loc for inline handlers, and sourceTextHash',
  version: HANDLER_STABLE_INPUT_VERSION
});

const HANDLER_ID_POLICY = Object.freeze({
  stable: HANDLER_STABLE_ID_POLICY
});

const HANDLER_TABLE_POLICY = Object.freeze({
  version: HANDLER_TABLE_VERSION,
  idPolicy: HANDLER_ID_POLICY
});

module.exports = {
  HANDLER_TABLE_VERSION,
  HANDLER_STABLE_INPUT_VERSION,
  HANDLER_STABLE_ID_POLICY,
  HANDLER_ID_POLICY,
  HANDLER_TABLE_POLICY
};
