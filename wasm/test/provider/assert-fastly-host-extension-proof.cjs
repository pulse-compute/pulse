'use strict';
require('../../../docs/internal/host-extensions/assert-hex01.cjs').run({ compareBaseline: false });
require('./lifecycle-hook-cases.cjs').run();
require('./lifecycle-native-cases.cjs').run();
require('./host-extension-lifecycle-cases.cjs').run();
