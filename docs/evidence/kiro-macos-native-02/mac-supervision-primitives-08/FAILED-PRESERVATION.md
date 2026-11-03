# Preservation attempt failed after copies, before aggregate manifest

Unique `preserve_results.py` execution **exit1**. Its immutable failure source is retained. All4review and18launchd files had completed their per-file hash/byte/0400readback before the doc check. Thus full contents now exist in06/authority-review and08/capture, even though **no preservation.json was emitted and no aggregate/doc pass is claimed**.

Cause: the new validator incorrectly required every rootREADME link to stay in native-02. The existing legitimate link `../kiro-macos-native-01/FAILURE.md` was rejected. This is a **new archival harness scope error**, not a target/API/source-content failure. No target or network operation ran. Do not rerun occupied directories or alter this failed script; recover in a new artifact-only case, allowing exactly that known sibling evidence file.

The following is a **later transcription of the tool's original combined console output**, not an original stderr file captured at run time:

```text
Traceback (most recent call last):
  File "/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-08/preserve_results.py", line 110, in <module>
    main()
  File "/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-08/preserve_results.py", line 76, in main
    target.relative_to(ROOT)
  File "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9/pathlib.py", line 929, in relative_to
    raise ValueError("{!r} is not in the subpath of {!r}"
ValueError: '/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-01/FAILURE.md' is not in the subpath of '/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02' OR one path is relative and the other is absolute.
Command exited with code 1
```
