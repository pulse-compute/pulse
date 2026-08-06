'use strict';

module.exports = {
  entry: './app.js',
  profile: 'local',
  runtime: {
    provider: 'node'
  },
  lowerablePackages: {
    '@pulse-compute/grip': {
      trust: 'first-party'
    }
  }
};
