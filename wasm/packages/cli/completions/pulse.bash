# Generated from @pulse-compute/cli/src/command-spec.js.
# Install for the current shell with: source <(pulse completion bash)
_pulse_completion() {
  local cur command words
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  command="${COMP_WORDS[1]}"

  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W "init doctor inspect test dev compile build completion help version --help -h --version -v" -- "$cur") )
    return 0
  fi

  if [[ "$command" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
    return 0
  fi

  case "$command" in
    init) words="--help -h --json --dry-run --plan --force --name" ;;
    doctor) words="--help -h --json --dry-run --plan --strict --profile" ;;
    inspect) words="--help -h --json --dry-run --plan --profile --artifact" ;;
    test) words="--help -h --json --dry-run --plan --profile --case" ;;
    dev) words="--help -h --json --dry-run --plan --once --watch --no-watch --profile --host --port" ;;
    compile) words="--help -h --json --dry-run --plan --clean --no-clean --experimental-native-size --profile --out" ;;
    build) words="--help -h --json --dry-run --plan --clean --no-clean --experimental-native-size --profile --out" ;;
    *) words="init doctor inspect test dev compile build completion help version --help -h --version -v" ;;
  esac
  COMPREPLY=( $(compgen -W "$words" -- "$cur") )
}
complete -F _pulse_completion pulse
