'use strict';
function failureKind(error, signal) {
  if (signal?.aborted || ['PULSE_REQUEST_DEADLINE_EXCEEDED', 'PULSE_REQUEST_CLOCK_INVALID'].includes(error?.code)) return 1;
  if (['PULSE_BODY_TOO_LARGE', 'PULSE_REQUEST_BODY_TOO_LARGE'].includes(error?.code)) return 2;
  if (error?.code === 'PULSE_REQUEST_BODY_INVALID_UTF8') return 3;
  return 0;
}
module.exports = { failureKind };
