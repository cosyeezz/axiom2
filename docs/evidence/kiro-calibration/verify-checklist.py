#!/usr/bin/env python3
"""Document and source-byte checks only; never imports project code or user data."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
REPORT = ROOT / "docs/kiro-calibration-checklist.md"
BASELINE = HERE / "previous-source-baseline.json"
OMISSION = ROOT / "docs/kiro-omission-review.md"
HISTORY_REPORT = ROOT / "docs/kiro-calibration-checklist-41-items.md"
HISTORY_RESULT = HERE / "verification-41-items.json"
REA_INDEX = HERE / "chat-local-rea-index.json"
EXPECTED_COUNT = 49
SECOND_REPORT = ROOT / "docs/kiro-calibration-checklist-48-items.md"
SECOND_OMISSION = ROOT / "docs/kiro-omission-review-48-items.md"
SECOND_RESULT = HERE / "verification-48-items.json"
THIRD_REPORT = ROOT / "docs/kiro-calibration-checklist-49-items.md"
THIRD_OMISSION = ROOT / "docs/kiro-omission-review-49-items.md"
THIRD_RESULT = HERE / "verification-49-items.json"
THIRD_REPORT_SHA = "6d9e8a9ce1e58cbe2d52e139aa4168cc01476c631d7c4ff4ae2cb3470fd78503"
THIRD_OMISSION_SHA = "c73d86a60ee0e3db865aaf7d322e2354e3da276c7c88293331e84c28c32e73c9"
THIRD_RESULT_SHA = "11f41dfbf9688cddfeca116609932cee8c873430b8e473280adeb826d5c6ae58"
REVIEW = HERE / "convergence-review.md"
REVIEWED_SOURCE = HERE / "convergence-source-baseline.json"
REVIEWED_SOURCE_SHA = "771f92d636840d6b9f3460caa0a24a1de03fefc77a6407f033157161a99e3fc1"
REVIEWED_PARALLEL = {"app/src/server/agent-worker.ts", "app/src/server/agents.ts",
                     "app/src/server/integrations/model-proxy-env.ts"}
SECOND_REPORT_SHA = "3462fbf32b1cb784347a68788d2a6254d19e35b4907b36f1c47d7f5f6b09ff1d"
SECOND_OMISSION_SHA = "27705985943e90f82440c3423dc048b35685e6cadd4314189b779ef77ffae575"
SECOND_RESULT_SHA = "d5803ffeab9c379bd20dc322f6edd3e7b26d1de39893dd85632cc6d748e7ce54"
HISTORY_REPORT_SHA = "aade806d740fc3101f7fdca8fcad149387bc1c1c119bd2d7fd3d8bb52fa2107e"
HISTORY_RESULT_SHA = "31fc90ad91f3e1d6d8aa96f2d0b971456340bc6625cadbf759b17bd1c1d29628"
CURRENT_PACKAGE_SHA = "68bffa21347a561e34a6017300a96687299feaf57917dbfdf32ccbc1e174af52"
EXPECTED_HEAD = "f9e68b140d20edb79ece463c1632c51ca9d7afc8"
EXPECTED_PI = "1.1.0"
failures = []


def fail(message):
    failures.append(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args):
    proc = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=15)
    if proc.returncode:
        fail("git command failed: " + " ".join(args) + ": " + str(proc.returncode))
    return {"args": list(args), "exit_code": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}


def local_links(document):
    checked = []
    text = document.read_text(encoding="utf-8")
    for raw in re.findall(r"\[[^\]\n]+\]\(([^)\s]+)\)", text):
        parts = urlsplit(raw)
        if parts.scheme or parts.netloc or raw.startswith("#"):
            fail(f"Unsupported non-local/file-only link in {document.name}: {raw}")
            continue
        target = (document.parent / unquote(parts.path)).resolve()
        if not target.is_relative_to(ROOT):
            fail(f"Link outside repository: {raw}")
            continue
        rel = str(target.relative_to(ROOT))
        row = {"document": str(document.relative_to(ROOT)), "target": rel, "fragment": parts.fragment}
        if target == HERE / "verification.json" and not parts.fragment:
            row["generated_by_this_run"] = True
        elif not target.is_file():
            fail(f"Missing linked file: {raw}")
        elif parts.fragment:
            match = re.fullmatch(r"L([1-9]\d*)(?:-L([1-9]\d*))?", parts.fragment)
            if not match:
                fail(f"Unsupported line anchor: {raw}")
            else:
                start = int(match.group(1))
                end = int(match.group(2) or start)
                lines = len(target.read_text(encoding="utf-8").splitlines())
                row.update({"start_line": start, "end_line": end, "file_line_count": lines})
                if not 1 <= start <= end <= lines:
                    fail(f"Line anchor outside file: {raw}")
        checked.append(row)
    return checked


document_paths = [REPORT, OMISSION, HISTORY_REPORT, HISTORY_RESULT,
                  SECOND_REPORT, SECOND_OMISSION, SECOND_RESULT, REA_INDEX, BASELINE,
                  THIRD_REPORT, THIRD_OMISSION, THIRD_RESULT, REVIEW, REVIEWED_SOURCE,
                  HERE / "README.md", HERE / "semantic-review.md", Path(__file__)]
document_snapshot = {str(path.relative_to(ROOT)): sha(path) for path in document_paths}
baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
reviewed = json.loads(REVIEWED_SOURCE.read_text(encoding="utf-8"))
if sha(REVIEWED_SOURCE) != REVIEWED_SOURCE_SHA or len(reviewed["source_snapshot_sha256"]) != 77:
    fail("Reviewed 77-source observation changed; re-review required")
text = REPORT.read_text(encoding="utf-8")
rows = re.findall(r"^\| (K\d{2}) \|.*$", text, re.MULTILINE)
expected_ids = [f"K{i:02d}" for i in range(1, EXPECTED_COUNT + 1)]
if rows != expected_ids:
    fail(f"Checklist IDs must appear once each, in order K01..K{EXPECTED_COUNT:02d}")
matrix_rows = re.findall(r"^\| (K\d{2}) \|.*$", OMISSION.read_text(encoding="utf-8"), re.MULTILINE)
if matrix_rows != expected_ids:
    fail("Official-evidence matrix must contain the same ordered IDs as the checklist")
if sha(HISTORY_REPORT) != HISTORY_REPORT_SHA or sha(HISTORY_RESULT) != HISTORY_RESULT_SHA:
    fail("Archived 41-item checklist/result changed")
history = json.loads(HISTORY_RESULT.read_text(encoding="utf-8"))
if (history["checklist"]["count"], history["links_checked"], history["unique_linked_files"],
        len(history["source_snapshot_sha256"]), history["prior_sources_matched"]) != (41, 86, 42, 35, 15):
    fail("Historical result no longer records the preserved 41/86/42/35/15 observation")
history_rows = re.findall(r"^\| (K\d{2}) \|.*$", HISTORY_REPORT.read_text(encoding="utf-8"), re.MULTILINE)
if history_rows != expected_ids[:41] or history["checklist"]["sha256"] != HISTORY_REPORT_SHA:
    fail("Historical checklist IDs/hash do not match archived verification")
if (sha(SECOND_REPORT) != SECOND_REPORT_SHA or sha(SECOND_OMISSION) != SECOND_OMISSION_SHA
        or sha(SECOND_RESULT) != SECOND_RESULT_SHA):
    fail("Archived 48-item checklist/omission/result changed")
second = json.loads(SECOND_RESULT.read_text(encoding="utf-8"))
if (second["checklist"]["count"], second["official_evidence_matrix"]["count"], second["links_checked"],
        second["unique_linked_files"], len(second["source_snapshot_sha256"])) != (48, 48, 171, 61, 49):
    fail("Historical 48-item result no longer records the preserved 48/48/171/61/49 observation")
for path in (SECOND_REPORT, SECOND_OMISSION):
    if re.findall(r"^\| (K\d{2}) \|.*$", path.read_text(encoding="utf-8"), re.MULTILINE) != expected_ids[:48]:
        fail("Archived 48-item IDs changed: " + path.name)
if (second["checklist"]["sha256"] != SECOND_REPORT_SHA
        or second["official_evidence_matrix"]["sha256"] != SECOND_OMISSION_SHA):
    fail("Historical 48-item hashes do not match archived documents")
if (sha(THIRD_REPORT) != THIRD_REPORT_SHA or sha(THIRD_OMISSION) != THIRD_OMISSION_SHA
        or sha(THIRD_RESULT) != THIRD_RESULT_SHA):
    fail("Archived 49-item checklist/omission/result changed")
third = json.loads(THIRD_RESULT.read_text(encoding="utf-8"))
if (third["checklist"]["count"], third["official_evidence_matrix"]["count"], third["links_checked"],
        third["unique_linked_files"], len(third["source_snapshot_sha256"]),
        len(third["supporting_document_sha256"])) != (49, 49, 219, 73, 59, 12):
    fail("Historical 49-item observation no longer records 49/49/219/73/59/12")
if third["checklist"]["disposition_counts"] != {"保留": 15, "待修": 14, "待证": 12, "待验": 8}:
    fail("Historical 49-item dispositions changed")
for path in (THIRD_REPORT, THIRD_OMISSION):
    if re.findall(r"^\| (K\d{2}) \|.*$", path.read_text(encoding="utf-8"), re.MULTILINE) != expected_ids:
        fail("Archived 49-item IDs changed: " + path.name)
if (third["checklist"]["sha256"] != THIRD_REPORT_SHA
        or third["official_evidence_matrix"]["sha256"] != THIRD_OMISSION_SHA):
    fail("Historical 49-item hashes do not match archived documents")
rea = json.loads(REA_INDEX.read_text(encoding="utf-8"))
expected_labels = {"generate-request", "header-builder", "json-key-writer", "json-string-writer",
                   "request-finalizer", "message-serializer", "input-context-serializer",
                   "bearer-builder", "generate-operation-future", "models-operation-future",
                   "event-header-handler"}
if len(rea["functions"]) != 11 or {f["label"] for f in rea["functions"]} != expected_labels:
    fail("Historical local REA excerpt must retain its 11 distinct analyst aliases")
if rea["source"]["sha256"] != "1061c72fc190e0772ab74202c9ce1acbb83e11e8ab7e6a68a3aa3cf2e41a19d4":
    fail("REA excerpt source binding changed")
if rea["original_index_sha256"] != "b2c66139f19550e698856bf281483cb8a6bd4f8d09305c2a833f057914b5121f":
    fail("REA excerpt original-index binding changed")
for function in rea["functions"]:
    if not re.fullmatch(r"ev_[0-9a-f]{64}", function["evidence_id"]):
        fail("Invalid historical Evidence ID: " + function["label"])
    for key in ("evidence_file_sha256", "analysis_profile_digest"):
        if not re.fullmatch(r"[0-9a-f]{64}", function[key]):
            fail("Invalid historical digest: " + function["label"])
    if int(function["va_start"], 16) >= int(function["va_end_exclusive"], 16):
        fail("Invalid historical function interval: " + function["label"])
statuses = collections.Counter()
for line in text.splitlines():
    if not re.match(r"^\| K\d{2} \|", line):
        continue
    status = re.findall(r"\*\*(保留|待修|待证|待验) / P[012]\*\*", line)
    if len(status) != 1:
        fail("Missing/ambiguous disposition: " + line.split("|", 2)[1])
    else:
        statuses[status[0]] += 1
    if line.count("|") != 6:
        fail("Expected five checklist columns: " + line.split("|", 2)[1])
if dict(statuses) != {"保留": 13, "待修": 16, "待证": 12, "待验": 8}:
    fail("Disposition counts differ from the reviewed 13/16/12/8; not pass/fail counts")
head = git("rev-parse", "HEAD")
if head["stdout"] != EXPECTED_HEAD:
    fail("Source HEAD changed since checklist was written; re-review required")
versions = {}
for package in ("pi-ai", "pi-coding-agent", "pi-agent-core"):
    path = ROOT / f"app/node_modules/@earendil-works/{package}/package.json"
    version = json.loads(path.read_text(encoding="utf-8"))["version"]
    versions[package] = version
    if version != EXPECTED_PI:
        fail(f"Installed {package} version changed: {version}")
links = (local_links(REPORT) + local_links(OMISSION) + local_links(HERE / "README.md")
         + local_links(HERE / "semantic-review.md") + local_links(REVIEW))
source_paths = (set(baseline["source_snapshot_sha256"]) | set(history["source_snapshot_sha256"])
                | set(second["source_snapshot_sha256"]) | set(third["source_snapshot_sha256"])
                | set(reviewed["source_snapshot_sha256"]))
source_paths.update(row["target"] for row in links if row["target"].startswith("app/"))
source_paths.update({"app/package.json", *(f"app/node_modules/@earendil-works/{name}/package.json" for name in versions)})
snapshot = {}
for rel in sorted(source_paths):
    path = ROOT / rel
    if not path.is_file():
        fail("Missing source file: " + rel)
    else:
        snapshot[rel] = sha(path)
if snapshot != reviewed["source_snapshot_sha256"]:
    fail("Current source bytes/scope differ from the reviewed 77-source observation")


def compare_snapshot(reference, expected_changes, label):
    rows = []
    for rel, previous in reference["source_snapshot_sha256"].items():
        current = snapshot.get(rel)
        match = current == previous
        accepted = (not match and rel in REVIEWED_PARALLEL
                    and current == reviewed["source_snapshot_sha256"].get(rel))
        if rel == "app/package.json" and not match:
            accepted = current == CURRENT_PACKAGE_SHA
        rows.append({"path": rel, "previous_sha256": previous, "current_sha256": current,
                     "matches": match, "reviewed_parallel_change": accepted})
    changed = {row["path"] for row in rows if not row["matches"]}
    if changed != expected_changes or any(not row["matches"] and not row["reviewed_parallel_change"] for row in rows):
        fail("Unexpected source change from " + label + "; re-review required")
    return rows


comparison = compare_snapshot(baseline, {"app/src/server/agent-worker.ts"}, "prior 15-source observation")
history_comparison = compare_snapshot(history, REVIEWED_PARALLEL | {"app/package.json"}, "41-item 35-source observation")
second_comparison = compare_snapshot(second, REVIEWED_PARALLEL, "48-item 49-source observation")
third_comparison = compare_snapshot(third, REVIEWED_PARALLEL, "49-item 59-source observation")
provider_paths = [p for p in baseline["source_snapshot_sha256"] if p.startswith("app/src/server/providers/kiro")]
provider_diff = git("diff", "--exit-code", "HEAD", "--", *provider_paths)
diff_scope = sorted(p for p in source_paths if not p.startswith("app/node_modules/"))
update_diff = git("diff", "--numstat", baseline["previous_head"], "--", *diff_scope)
# Detect concurrent changes during this byte-only observation. No test is run.
for rel, digest in snapshot.items():
    if sha(ROOT / rel) != digest:
        fail("Source changed during document check: " + rel)
for rel, digest in document_snapshot.items():
    if sha(ROOT / rel) != digest:
        fail("Document changed during document check: " + rel)
result = {
    "kind": "read-only-document-and-source-byte-verification",
    "observed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "head": head,
    "installed_pi_versions": versions,
    "checklist": {"path": str(REPORT.relative_to(ROOT)), "sha256": sha(REPORT), "count": len(rows), "ids": rows, "disposition_counts": dict(statuses)},
    "official_evidence_matrix": {"path": str(OMISSION.relative_to(ROOT)), "sha256": sha(OMISSION), "count": len(matrix_rows), "ids": matrix_rows},
    "archived_41_items": {"checklist_sha256": sha(HISTORY_REPORT), "verification_sha256": sha(HISTORY_RESULT),
                          "historical_counts": {"items": 41, "links": 86, "linked_files": 42, "sources": 35, "prior_sources_matched": 15},
                          "source_comparison": history_comparison,
                          "sources_matched": sum(row["matches"] for row in history_comparison),
                          "observed_change": "app/package.json has the prior entities dependency change; worker/agents/network have separately reviewed parallel hot-switch changes. Pi remains 1.1.0."},
    "archived_48_items": {"checklist_sha256": sha(SECOND_REPORT), "omission_sha256": sha(SECOND_OMISSION),
                          "verification_sha256": sha(SECOND_RESULT),
                          "historical_counts": {"items": 48, "matrix_rows": 48, "links": 171, "linked_files": 61, "sources": 49},
                          "source_comparison": second_comparison,
                          "sources_matched": sum(row["matches"] for row in second_comparison)},
    "archived_49_items": {"checklist_sha256": sha(THIRD_REPORT), "omission_sha256": sha(THIRD_OMISSION),
                          "verification_sha256": sha(THIRD_RESULT),
                          "historical_counts": {"items": 49, "matrix_rows": 49, "links": 219, "linked_files": 73,
                                                "sources": 59, "supporting_documents": 12},
                          "source_comparison": third_comparison,
                          "sources_matched": sum(row["matches"] for row in third_comparison)},
    "reviewed_source_baseline": {"path": str(REVIEWED_SOURCE.relative_to(ROOT)), "sha256": sha(REVIEWED_SOURCE),
                                 "observed_at_utc": reviewed["observed_at_utc"], "source_count": len(reviewed["source_snapshot_sha256"]),
                                 "sources_matched": sum(snapshot.get(rel) == digest for rel, digest in reviewed["source_snapshot_sha256"].items()),
                                 "parallel_changes_from_49_items": sorted(REVIEWED_PARALLEL)},
    "historical_local_rea_excerpt": {"path": str(REA_INDEX.relative_to(ROOT)), "sha256": sha(REA_INDEX), "functions": len(rea["functions"]), "new_REA_execution": False, "full_evidence_bodies_revalidated": False},
    "links_checked": len(links),
    "unique_linked_files": len({row["target"] for row in links}),
    "links": links,
    "previous_source_baseline_sha256": sha(BASELINE),
    "prior_source_comparison": comparison,
    "prior_sources_matched": sum(row["matches"] for row in comparison),
    "source_snapshot_sha256": snapshot,
    "provider_diff": provider_diff,
    "update_diff_from_previous_head": update_diff,
    "verifier_sha256": sha(Path(__file__)),
    "semantic_review_present": (HERE / "semantic-review.md").is_file(),
    "supporting_document_sha256": document_snapshot,
    "failures": failures,
    "limits": [
        "Checks document structure, local file/line links and observed source bytes only; not semantics or official CLI behavior.",
        "No project source imported or executed; no source tests, builds, network, Kiro CLI/REA, login, refresh or model calls.",
        "No live credentials, login caches, user model configuration, logs or transcripts read.",
        "Preserved prior hashes are a prior working-tree observation, not a clean-commit baseline.",
        "Parallel source changes were reviewed and recorded explicitly; the source tree was not successfully frozen.",
        "Convergence-round conclusions are human semantic judgments, not established by this byte checker.",
        "Official-evidence matrix is checked for ID completeness only, not factual proof of the assigned evidence levels.",
        "Historical REA excerpt checks metadata bindings only, not raw binaries or complete Evidence bodies.",
        "All runtime acceptance scenarios and official full-call-chain validation remain unexecuted in this review."
    ]
}
(HERE / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"checklist_count": len(rows), "matrix_count": len(matrix_rows), "disposition_counts": dict(statuses), "links_checked": len(links), "unique_linked_files": result["unique_linked_files"], "prior_sources_matched": result["prior_sources_matched"], "archived_35_sources_matched": result["archived_41_items"]["sources_matched"], "archived_49_sources_matched": result["archived_48_items"]["sources_matched"], "archived_59_sources_matched": result["archived_49_items"]["sources_matched"], "reviewed_77_sources_matched": result["reviewed_source_baseline"]["sources_matched"], "source_files_observed": len(snapshot), "historical_local_rea_functions": len(rea["functions"]), "failures": failures}, ensure_ascii=False, indent=2))
sys.exit(1 if failures else 0)
