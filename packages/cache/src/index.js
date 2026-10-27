'use strict';
// Native lowering is explicit; importing this package never installs a host.
function unsupported(){throw Object.assign(new Error('Cache requires the bounded Fastly Native realization.'),{code:'PULSE_CACHE_TARGET_UNSUPPORTED'});}
exports.cache=Object.freeze({getText:unsupported,putText:unsupported});
