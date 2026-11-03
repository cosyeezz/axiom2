# Independent new15 metadata guard test

Results: 63 PASS, 0 FAIL, 63 named outcomes. Exit 0.

new15 SHA256: ef7b3d8bebf172b1363f8cea0217cc0e799b590ad9e75f3ba330061514934b68
14 SHA256: 4a2ae5b37edebb2b626bbadb354150d613476273f0ffa0b7e1b27f2fc4ec8ebc

## Execution
CWD: /Volumes/D_Work/axiom2
Interpreter: /usr/bin/python3 -B; minimal env recorded in commands.txt.
Python: 3.9.6 (default, May  7 2023, 23:32:44) 
[Clang 14.0.3 (clang-1403.0.22.14.1)]
CPU hard/soft15s, wall alarm60s, per-file4MiB, output aggregate16MiB checked before writes. One run; no retry.
AST execution namespace initially contains struct only (plus Python-injected builtins); only unpack_at, metadata, decode_pointer, walk_chains compiled. No original module imports or top-level execution.
Inputs copied before and after, stable-stat + SHA checked. SDK header copied completely with license.

## Contract and limitations
Acceptance means supported by these offline functions, not universal Mach-O validity. Disjointness excludes empty intervals and permits abutting endpoints. Empty pageStarts/no record offsets produce no walk rows. Section tests validate storage only, not section content semantics.
Header overlap attempts fail fixups header offsets before pairwise checks; record/header overlap is structurally excluded by starts>=28 and relative>=index size.
Original failed14 harness/results not read per allowlist. Four failed14_family tests independently recreate three disjoint-table alias classes and missing section storage; exact original vector/name identity unverified.
No original325 regression run here; no cumulative totals. No real binaries/snapshot/settings/credentials/network/shim reads, no 14 execution, no main. Main must wait for matching independent reports.

## Named actual / expected / guard outcomes
- PASS `AST_unpack_at`: expected `True`; actual `True`. Details in results.json.
- PASS `AST_metadata`: expected `False`; actual `False`. Details in results.json.
- PASS `AST_decode_pointer`: expected `True`; actual `True`. Details in results.json.
- PASS `AST_walk_chains`: expected `True`; actual `True`. Details in results.json.
- PASS `source_only_two_guard_regions`: expected `True`; actual `True`. Details in results.json.
- PASS `abutting_header_index_record_import_symbol`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format1_symbols0`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format1_symbols1`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format2_symbols0`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format2_symbols1`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format3_symbols0`: expected `accept`; actual `accept`. Details in results.json.
- PASS `abutting_import_format3_symbols1`: expected `accept`; actual `accept`. Details in results.json.
- PASS `empty_imports_at_record_interior`: expected `accept`; actual `accept`. Details in results.json.
- PASS `empty_symbols_at_payload_end`: expected `accept`; actual `accept`. Details in results.json.
- PASS `empty_imports_and_symbols_at_end`: expected `accept`; actual `accept`. Details in results.json.
- PASS `empty_imports_at_header_boundary`: expected `accept`; actual `accept`. Details in results.json.
- PASS `empty_page_roots`: expected `accept`; actual `accept`. Details in results.json.
- PASS `zero_segment_record_offsets`: expected `accept`; actual `accept`. Details in results.json.
- PASS `imports_before_starts`: expected `accept`; actual `accept`. Details in results.json.
- PASS `no_imports_symbols_before_starts_rejected`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `failed14_family_starts_import_alias`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `failed14_family_starts_symbol_alias`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `failed14_family_import_symbol_alias`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `imports_contain_starts`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `symbols_contain_starts`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `import_symbol_exact_alias`: expected `ValueError: overlapping payload regions outside supported contract`; actual `ValueError: overlapping payload regions outside supported contract`. Details in results.json.
- PASS `record_import_partial_overlap`: expected `ValueError: overlapping segment info`; actual `ValueError: overlapping segment info`. Details in results.json.
- PASS `record_import_containment`: expected `ValueError: overlapping segment info`; actual `ValueError: overlapping segment info`. Details in results.json.
- PASS `record_symbol_partial_overlap`: expected `ValueError: overlapping segment info`; actual `ValueError: overlapping segment info`. Details in results.json.
- PASS `record_symbol_containment`: expected `ValueError: overlapping segment info`; actual `ValueError: overlapping segment info`. Details in results.json.
- PASS `record_overlaps_starts_index`: expected `ValueError: segment info overlaps index`; actual `ValueError: segment info overlaps index`. Details in results.json.
- PASS `record_record_alias`: expected `ValueError: overlapping segment info`; actual `ValueError: overlapping segment info`. Details in results.json.
- PASS `abutting_segment_records`: expected `accept`; actual `accept`. Details in results.json.
- PASS `starts_inside_header_0`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `starts_inside_header_24`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `starts_inside_header_27`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `imports_inside_header_0`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `imports_inside_header_24`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `imports_inside_header_27`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `symbols_inside_header_0`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `symbols_inside_header_24`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `symbols_inside_header_27`: expected `ValueError: fixups header offsets`; actual `ValueError: fixups header offsets`. Details in results.json.
- PASS `nsects0_exact`: expected `accept`; actual `accept`. Details in results.json.
- PASS `nsects0_padded`: expected `accept`; actual `accept`. Details in results.json.
- PASS `nsects1_exact`: expected `accept`; actual `accept`. Details in results.json.
- PASS `failed14_family_nsects_missing_storage`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `nsects1_short8`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `nsects128_exact_cap`: expected `accept`; actual `accept`. Details in results.json.
- PASS `nsects128_short8`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `nsects129_full_storage`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `nsects129_no_storage`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `nsects_uint32max`: expected `ValueError: section table storage`; actual `ValueError: section table storage`. Details in results.json.
- PASS `command_area_truncated`: expected `ValueError: load command cap`; actual `ValueError: load command cap`. Details in results.json.
- PASS `segment_declared_past_command_area`: expected `ValueError: load command range`; actual `ValueError: load command range`. Details in results.json.
- PASS `segment_command_below_fixed_header`: expected `ValueError: segment command`; actual `ValueError: segment command`. Details in results.json.
- PASS `payload_file_truncated`: expected `ValueError: segment range`; actual `ValueError: segment range`. Details in results.json.
- PASS `decode_smoke_fmt1`: expected `56`; actual `56`. Details in results.json.
- PASS `decode_smoke_fmt9`: expected `4294967352`; actual `4294967352`. Details in results.json.
- PASS `decode_smoke_fmt12`: expected `4294967352`; actual `4294967352`. Details in results.json.
- PASS `frozen_new15`: expected `True`; actual `True`. Details in results.json.
- PASS `frozen_old14`: expected `True`; actual `True`. Details in results.json.
- PASS `frozen_experiment15`: expected `True`; actual `True`. Details in results.json.
- PASS `frozen_schema`: expected `True`; actual `True`. Details in results.json.

## Files
results.json contains full per-case fixture SHA, metadata/roots/walk outputs and expected/actual outcomes. fixtures/ holds every synthetic input. source.diff records the exact two source guard edits. *.before.txt/*.after.txt and before.json/after.json bind all permitted source files. stdout.log/stderr.log preserve raw streams; exit-status.txt preserves process status. inventory.json lists final files and hashes (excluding itself).
