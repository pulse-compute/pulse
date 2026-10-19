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

const { PulseProjectError } = require(path.join(cliRoot, 'src/internal/project-error.js'));

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
  publicOptionsForCommand,
  optionDisplay,
  optionDescription
} = require(commandSpecPath);
const { usage } = workflow;
const { COMPLETION_SHELLS, renderCompletion, completionFile } = require(path.join(cliRoot, 'src', 'completion.js'));
const help = usage();
const reference = fs.readFileSync(referencePath, 'utf8');
const publicOptions = OPTION_SPECS.filter((option) => option.visibility === 'public');

assert.deepEqual(workflow.COMMANDS, COMMANDS, 'workflow command surface must use the canonical command specification');
assert.deepEqual(PUBLIC_COMMAND_ORDER, ['init', 'doctor', 'inspect', 'test', 'dev', 'compile', 'build', 'report']);
assert.equal(publicOptions.length, 20, 'the CLI must expose exactly 20 documented option contracts');
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
// Every catalog command has exactly one index link and an existing detail anchor.
const commandIndex = reference.split('## Command index\n')[1]?.split('\n## Meta invocations')[0];
assert.ok(commandIndex, 'CLI reference must have a compact command index before the detail sections');
assert.deepEqual([...commandIndex.matchAll(/\[\x60pulse (\w+)\x60\]\(#pulse-(\w+)\)/g)].map((match) => {
  assert.equal(match[1], match[2], 'command index links must resolve to their command headings');
  assert.ok(reference.includes(`## \x60pulse ${match[1]}\x60\n`));
  return match[1];
}), [...PUBLIC_COMMAND_ORDER]);
for (const name of PUBLIC_COMMAND_ORDER) {
  const section = reference.split(`## \x60pulse ${name}\x60\n`)[1].split('\n## ')[0];
  for (const detail of [...COMMAND_SPECS[name].outputs, ...COMMAND_SPECS[name].sideEffects, COMMAND_SPECS[name].exit]) {
    assert.ok(section.includes(detail), `${name} must retain its output, side-effect and exit contracts`);
  }
}
const buildDescription = COMMAND_SPECS.build.outputs.join(' ') + ' ' + COMMAND_SPECS.build.sideEffects.join(' ');
assert.match(buildDescription, /Native builds include the provider-neutral native module/);
assert.match(buildDescription, /JavaScript builds emit a deterministic source package/);
assert.match(buildDescription, /Fastly Native builds.*without a JavaScript runtime image/);
assert.match(buildDescription, /Fastly JavaScript builds.*downstream compiler pins/);
assert.match(buildDescription, /JavaScript builds.*without invoking the Pulse Native compiler/);
const providerTable = reference.split('## Provider restrictions and build products')[1].split('## Exit classes')[0];
for (const provider of ['node', 'fastly']) {
  for (const target of ['Native', 'JavaScript']) {
    assert.ok(providerTable.includes(`| \x60${provider}\x60 | ${target} | Yes | Yes |`), `${provider} ${target} needs its own build row`);
  }
}
assert.ok(providerTable.includes('| `none` | Compile-only Native | Yes | No | No |'));
assert.match(providerTable, /Diagnostic WAT is opt-in/);
assert.match(COMMAND_SPECS.compile.outputs.join(' '), /--emit-wat adds diagnostic WAT/);
assert.equal(parseCommandRequest(['compile']).emitWat, undefined, 'WAT remains opt-in');

for (const invocation of META_INVOCATIONS) assert.ok(help.includes(invocation.syntax), `public help is missing meta invocation: ${invocation.syntax}`);

function valueFor(option) {
  if (option.parse === 'number') return { source: '4312', expected: 4312 };
  if (option.id === 'artifact') return { source: 'artifact.json', expected: 'artifact.json' };
  if (option.id === 'case') return { source: 'smoke', expected: 'smoke' };
  if (option.id === 'name') return { source: '@example/pulse-app', expected: '@example/pulse-app' };
  if (option.id === 'out') return { source: 'report.html', expected: 'report.html' };
  return { source: 'sample-value', expected: 'sample-value' };
}

// Audit every command/flag pair, including aliases, negative booleans and both
// value syntaxes. Scope-specific option descriptions must reach help and docs.
const globalIds = new Set(['help', 'json', 'dry-run']);
const globalReference = reference.split('## Global options\n')[1].split('\n## ')[0];
for (const command of PUBLIC_COMMAND_ORDER) {
  const section = reference.split(`## \x60pulse ${command}\x60\n`)[1].split('\n## ')[0];
  const declared = publicOptions.filter(option => option.commands === 'all' || option.commands.includes(command));
  assert.deepEqual(publicOptionsForCommand(command).map(option => option.id), declared.map(option => option.id),
    `${command} must expose every parser-allowed option in its public catalog`);
  for (const option of publicOptions) {
    const allowed = declared.includes(option);
    for (const flag of option.flags) {
      const value = option.kind === 'value' ? valueFor(option) : null;
      const forms = value ? [[flag.name, value.source], [`${flag.name}=${value.source}`]] : [[flag.name]];
      for (const form of forms) {
        // --out on report is intentionally valid only together with --html.
        const argv = [command, ...form, ...(command === 'report' && option.id === 'out' ? ['--html'] : [])];
        if (!allowed) {
          assert.throws(() => parseCommandRequest(argv), error => error.code === 'PULSE_ARGUMENT_UNEXPECTED',
            `${command} must reject ${flag.name}`);
          continue;
        }
        const expected = value ? value.expected : option.kind === 'boolean-value' ? flag.value : true;
        assert.equal(parseCommandRequest(argv)[option.key], expected, `${command} ${form.join(' ')} must parse`);
      }
    }
    if (allowed) {
      const display = optionDisplay(option, command);
      const description = optionDescription(option, command);
      assert.ok(help.includes(display), `public help is missing ${command} ${display}`);
      assert.ok(help.includes(description), `public help is missing ${command} option limits: ${option.id}`);
      assert.ok((globalIds.has(option.id) ? globalReference : section).includes(`| \x60${display}\x60 | ${description} |`),
        `reference must retain ${command} ${option.id} flags, value form and full description`);
    }
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
assert.equal(parseCommandRequest(['build', '--experimental-native-bounded-size']).experimentalNativeBoundedSize, true);
assert.throws(() => parseCommandRequest(['build', '--experimental-native-size', '--experimental-native-bounded-size']), error => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED');
assert.equal(parseCommandRequest(['compile', 'examples/hello']).directory, 'examples/hello');
assert.equal(parseCommandRequest(['compile', '--experimental-native-size']).experimentalNativeSize, true);
assert.equal(parseCommandRequest(['compile', '--experimental-native-bounded-size']).experimentalNativeBoundedSize, true);
for (const command of ['compile', 'build']) {
  assert.equal(parseCommandRequest([command, '--elide-json-cache-arena']).elideJsonCacheArena, true);
  assert.equal(parseCommandRequest([command]).elideJsonCacheArena, undefined, 'arena elision remains opt-in');
}
for (const command of ['init', 'doctor', 'inspect', 'test', 'dev', 'report']) {
  assert.throws(() => parseCommandRequest([command, '--elide-json-cache-arena']),
    error => error instanceof PulseProjectError && error.code === 'PULSE_ARGUMENT_UNEXPECTED');
}
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
