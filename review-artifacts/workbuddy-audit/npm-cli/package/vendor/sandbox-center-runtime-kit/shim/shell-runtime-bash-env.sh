# CodeBuddy bash runtime environment — sourced via BASH_ENV for bash subprocesses.
# Keep feature-specific bootstrap scripts separate and compose them here.
__codebuddy_shell_runtime_source="${BASH_SOURCE[0]}"
case "$OSTYPE" in
    msys*|cygwin*) __codebuddy_shell_runtime_source="${__codebuddy_shell_runtime_source//\\//}" ;;
esac
case "$__codebuddy_shell_runtime_source" in
    */*) __codebuddy_shell_runtime_dir="${__codebuddy_shell_runtime_source%/*}" ;;
    *) __codebuddy_shell_runtime_dir="." ;;
esac
__codebuddy_shell_runtime_dir="$(cd -- "${__codebuddy_shell_runtime_dir:-/}" && pwd)"

[ ! -f "${__codebuddy_shell_runtime_dir}/safe-bin/safe-delete-bash-env.sh" ] || . "${__codebuddy_shell_runtime_dir}/safe-bin/safe-delete-bash-env.sh"
[ ! -f "${__codebuddy_shell_runtime_dir}/brokered-sandbox-bash-env.sh" ] || . "${__codebuddy_shell_runtime_dir}/brokered-sandbox-bash-env.sh"

unset __codebuddy_shell_runtime_dir __codebuddy_shell_runtime_source
