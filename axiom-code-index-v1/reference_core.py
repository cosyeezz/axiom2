"""Small executable reference: hashes, worktree isolation, immutable evidence and CAS.

This is NOT an Axiom/Pi integration or a complete indexer. Full-scope hashing is
an intentionally strict test oracle; production watchers may precompute changes
but must not silently claim the same guarantee without a synchronization contract.
Python >= 3.11; standard library only.
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any, Callable


class Conflict(RuntimeError):
    pass


def canonical_json(value: Any) -> str:
    # Arrays retain their order; callers must sort only semantically unordered sets.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def resolve_inside(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        raise ValueError("A nonempty relative path is required")
    root = root.resolve(strict=True)
    candidate = root / relative
    # Reference policy does not follow symlinks, even internal ones.
    current = root
    for part in Path(relative).parts:
        if part == "..":
            raise ValueError("Parent traversal is forbidden")
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlinks are outside the reference policy")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root):
        raise ValueError("Path escapes workspace")
    return resolved


def file_hash(root: Path, relative: str) -> str:
    return digest(resolve_inside(root, relative).read_bytes())


def scope_digest(root: Path, relative_dir: str = ".") -> str:
    """Strict fixture oracle; production must apply the same central file policy.

    Includes path membership AND bytes. It intentionally ignores mtimes.
    Not an atomic filesystem snapshot: callers must stop/retry on concurrent edits.
    """
    base = resolve_inside(root, relative_dir)
    if not base.is_dir():
        raise ValueError("Scope must be a directory")
    entries: list[tuple[str, str]] = []
    for path in sorted(base.rglob("*")):
        if path.is_symlink():
            raise ValueError("Symlink encountered in scope")
        if path.is_file():
            entries.append((path.relative_to(root).as_posix(), digest(path.read_bytes())))
    return digest(canonical_json(entries).encode())


def make_source_ref(root: Path, workspace_id: str, path: str, start: int, end: int) -> dict[str, Any]:
    content = resolve_inside(root, path).read_bytes()
    text = content.decode("utf-8", errors="strict")
    lines = text.splitlines()
    if start < 1 or end < start or end > len(lines):
        raise ValueError("Invalid one-based inclusive line range")
    record = {
        "workspace_id": workspace_id, "path": path,
        "content_hash": digest(content), "start_line": start, "end_line": end,
    }
    return {"id": "src_" + digest(canonical_json(record).encode()), **record}


def fetch_ref(root: Path, workspace_id: str, ref: dict[str, Any]) -> str:
    if ref["workspace_id"] != workspace_id:
        raise ValueError("Wrong workspace")
    content = resolve_inside(root, ref["path"]).read_bytes()
    if digest(content) != ref["content_hash"]:
        raise Conflict("FILE_CHANGED")
    return "\n".join(content.decode("utf-8").splitlines()[ref["start_line"]-1:ref["end_line"]])


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, isolation_level=None)
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    connection.executescript(schema)
    return connection


def put_object(connection: sqlite3.Connection, *, object_id: str, kind: str,
               name: str, body: dict[str, Any], expected_rev: int | None,
               review: dict[str, Any], validate_basis: Callable[[], bool]) -> int:
    """CAS transaction illustrating source-basis checks and no-op content revisions.

    Real commits must also validate JSON schema, evidence ledger, typed links,
    acyclicity, query projections and dependencies in the SAME transaction.
    Source reads here are synchronous and tiny because this is a fixture oracle;
    production hashes outside a short DB transaction and validates its read token.
    """
    if not validate_basis():
        raise Conflict("SOURCE_CHANGED")
    body_text = canonical_json(body)
    content_hash = digest(canonical_json({"kind": kind, "name": name, "body": body}).encode())
    connection.execute("BEGIN IMMEDIATE")
    try:
        old = connection.execute("SELECT content_rev,content_hash FROM objects WHERE id=?", (object_id,)).fetchone()
        current_rev = old[0] if old else None
        if current_rev != expected_rev:
            raise Conflict("RECORD_CHANGED")
        changed = old is None or old[1] != content_hash
        rev = (current_rev + 1 if current_rev is not None else 1) if changed else current_rev
        connection.execute(
            """INSERT INTO objects(id,kind,name,body_json,content_hash,content_rev,review_json)
               VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind,name=excluded.name,body_json=excluded.body_json,
               content_hash=excluded.content_hash,content_rev=excluded.content_rev,
               review_json=excluded.review_json""",
            (object_id, kind, name, body_text, content_hash, rev, canonical_json(review)),
        )
        if changed:
            connection.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='semantic_epoch'")
        if not validate_basis():
            raise Conflict("SOURCE_CHANGED")
        connection.execute("COMMIT")
        return int(rev)
    except BaseException:
        connection.execute("ROLLBACK")
        raise
