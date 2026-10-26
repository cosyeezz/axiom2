#!/bin/sh
# Fixed, read-only POSIX directory browser.
#
# stdin is one bounded JSON request. This script does not eval, does not
# interpolate a path into shell syntax, does not scan the filesystem, and
# emits strings as hex:<lowercase-hex-bytes> so spaces, Unicode and even
# newlines in directory names are preserved without a JSON runtime.

set -eu

MAX_REQUEST_BYTES=8192
MAX_PATH_BYTES=4096
MAX_CHILDREN=256
MAX_ROOTS=64

read_request() {
    request=$(dd bs=1 count=$((MAX_REQUEST_BYTES + 1)) 2>/dev/null || true)
    if [ "${#request}" -gt "$MAX_REQUEST_BYTES" ]; then
        exit 2
    fi
    if [ -z "$request" ]; then
        exit 2
    fi
}

# Extract a top-level ASCII JSON string field without eval. The request
# protocol is intentionally tiny:
# {"schemaVersion":1,"mode":"...","pathBase64":"..."}.
json_string_field() {
    field=$1
    printf '%s' "$request" | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"\\\\]*\\)\".*/\\1/p" | head -n 1
}

json_mode() {
    json_string_field mode
}

json_path_base64() {
    json_string_field pathBase64
}

decode_path_base64() {
    encoded=$1
    case "$encoded" in
        *[!A-Za-z0-9+/=]*|'') return 1 ;;
    esac
    printf '%s' "$encoded" | base64 -d 2>/dev/null
}

hex_encode() {
    printf '%s' "$1" | od -An -tx1 | tr -d ' \n'
}

hex_string() {
    printf '"hex:%s"' "$(hex_encode "$1")"
}

json_null() {
    printf 'null'
}

json_bool() {
    if [ "$1" = 1 ]; then printf 'true'; else printf 'false'; fi
}

emit_roots() {
    printf '{"schemaVersion":1,"platform":"posix","home":'
    if [ -n "${HOME-}" ]; then hex_string "$HOME"; else json_null; fi
    printf ',"roots":[{"path":'
    hex_string '/'
    printf ',"label":'
    hex_string '/'
    printf '}],"current":null,"parent":null,"children":[],"truncated":false,"encoding":"utf8"}\n'
}

emit_children() {
    target=$1
    case "$target" in
        /) target='/' ;;
        //) target='/' ;;
        */) target=${target%/} ;;
    esac
    if [ -z "$target" ] || [ "${#target}" -gt "$MAX_PATH_BYTES" ]; then
        exit 3
    fi
    if [ ! -d "$target" ]; then
        exit 4
    fi

    count=0
    truncated=0
    children=''
    for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        name=${entry##*/}
        if [ -d "$entry" ] && [ ! -L "$entry" ]; then
            kind='directory'
        else
            continue
        fi
        if [ "$count" -ge "$MAX_CHILDREN" ]; then
            truncated=1
            break
        fi
        case "$target" in
            /) child_path="/$name" ;;
            *) child_path="$target/$name" ;;
        esac
        if [ -n "$children" ]; then
            children="$children,"
        fi
        children="$children{\"name\":$(hex_string "$name"),\"path\":$(hex_string "$child_path"),\"kind\":\"$kind\"}"
        count=$((count + 1))
    done

    parent=''
    case "$target" in
        /) parent='' ;;
        */*) parent=${target%/*}; [ -n "$parent" ] || parent='/' ;;
    esac

    printf '{"schemaVersion":1,"platform":"posix","home":'
    if [ -n "${HOME-}" ]; then hex_string "$HOME"; else json_null; fi
    printf ',"roots":[{"path":'
    hex_string '/'
    printf ',"label":'
    hex_string '/'
    printf '}],"current":'
    hex_string "$target"
    printf ',"parent":'
    if [ -n "$parent" ]; then hex_string "$parent"; else json_null; fi
    printf ',"children":[%s],"truncated":%s,"encoding":"utf8"}\n' "$children" "$(json_bool "$truncated")"
}

read_request
mode=$(json_mode)
case "$mode" in
    roots) emit_roots ;;
    children)
        path_base64=$(json_path_base64)
        decoded_path=$(decode_path_base64 "$path_base64") || exit 3
        emit_children "$decoded_path"
        ;;
    *) exit 5 ;;
esac
