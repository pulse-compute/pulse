'use strict';
// One provider-internal observer binding, shared by GRIP and independent packages.
module.exports = () => {
  const note = n => `__pulse_fastly_jwt_secret_calls = __pulse_fastly_jwt_secret_calls * 10 + ${n};`;
  const hook = (point, body) => ({ point, owner: 'test.observer', order: 20, body });
  return [hook('request.acquired', note(1)), hook('effect.settle', note(2) + 'return true'),
    { point: 'effect.deliver', owner: 'test.observer', order: 20, before: note(3), after: note(5) },
    hook('effect.result', note(4) + 'return true'), hook('invocation.end', note(6)),
    hook('invocation.close', note(7)), hook('invocation.closed', note(8))];
};
