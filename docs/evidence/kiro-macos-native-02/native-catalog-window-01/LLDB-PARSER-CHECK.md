# LLDB output gate — one synthetic check

Before either planned LLDB invocation, run the main-authored pure output validator once by AST-extracting only that function from disassemble_once.py, not importing/executing its controller. No target/input artifact access, tool invocation, network, auth or model. Retain a permanent LLDB_PARSER_ONCE marker before the check; failure consumes the check, do not repair and rerun it.

Exactly10 named parser calls: valid162-word format; valid1229-word field; wrong word; wrong address; missing line; extra line; changed command banner; non-ASCII; argument over192 chars; raw output over262144B. Both valid cases are wholly synthetic NOP words rendered as NOP, not actual LLDB output. One assertion per call, not10 processes or native instructions executed. Rejected cases must raise, without persisting input/exception/stack. No actual frozen-code bytes are needed.

One /usr/bin/python3 -I -B process, CPU2/3/core0/FSIZE64KiB/NOFILE32/alarm3, outer10. Explicit inherited environment (not six-key/minimal claim), no owned temporary files needed beyond the permanent marker and fixed small safe result. Source AST/hash read only; check source unchanged before/after. Failure output limited to fixed phase/completed/attempted counters. This is a narrow main-authored parser check, not independent verification of LLDB, child ownership, deadline/cleanup branches, resource enforcement, every output variant or real-auth safety.

The static owner will separately require actual exit0, both EOF, no fault, empty stderr, expected command/path banners and complete address/word roundtrip before saving assembly. Word coverage does not prove CFG/executable reachability. No Ghidra or target execution.
