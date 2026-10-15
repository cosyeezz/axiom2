from __future__ import annotations
import csv
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from reference_core import (Conflict, canonical_json, connect, fetch_ref, file_hash,
                            make_source_ref, put_object, resolve_inside, scope_digest)
from eval_ab import analyze, load_rows

class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)/"repo"
        self.root.mkdir()
        (self.root/"a.ts").write_text("export const a = 1;\n",encoding="utf-8")
        self.db = connect(Path(self.tmp.name)/"index.sqlite")
    def tearDown(self):
        self.db.close(); self.tmp.cleanup()
    def put(self, **kwargs):
        values=dict(object_id="impl_1",kind="implementation",name="behavior",body={"facts":[]},
                    expected_rev=None,review={"version":1},validate_basis=lambda: True)
        values.update(kwargs)
        return put_object(self.db, **values)
    def test_schema_integrity(self):
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0],"ok")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
    def test_metadata_only_change_keeps_hash(self):
        old=file_hash(self.root,"a.ts"); os.utime(self.root/"a.ts",None)
        self.assertEqual(old,file_hash(self.root,"a.ts"))
    def test_same_size_same_mtime_change_detected(self):
        p=self.root/"a.ts"; st=p.stat(); old=file_hash(self.root,"a.ts")
        p.write_text("export const a = 2;\n",encoding="utf-8")
        os.utime(p,ns=(st.st_atime_ns,st.st_mtime_ns))
        self.assertNotEqual(old,file_hash(self.root,"a.ts"))
    def test_scope_detects_addition(self):
        old=scope_digest(self.root); (self.root/"b.ts").write_text("new")
        self.assertNotEqual(old,scope_digest(self.root))
    def test_scope_detects_deletion(self):
        old=scope_digest(self.root); (self.root/"a.ts").unlink()
        self.assertNotEqual(old,scope_digest(self.root))
    def test_scope_detects_existing_file_content(self):
        old=scope_digest(self.root); (self.root/"a.ts").write_text("other")
        self.assertNotEqual(old,scope_digest(self.root))
    def test_scope_ignores_creation_order(self):
        (self.root/"b.ts").write_text("B"); old=scope_digest(self.root)
        text=(self.root/"b.ts").read_text(); (self.root/"b.ts").unlink()
        (self.root/"b.ts").write_text(text)
        self.assertEqual(old,scope_digest(self.root))
    def test_ref_returns_exact_version(self):
        ref=make_source_ref(self.root,"w1","a.ts",1,1)
        self.assertIn("a = 1",fetch_ref(self.root,"w1",ref))
    def test_ref_rejects_changed_file(self):
        ref=make_source_ref(self.root,"w1","a.ts",1,1)
        (self.root/"a.ts").write_text("changed")
        with self.assertRaises(Conflict): fetch_ref(self.root,"w1",ref)
    def test_ref_rejects_other_workspace(self):
        ref=make_source_ref(self.root,"w1","a.ts",1,1)
        with self.assertRaises(ValueError): fetch_ref(self.root,"w2",ref)
    def test_ref_range_bounds(self):
        with self.assertRaises(ValueError): make_source_ref(self.root,"w1","a.ts",1,9)
    def test_parent_traversal(self):
        with self.assertRaises(ValueError): resolve_inside(self.root,"../index.sqlite")
    def test_absolute_path(self):
        with self.assertRaises(ValueError): resolve_inside(self.root,str(self.root/"a.ts"))
    def test_symlink_rejected(self):
        (self.root/"link.ts").symlink_to(self.root/"a.ts")
        with self.assertRaises(ValueError): resolve_inside(self.root,"link.ts")
    def test_create(self):
        self.assertEqual(self.put(),1)
    def test_semantic_change_increments_revision(self):
        self.put(); self.assertEqual(self.put(expected_rev=1,body={"facts":["new"]}),2)
    def test_review_only_does_not_increment_content_revision(self):
        self.put(); self.assertEqual(self.put(expected_rev=1,review={"version":2}),1)
        self.assertEqual(self.db.execute("SELECT value FROM meta WHERE key='semantic_epoch'").fetchone()[0],"1")
    def test_compare_and_swap_rejects_stale_writer(self):
        self.put(); self.put(expected_rev=1,body={"facts":["first"]})
        with self.assertRaises(Conflict): self.put(expected_rev=1,body={"facts":["second"]})
    def test_invalid_basis_prevents_write(self):
        with self.assertRaises(Conflict): self.put(validate_basis=lambda: False)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM objects").fetchone()[0],0)
    def test_changed_basis_rolls_back(self):
        state=iter([True,False])
        with self.assertRaises(Conflict): self.put(validate_basis=lambda: next(state))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM objects").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT value FROM meta WHERE key='semantic_epoch'").fetchone()[0],"0")
    def test_invalid_kind_rolls_back(self):
        with self.assertRaises(sqlite3.IntegrityError): self.put(kind="guess")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM objects").fetchone()[0],0)
    def test_json_nan_rejected(self):
        with self.assertRaises(ValueError): canonical_json({"x":float("nan")})
    def test_json_key_order_stable(self):
        self.assertEqual(canonical_json({"b":1,"a":2}),canonical_json({"a":2,"b":1}))
    def test_json_array_order_preserved(self):
        self.assertNotEqual(canonical_json([1,2]),canonical_json([2,1]))
    def test_foreign_key_rejects_orphan_dependency(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO dependencies VALUES ('missing','file','a.ts','hash')")

class EvaluationTests(unittest.TestCase):
    def fixture(self, root:Path, omit_b=False, duplicate=False, invalid_cache=False):
        path=root/"ab.csv"
        fields=["task_id","scenario","repeat","arm","latency_ms","budget_ms","input_total","output_total","input_cached","success"]
        with path.open("w",newline="",encoding="utf-8") as f:
            writer=csv.DictWriter(f,fieldnames=fields); writer.writeheader()
            for task in range(3):
                for arm in (["A"] if omit_b else ["A","B"]):
                    row=dict(task_id=f"t{task}",scenario="synthetic",repeat=0,arm=arm,
                             latency_ms=100 if arm=="A" else 50,budget_ms=1000,
                             input_total=100,output_total=20,input_cached=200 if invalid_cache else 40,success=1)
                    writer.writerow(row)
                    if duplicate: writer.writerow(row)
        return path
    def test_paired_synthetic_ratio(self):
        with tempfile.TemporaryDirectory() as tmp:
            report=analyze(load_rows(self.fixture(Path(tmp))),iterations=100)
            self.assertEqual(report["paired_task_means"]["penalized_ms"]["effect"],.5)
    def test_missing_arm_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): load_rows(self.fixture(Path(tmp),omit_b=True))
    def test_duplicate_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): load_rows(self.fixture(Path(tmp),duplicate=True))
    def test_cache_accounting_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): load_rows(self.fixture(Path(tmp),invalid_cache=True))
    def test_failure_gets_budget_penalty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=self.fixture(Path(tmp)); text=path.read_text()
            text=text.replace(",40,1",",40,0"); path.write_text(text)
            rows=load_rows(path)
            self.assertTrue(all(row["penalized_ms"]==1000 for row in rows))

if __name__ == "__main__": unittest.main(verbosity=2)
