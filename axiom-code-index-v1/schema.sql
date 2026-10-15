-- Target initial production schema. NOT an implemented Axiom migration.
-- One DB/worker/author lock per indexKey in an Axiom data root; workspace aliases share it.
-- Runtime must validate JSON, graph types, evidence, ownership, lifecycle and CAS.
-- Legacy Python reference tests exercise only the original primitive subset of this schema.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 3000;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  content_hash TEXT,
  language TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL CHECK(status IN ('present','deleted','parse_error')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  observed_epoch INTEGER NOT NULL CHECK(observed_epoch >= 0)
);

CREATE TABLE IF NOT EXISTS scopes (
  id TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  definition_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  content_digest TEXT NOT NULL
);

-- Three code layers, module/knowledge views, and independently versioned edges.
CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('symbol','module','implementation','feature','knowledge','edge')),
  name TEXT NOT NULL,
  natural_key TEXT,
  file_path TEXT,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  content_hash TEXT NOT NULL,
  content_rev INTEGER NOT NULL CHECK(content_rev >= 1),
  record_rev INTEGER NOT NULL DEFAULT 1 CHECK(record_rev >= 1),
  review_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(review_json)),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS symbol_identity
  ON objects(natural_key) WHERE kind='symbol' AND natural_key IS NOT NULL AND lifecycle='active';
CREATE INDEX IF NOT EXISTS objects_kind ON objects(kind,lifecycle);
CREATE INDEX IF NOT EXISTS objects_path ON objects(file_path);

-- Immutable references: the file may subsequently disappear.
CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  start_line INTEGER NOT NULL CHECK(start_line >= 0),
  start_character INTEGER NOT NULL CHECK(start_character >= 0),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  end_character INTEGER NOT NULL CHECK(end_character >= 0),
  encoding TEXT NOT NULL CHECK(encoding = 'utf-16'),
  CHECK(end_line > start_line OR end_character >= start_character)
);

-- Committed assertions keep evidence after the request ledger expires.
-- scope_observation JSON includes its immutable historical scope definition/digest.
CREATE TABLE IF NOT EXISTS evidence_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('source_range','scope_observation')),
  source_ref_id TEXT REFERENCES source_refs(id),
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  CHECK((kind='source_range' AND source_ref_id IS NOT NULL)
     OR (kind='scope_observation' AND source_ref_id IS NULL))
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES objects(id),
  to_id TEXT REFERENCES objects(id),
  source_ref_id TEXT REFERENCES source_refs(id),
  relation TEXT NOT NULL CHECK(relation IN ('contains','uses','code','test','relates','applies_to','contradicts')),
  slot TEXT NOT NULL DEFAULT '',
  CHECK((to_id IS NOT NULL AND source_ref_id IS NULL)
     OR (to_id IS NULL AND source_ref_id IS NOT NULL)),
  CHECK(to_id IS NULL OR from_id <> to_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS link_node_unique
  ON links(from_id,relation,to_id,slot) WHERE to_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS link_source_unique
  ON links(from_id,relation,source_ref_id,slot) WHERE source_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS links_reverse ON links(to_id);

-- version is a hash, scope digest, object content_rev, or context fingerprint.
CREATE TABLE IF NOT EXISTS dependencies (
  owner_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('file','scope','object','context')),
  dep_key TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY(owner_id,kind,dep_key)
);
CREATE INDEX IF NOT EXISTS dependencies_reverse ON dependencies(kind,dep_key);

-- Persist observations before scheduling; watcher events are hints, never proof.
CREATE TABLE IF NOT EXISTS change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('tool','watcher','reconcile')),
  run_id TEXT,
  observed_epoch INTEGER NOT NULL,
  consumed_by TEXT
);
-- Total initialization/import budgets survive batching and restarts.
CREATE TABLE IF NOT EXISTS job_groups (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('bootstrap','import_review')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
  consumed_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(consumed_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','running','done','blocked','cancelled','interrupted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Jobs belong to this DB's indexKey. The workspace is only the current admission owner.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES job_groups(id),
  owner_workspace_id TEXT,
  purpose TEXT NOT NULL CHECK(purpose IN ('bootstrap','maintain','import_review')),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
  budget_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(budget_json)),
  consumed_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(consumed_json)),
  event_high_watermark INTEGER NOT NULL DEFAULT 0 CHECK(event_high_watermark >= 0),
  scope_ids_json TEXT NOT NULL CHECK(json_valid(scope_ids_json)),
  origin_run_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(origin_run_ids_json)),
  input_digest TEXT NOT NULL,
  coalesce_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','running','done','blocked','cancelled','interrupted')),
  reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  lease_owner TEXT,
  lease_until INTEGER,
  next_attempt_at INTEGER,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(state <> 'running' OR owner_workspace_id IS NOT NULL)
);
-- coalesce_key includes indexKey/scope/input digest, plus purpose/group for explicit jobs.
CREATE UNIQUE INDEX IF NOT EXISTS job_coalesce ON jobs(coalesce_key)
  WHERE state IN ('pending','running');

-- Issued source references alone do not prove this run read their content.
CREATE TABLE IF NOT EXISTS request_ledgers (
  ledger_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  owner_json TEXT NOT NULL CHECK(json_valid(owner_json)),
  purpose TEXT NOT NULL,
  basis_json TEXT NOT NULL CHECK(json_valid(basis_json)),
  visible_evidence_json TEXT NOT NULL CHECK(json_valid(visible_evidence_json)),
  expires_at INTEGER NOT NULL,
  UNIQUE(request_id,attempt_id)
);
-- Immutable commit facts, not a pre-authorized response cache. Replays recheck ownership,
-- current policy and basis; owner_json follows SubmissionOwner and outlives the ledger.
CREATE TABLE IF NOT EXISTS submissions (
  request_id TEXT PRIMARY KEY,
  proposal_digest TEXT NOT NULL,
  owner_json TEXT NOT NULL CHECK(json_valid(owner_json)),
  outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json)),
  committed_at INTEGER NOT NULL
);
-- Persist before sending; missing provider measurements remain unknown, never fabricated zeros.
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  model_request_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  owner_workspace_id TEXT NOT NULL,
  owner_session_id TEXT,
  owner_run_id TEXT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  measurement_state TEXT NOT NULL CHECK(measurement_state IN ('pending','reported','unknown')),
  measurement_reason TEXT,
  usage_json TEXT CHECK(usage_json IS NULL OR json_valid(usage_json)),
  accounting_state TEXT NOT NULL CHECK(accounting_state IN ('workspace','session_pending','session_recorded')),
  created_at INTEGER NOT NULL,
  CHECK((measurement_state='reported' AND usage_json IS NOT NULL)
     OR (measurement_state IN ('pending','unknown') AND usage_json IS NULL)),
  CHECK((measurement_state='unknown' AND measurement_reason IS NOT NULL AND length(trim(measurement_reason)) > 0)
     OR (measurement_state<>'unknown' AND measurement_reason IS NULL))
);
-- manifest_json stores ContextDelivery ownership/policy, object revisions/scopes,
-- and ContextFocusSnapshot input boundary, anchor, call/result stamps and reason codes.
-- Stamps keep separate source/projected hashes, never chat or tool-result bodies.
-- Recovery checks the full current branch (including compacted context edits),
-- latest consumed input even if omitted, paired calls/results and current permissions.
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY,
  model_request_id TEXT,
  package_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  context_generation TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  state TEXT NOT NULL CHECK(state IN ('prepared','included','obsolete')),
  updated_at INTEGER NOT NULL,
  CHECK(state <> 'included' OR model_request_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS delivery_context
  ON deliveries(session_id,run_id,context_generation);
-- A staged import cannot appear in search or current overview projections.
CREATE TABLE IF NOT EXISTS import_candidates (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected')),
  resolution_json TEXT CHECK(resolution_json IS NULL OR json_valid(resolution_json))
);

-- Exact-query cache only. Values reference committed object IDs/revisions,
-- never an unchecked model paragraph. Eviction is not freshness validation.
CREATE TABLE IF NOT EXISTS query_cache (
  key TEXT PRIMARY KEY,
  workspace_epoch INTEGER NOT NULL,
  semantic_epoch INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  basis_json TEXT NOT NULL CHECK(json_valid(basis_json)),
  last_access INTEGER NOT NULL
);

-- Small deterministic lexical index. FTS is an optional replaceable projection.
CREATE TABLE IF NOT EXISTS search_terms (
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight > 0),
  PRIMARY KEY(object_id,term)
);
CREATE INDEX IF NOT EXISTS search_terms_lookup ON search_terms(term);

INSERT OR IGNORE INTO meta(key,value) VALUES ('schema_version','1');
INSERT OR IGNORE INTO meta(key,value) VALUES ('workspace_epoch','0');
INSERT OR IGNORE INTO meta(key,value) VALUES ('semantic_epoch','0');
-- Workspace identity, authorization/policy and analysis-context hashes are initialized
-- by the owner, never accepted from a locator proposal. Schema migrations must not
-- silently downgrade a newer database; CREATE IF NOT EXISTS is not migration logic.
