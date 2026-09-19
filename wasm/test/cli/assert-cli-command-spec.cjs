#!/usr/bin/env node
'use strict';

const { releaseVersion } = require('../../../release/pulse-release-manifest.json');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cliRoot = path.resolve(__dirname, '..', '..', 'packages', 'cli');
const workflowPath = path.join(cliRoot, 'src', 'workflow.js');
const projectConfigPath = path.join(cliRoot, 'src', 'project-config.js');
const projectExecutionPath = path.join(cliRoot, 'src', 'project-execution.js');
const commandSpecPath = path.join(cliRoot, 'src', 'command-spec.js');
const referencePath = path.resolve(__dirname, '..', '..', '..', 'docs', 'reference', 'cli.md');
const machineSpecPath = path.resolve(__dirname, '..', '..', '..', 'docs', 'reference', 'cli-spec.json');

class PulseProjectError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PulseProjectError';
    this.code = code;
    this.detail = detail;
  }
}

function unavailable(name) {
  return () => { throw new Error(`${name} is not available in the parser-only contract test`); };
}

function cachedModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

const previousConfig = require.cache[projectConfigPath];
const previousExecution = require.cache[projectExecutionPath];
const previousWorkflow = require.cache[workflowPath];

require.cache[projectConfigPath] = cachedModule(projectConfigPath, {
  PROJECT_CONFIG_VERSION: 'pulse.project-config.v4',
  PROJECT_PROVIDERS: Object.freeze(['node', 'fastly', 'none']),
  CONFIG_FILE_NAMES: Object.freeze(['.pulse/config.ts']),
  PulseProjectError,
  resolveProject: unavailable('resolveProject'),
  projectJson: unavailable('projectJson')
});
require.cache[projectExecutionPath] = cachedModule(projectExecutionPath, {
  PROJECT_EXECUTION_VERSION: 'pulse.project-execution.v9',
  compileNativeProject: unavailable('compileNativeProject'),
  buildProject: unavailable('buildProject'),
  runProjectTests: unavailable('runProjectTests'),
  inspectProject: unavailable('inspectProject'),
  doctorProject: unavailable('doctorProject'),
  startDevServer: unavailable('startDevServer'),
  initProject: unavailable('initProject'),
  errorSummary: (error) => ({ code: error && error.code, message: error && error.message })
});
delete require.cache[workflowPath];

let workflow;
let parseCommandRequest;
try {
  workflow = require(workflowPath);
  ({ parseCommandRequest } = require(path.join(cliRoot, 'src', 'internal', 'command-request.js')));
} finally {
  if (previousConfig) require.cache[projectConfigPath] = previousConfig;
  else delete require.cache[projectConfigPath];
  if (previousExecution) require.cache[projectExecutionPath] = previousExecution;
  else delete require.cache[projectExecutionPath];
  if (previousWorkflow) require.cache[workflowPath] = previousWorkflow;
  else delete require.cache[workflowPath];
}

const {
  COMMANDS,
  PUBLIC_COMMAND_ORDER,
  COMMAND_SPECS,
  OPTION_SPECS,
  META_INVOCATIONS,
  publicCommandSpecDocument,
  optionDisplay,
  optionDescription
} = require(commandSpecPath);
const { usage } = workflow;
const { COMPLETION_SHELLS, renderCompletion, completionFile } = require(path.join(cliRoot, 'src', 'completion.js'));
const help = usage();
const reference = fs.readFileSync(referencePath, 'utf8');
const publicOptions = OPTION_SPECS.filter((option) => option.visibility === 'public');

assert.deepEqual(workflow.COMMANDS, COMMANDS, 'workflow command surface must use the canonical command specification');
assert.deepEqual(PUBLIC_COMMAND_ORDER, ['init', 'doctor', 'inspect', 'test', 'dev', 'compile', 'build']);
assert.equal(publicOptions.length, 17, 'the CLI must expose exactly 17 documented option contracts');
assert.equal(OPTION_SPECS.every((option) => option.visibility === 'public'), true, 'the product parser must not retain repository-only controls');

for (const command of PUBLIC_COMMAND_ORDER) {
  assert.ok(COMMAND_SPECS[command], `missing command specification for ${command}`);
  for (const signature of COMMAND_SPECS[command].usage) {
    assert.ok(help.includes(signature), `public help is missing usage signature: ${signature}`);
    assert.ok(reference.includes(signature), `CLI reference is missing usage signature: ${signature}`);
  }
  for (const example of COMMAND_SPECS[command].examples) {
    assert.ok(reference.includes(example), `CLI reference is missing ${command} example: ${example}`);
  }
  for (const code of COMMAND_SPECS[command].diagnostics) {
    assert.ok(reference.includes(`diagnostics.md#${code.toLowerCase().replace(/_/g, '-')}`), `CLI reference is missing ${command} diagnostic: ${code}`);
  }
}
for (const invocation of META_INVOCATIONS) assert.ok(help.includes(invocation.syntax), `public help is missing meta invocation: ${invocation.syntax}`);

function valueFor(option) {
  if (option.parse === 'number') return { source: '4312', expected: 4312 };
  if (option.id === 'artifact') return { source: 'artifact.json', expected: 'artifact.json' };
  if (option.id === 'case') return { source: 'smoke', expected: 'smoke' };
  if (option.id === 'name') return { source: '@example/pulse-app', expected: '@example/pulse-app' };
  return { source: 'sample-value', expected: 'sample-value' };
}

for (const option of publicOptions) {
  const command = option.commands === 'all' ? 'build' : option.commands[0];
  for (const flag of option.flags) {
    let token = flag.name;
    let expected = true;
    if (option.kind === 'boolean-value') expected = flag.value;
    if (option.kind === 'value') {
      const value = valueFor(option);
      token = `${flag.name}=${value.source}`;
      expected = value.expected;
    }
    const parsed = parseCommandRequest([command, token]);
    assert.equal(parsed[option.key], expected, `${flag.name} must parse into ${option.key}`);
    assert.ok(help.includes(flag.name), `public help is missing ${flag.name}`);
    assert.ok(reference.includes(flag.name), `CLI reference is missing ${flag.name}`);
  }
}

assert.deepEqual(parseCommandRequest([]), { kind: 'meta', invocation: 'help' });
assert.deepEqual(parseCommandRequest(['help']), { kind: 'meta', invocation: 'help' });
assert.deepEqual(parseCommandRequest(['--version']), { kind: 'meta', invocation: 'version' });
assert.deepEqual(parseCommandRequest(['-v']), { kind: 'meta', invocation: 'version' });
assert.deepEqual(parseCommandRequest(['version']), { kind: 'meta', invocation: 'version' });

assert.deepEqual(parseCommandRequest(['completion', 'bash']), { kind: 'meta', invocation: 'completion', shell: 'bash' });
assert.deepEqual(parseCommandRequest(['completion', 'ZSH']), { kind: 'meta', invocation: 'completion', shell: 'zsh' });
assert.throws(
  () => parseCommandRequest(['completion']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED'
);
assert.throws(
  () => parseCommandRequest(['completion', 'powershell']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED'
);

const expectedMachineSpec = JSON.parse(JSON.stringify(publicCommandSpecDocument({ version: releaseVersion, completionShells: COMPLETION_SHELLS })));
assert.deepEqual(JSON.parse(fs.readFileSync(machineSpecPath, 'utf8')), expectedMachineSpec);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cliRoot, 'cli-spec.json'), 'utf8')), expectedMachineSpec);
for (const shell of COMPLETION_SHELLS) {
  const generated = renderCompletion(shell);
  const shipped = fs.readFileSync(path.join(cliRoot, 'completions', completionFile(shell)), 'utf8');
  assert.equal(shipped, generated, `${shell} completion must be generated from the public command spec`);
}

assert.equal(parseCommandRequest(['init', 'apps/demo']).target, 'apps/demo');
assert.equal(parseCommandRequest(['inspect', 'build/pulse-build.json']).directory, 'build/pulse-build.json');
assert.equal(parseCommandRequest(['inspect', 'examples/hello']).directory, 'examples/hello');
assert.equal(parseCommandRequest(['build', 'examples/hello']).directory, 'examples/hello');
assert.equal(parseCommandRequest(['build', '--experimental-native-size']).experimentalNativeSize, true);
assert.equal(parseCommandRequest(['compile', 'examples/hello']).directory, 'examples/hello');
assert.equal(parseCommandRequest(['compile', '--experimental-native-size']).experimentalNativeSize, true);
assert.equal(parseCommandRequest(['test', '--profile=local']).profile, 'local');

for (const removed of ['--project', '--workspace', '--entry', '--config', '--fixture', '--suite-profile', '--suite-task', '--report', '--no-report']) {
  assert.throws(
    () => parseCommandRequest(['test', removed, 'value']),
    (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED',
    `${removed} must be absent from the product parser`
  );
}

assert.equal(publicOptions.some((option) => option.id === 'provider'), false, 'provider selection must live in project configuration');
assert.equal(publicOptions.some((option) => option.id === 'source-only'), false, 'source-only JavaScript packaging must not remain public');
assert.equal(help.includes('--provider'), false);
assert.equal(help.includes('--source-only'), false);

assert.throws(
  () => parseCommandRequest(['unknown']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_COMMAND_UNKNOWN'
);
assert.throws(
  () => parseCommandRequest(['doctor', '--clean']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED'
);
assert.throws(
  () => parseCommandRequest(['dev', '--source-only']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_SOURCE_ONLY_REMOVED'
);
assert.throws(
  () => parseCommandRequest(['build', '--watch']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED'
);
assert.throws(
  () => parseCommandRequest(['compile', '--provider', 'fastly']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_PROVIDER_FLAG_REMOVED'
);
assert.throws(
  () => parseCommandRequest(['build', '--provider=fastly']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_PROVIDER_FLAG_REMOVED'
);
assert.throws(
  () => parseCommandRequest(['build', 'one', 'two']),
  (error) => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED'
);

console.log(`ok - CLI parser, help, machine spec, and ${COMPLETION_SHELLS.length} completions agree on ${COMMANDS.length} commands and ${publicOptions.length} public options with no hidden product controls`);
