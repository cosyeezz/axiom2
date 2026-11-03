#!/bin/bash
# Invoke only after independent checks and creation of READINESS.json.
# Any consumed LAUNCH_ONCE or main/result artifact prohibits a retry.
set -u
umask 077
case_dir="$(cd "$(dirname "$0")" && pwd -P)" || exit 88
if test ! -f "$case_dir/READINESS.json" || test -L "$case_dir/READINESS.json"; then
  printf '%s\n' 'selection03-not-ready-no-main-executed' >&2
  exit 89
fi
for name in main.exit main.stdout main.stderr main-workdir.txt results; do
  if test -e "$case_dir/$name" || test -L "$case_dir/$name"; then
    printf '%s\n' 'selection03-existing-artifact-no-retry' >&2
    exit 90
  fi
done
/bin/mkdir -m 700 "$case_dir/LAUNCH_ONCE" || exit 91
control=$(/usr/bin/mktemp -d /tmp/kiro-select03-parent.XXXXXXXX) || exit 92
/bin/mkdir -m 700 "$control/home" "$control/tmp" || exit 93
set -o noclobber
printf '%s\n' "$control" > "$case_dir/main-workdir.txt" || exit 94
/usr/bin/env -i HOME="$control/home" TMPDIR="$control/tmp" PATH=/usr/bin:/bin LC_ALL=C /usr/bin/python3 -I -B "$case_dir/probe_logged.py" > "$case_dir/main.stdout" 2> "$case_dir/main.stderr"
code=$?
printf '%s\n' "$code" > "$case_dir/main.exit" || exit 95
printf 'selection03_main_exit=%s control=%s\n' "$code" "$control"
exit "$code"
