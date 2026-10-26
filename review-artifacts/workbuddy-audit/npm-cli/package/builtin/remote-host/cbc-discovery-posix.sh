#!/bin/sh

set -eu

MAX_REQUEST_BYTES=16384
MAX_CANDIDATES=16
MAX_PROBE_OUTPUT_BYTES=8192
PROBE_TIMEOUT_SECONDS=10

fail() {
    exit "$1"
}

read_request() {
    request=$(dd bs=1 count=$((MAX_REQUEST_BYTES + 1)) 2>/dev/null || true)
    if [ "${#request}" -gt "$MAX_REQUEST_BYTES" ] || [ -z "$request" ]; then
        fail 2
    fi
}

hex_decode() {
    value=$1
    case "$value" in
        *[!0-9A-Fa-f]*|'') fail 2 ;;
    esac
    if [ $(( ${#value} % 2 )) -ne 0 ]; then
        fail 2
    fi
    result=
    while [ -n "$value" ]; do
        pair=$(printf '%s' "$value" | cut -c1-2)
        decimal=$(printf '%d' "0x$pair" 2>/dev/null) || fail 2
        octal=$(printf '%03o' "$decimal")
        result="${result}\\$octal"
        value=$(printf '%s' "$value" | cut -c3-)
    done
    printf '%b' "$result"
}

hex_encode() {
    printf '%s' "$1" | od -An -tx1 | tr -d ' \n'
}

json_hex_string() {
    if [ "$1" = "" ]; then
        printf 'null'
    else
        printf '"hex:%s"' "$(hex_encode "$1")"
    fi
}

extract_hex_array() {
    printf '%s' "$request" \
        | sed -n 's/.*"explicitPaths"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' \
        | tr -d ' "' \
        | tr ',' '\n'
}

extract_managed_roots() {
    printf '%s' "$request" \
        | sed -n 's/.*"managedRoots"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' \
        | tr -d ' "' \
        | tr ',' '\n'
}

extract_trusted_refs() {
    printf '%s' "$request" \
        | sed -n 's/.*"trustedInstallRefs"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' \
        | tr -d ' "' \
        | tr ',' '\n'
}

append_candidate() {
    path=$1
    [ -n "$path" ] || return 0
    [ "${#path}" -le 4096 ] || return 0
    case "$path" in
        /*) ;;
        *) return 0 ;;
    esac
    case "$path" in
        *"
"*|*"	"*|*"
"*) return 0 ;;
    esac
    [ -x "$path" ] || return 0
    real=$(realpath "$path" 2>/dev/null || readlink -f "$path" 2>/dev/null || printf '%s' "$path") || return 0
    identity=$(ls -di "$real" 2>/dev/null | awk '{print $1}' || true)
    if [ -n "$identity" ]; then
        key="${identity}:${real}"
        case ":$seen:" in
            *":$key:"*) return 0 ;;
        esac
        seen="${seen}:$key"
    fi
    [ -f "$real" ] || return 0
    [ -r "$real" ] || return 0
    printf '%s\n' "$real" >> "$candidate_file"
}

add_path_names() {
    printf '%s\n' "${PATH-}" | tr ':' '\n' | while IFS= read -r directory; do
        [ -n "$directory" ] || continue
        [ -d "$directory" ] || continue
        writable_by_others=$(find "$directory" -maxdepth 0 -perm -0022 -print 2>/dev/null || true)
        if [ -n "$writable_by_others" ]; then
            continue
        fi
        for name in codebuddy cbc codebuddy-code; do
            append_candidate "$directory/$name"
        done
    done
}

run_bounded() {
    stdout_file=$1
    stderr_file=$2
    shift 2
    "$@" >"$stdout_file" 2>"$stderr_file" &
    child=$!
    waited=0
    while kill -0 "$child" 2>/dev/null; do
        if [ "$waited" -ge $((PROBE_TIMEOUT_SECONDS * 10)) ]; then
            kill -TERM "$child" 2>/dev/null || true
            sleep 0.2
            kill -KILL "$child" 2>/dev/null || true
            wait "$child" 2>/dev/null || true
            return 124
        fi
        waited=$((waited + 1))
        sleep 0.1
    done
    wait "$child"
}

probe_candidate() {
    path=$1
    saved_path=${PATH-}
    node_dir=
    # Prefer the runtime that owns this CBC (<prefix>/lib/node_modules/<pkg>)
    # so a candidate is judged with the node it would actually run on.
    case "$path" in
        */lib/node_modules/*)
            candidate_node="${path%%/lib/node_modules/*}/bin/node"
            if [ -x "$candidate_node" ] \
                && { ! command -v _cbc_node_usable >/dev/null 2>&1 || _cbc_node_usable "$candidate_node"; }; then
                node_dir=$(dirname "$candidate_node")
                PATH="${node_dir}:${PATH-}"
            fi
            ;;
    esac
    if [ -z "$node_dir" ] && [ "${CBC_NODE_RESOLVED:-0}" = 1 ] && [ -n "${CBC_NODE_DIR:-}" ]; then
        # Report the runtime the resolver already proved so serve can start
        # CBC with the same node that passed this probe.
        node_dir=$CBC_NODE_DIR
    fi
    version_file=$(mktemp "${TMPDIR:-/tmp}/cbc-version.XXXXXX") || { PATH=$saved_path; return 1; }
    version_error=$(mktemp "${TMPDIR:-/tmp}/cbc-version-err.XXXXXX") || { PATH=$saved_path; return 1; }
    discovery_file=$(mktemp "${TMPDIR:-/tmp}/cbc-discovery.XXXXXX") || { PATH=$saved_path; return 1; }
    discovery_error=$(mktemp "${TMPDIR:-/tmp}/cbc-discovery-err.XXXXXX") || { PATH=$saved_path; return 1; }
    if run_bounded "$version_file" "$version_error" "$path" --version; then
        version_exit=0
    else
        version_exit=$?
    fi
    if [ "$version_exit" -ne 0 ]; then
        probe_succeeded=0
    else
        probe_succeeded=1
    fi
    if run_bounded "$discovery_file" "$discovery_error" "$path" remote-host discovery --json; then
        discovery_exit=0
    else
        discovery_exit=$?
    fi
    protocol_output=$(dd if="$discovery_file" bs=1 count=$((MAX_PROBE_OUTPUT_BYTES + 1)) 2>/dev/null || true)
    if [ "$discovery_exit" -eq 0 ]; then
        protocol_min=$(printf '%s' "$protocol_output" | sed -n 's/.*"protocolMin":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
        protocol_max=$(printf '%s' "$protocol_output" | sed -n 's/.*"protocolMax":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
        discovery_product=$(printf '%s' "$protocol_output" | sed -n 's/.*"product":[[:space:]]*"\([A-Za-z0-9-]*\)".*/\1/p' | head -n 1)
    else
        protocol_min=
        protocol_max=
        discovery_product=
        protocol_output=
    fi
    case "$protocol_min" in
        ''|*[!0-9]*) protocol_min=null ;;
    esac
    case "$protocol_max" in
        ''|*[!0-9]*) protocol_max=null ;;
    esac
    if [ "$protocol_min" = "null" ] || [ "$protocol_max" = "null" ]; then
        protocol_output=
    fi
    version_output=$(dd if="$version_file" bs=1 count=$((MAX_PROBE_OUTPUT_BYTES + 1)) 2>/dev/null || true)
    if [ "$(wc -c < "$version_file" 2>/dev/null || printf 0)" -gt "$MAX_PROBE_OUTPUT_BYTES" ]; then
        probe_succeeded=0
        version_output=
    fi
    if [ "$(wc -c < "$discovery_file" 2>/dev/null || printf 0)" -gt "$MAX_PROBE_OUTPUT_BYTES" ]; then
        protocol_min=null
        protocol_max=null
    fi
    case "$discovery_product" in
        codebuddy|cbc|codebuddy-code) product=$discovery_product ;;
        *)
            case "$version_output" in
                *CodeBuddy*|*codebuddy*|*CODEBUDDY*) product=codebuddy ;;
                *) product=unknown ;;
            esac
            ;;
    esac
    if [ "$probe_succeeded" = 1 ]; then
        probe_succeeded_json=true
    else
        probe_succeeded_json=false
    fi
    printf '{"executablePath":%s,"versionOutput":%s,"product":"%s","protocolMin":%s,"protocolMax":%s,"protocolRaw":%s,"executable":true,"probeSucceeded":%s,"nodeDir":%s}' \
        "$(json_hex_string "$path")" \
        "$(json_hex_string "$version_output")" \
        "$product" \
        "$protocol_min" \
        "$protocol_max" \
        "$(json_hex_string "$protocol_output")" \
        "$probe_succeeded_json" \
        "$(json_hex_string "$node_dir")"
    rm -f "$version_file" "$version_error" "$discovery_file" "$discovery_error"
    PATH=$saved_path
}

read_request
if command -v cbc_resolve_runtime >/dev/null 2>&1; then
    # Our own installer puts node/CBC under the user prefix; make that the
    # last-resort candidate without hard-coding any system directory.
    CBC_INSTALL_PREFIX="${HOME}/.local"
    export CBC_INSTALL_PREFIX
    cbc_resolve_runtime || true
    if [ "${CBC_NODE_RESOLVED:-0}" = 1 ] && [ -n "${CBC_NODE_DIR:-}" ]; then
        PATH="${CBC_NODE_DIR}:${PATH-}"
        export PATH
    fi
fi
explicit_paths=$(extract_hex_array || true)
managed_roots=$(extract_managed_roots || true)
trusted_refs=$(extract_trusted_refs || true)
seen=
candidate_file=$(mktemp "${TMPDIR:-/tmp}/cbc-candidates.XXXXXX") || fail 4

for encoded in $explicit_paths; do
    decoded=$(hex_decode "$encoded") || fail 2
    append_candidate "$decoded"
done

for encoded in $managed_roots; do
    root=$(hex_decode "$encoded") || fail 2
    append_candidate "$root/bin/codebuddy"
    append_candidate "$root/bin/cbc"
    append_candidate "$root/bin/codebuddy-code"
done

for encoded in $trusted_refs; do
    ref=$(hex_decode "$encoded") || fail 2
    append_candidate "$ref"
done

add_path_names

count=0
json=
while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if [ "$count" -ge "$MAX_CANDIDATES" ]; then
        break
    fi
    if [ -n "$json" ]; then
        json="$json,"
    fi
    json="$json$(probe_candidate "$candidate")"
    count=$((count + 1))
done < "$candidate_file"
rm -f "$candidate_file"

printf '{"schemaVersion":1,"platform":"posix","candidates":[%s]}\n' "$json"
