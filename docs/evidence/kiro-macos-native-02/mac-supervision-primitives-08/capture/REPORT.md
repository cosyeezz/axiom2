# Independent shipped-launchd static evidence

Status: STATIC_CAPTURE_COMPLETE
Working directory: /Volumes/D_Work/axiom2
Own TEMP: /var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9

Hypothesis: the exact shipped artifact contains candidate supervision imports/strings; absence/presence is not behavior evidence.
Gate: exact regular no-final-symlink /sbin/launchd <=16MiB; held-FD before/after stat and hash; final path stat; own snapshot mode0400 and byte/SHA readback.

## Identity
{
  "path": "/sbin/launchd",
  "stat_before": {
    "st_dev": 16777230,
    "st_ino": 1152921500312571473,
    "st_mode": 33261,
    "st_nlink": 1,
    "st_uid": 0,
    "st_gid": 0,
    "st_size": 1236160,
    "st_mtime_ns": 1786589515000000000,
    "st_ctime_ns": 1786589515000000000
  },
  "stat_after": {
    "st_dev": 16777230,
    "st_ino": 1152921500312571473,
    "st_mode": 33261,
    "st_nlink": 1,
    "st_uid": 0,
    "st_gid": 0,
    "st_size": 1236160,
    "st_mtime_ns": 1786589515000000000,
    "st_ctime_ns": 1786589515000000000
  },
  "sha256": "7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09",
  "bytes": 1236160,
  "same_fd": true,
  "final_path_check": true
}
{
  "path": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot",
  "stat": {
    "st_dev": 16777230,
    "st_ino": 22824948,
    "st_mode": 33024,
    "st_nlink": 1,
    "st_uid": 501,
    "st_gid": 20,
    "st_size": 1236160,
    "st_mtime_ns": 1793306710563345523,
    "st_ctime_ns": 1793306710563779690
  },
  "sha256": "7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09",
  "mode": "0400",
  "readback": true
}
UUIDs: ['3FEC147A-7931-3FCD-BDB9-59C9A814779C']
Architectures in the fat file: /var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot are: x86_64 arm64e 
/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot:
Mach header
      magic  cputype cpusubtype  caps    filetype ncmds sizeofcmds      flags
MH_MAGIC_64    ARM64          E USR00     EXECUTE    27       4248   NOUNDEFS DYLDLINK TWOLEVEL PIE

## Commands and actual exits
[
  {
    "argv": [
      "/usr/bin/file",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/01-file.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/01-file.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.00812725001014769,
    "stdout_bytes": 553,
    "stderr_bytes": 0,
    "output_cap_hit": false
  },
  {
    "argv": [
      "/usr/bin/lipo",
      "-info",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/02-lipo.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/02-lipo.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.04625237500295043,
    "stdout_bytes": 153,
    "stderr_bytes": 0,
    "output_cap_hit": false
  },
  {
    "argv": [
      "/usr/bin/otool",
      "-hv",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/03-otool.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/03-otool.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.02302995789796114,
    "stdout_bytes": 293,
    "stderr_bytes": 0,
    "output_cap_hit": false
  },
  {
    "argv": [
      "/usr/bin/otool",
      "-l",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/04-otool.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/04-otool.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.021225957898423076,
    "stdout_bytes": 13249,
    "stderr_bytes": 0,
    "output_cap_hit": false
  },
  {
    "argv": [
      "/usr/bin/nm",
      "-u",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/05-nm.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/05-nm.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.04521833290345967,
    "stdout_bytes": 28485,
    "stderr_bytes": 0,
    "output_cap_hit": false
  }
]
## String scan
{
  "path": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/selected-strings.tsv",
  "method": "one ASCII printable run scan >=4 bytes, case-insensitive keyword substring; offsets are whole-file offsets",
  "pattern": "coalition|AbandonProcessGroup|bootout|kill|termination|jetsam",
  "matching_total": 286,
  "selected_count": 256,
  "selected_bytes": 31958,
  "omitted_count": 30,
  "cap_hit": true
}
## Limits and interpretation
Each subprocess <=5s; conservative whole driver deadline 4.5s; CPU RLIMIT 15s; per-stream file-size limit 2MiB; raw files retained. No retries. Optional codesign not run. Snapshot and outputs only in own TEMP.
Imports and strings establish candidate locators only: NOT call reachability, caller authority, bootout kill/drain, complete descendants, loaded PID1 identity, host M3, or any runtime behavior. UUID/architecture bind only this static file. No execution of launchd/launchctl, service/XPC/control/coalition/Security APIs, process scan/attach, model/official calls, credential access, dependency traversal, dyld extraction, or decompilation.
Symbols are limited to undefined imports from nm -u; local/stripped function boundaries and xrefs were not inspected.
## Single next static-xref question
In this SHA-bound arm64e snapshot, does the code referencing the exact AbandonProcessGroup string have a direct static reference to an imported coalition termination routine? Restrict a separately authorized follow-up to that string xref and its immediate function; do not infer reachability or run any control operation.
## Budget
Elapsed before reporting: 0.17591733299195766
CPU before reporting: 0.136714

## Inspected candidate findings and all-slice metadata completion
lipo: universal x86_64 + arm64e. Initial otool default inspected arm64e only; command 06 explicitly expands metadata to all slices, with raw outputs preserved; no instruction analysis.
{
  "all_slice_uuids": [
    {
      "arch": "x86_64",
      "uuids": [
        "40C18703-52FF-337F-9BBC-16880FDE88B4"
      ]
    },
    {
      "arch": "arm64e",
      "uuids": [
        "3FEC147A-7931-3FCD-BDB9-59C9A814779C"
      ]
    }
  ],
  "candidate_undefined_imports": {
    "x86_64": [
      "_coalition_create",
      "_coalition_reap",
      "_coalition_terminate",
      "_kill",
      "_killpg",
      "_posix_spawnattr_setcoalition_np",
      "_proc_terminate",
      "_proc_terminate_delegate"
    ],
    "arm64e": [
      "_coalition_create",
      "_coalition_reap",
      "_coalition_terminate",
      "_kill",
      "_killpg",
      "_posix_spawnattr_setcoalition_np",
      "_proc_terminate",
      "_proc_terminate_delegate"
    ]
  },
  "command06": {
    "argv": [
      "/usr/bin/otool",
      "-arch",
      "all",
      "-l",
      "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/launchd.snapshot"
    ],
    "stdout": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/06-otool-all.stdout",
    "stderr": "/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/launchd-static-independent-2x_n5ja9/06-otool-all.stderr",
    "timeout_seconds": 4,
    "exit_code": 0,
    "timed_out": false,
    "elapsed_seconds": 0.02470141602680087,
    "stdout_bytes": 25825,
    "stderr_bytes": 0,
    "output_cap_hit": false
  }
}
Whole-file string offsets (not VM addresses): AbandonProcessGroup 0x5ef86 / 0xf4db6; _AbandonCoalition 0x5e053 / 0xf3e83; service bootout (%s) 0x69125 / 0xffa3b; WAITING_ON_COALITIONS 0x638d7 / 0xf9f43; allowed-coalition-quiesce 0x5c526 / 0xf8f1f. These are locator bytes only, not policy or execution evidence.
Superseding the earlier proposed question, the SINGLE smallest next static-xref question is: in the arm64e slice, does the immediate function referencing the exact service bootout (%s) string directly call the imported _coalition_terminate? Bound follow-up to this string xref and immediate function only, under separate authorization.
Only nm -u was requested: local/internal symbol availability is unverified, not claimed absent. Optional codesign display omitted. No runtime tests run.
