'use strict';

const COMMAND_SPEC_VERSION = 'pulse.cli-command-spec.v5';
const COMMANDS = Object.freeze(['init', 'dev', 'test', 'inspect', 'compile', 'build', 'doctor']);
const PUBLIC_COMMAND_ORDER = Object.freeze(['init', 'doctor', 'inspect', 'test', 'dev', 'compile', 'build']);

function freezeOption(value) {
  return Object.freeze({
    ...value,
    flags: Object.freeze(value.flags.map((entry) => Object.freeze(typeof entry === 'string' ? { name: entry } : { ...entry }))),
    commands: value.commands === 'all' ? 'all' : Object.freeze([...value.commands]),
    valueNameByCommand: value.valueNameByCommand ? Object.freeze({ ...value.valueNameByCommand }) : undefined,
    descriptionByCommand: value.descriptionByCommand ? Object.freeze({ ...value.descriptionByCommand }) : undefined
  });
}

const OPTION_SPECS = Object.freeze([
  freezeOption({ id: 'help', key: 'help', flags: ['--help', '-h'], kind: 'boolean', commands: 'all', visibility: 'public', description: 'Print public CLI help and exit.' }),
  freezeOption({ id: 'json', key: 'json', flags: ['--json'], kind: 'boolean', commands: 'all', visibility: 'public', description: 'Emit machine-readable JSON. pulse dev emits one JSON event per line.' }),
  freezeOption({ id: 'dry-run', key: 'dryRun', flags: ['--dry-run', '--plan'], kind: 'boolean', commands: 'all', visibility: 'public', description: 'Resolve and report the command plan without executing it.' }),
  freezeOption({ id: 'force', key: 'force', flags: ['--force'], kind: 'boolean', commands: ['init'], visibility: 'public', description: 'Allow generated files to replace entries in a non-empty target directory.' }),
  freezeOption({ id: 'strict', key: 'strict', flags: ['--strict'], kind: 'boolean', commands: ['doctor'], visibility: 'public', description: 'Treat doctor warnings as failed checks.' }),
  freezeOption({ id: 'once', key: 'once', flags: ['--once'], kind: 'boolean', commands: ['dev'], visibility: 'public', description: 'Close the development server after the first completed request.' }),
  freezeOption({ id: 'watch', key: 'watch', flags: [{ name: '--watch', value: true }, { name: '--no-watch', value: false }], kind: 'boolean-value', commands: ['dev'], visibility: 'public', description: 'Enable or disable entry and schema dependency watching. Watching is enabled by default.' }),
  freezeOption({ id: 'clean', key: 'clean', flags: [{ name: '--clean', value: true }, { name: '--no-clean', value: false }], kind: 'boolean-value', commands: ['compile', 'build'], visibility: 'public', description: 'Remove or preserve the selected output directory before writing artifacts. Cleaning is enabled by default.' }),
  freezeOption({ id: 'emit-wat', key: 'emitWat', flags: ['--emit-wat'], kind: 'boolean', commands: ['compile', 'build'], visibility: 'public', description: 'Also emit diagnostic WebAssembly text (WAT). Native builds omit it by default; large text emission can exhaust compiler string capacity.' }),
  freezeOption({ id: 'experimental-native-size', key: 'experimentalNativeSize', flags: ['--experimental-native-size'], kind: 'boolean', commands: ['compile', 'build'], visibility: 'public', description: 'Experimentally optimize Native Wasm for size. JavaScript build targets reject this flag.' }),

  freezeOption({ id: 'profile', key: 'profile', flags: ['--profile'], kind: 'value', valueName: '<profile>', commands: ['doctor', 'inspect', 'test', 'dev', 'compile', 'build'], visibility: 'public', description: 'Select a project profile. Precedence: --profile, PULSE_PROFILE, pulse.defaultProfile.' }),
  freezeOption({ id: 'out', key: 'outDir', flags: ['--out'], kind: 'value', valueName: '<dir>', commands: ['compile', 'build'], visibility: 'public', description: 'Override the project-relative artifact output directory.' }),
  freezeOption({ id: 'host', key: 'host', flags: ['--host'], kind: 'value', valueName: '<host>', commands: ['dev'], visibility: 'public', description: 'Override the development listen host.' }),
  freezeOption({ id: 'port', key: 'port', flags: ['--port'], kind: 'value', valueName: '<port>', parse: 'number', commands: ['dev'], visibility: 'public', description: 'Override the development listen port. Use 0 to request an ephemeral port.' }),
  freezeOption({ id: 'artifact', key: 'artifact', flags: ['--artifact'], kind: 'value', valueName: '<file.json>', commands: ['inspect'], visibility: 'public', description: 'Inspect an existing JSON build or compiler artifact instead of a project.' }),
  freezeOption({ id: 'case', key: 'caseName', flags: ['--case'], kind: 'value', valueName: '<name>', commands: ['test'], visibility: 'public', description: 'Run one named project test case.' }),
  freezeOption({ id: 'name', key: 'name', flags: ['--name'], kind: 'value', valueName: '<package-name>', commands: ['init'], visibility: 'public', description: 'Set the generated npm package name.' })
]);

function freezeCommand(value) {
  return Object.freeze({
    ...value,
    usage: Object.freeze([...value.usage]),
    positionals: Object.freeze([...(value.positionals || [])].map((entry) => Object.freeze({ ...entry }))),
    optionIds: Object.freeze([...value.optionIds]),
    examples: Object.freeze([...(value.examples || [])]),
    diagnostics: Object.freeze([...(value.diagnostics || [])]),
    outputs: Object.freeze([...(value.outputs || [])]),
    sideEffects: Object.freeze([...(value.sideEffects || [])])
  });
}

const COMMAND_SPECS = Object.freeze({
  init: freezeCommand({
    name: 'init',
    summary: 'Create a conventional .pulse workspace with an async Pulse application and dedicated test harness.',
    usage: ['pulse init [directory] [--name <package-name>] [--force]'],
    positionals: [{ name: 'directory', key: 'target', description: 'Target directory. Defaults to the current directory.' }],
    optionIds: ['name', 'force'],
    examples: ['pulse init ./my-pulse-app', 'pulse init ./edge-app --name @example/edge-app'],
    diagnostics: ['PULSE_INIT_NOT_EMPTY', 'PULSE_INIT_FILE_EXISTS', 'PULSE_PROVIDER_UNSUPPORTED'],
    outputs: ['Human output lists generated files and next steps.', 'With --json, emits one initialization result object.'],
    sideEffects: ['Creates .pulse/config.ts, an async Pulse application, a dedicated test harness, package scripts, and documentation.', 'Does not install dependencies or run npm, pnpm, or any network operation.'],
    exit: '0 on success; 2 for invalid usage, provider selection, or unsafe overwrite conditions.'
  }),
  doctor: freezeCommand({
    name: 'doctor',
    summary: 'Audit project shape, compilation, schemas, provider bindings, output safety, and required tools.',
    usage: ['pulse doctor [directory] [--profile <name>] [--strict]'],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'strict'],
    examples: ['pulse doctor ./my-pulse-app', 'pulse doctor ./edge-app --strict --json'],
    diagnostics: ['PULSE_CONFIG_NOT_FOUND', 'PULSE_PROJECT_COMPILE_FAILED', 'PULSE_NODE_VERSION_UNSUPPORTED', 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED'],
    outputs: ['Human output prints every check.', 'With --json, emits one completed audit object including failed and warning checks.'],
    sideEffects: ['Reads and compiles the project.', 'Does not write the build output.'],
    exit: '0 when the audit passes; 1 when a completed audit contains failed checks; 2–5 only when the audit command itself cannot be completed.'
  }),
  inspect: freezeCommand({
    name: 'inspect',
    summary: 'Report canonical compiler, schema, effect, continuation, capability, provider, and build-mode details.',
    usage: [
      'pulse inspect [directory] [--profile <name>]',
      'pulse inspect --artifact <file.json>'
    ],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'artifact'],
    examples: ['pulse inspect ./my-pulse-app --json', 'pulse inspect --artifact ./dist/pulse-build.json'],
    diagnostics: ['PULSE_CONFIG_NOT_FOUND', 'PULSE_PROJECT_COMPILE_FAILED', 'PULSE_CANONICAL_COMPILE_FAILED'],
    outputs: ['Human output prints a compact project/compiler summary.', 'With --json, emits one inspection or artifact object.'],
    sideEffects: ['Compiles and validates the project in memory.', 'Does not write the build output.'],
    exit: '0 on success; 2–5 according to the emitted stable diagnostic.'
  }),
  test: freezeCommand({
    name: 'test',
    summary: 'Run configured cases through the selected provider local-conformance runtime.',
    usage: ['pulse test [directory] [--profile <name>] [--case <name>]'],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'case'],
    examples: ['pulse test ./my-pulse-app', 'pulse test ./my-pulse-app --case smoke --json'],
    diagnostics: ['PULSE_TEST_PROVIDER_REQUIRED', 'PULSE_PROVIDER_CAPABILITY_MISSING', 'PULSE_SCHEMA_DECODE'],
    outputs: ['Human output uses TAP-like case lines and a summary.', 'With --json, emits one test-run object; expected stable errors remain inside their case results.'],
    sideEffects: ['Compiles the project and executes configured deterministic or live fixtures.', 'Does not write the build output.'],
    exit: '0 when all selected cases pass; 1 when the completed test run has failed cases; 2–5 when setup, compilation, runtime, or toolchain execution fails before a normal result.'
  }),
  dev: freezeCommand({
    name: 'dev',
    summary: 'Start the foreground local server with the selected provider conformance runtime.',
    usage: ['pulse dev [directory] [--profile <name>] [--host <host>] [--port <port>] [--watch|--no-watch] [--once]'],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'host', 'port', 'watch', 'once'],
    examples: ['pulse dev ./my-pulse-app', 'pulse dev ./my-pulse-app --port 0 --once --json'],
    diagnostics: ['PULSE_DEV_PROVIDER_UNSUPPORTED', 'PULSE_REQUEST_BODY_TOO_LARGE', 'PULSE_FETCH_NETWORK'],
    outputs: ['Human output reports the ready URL and reload or error messages.', 'With --json, stdout is newline-delimited JSON events: compiled, ready, reloaded, request, compile-error, and request-error. It is not one enclosing JSON document.'],
    sideEffects: ['Binds a foreground HTTP listener.', 'Watches the entry and schema dependency graph by default.', 'Configuration-file changes require restarting the command.'],
    exit: '0 after a normal server close; 2–5 when setup, compilation, provider, runtime, or toolchain initialization fails.'
  }),
  compile: freezeCommand({
    name: 'compile',
    summary: 'Compile the canonical project into provider-neutral Pulse-owned WebAssembly.',
    usage: ['pulse compile [directory] [--profile <name>] [--out <dir>] [--clean|--no-clean] [--experimental-native-size] [--emit-wat]'],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'out', 'clean', 'experimental-native-size', 'emit-wat'],
    examples: ['pulse compile ./my-pulse-app', 'pulse compile ./edge-app --out ./dist --json', 'pulse compile ./edge-app --experimental-native-size'],
    diagnostics: ['PULSE_BUILD_OUT_UNSAFE', 'PULSE_CANONICAL_NATIVE_PLAN_FAILED', 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED'],
    outputs: ['Writes pulse-compile.json, the canonical program, native plan, generated AssemblyScript, compact Wasm, and native manifest; --emit-wat adds diagnostic WAT.', 'The output is provider-neutral and does not package a deployment provider runtime.', 'Experimental size builds record the exact non-default Native compiler optimization settings.', 'With --json, emits one compile result object containing exact artifact paths and native metadata.'],
    sideEffects: ['Cleans the output directory by default.', 'Invokes the lockfile-pinned AssemblyScript compiler.', 'Refuses absolute, parent-traversal, and symbolic-link traversal outside the project root.'],
    exit: '0 on success; 2–5 according to the emitted stable diagnostic.'
  }),
  build: freezeCommand({
    name: 'build',
    summary: 'Compile the canonical project and realize the deployment provider selected by the active project profile.',
    usage: ['pulse build [directory] [--profile <name>] [--out <dir>] [--clean|--no-clean] [--experimental-native-size] [--emit-wat]'],
    positionals: [{ name: 'directory', key: 'directory', description: 'Project discovery start. Defaults to the current directory.' }],
    optionIds: ['profile', 'out', 'clean', 'experimental-native-size', 'emit-wat'],
    examples: ['pulse build ./my-pulse-app', 'pulse build ./edge-app --out ./dist --json', 'pulse build ./edge-app --experimental-native-size'],
    diagnostics: ['PULSE_BUILD_OUT_UNSAFE', 'PULSE_BUILD_PROVIDER_REQUIRED', 'PULSE_EXPERIMENTAL_NATIVE_SIZE_UNSUPPORTED', 'PULSE_NATIVE_TEXT_UNSUPPORTED', 'PULSE_CANONICAL_NATIVE_COMPILE_FAILED'],
    outputs: ['Writes pulse-build.json, the provider-neutral native module, and the configured provider realization; Native --emit-wat builds also write diagnostic WAT.', 'Fastly builds write generated AssemblyScript and direct-host-ABI native Wasm at bin/main.wasm; no JavaScript runtime image is packaged.', 'Experimental size builds record the exact non-default Native compiler optimization settings in portable, provider, and build metadata.', 'With --json, emits one build result object containing exact portable and provider artifact paths.'],
    sideEffects: ['Cleans the output directory by default.', 'Invokes the native compiler and configured provider realization.', 'Refuses absolute, parent-traversal, and symbolic-link traversal outside the project root.'],
    exit: '0 on success; 2–5 according to the emitted stable diagnostic.'
  })
});

const META_INVOCATIONS = Object.freeze([
  Object.freeze({ syntax: 'pulse --help | pulse -h | pulse help', description: 'Print public help.' }),
  Object.freeze({ syntax: 'pulse --version | pulse -v | pulse version', description: 'Print the installed CLI package version.' }),
  Object.freeze({ syntax: 'pulse completion <bash|zsh|fish>', description: 'Print a shell completion script generated from the public command specification.' })
]);

const OPTION_BY_FLAG = new Map();
for (const option of OPTION_SPECS) {
  for (const flag of option.flags) OPTION_BY_FLAG.set(flag.name, Object.freeze({ option, flag }));
}

function optionForToken(token) {
  const exact = OPTION_BY_FLAG.get(token);
  if (exact) return exact;
  if (!String(token).startsWith('--') || !String(token).includes('=')) return undefined;
  const name = String(token).slice(0, String(token).indexOf('='));
  const found = OPTION_BY_FLAG.get(name);
  if (!found || found.option.kind !== 'value') return undefined;
  return found;
}

function optionAllowed(option, command) {
  return option.commands === 'all' || option.commands.includes(command);
}

function publicOptionsForCommand(command) {
  const commandSpec = COMMAND_SPECS[command];
  if (!commandSpec) return Object.freeze([]);
  const ids = new Set(['help', 'json', 'dry-run', ...commandSpec.optionIds]);
  return Object.freeze(OPTION_SPECS.filter((option) => option.visibility === 'public' && ids.has(option.id) && optionAllowed(option, command)));
}

function optionDisplay(option, command) {
  const valueName = command && option.valueNameByCommand && option.valueNameByCommand[command]
    ? option.valueNameByCommand[command]
    : option.valueName;
  return option.flags.map((flag) => `${flag.name}${option.kind === 'value' ? ` ${valueName}` : ''}`).join(', ');
}

function optionDescription(option, command) {
  return command && option.descriptionByCommand && option.descriptionByCommand[command]
    ? option.descriptionByCommand[command]
    : option.description;
}

function publicCommandSpecDocument(options = {}) {
  const version = String(options.version || 'unknown');
  const completionShells = Object.freeze([...(options.completionShells || [])]);
  const globalIds = new Set(['help', 'json', 'dry-run']);
  function serializeOption(option, command) {
    return Object.freeze({
      id: option.id,
      key: option.key,
      flags: Object.freeze(option.flags.map((flag) => Object.freeze({ ...flag }))),
      kind: option.kind,
      valueName: command && option.valueNameByCommand && option.valueNameByCommand[command]
        ? option.valueNameByCommand[command]
        : option.valueName,
      description: optionDescription(option, command),
      unsupportedCode: option.unsupportedCode
    });
  }
  return Object.freeze({
    schemaVersion: COMMAND_SPEC_VERSION,
    cliVersion: version,
    completionShells,
    metaInvocations: Object.freeze(META_INVOCATIONS.map((entry) => Object.freeze({ ...entry }))),
    globalOptions: Object.freeze(OPTION_SPECS
      .filter((entry) => entry.visibility === 'public' && globalIds.has(entry.id))
      .map((entry) => serializeOption(entry))),
    commands: Object.freeze(PUBLIC_COMMAND_ORDER.map((name) => {
      const command = COMMAND_SPECS[name];
      return Object.freeze({
        name,
        summary: command.summary,
        usage: command.usage,
        positionals: command.positionals,
        options: Object.freeze(publicOptionsForCommand(name)
          .filter((entry) => !globalIds.has(entry.id))
          .map((entry) => serializeOption(entry, name))),
        examples: command.examples,
        diagnostics: command.diagnostics,
        outputs: command.outputs,
        sideEffects: command.sideEffects,
        exit: command.exit
      });
    }))
  });
}

function renderUsage(options = {}) {
  const version = String(options.version || 'unknown');
  const configFiles = options.configFiles || [];
  const lines = [
    `Pulse CLI ${version}`,
    '',
    'Meta commands:'
  ];
  for (const entry of META_INVOCATIONS) lines.push(`  ${entry.syntax}`, `    ${entry.description}`);
  lines.push('', 'Usage:');
  for (const command of PUBLIC_COMMAND_ORDER) {
    for (const signature of COMMAND_SPECS[command].usage) lines.push(`  ${signature}`);
  }
  lines.push('', 'Global options:');
  for (const option of OPTION_SPECS.filter((entry) => entry.visibility === 'public' && ['help', 'json', 'dry-run'].includes(entry.id))) {
    lines.push(`  ${optionDisplay(option).padEnd(26)} ${optionDescription(option)}`);
  }
  lines.push('', 'Command options:');
  for (const command of PUBLIC_COMMAND_ORDER) {
    const commandOptions = publicOptionsForCommand(command).filter((entry) => !['help', 'json', 'dry-run'].includes(entry.id));
    lines.push(`  ${command}:`);
    for (const option of commandOptions) lines.push(`    ${optionDisplay(option, command).padEnd(30)} ${optionDescription(option, command)}`);
  }
  lines.push(
    '',
    'Project config search:',
    `  ${configFiles.join(', ')}`,
    '',
    'Use --dry-run or --plan to resolve a command without executing it.',
    'Project discovery starts from [directory] or the current directory and searches upward for .pulse/config.ts.',
    'Provider selection belongs in the active profile; pulse compile is provider-neutral and pulse build realizes the selected provider.'
  );
  return `${lines.join('\n')}\n`;
}

module.exports = Object.freeze({
  COMMAND_SPEC_VERSION,
  COMMANDS,
  PUBLIC_COMMAND_ORDER,
  COMMAND_SPECS,
  OPTION_SPECS,
  META_INVOCATIONS,
  optionForToken,
  optionAllowed,
  publicOptionsForCommand,
  optionDisplay,
  optionDescription,
  publicCommandSpecDocument,
  renderUsage
});
