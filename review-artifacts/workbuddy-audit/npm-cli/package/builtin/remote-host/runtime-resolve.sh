#!/bin/sh

# Resolve the Node.js runtime this account actually uses.
#
# A non-interactive SSH session does not source ~/.bashrc, so version managers
# (nvm, fnm, asdf, mise, volta, n) are usually invisible there even though the
# user's terminal has them. Enumerating manager directories cannot keep up with
# every manager and custom prefix, so this resolver asks the tools themselves
# and validates every candidate by executing it.
#
# Contract: defines functions and variables only; it runs nothing at load time.
# After cbc_resolve_runtime the caller reads:
#   CBC_NODE_RESOLVED=0|1
#   CBC_NODE_PATH / CBC_NODE_DIR / CBC_NODE_VERSION / CBC_NODE_SOURCE
#   CBC_NODE_REJECTS  newline separated "path|version|reason"
#
# Optional hints (never guessed by this script):
#   CBC_RUNTIME_HINT    absolute node path already proven on this host
#   CBC_CBC_PATH        CBC executable discovered in this session
#   CBC_INSTALL_PREFIX  our own user prefix (usually ~/.local)

CBC_NODE_TIME_BUDGET=6
CBC_NODE_MAX_REJECTS=8
CBC_NODE_PROBE_SECONDS=2
CBC_NODE_QUERY_SECONDS=3

CBC_NODE_RESOLVED=0
CBC_NODE_PATH=
CBC_NODE_DIR=
CBC_NODE_VERSION=
CBC_NODE_SOURCE=
CBC_NODE_REJECTS=

_cbc_seen=
_cbc_rejects=0
_cbc_deadline=0

_cbc_epoch() {
    date +%s 2>/dev/null || printf '0'
}

_cbc_deadline_init() {
    if [ "${_cbc_deadline:-0}" = 0 ]; then
        _cbc_deadline=$(( $(_cbc_epoch) + CBC_NODE_TIME_BUDGET ))
    fi
}

_cbc_budget_left() {
    _cbc_deadline_init
    _cbc_left=$(( _cbc_deadline - $(_cbc_epoch) ))
    if [ "$_cbc_left" -gt 0 ]; then
        printf '%s' "$_cbc_left"
    fi
}

# Run one command with a hard deadline; stdin is detached so a shell probe can
# never consume the caller's request payload.
_cbc_run_bounded() {
    _cbc_secs=$1
    _cbc_out=$2
    _cbc_err=$3
    shift 3
    "$@" >"$_cbc_out" 2>"$_cbc_err" </dev/null &
    _cbc_pid=$!
    _cbc_waited=0
    _cbc_limit=$((_cbc_secs * 10))
    while kill -0 "$_cbc_pid" 2>/dev/null; do
        if [ "$_cbc_waited" -ge "$_cbc_limit" ]; then
            kill -TERM "$_cbc_pid" 2>/dev/null || true
            sleep 0.1 2>/dev/null || sleep 1
            kill -KILL "$_cbc_pid" 2>/dev/null || true
            wait "$_cbc_pid" 2>/dev/null || true
            return 124
        fi
        _cbc_waited=$((_cbc_waited + 1))
        sleep 0.1 2>/dev/null || sleep 1
    done
    wait "$_cbc_pid"
}

# Print the last non-empty stdout line of one bounded command.
_cbc_query() {
    _cbc_q_secs=$1
    shift
    _cbc_q_out=$(mktemp "${TMPDIR:-/tmp}/cbc-query.XXXXXX" 2>/dev/null) || return 1
    _cbc_q_err=$(mktemp "${TMPDIR:-/tmp}/cbc-query-err.XXXXXX" 2>/dev/null) || {
        rm -f "$_cbc_q_out"
        return 1
    }
    _cbc_run_bounded "$_cbc_q_secs" "$_cbc_q_out" "$_cbc_q_err" "$@" || true
    _cbc_q_line=$(grep -v '^[[:space:]]*$' "$_cbc_q_out" 2>/dev/null | tail -n 1 | tr -d '\r')
    rm -f "$_cbc_q_out" "$_cbc_q_err"
    if [ -n "$_cbc_q_line" ]; then
        printf '%s' "$_cbc_q_line"
    fi
}

# Keep only absolute paths from a noisy rc banner.
_cbc_query_path() {
    _cbc_query "$@" | grep '^/' | tail -n 1
}

# rc files may print a banner after the command output, so the shell probe
# tags its answer and everything else is discarded by the prefix match.
_cbc_query_sentinel() {
    _cbc_query "$@" | sed -n 's/^CBCNODE://p' | tail -n 1
}

# Keep every probe inside the resolver budget; an exhausted budget still
# allows one short attempt so the cheap user-prefix fallback can run.
_cbc_probe_seconds() {
    _cbc_left=$(_cbc_budget_left)
    if [ -z "$_cbc_left" ]; then
        printf '1'
    elif [ "$_cbc_left" -lt "$CBC_NODE_PROBE_SECONDS" ]; then
        printf '%s' "$_cbc_left"
    else
        printf '%s' "$CBC_NODE_PROBE_SECONDS"
    fi
}

_cbc_node_version() {
    _cbc_v=$(_cbc_query "$(_cbc_probe_seconds)" "$1" -v 2>/dev/null)
    case "$_cbc_v" in
        v[0-9]*) printf '%s' "${_cbc_v#v}" ;;
        [0-9]*) printf '%s' "$_cbc_v" ;;
    esac
}

_cbc_node_usable() {
    _cbc_run_bounded "$(_cbc_probe_seconds)" /dev/null /dev/null \
        "$1" -e 'var v=process.versions.node.split(".").map(Number);process.exit(v[0]>18||(v[0]===18&&(v[1]>20||(v[1]===20&&v[2]>=8)))?0:1)'
}

_cbc_reject() {
    _cbc_rejects=$((_cbc_rejects + 1))
    if [ "$_cbc_rejects" -le "$CBC_NODE_MAX_REJECTS" ]; then
        CBC_NODE_REJECTS="${CBC_NODE_REJECTS}${1}|${2:-unknown}|${3}
"
    fi
}

_cbc_try_node() {
    _cbc_path=${1:-}
    _cbc_source=${2:-unknown}
    [ -n "$_cbc_path" ] || return 1
    case "$_cbc_path" in
        /*) ;;
        *) return 1 ;;
    esac
    if [ ! -x "$_cbc_path" ]; then
        _cbc_reject "$_cbc_path" "" notExecutable
        return 1
    fi
    _cbc_real=$(realpath "$_cbc_path" 2>/dev/null || readlink -f "$_cbc_path" 2>/dev/null || printf '%s' "$_cbc_path")
    case ":$_cbc_seen:" in
        *":$_cbc_real:"*) return 1 ;;
    esac
    _cbc_seen="${_cbc_seen}:${_cbc_real}"
    _cbc_version=$(_cbc_node_version "$_cbc_real")
    if _cbc_node_usable "$_cbc_real"; then
        CBC_NODE_RESOLVED=1
        CBC_NODE_PATH=$_cbc_real
        CBC_NODE_DIR=$(dirname "$_cbc_real")
        CBC_NODE_VERSION=$_cbc_version
        CBC_NODE_SOURCE=$_cbc_source
        return 0
    fi
    if [ -n "$_cbc_version" ]; then
        _cbc_reject "$_cbc_real" "$_cbc_version" tooOld
    else
        _cbc_reject "$_cbc_real" "" unusable
    fi
    return 1
}

# nvm may point `current`/`default` at a legacy version while newer ones
# are installed. Its versions directory is nvm's own contract, so use it only
# after the manager itself answered, and only as a fallback.
_cbc_try_nvm_versions() {
    _cbc_nvm_dir=${NVM_DIR:-$HOME/.nvm}
    [ -d "$_cbc_nvm_dir/versions/node" ] || return 1
    _cbc_best=
    _cbc_best_major=-1
    _cbc_best_minor=-1
    _cbc_best_patch=-1
    for _cbc_node in "$_cbc_nvm_dir"/versions/node/v*/bin/node; do
        [ -x "$_cbc_node" ] || continue
        _cbc_dir=${_cbc_node%/bin/node}
        _cbc_ver=${_cbc_dir##*/}
        _cbc_ver=${_cbc_ver#v}
        _cbc_major=${_cbc_ver%%.*}
        _cbc_rest=${_cbc_ver#*.}
        _cbc_minor=${_cbc_rest%%.*}
        _cbc_patch=${_cbc_rest#*.}
        case "$_cbc_major:$_cbc_minor:$_cbc_patch" in
            ''|*[!0-9:]*) continue ;;
        esac
        if [ "$_cbc_major" -gt "$_cbc_best_major" ] \
            || { [ "$_cbc_major" -eq "$_cbc_best_major" ] && [ "$_cbc_minor" -gt "$_cbc_best_minor" ]; } \
            || { [ "$_cbc_major" -eq "$_cbc_best_major" ] && [ "$_cbc_minor" -eq "$_cbc_best_minor" ] && [ "$_cbc_patch" -gt "$_cbc_best_patch" ]; }; then
            _cbc_best=$_cbc_node
            _cbc_best_major=$_cbc_major
            _cbc_best_minor=$_cbc_minor
            _cbc_best_patch=$_cbc_patch
        fi
    done
    [ -n "$_cbc_best" ] && _cbc_try_node "$_cbc_best" nvm-versions
}

# Run every rc convention the user's shell may need, once, with a deadline.
# The last candidate tried is our own user prefix, which needs no shell.
_cbc_try_shells() {
    [ -n "$(_cbc_budget_left)" ] || return 1
    _cbc_shell_list=$(mktemp "${TMPDIR:-/tmp}/cbc-shells.XXXXXX" 2>/dev/null) || return 1
    _cbc_shell_seen=
    for _cbc_cand in "${SHELL:-}" "$(command -v bash 2>/dev/null || true)" "$(command -v zsh 2>/dev/null || true)"; do
        case "$_cbc_cand" in
            /*) ;;
            *) continue ;;
        esac
        [ -x "$_cbc_cand" ] || continue
        _cbc_real=$(realpath "$_cbc_cand" 2>/dev/null || printf '%s' "$_cbc_cand")
        case ":${_cbc_shell_seen}:" in
            *":${_cbc_real}:"*) continue ;;
        esac
        _cbc_shell_seen="${_cbc_shell_seen}:${_cbc_real}"
        printf '%s\n' "$_cbc_real" >> "$_cbc_shell_list"
    done
    _cbc_shell_hit=0
    while IFS= read -r _cbc_sh; do
        [ -n "$_cbc_sh" ] || continue
        [ -n "$(_cbc_budget_left)" ] || break
        if _cbc_try_node "$(_cbc_query_sentinel "$CBC_NODE_QUERY_SECONDS" "$_cbc_sh" -lic 'printf "CBCNODE:%s\n" "$(command -v node 2>/dev/null)"')" "shell:${_cbc_sh##*/}"; then
            _cbc_shell_hit=1
            break
        fi
    done < "$_cbc_shell_list"
    rm -f "$_cbc_shell_list"
    [ "$_cbc_shell_hit" = 1 ]
}

# Public entry point. Resolution order is evidence first, guesses never:
#   1. a runtime already proven on this host
#   2. the runtime that owns the CBC we found (<prefix>/lib/node_modules/<pkg>)
#   3. whatever this non-interactive shell already resolves
#   4. version managers, asked through their own commands
#   5. the user's rc files, through their own shell
#   6. our own user prefix
cbc_resolve_runtime() {
    CBC_NODE_RESOLVED=0
    CBC_NODE_PATH=
    CBC_NODE_DIR=
    CBC_NODE_VERSION=
    CBC_NODE_SOURCE=
    CBC_NODE_REJECTS=
    _cbc_seen=
    _cbc_rejects=0
    _cbc_deadline=0

    _cbc_try_node "${CBC_RUNTIME_HINT:-}" hint && return 0

    case "${CBC_CBC_PATH:-}" in
        */lib/node_modules/*)
            _cbc_try_node "${CBC_CBC_PATH%%/lib/node_modules/*}/bin/node" cbc-sibling && return 0
            ;;
    esac

    _cbc_try_node "$(command -v node 2>/dev/null || true)" path && return 0

    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_nvm=$(_cbc_query_path "$CBC_NODE_QUERY_SECONDS" bash -c 'set +u; export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] || exit 1; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || exit 1; nvm which current 2>/dev/null || nvm which default 2>/dev/null')
        _cbc_try_node "$_cbc_nvm" nvm && return 0
        _cbc_try_nvm_versions && return 0
    fi
    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_fnm=$(_cbc_query_path "$CBC_NODE_QUERY_SECONDS" fnm exec --using=default -- sh -c 'command -v node')
        _cbc_try_node "$_cbc_fnm" fnm && return 0
    fi
    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_asdf_dir=$(_cbc_query "$CBC_NODE_QUERY_SECONDS" asdf where nodejs 2>/dev/null)
        case "$_cbc_asdf_dir" in
            /*) _cbc_try_node "${_cbc_asdf_dir}/bin/node" asdf && return 0 ;;
        esac
    fi
    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_try_node "$(_cbc_query_path "$CBC_NODE_QUERY_SECONDS" mise which node 2>/dev/null)" mise && return 0
    fi
    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_try_node "$(_cbc_query_path "$CBC_NODE_QUERY_SECONDS" volta which node 2>/dev/null)" volta && return 0
    fi
    if [ -n "$(_cbc_budget_left)" ]; then
        _cbc_n_dir=$(_cbc_query "$CBC_NODE_QUERY_SECONDS" n bin current 2>/dev/null)
        case "$_cbc_n_dir" in
            /*) _cbc_try_node "${_cbc_n_dir}/node" n && return 0 ;;
        esac
        _cbc_n_dir=$(_cbc_query "$CBC_NODE_QUERY_SECONDS" n bin lts 2>/dev/null)
        case "$_cbc_n_dir" in
            /*) _cbc_try_node "${_cbc_n_dir}/node" n-lts && return 0 ;;
        esac
    fi

    _cbc_try_shells && return 0

    case "${CBC_INSTALL_PREFIX:-}" in
        /*) _cbc_try_node "${CBC_INSTALL_PREFIX}/bin/node" install-prefix && return 0 ;;
    esac

    return 1
}

# Human-readable rejection list for install diagnostics.
cbc_runtime_report() {
    if [ -z "${CBC_NODE_REJECTS:-}" ]; then
        return 0
    fi
    printf '%s\n' 'CBC_NODE_REJECTED:'
    printf '%s' "$CBC_NODE_REJECTS" | while IFS='|' read -r _cbc_rp _cbc_rv _cbc_rr; do
        [ -n "$_cbc_rp" ] || continue
        printf '  path=%s version=%s reason=%s\n' "$_cbc_rp" "${_cbc_rv:-unknown}" "${_cbc_rr:-unknown}"
    done
}
