'use strict';

const {
  PUBLIC_COMMAND_ORDER,
  COMMAND_SPECS,
  publicOptionsForCommand
} = require('./command-spec.js');

const COMPLETION_SHELLS = Object.freeze(['bash', 'zsh', 'fish']);
const META_WORDS = Object.freeze(['completion', 'help', 'version', '--help', '-h', '--version', '-v']);

function optionNames(command) {
  return Object.freeze(publicOptionsForCommand(command).flatMap((option) => option.flags.map((flag) => flag.name)));
}

function valueChoices() {
  return Object.freeze([]);
}

function bashCompletion() {
  const commands = [...PUBLIC_COMMAND_ORDER, ...META_WORDS].join(' ');
  const commandCases = PUBLIC_COMMAND_ORDER.map((command) => `    ${command}) words=${JSON.stringify(optionNames(command).join(' '))} ;;`).join('\n');
  return `# Generated from @pulse-compute/cli/src/command-spec.js.\n# Install for the current shell with: source <(pulse completion bash)\n_pulse_completion() {\n  local cur command words\n  COMPREPLY=()\n  cur="\${COMP_WORDS[COMP_CWORD]}"\n  command="\${COMP_WORDS[1]}"\n\n  if (( COMP_CWORD == 1 )); then\n    COMPREPLY=( $(compgen -W ${JSON.stringify(commands)} -- "$cur") )\n    return 0\n  fi\n\n  if [[ "$command" == "completion" ]]; then\n    COMPREPLY=( $(compgen -W ${JSON.stringify(COMPLETION_SHELLS.join(' '))} -- "$cur") )\n    return 0\n  fi\n\n  case "$command" in\n${commandCases}\n    *) words=${JSON.stringify(commands)} ;;\n  esac\n  COMPREPLY=( $(compgen -W "$words" -- "$cur") )\n}\ncomplete -F _pulse_completion pulse\n`;
}

function zshEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

function zshValueCompletion(option, command) {
  if (option.kind !== 'value') return '';
  if (['project', 'out'].includes(option.id)) return ':directory:_directories';
  if (['config', 'entry', 'artifact'].includes(option.id)) return ':file:_files';
  return ':value:';
}

function zshCompletion() {
  const commands = PUBLIC_COMMAND_ORDER.map((name) => `    '${zshEscape(name)}:${zshEscape(COMMAND_SPECS[name].summary)}'`).join('\n');
  const commandCases = PUBLIC_COMMAND_ORDER.map((command) => {
    const options = publicOptionsForCommand(command).flatMap((option) => {
      const description = zshEscape(option.descriptionByCommand?.[command] || option.description);
      const value = zshValueCompletion(option, command);
      return option.flags.map((flag) => `      '${zshEscape(flag.name)}[${description}]${value}'`);
    }).join(' \\\n');
    return `    ${command})\n      _arguments -s ${options || "'*:argument:_files'"}\n      ;;`;
  }).join('\n');
  return `#compdef pulse\n# Generated from @pulse-compute/cli/src/command-spec.js.\nlocal -a commands\ncommands=(\n${commands}\n    'completion:Print a generated shell completion script'\n    'help:Print public help'\n    'version:Print the installed CLI version'\n    '--help:Print public help'\n    '-h:Print public help'\n    '--version:Print the installed CLI version'\n    '-v:Print the installed CLI version'\n)\n\nif (( CURRENT == 2 )); then\n  _describe 'pulse command' commands\n  return\nfi\n\ncase $words[2] in\n  completion)\n    _values 'shell' ${COMPLETION_SHELLS.join(' ')}\n    ;;\n${commandCases}\n  *)\n    _describe 'pulse command' commands\n    ;;\nesac\n`;
}

function fishDescription(value) {
  return String(value).replace(/'/g, "\\'");
}

function fishCompletion() {
  const lines = [
    '# Generated from @pulse-compute/cli/src/command-spec.js.',
    '# Install for the current shell with: pulse completion fish | source',
    'complete -c pulse -f'
  ];
  for (const command of PUBLIC_COMMAND_ORDER) {
    lines.push(`complete -c pulse -n '__fish_use_subcommand' -a '${command}' -d '${fishDescription(COMMAND_SPECS[command].summary)}'`);
  }
  lines.push("complete -c pulse -n '__fish_use_subcommand' -a 'completion' -d 'Print a generated shell completion script'");
  lines.push("complete -c pulse -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'");
  lines.push("complete -c pulse -n '__fish_use_subcommand' -a 'help version'");
  lines.push("complete -c pulse -n '__fish_use_subcommand' -l help -d 'Print public help'");
  lines.push("complete -c pulse -n '__fish_use_subcommand' -s h -d 'Print public help'");
  lines.push("complete -c pulse -n '__fish_use_subcommand' -l version -d 'Print the installed CLI version'");
  lines.push("complete -c pulse -n '__fish_use_subcommand' -s v -d 'Print the installed CLI version'");
  for (const command of PUBLIC_COMMAND_ORDER) {
    for (const option of publicOptionsForCommand(command)) {
      for (const flag of option.flags) {
        const parts = [`complete -c pulse -n '__fish_seen_subcommand_from ${command}'`];
        if (flag.name.startsWith('--')) parts.push(`-l ${flag.name.slice(2)}`);
        else if (flag.name.startsWith('-')) parts.push(`-s ${flag.name.slice(1)}`);
        if (option.kind === 'value') {
          parts.push('-r');
          const choices = valueChoices(option.id, command);
          if (choices.length) parts.push(`-a '${choices.join(' ')}'`);
        }
        parts.push(`-d '${fishDescription(option.descriptionByCommand?.[command] || option.description)}'`);
        lines.push(parts.join(' '));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderCompletion(shell) {
  const normalized = String(shell || '').toLowerCase();
  if (normalized === 'bash') return bashCompletion();
  if (normalized === 'zsh') return zshCompletion();
  if (normalized === 'fish') return fishCompletion();
  const error = new Error(`Unsupported completion shell ${shell}. Choose bash, zsh, or fish.`);
  error.code = 'PULSE_ARGUMENT_UNEXPECTED';
  throw error;
}

function completionFile(shell) {
  if (shell === 'bash') return 'pulse.bash';
  if (shell === 'zsh') return '_pulse';
  if (shell === 'fish') return 'pulse.fish';
  throw new Error(`Unsupported completion shell ${shell}`);
}

module.exports = Object.freeze({
  COMPLETION_SHELLS,
  META_WORDS,
  optionNames,
  valueChoices,
  renderCompletion,
  completionFile
});
