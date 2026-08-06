'use strict';

const { PulseProjectError } = require('../project-config.js');
const { COMPLETION_SHELLS } = require('../completion.js');
const {
  COMMANDS,
  COMMAND_SPECS,
  optionForToken,
  optionAllowed,
  publicOptionsForCommand
} = require('../command-spec.js');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function metaRequest(invocation, detail = {}) {
  return deepFreeze({ kind: 'meta', invocation, ...detail });
}

function baseCommandRequest(command) {
  const request = { kind: 'command', command, json: false, dryRun: false };
  if (command === 'compile' || command === 'build') request.clean = true;
  return request;
}

function allowedRequestKeys(command) {
  const keys = new Set(['command', 'json', 'dryRun', 'help']);
  for (const option of publicOptionsForCommand(command)) keys.add(option.key);
  for (const positional of COMMAND_SPECS[command].positionals) keys.add(positional.key);
  return keys;
}

function finishCommandRequest(request) {
  const allowed = allowedRequestKeys(request.command);
  for (const key of Object.keys(request)) {
    if (key === 'kind') continue;
    if (!allowed.has(key)) throw new Error(`CLI request normalization leaked unsupported field ${request.command}.${key}`);
  }
  return deepFreeze(request);
}

function parseCommandRequest(argv) {
  const input = Array.from(argv || []);
  if (input.length === 0 || ['help', '--help', '-h'].includes(input[0])) return metaRequest('help');
  if (['--version', '-v', 'version'].includes(input[0])) return metaRequest('version');
  if (String(input[0]).toLowerCase() === 'completion') {
    input.shift();
    const shell = input.shift();
    if (!shell || input.length > 0 || !COMPLETION_SHELLS.includes(String(shell).toLowerCase())) {
      throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', 'Usage: pulse completion <bash|zsh|fish>.', { shell, allowed: COMPLETION_SHELLS });
    }
    return metaRequest('completion', { shell: String(shell).toLowerCase() });
  }

  const command = String(input.shift()).toLowerCase();
  if (!COMMANDS.includes(command)) {
    throw new PulseProjectError('PULSE_COMMAND_UNKNOWN', `Unknown pulse command "${command}".`, { command, allowed: COMMANDS });
  }

  const request = baseCommandRequest(command);
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    const next = () => {
      const value = input[++index];
      if (value === undefined) throw new PulseProjectError('PULSE_ARGUMENT_MISSING', `Missing value after ${token}.`, { token });
      return value;
    };

    if (token === '--provider' || String(token).startsWith('--provider=')) {
      throw new PulseProjectError(
        'PULSE_PROVIDER_FLAG_REMOVED',
        'The public --provider override was removed. Configure the deployment provider in .pulse/config.ts; pulse compile is always provider-neutral and pulse build realizes the configured provider.',
        { token, command, replacement: command === 'compile' ? 'pulse compile' : 'active profile in .pulse/config.ts' }
      );
    }
    if (token === '--source-only') {
      throw new PulseProjectError(
        'PULSE_SOURCE_ONLY_REMOVED',
        'The --source-only build mode was removed. Native builds always emit generated source and provider Wasm together.',
        { token, command, replacement: 'pulse build' }
      );
    }

    const match = optionForToken(token);
    if (match) {
      const { option, flag } = match;
      if (!optionAllowed(option, command)) {
        throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', `Unexpected pulse ${command} argument: ${token}`, { token, command });
      }
      let value;
      if (option.kind === 'boolean') value = true;
      else if (option.kind === 'boolean-value') value = flag.value;
      else {
        const raw = token === flag.name ? next() : token.slice(flag.name.length + 1);
        if (raw === '') throw new PulseProjectError('PULSE_ARGUMENT_MISSING', `Missing value after ${flag.name}.`, { token: flag.name });
        value = option.parse === 'number' ? Number(raw) : raw;
      }
      request[option.key] = value;
      continue;
    }

    if (!token.startsWith('-')) {
      if (command === 'init' && !request.target) {
        request.target = token;
        continue;
      }
      if (command !== 'init' && !request.directory) {
        request.directory = token;
        continue;
      }
    }
    throw new PulseProjectError('PULSE_ARGUMENT_UNEXPECTED', `Unexpected pulse ${command} argument: ${token}`, { token, command });
  }

  return finishCommandRequest(request);
}

function isCommandRequest(value) {
  return Boolean(value && value.kind === 'command' && COMMANDS.includes(value.command));
}

function isMetaRequest(value) {
  return Boolean(value && value.kind === 'meta' && ['help', 'version', 'completion'].includes(value.invocation));
}

function normalizeCommandRequest(value) {
  if (Array.isArray(value)) return parseCommandRequest(value);
  if (isCommandRequest(value) || isMetaRequest(value)) return value;
  if (!value || typeof value !== 'object') throw new TypeError('CLI command request must be argv or a parsed request object');

  if (value.help && !value.command) return metaRequest('help');
  if (value.version && !value.command) return metaRequest('version');
  if (value.completion && !value.command) return metaRequest('completion', { shell: String(value.completion).toLowerCase() });
  if (!COMMANDS.includes(value.command)) {
    throw new PulseProjectError('PULSE_COMMAND_UNKNOWN', `Unknown pulse command "${value.command}".`, { command: value.command, allowed: COMMANDS });
  }

  const request = baseCommandRequest(value.command);
  for (const key of allowedRequestKeys(value.command)) {
    if (key === 'command') continue;
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) request[key] = value[key];
  }
  return finishCommandRequest(request);
}

module.exports = deepFreeze({
  parseCommandRequest,
  normalizeCommandRequest,
  isCommandRequest,
  isMetaRequest
});
