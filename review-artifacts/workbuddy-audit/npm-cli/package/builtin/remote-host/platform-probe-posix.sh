#!/bin/sh
# Read-only POSIX platform probe. The output is a versioned text envelope
# whose payload is base64(JSON), so the control side can decode it without
# trusting a possibly banner-polluted stdout stream.

set -eu

MARKER='CODEBUDDY_PLATFORM_PROBE_V1'
TERMINATOR='CODEBUDDY_PLATFORM_PROBE_END_V1'

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

has_control_characters() {
    control_clean=$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177')
    if [ "$control_clean" != "$1" ]; then
        return 0
    fi
    return 1
}

json_string_or_null() {
    if [ -n "${1-}" ]; then
        if has_control_characters "$1"; then
            printf 'null'
            return
        fi
        printf '"%s"' "$(json_escape "$1")"
    else
        printf 'null'
    fi
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

uname_s=$(uname -s 2>/dev/null || true)
uname_m=$(uname -m 2>/dev/null || true)
os='unknown'
case "$uname_s" in
    Darwin) os='macos' ;;
    Linux) os='linux' ;;
esac

kernel_arch='unknown'
case "$uname_m" in
    x86_64|amd64) kernel_arch='x64' ;;
    arm64|aarch64) kernel_arch='arm64' ;;
    i386|i486|i586|i686) kernel_arch='x86' ;;
    armv7l|armv6l) kernel_arch='arm32' ;;
    *) kernel_arch='other' ;;
esac

native_arch="$kernel_arch"
process_arch="$kernel_arch"
rosetta='notApplicable'
if [ "$os" = 'macos' ] && command_exists sysctl; then
    sysctl_machine=$(sysctl -n hw.machine 2>/dev/null || true)
    sysctl_opt=$(sysctl -n sysctl.proc_translated 2>/dev/null || true)
    case "$sysctl_machine" in
        arm64) native_arch='arm64' ;;
        x86_64) native_arch='x64' ;;
    esac
    case "$process_arch" in
        arm64|x64) ;;
        *) process_arch="$native_arch" ;;
    esac
    if [ "$sysctl_opt" = '1' ]; then
        rosetta='translated'
        native_arch='arm64'
        process_arch='x64'
    elif [ -n "$sysctl_opt" ]; then
        rosetta='native'
    fi
elif [ "$os" = 'macos' ]; then
    rosetta='unknown'
fi

libc='unknown'
libc_version='null'
if [ "$os" = 'linux' ] && command_exists getconf; then
    gnu_libc=$(getconf GNU_LIBC_VERSION 2>/dev/null || true)
    if [ -n "$gnu_libc" ]; then
        case "$gnu_libc" in
            glibc\ *)
                libc='glibc'
                libc_version=$(json_string_or_null "${gnu_libc#glibc }")
                ;;
            musl)
                libc='musl'
                libc_version='null'
                ;;
            *)
                libc='unknown'
                libc_version='null'
                ;;
        esac
    elif [ -r /etc/alpine-release ]; then
        libc='musl'
        libc_version='null'
    fi
fi

wsl='none'
if [ "$os" = 'linux' ]; then
    kernel_release=$(uname -r 2>/dev/null || true)
    case "$kernel_release" in
        *[Mm]icrosoft*WSL2*|*WSL2*) wsl='wsl2' ;;
        *[Mm]icrosoft*WSL1*|*WSL1*) wsl='wsl1' ;;
        *[Mm]icrosoft*) wsl='unknown' ;;
    esac
    if [ "$wsl" = 'none' ] && command_exists grep && [ -r /proc/version ]; then
        if grep -qi 'microsoft' /proc/version 2>/dev/null; then
            wsl='unknown'
        fi
    fi
fi

home_value=''
if [ -n "${HOME-}" ]; then
    home_value="$HOME"
fi
user_id=''
if command_exists id; then
    user_id=$(id -u 2>/dev/null || true)
fi

shell_kind='unknown'
shell_name=${SHELL-}
case "${shell_name##*/}" in
    sh|bash|zsh|ksh) shell_kind="${shell_name##*/}" ;;
esac

tool_curl='null'
tool_tar='null'
tool_unzip='null'
tool_sha256='null'
if command_exists curl; then tool_curl=true; else tool_curl=false; fi
if command_exists tar; then tool_tar=true; else tool_tar=false; fi
if command_exists unzip; then tool_unzip=true; else tool_unzip=false; fi
if command_exists sha256sum || command_exists shasum; then tool_sha256=true; else tool_sha256=false; fi

os_version=$(uname -r 2>/dev/null || true)
payload=$(printf '%s' "{\"schemaVersion\":1,\"probeKind\":\"posix\",\"os\":\"$os\",\"osVersion\":$(json_string_or_null "$os_version"),\"kernelArch\":\"$kernel_arch\",\"nativeArch\":\"$native_arch\",\"processArch\":\"$process_arch\",\"libc\":\"$libc\",\"libcVersion\":$libc_version,\"wsl\":\"$wsl\",\"rosetta\":\"$rosetta\",\"home\":$(json_string_or_null "$home_value"),\"userId\":$(json_string_or_null "$user_id"),\"shellKind\":\"$shell_kind\",\"tools\":{\"curl\":$tool_curl,\"tar\":$tool_tar,\"unzip\":$tool_unzip,\"sha256\":$tool_sha256},\"diskFreeBytes\":null,\"desktop\":{\"present\":null,\"kind\":null}}")

if command_exists base64; then
    encoded=$(printf '%s' "$payload" | base64 | tr -d '\n')
else
    encoded=''
fi

if [ -z "$encoded" ]; then
    exit 1
fi

printf '%s\n' "$MARKER"
printf '%s\n' "$encoded"
printf '%s\n' "$TERMINATOR"
