'use strict';

const CHANNEL_BROADCASTER_VERSION = 'pulsewasm.channel-broadcaster.v1';
const CHANNEL_BROADCASTER_PHASE = '10E';

const CHANNEL_ABI_EXPORTS = Object.freeze([
  'pulse_channel_count(channelsRef) -> i32',
  'pulse_channel_ref_at(channelsRef, index) -> StringRef',
  'pulse_string_ptr(stringRef) -> i32',
  'pulse_string_len(stringRef) -> i32'
]);

const CHANNEL_MISSING_HANDLER_CODE = 'PULSEWASM_CHANNEL_HANDLER_MISSING';
const CHANNEL_INVALID_RESULT_CODE = 'PULSEWASM_CHANNEL_RESULT_INVALID';
const BROADCASTER_MISSING_CODE = 'PULSEWASM_BROADCASTER_MISSING';

function channelAbiContract() {
  return {
    handlerSignature: 'ChannelHandler = (ctxRef: i32) -> ChannelsRef(i32)',
    channelsRef: 'opaque i32 reference to an ordered channel list; 0 means no channels',
    ordered: true,
    repeatedAllowed: true,
    emptyListBehavior: 'equivalent to 0 / no broadcaster call',
    exports: CHANNEL_ABI_EXPORTS.slice(),
    staticChannelLowering: 'static string channels lower to a ChannelsRef with one StringRef entry',
    handlerChannelLowering: 'handler channel slots invoke ChannelHandler and normalize its ChannelsRef return',
    validation: {
      missingChannelHandler: CHANNEL_MISSING_HANDLER_CODE,
      invalidChannelResult: CHANNEL_INVALID_RESULT_CODE
    }
  };
}

function broadcasterImportContract(options = {}) {
  return {
    module: 'pulsewasm_broadcaster',
    name: 'broadcast',
    signature: '(channelsRef: i32, ctxRef: i32) -> ErrorRef(i32)',
    returnPolicy: '0 = ok; non-zero = ErrorRef and dispatch/result fail with that error',
    requiredWhenChannelsResolve: Boolean(options.requiredWhenChannelsResolve),
    missingFailure: {
      code: BROADCASTER_MISSING_CODE,
      message: 'Channel routing resolved channels, but no broadcaster adaptor was provided.',
      statusCode: 500
    },
    failureBehavior: 'non-zero ErrorRef becomes active error/result failure at adaptor boundary',
    sideEffects: 'adaptor-defined; may attach GRIP/Fanout broadcaster behavior later'
  };
}

module.exports = {
  CHANNEL_BROADCASTER_VERSION,
  CHANNEL_BROADCASTER_PHASE,
  CHANNEL_ABI_EXPORTS,
  CHANNEL_MISSING_HANDLER_CODE,
  CHANNEL_INVALID_RESULT_CODE,
  BROADCASTER_MISSING_CODE,
  channelAbiContract,
  broadcasterImportContract
};
