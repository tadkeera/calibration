-- Centralized Equipment Protocol Management — additive Supabase migration.
--
-- HOW TO APPLY (Supabase Dashboard → SQL Editor → New query → paste → Run):
--   * Prerequisites: server/sql/supabase_schema.sql and
--     server/sql/polarimeter_workflow_migration.sql already applied.
--   * Additive only: NO existing table, column or row is modified or removed.
--   * Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
--   * Runs in one transaction: either everything is applied or nothing is.
--   * Ends with NOTIFY pgrst so PostgREST reloads its schema cache immediately.
--   * If an earlier version of this file was already applied, simply run the
--     whole (updated) file again: new tables/columns are added, nothing is lost.
--   * Verify afterwards: GET https://<your-app>/api/health/schema
--     → "protocolManagement": { "ok": true, "workflowOk": true }.
--
-- Security model:
--   * Tables are readable by service_role only (RLS on, anon/authenticated revoked).
--   * service_role has NO direct INSERT/UPDATE/DELETE. Every write goes through
--     public.protocol_apply_changes(jsonb), which applies a whole change set in a
--     single transaction with row-version guards (optimistic concurrency).
--   * Database triggers enforce: allowed status transitions, content editable
--     only in draft/changes-required, approved revisions immutable, approval /
--     audit / execution records append-only, no deletion of historical records.
--   * Role / duty / segregation-of-duties checks are enforced by the application
--     backend (server/protocols/service.ts) before the change set is submitted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.protocols (
  id text PRIMARY KEY,
  protocol_number text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  equipment_category text,
  equipment_type text,
  manufacturer text,
  model text,
  instrument_key text,
  equipment_id text,
  association_type text NOT NULL CHECK (association_type IN ('model','equipment')),
  protocol_type text NOT NULL,
  intended_use text,
  status text NOT NULL,
  current_revision_id text,
  current_revision_number integer,
  released_revision_id text,
  released_revision_number integer,
  review_flag boolean NOT NULL DEFAULT false,
  review_flag_reason text,
  created_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocols_instrument_idx ON public.protocols(instrument_key);

CREATE TABLE IF NOT EXISTS public.protocol_revisions (
  id text PRIMARY KEY,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  status text NOT NULL,
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  change_reason text NOT NULL,
  revision_description text,
  based_on_revision_id text REFERENCES public.protocol_revisions(id),
  locked boolean NOT NULL DEFAULT false,
  author_user_id bigint NOT NULL REFERENCES public.app_users(id),
  author_name text,
  submitted_at timestamptz,
  technical_reviewer_user_id bigint REFERENCES public.app_users(id),
  technical_reviewer_name text,
  technical_reviewed_at timestamptz,
  qa_approver_user_id bigint REFERENCES public.app_users(id),
  qa_approver_name text,
  approved_at timestamptz,
  released_by_user_id bigint REFERENCES public.app_users(id),
  released_by_name text,
  released_at timestamptz,
  effective_date date,
  next_review_date date,
  superseded_at timestamptz,
  superseded_by_revision_id text,
  retired_at timestamptz,
  reference_snapshot jsonb,
  reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_verification_count integer NOT NULL DEFAULT 0,
  open_gap_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT protocol_revisions_number_key UNIQUE (protocol_id, revision_number)
);
CREATE INDEX IF NOT EXISTS protocol_revisions_status_idx ON public.protocol_revisions(status);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_revisions_one_open_idx ON public.protocol_revisions(protocol_id)
  WHERE status NOT IN ('released','superseded','retired','rejected');
CREATE UNIQUE INDEX IF NOT EXISTS protocol_revisions_one_released_idx ON public.protocol_revisions(protocol_id)
  WHERE status = 'released';

CREATE TABLE IF NOT EXISTS public.protocol_references (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  issuer text,
  reference_type text NOT NULL,
  document_number text,
  edition text,
  revision text,
  publication_date text,
  effective_date text,
  expiry_date text,
  review_date text,
  source_url text,
  document_url text,
  applicable_section text,
  applicable_clause text,
  verification_status text NOT NULL CHECK (verification_status IN ('pending-verification','verified','superseded','withdrawn')),
  verified_at timestamptz,
  verified_by_user_id bigint REFERENCES public.app_users(id),
  verified_by_name text,
  notes text,
  created_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.protocol_approvals (
  id text PRIMARY KEY,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  revision_id text NOT NULL REFERENCES public.protocol_revisions(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL,
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  signature_meaning text,
  actor_user_id bigint NOT NULL REFERENCES public.app_users(id),
  actor_name text,
  actor_role text,
  comment text,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_approvals_revision_idx ON public.protocol_approvals(revision_id, created_at);

CREATE TABLE IF NOT EXISTS public.protocol_review_comments (
  id text PRIMARY KEY,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  revision_id text NOT NULL REFERENCES public.protocol_revisions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('comment','gap-decision')),
  stage text NOT NULL,
  target_type text NOT NULL,
  target_key text,
  body text NOT NULL,
  decision text,
  author_user_id bigint NOT NULL REFERENCES public.app_users(id),
  author_name text,
  status text NOT NULL CHECK (status IN ('open','resolved','recorded')),
  resolution_note text,
  resolved_by_user_id bigint REFERENCES public.app_users(id),
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocol_review_comments_revision_idx ON public.protocol_review_comments(revision_id, created_at);

CREATE TABLE IF NOT EXISTS public.protocol_audit_events (
  id text PRIMARY KEY,
  protocol_id text,
  revision_id text,
  revision_number integer,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  actor_user_id bigint NOT NULL REFERENCES public.app_users(id),
  actor_name text,
  actor_role text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_audit_events_protocol_idx ON public.protocol_audit_events(protocol_id, created_at);
CREATE INDEX IF NOT EXISTS protocol_audit_events_entity_idx ON public.protocol_audit_events(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.protocol_executions (
  id text PRIMARY KEY,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  revision_id text NOT NULL REFERENCES public.protocol_revisions(id) ON DELETE RESTRICT,
  protocol_number text NOT NULL,
  revision_number integer NOT NULL,
  content_hash text NOT NULL,
  instrument_key text NOT NULL,
  equipment_id text,
  serial_number text,
  validation_record_id bigint REFERENCES public.validation_records(id) ON DELETE RESTRICT,
  stage text,
  measurements jsonb NOT NULL,
  evaluation jsonb NOT NULL,
  overall_result text NOT NULL CHECK (overall_result IN ('PASS','FAIL','INCOMPLETE','NOT APPLICABLE','UNDER REVIEW')),
  engine_version text NOT NULL,
  protocol_snapshot jsonb NOT NULL,
  reference_snapshot jsonb,
  comments text,
  executed_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  executed_by_name text,
  executed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_executions_revision_idx ON public.protocol_executions(revision_id);
CREATE INDEX IF NOT EXISTS protocol_executions_instrument_idx ON public.protocol_executions(instrument_key, executed_at);
CREATE INDEX IF NOT EXISTS protocol_executions_record_idx ON public.protocol_executions(validation_record_id)
  WHERE validation_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.protocol_notifications (
  id text PRIMARY KEY,
  kind text NOT NULL,
  recipient_duty text,
  recipient_user_id bigint REFERENCES public.app_users(id),
  protocol_id text REFERENCES public.protocols(id),
  revision_id text REFERENCES public.protocol_revisions(id),
  message text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_notifications_created_idx ON public.protocol_notifications(created_at);

CREATE TABLE IF NOT EXISTS public.protocol_notification_reads (
  id text PRIMARY KEY,
  notification_id text NOT NULL REFERENCES public.protocol_notifications(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES public.app_users(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_notification_reads_once UNIQUE (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.protocol_duty_assignments (
  id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.app_users(id),
  duty text NOT NULL,
  granted_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id bigint REFERENCES public.app_users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_duty_active_idx ON public.protocol_duty_assignments(user_id, duty)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.protocol_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  template_category text NOT NULL,
  protocol_type text NOT NULL,
  description text,
  structure jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  source_revision_id text REFERENCES public.protocol_revisions(id),
  created_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Module extension (v2): electronic re-authentication flag, execution
-- activity / deviations, execution review & approval, controlled attachments.
-- Additive and idempotent: safe on databases where the first version of this
-- file was already applied (re-run the whole file).
-- ---------------------------------------------------------------------------

ALTER TABLE public.protocol_approvals ADD COLUMN IF NOT EXISTS reauthenticated boolean NOT NULL DEFAULT false;
ALTER TABLE public.protocol_executions ADD COLUMN IF NOT EXISTS activity_key text;
ALTER TABLE public.protocol_executions ADD COLUMN IF NOT EXISTS activity_name text;
ALTER TABLE public.protocol_executions ADD COLUMN IF NOT EXISTS deviations jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS protocol_executions_activity_idx
  ON public.protocol_executions(protocol_id, instrument_key, activity_key, executed_at);

CREATE TABLE IF NOT EXISTS public.protocol_execution_reviews (
  id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES public.protocol_executions(id) ON DELETE RESTRICT,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  action text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  signature_meaning text NOT NULL,
  reauthenticated boolean NOT NULL DEFAULT false,
  comment text NOT NULL CHECK (length(btrim(comment)) >= 3),
  actor_user_id bigint NOT NULL REFERENCES public.app_users(id),
  actor_name text,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_execution_reviews_step CHECK (
    (action = 'review' AND from_status = 'recorded' AND to_status = 'reviewed')
    OR (action = 'approve' AND from_status = 'reviewed' AND to_status = 'approved')
    OR (action = 'reject' AND from_status IN ('recorded','reviewed') AND to_status = 'rejected')),
  -- One decision per execution state: concurrent / duplicate decisions are impossible.
  CONSTRAINT protocol_execution_reviews_once UNIQUE (execution_id, from_status)
);
CREATE INDEX IF NOT EXISTS protocol_execution_reviews_execution_idx ON public.protocol_execution_reviews(execution_id, created_at);

CREATE TABLE IF NOT EXISTS public.protocol_attachments (
  id text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('execution','reference')),
  entity_id text NOT NULL,
  protocol_id text REFERENCES public.protocols(id),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 3145728),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_base64 text NOT NULL,
  description text,
  uploaded_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protocol_attachments_entity_idx ON public.protocol_attachments(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Module extension (v3): equipment specifications page, field-level equipment
-- audit, calibration runs (dynamic per-protocol workflow) and their immutable
-- version history. Additive and idempotent (re-run the whole file).
-- Rollback notes: server/sql/protocol_management_v3_rollback.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.protocol_equipment_specs (
  id text PRIMARY KEY,
  instrument_key text NOT NULL UNIQUE,
  equipment_type text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  retired_reason text,
  retired_at timestamptz,
  created_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id bigint REFERENCES public.app_users(id),
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.protocol_equipment_changes (
  id text PRIMARY KEY,
  change_set_id text NOT NULL,
  instrument_key text NOT NULL,
  field_group text NOT NULL,
  field text NOT NULL,
  label text,
  previous_value jsonb,
  new_value jsonb,
  unit text,
  critical boolean NOT NULL DEFAULT false,
  reason text,
  reference text,
  actor_user_id bigint NOT NULL REFERENCES public.app_users(id),
  actor_name text,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_equipment_changes_reason CHECK (NOT critical OR length(btrim(coalesce(reason, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS protocol_equipment_changes_key_idx ON public.protocol_equipment_changes(instrument_key, created_at);

CREATE TABLE IF NOT EXISTS public.protocol_runs (
  id text PRIMARY KEY,
  run_number text NOT NULL UNIQUE,
  protocol_id text NOT NULL REFERENCES public.protocols(id) ON DELETE RESTRICT,
  revision_id text NOT NULL REFERENCES public.protocol_revisions(id) ON DELETE RESTRICT,
  protocol_number text NOT NULL,
  revision_number integer NOT NULL,
  revision_status text NOT NULL,
  content_hash text NOT NULL,
  protocol_snapshot jsonb NOT NULL,
  instrument_key text NOT NULL,
  equipment_snapshot jsonb NOT NULL,
  equipment_version text NOT NULL,
  measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluation jsonb,
  overall_result text,
  current_step text,
  status text NOT NULL CHECK (status IN ('draft','recorded','abandoned')),
  execution_id text REFERENCES public.protocol_executions(id),
  abandon_reason text,
  created_by_user_id bigint NOT NULL REFERENCES public.app_users(id),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id bigint REFERENCES public.app_users(id),
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS protocol_runs_protocol_idx ON public.protocol_runs(protocol_id, instrument_key, status);

CREATE TABLE IF NOT EXISTS public.protocol_run_snapshots (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES public.protocol_runs(id) ON DELETE RESTRICT,
  row_version integer NOT NULL,
  action text NOT NULL,
  measurements jsonb NOT NULL,
  evaluation jsonb,
  overall_result text,
  equipment_version text,
  reason text,
  actor_user_id bigint NOT NULL REFERENCES public.app_users(id),
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protocol_run_snapshots_once UNIQUE (run_id, row_version)
);

CREATE OR REPLACE FUNCTION public.protocol_runs_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'protocol_runs: recorded / abandoned runs are immutable';
  END IF;
  IF NEW.protocol_id IS DISTINCT FROM OLD.protocol_id OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.equipment_snapshot IS DISTINCT FROM OLD.equipment_snapshot OR NEW.equipment_version IS DISTINCT FROM OLD.equipment_version
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.protocol_snapshot IS DISTINCT FROM OLD.protocol_snapshot OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.instrument_key IS DISTINCT FROM OLD.instrument_key OR NEW.run_number IS DISTINCT FROM OLD.run_number THEN
    RAISE EXCEPTION 'protocol_runs: protocol, revision, equipment snapshot and creator are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protocol_runs_guard ON public.protocol_runs;
CREATE TRIGGER protocol_runs_guard BEFORE UPDATE ON public.protocol_runs FOR EACH ROW EXECUTE FUNCTION public.protocol_runs_guard();

-- ---------------------------------------------------------------------------
-- Database-level integrity guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protocol_revisions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'protocol_revisions: deletion is not permitted (historical records are preserved)';
  END IF;
  IF NEW.protocol_id IS DISTINCT FROM OLD.protocol_id OR NEW.revision_number IS DISTINCT FROM OLD.revision_number THEN
    RAISE EXCEPTION 'protocol_revisions: protocol_id and revision_number are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status || '>' || NEW.status) = ANY (ARRAY[
    'draft>technical-review-pending',
    'technical-changes-required>technical-review-pending',
    'qa-changes-required>technical-review-pending',
    'technical-review-pending>technical-review-in-progress',
    'technical-review-in-progress>technical-changes-required',
    'technical-review-in-progress>technically-reviewed',
    'technically-reviewed>qa-review-pending',
    'qa-review-pending>qa-review-in-progress',
    'qa-review-in-progress>qa-changes-required',
    'qa-review-in-progress>approved',
    'qa-review-in-progress>rejected',
    'approved>released',
    'released>superseded',
    'released>retired'
  ])) THEN
    RAISE EXCEPTION 'protocol_revisions: invalid status transition % -> %', OLD.status, NEW.status;
  END IF;
  IF (NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash)
     AND (NOT (OLD.status = ANY (ARRAY['draft','technical-changes-required','qa-changes-required'])) OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'protocol_revisions: content may only change while the revision is editable (draft or changes required)';
  END IF;
  IF OLD.locked AND (NOT NEW.locked
      OR NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
      OR NEW.reference_snapshot IS DISTINCT FROM OLD.reference_snapshot OR NEW.reference_ids IS DISTINCT FROM OLD.reference_ids
      OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
      OR NEW.technical_reviewer_user_id IS DISTINCT FROM OLD.technical_reviewer_user_id
      OR NEW.qa_approver_user_id IS DISTINCT FROM OLD.qa_approver_user_id
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.technical_reviewed_at IS DISTINCT FROM OLD.technical_reviewed_at
      OR NEW.change_reason IS DISTINCT FROM OLD.change_reason
      OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at)) THEN
    RAISE EXCEPTION 'protocol_revisions: approved revisions are immutable; create a new revision';
  END IF;
  IF NEW.locked AND NOT (NEW.status = ANY (ARRAY['approved','released','superseded','retired'])) THEN
    RAISE EXCEPTION 'protocol_revisions: only approved/released/superseded/retired revisions can be locked';
  END IF;
  IF NOT NEW.locked AND NEW.status = ANY (ARRAY['approved','released','superseded','retired']) THEN
    RAISE EXCEPTION 'protocol_revisions: approved, released, superseded and retired revisions must stay locked';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protocol_revisions_guard ON public.protocol_revisions;
CREATE TRIGGER protocol_revisions_guard BEFORE UPDATE OR DELETE ON public.protocol_revisions
  FOR EACH ROW EXECUTE FUNCTION public.protocol_revisions_guard();

CREATE OR REPLACE FUNCTION public.protocol_review_comments_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'protocol_review_comments: deletion is not permitted';
  END IF;
  IF OLD.kind = 'gap-decision' OR OLD.status <> 'open'
     OR NEW.body IS DISTINCT FROM OLD.body OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.decision IS DISTINCT FROM OLD.decision
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protocol_review_comments: comment content and gap decisions are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protocol_review_comments_guard ON public.protocol_review_comments;
CREATE TRIGGER protocol_review_comments_guard BEFORE UPDATE OR DELETE ON public.protocol_review_comments
  FOR EACH ROW EXECUTE FUNCTION public.protocol_review_comments_guard();

CREATE OR REPLACE FUNCTION public.protocol_execution_reviews_sequence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.protocol_execution_reviews r
             WHERE r.execution_id = NEW.execution_id AND r.to_status IN ('approved','rejected')) THEN
    RAISE EXCEPTION 'protocol_execution_reviews: the execution already has a final decision';
  END IF;
  IF NEW.from_status = 'reviewed' AND NOT EXISTS (SELECT 1 FROM public.protocol_execution_reviews r
             WHERE r.execution_id = NEW.execution_id AND r.to_status = 'reviewed') THEN
    RAISE EXCEPTION 'protocol_execution_reviews: QA decision requires a completed technical review';
  END IF;
  IF NEW.from_status = 'recorded' AND EXISTS (SELECT 1 FROM public.protocol_execution_reviews r
             WHERE r.execution_id = NEW.execution_id) THEN
    RAISE EXCEPTION 'protocol_execution_reviews: the execution is no longer in the recorded state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.protocol_executions e WHERE e.id = NEW.execution_id AND e.executed_by_user_id = NEW.actor_user_id) THEN
    RAISE EXCEPTION 'protocol_execution_reviews: segregation of duties - the executor cannot review or approve their own execution';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protocol_execution_reviews_sequence ON public.protocol_execution_reviews;
CREATE TRIGGER protocol_execution_reviews_sequence BEFORE INSERT ON public.protocol_execution_reviews
  FOR EACH ROW EXECUTE FUNCTION public.protocol_execution_reviews_sequence();

CREATE OR REPLACE FUNCTION public.protocol_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '%: % is not permitted (append-only / historical record)', TG_TABLE_NAME, TG_OP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['protocol_approvals','protocol_audit_events','protocol_executions','protocol_notifications','protocol_notification_reads','protocol_execution_reviews','protocol_attachments','protocol_equipment_changes','protocol_run_snapshots'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protocol_append_only_guard()', t || '_append_only', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['protocols','protocol_references','protocol_templates','protocol_duty_assignments','protocol_equipment_specs','protocol_runs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protocol_append_only_guard()', t || '_no_delete', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Transactional write function (the only write path for service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protocol_apply_changes(p_changes jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_change jsonb;
  v_table text;
  v_op text;
  v_sets text;
  v_conds text;
  v_count integer;
  v_applied integer := 0;
  v_allowed constant text[] := ARRAY['protocols','protocol_revisions','protocol_references','protocol_approvals',
    'protocol_review_comments','protocol_audit_events','protocol_executions','protocol_notifications',
    'protocol_notification_reads','protocol_duty_assignments','protocol_templates','protocol_execution_reviews','protocol_attachments',
    'protocol_equipment_specs','protocol_equipment_changes','protocol_runs','protocol_run_snapshots'];
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'protocol_apply_changes: p_changes must be a JSON array';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    v_table := v_change->>'table';
    v_op := v_change->>'op';
    IF v_table IS NULL OR NOT (v_table = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'protocol_apply_changes: table % is not allowed', v_table;
    END IF;
    IF v_op = 'insert' OR v_op = 'insert-ignore' THEN
      IF jsonb_typeof(v_change->'row') <> 'object' THEN
        RAISE EXCEPTION 'protocol_apply_changes: insert requires a row object';
      END IF;
      EXECUTE format('INSERT INTO public.%1$I SELECT * FROM jsonb_populate_record(NULL::public.%1$I, $1) %2$s',
                     v_table, CASE WHEN v_op = 'insert-ignore' THEN 'ON CONFLICT DO NOTHING' ELSE '' END)
        USING v_change->'row';
    ELSIF v_op = 'update' THEN
      IF v_change->>'id' IS NULL OR jsonb_typeof(v_change->'set') <> 'object' THEN
        RAISE EXCEPTION 'protocol_apply_changes: update requires id and set';
      END IF;
      SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO v_sets
        FROM jsonb_object_keys(v_change->'set') AS k WHERE k <> 'id';
      IF v_sets IS NULL THEN
        RAISE EXCEPTION 'protocol_apply_changes: empty update';
      END IF;
      SELECT string_agg(format('t.%I IS NOT DISTINCT FROM e.%I', k, k), ' AND ') INTO v_conds
        FROM jsonb_object_keys(COALESCE(v_change->'expect', '{}'::jsonb)) AS k;
      EXECUTE format('UPDATE public.%1$I AS t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) AS r, '
                     'jsonb_populate_record(NULL::public.%1$I, $2) AS e WHERE t.id = $3 AND %3$s',
                     v_table, v_sets, COALESCE(v_conds, 'TRUE'))
        USING v_change->'set', COALESCE(v_change->'expect', '{}'::jsonb), v_change->>'id';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409',
          MESSAGE = format('PROTOCOL_CONFLICT: %s %s was changed concurrently or is not in the expected state', v_table, v_change->>'id');
      END IF;
    ELSE
      RAISE EXCEPTION 'protocol_apply_changes: unsupported operation %', v_op;
    END IF;
    v_applied := v_applied + 1;
  END LOOP;
  RETURN v_applied;
END $$;

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['protocols','protocol_revisions','protocol_references','protocol_approvals',
    'protocol_review_comments','protocol_audit_events','protocol_executions','protocol_notifications',
    'protocol_notification_reads','protocol_duty_assignments','protocol_templates','protocol_execution_reviews','protocol_attachments',
    'protocol_equipment_specs','protocol_equipment_changes','protocol_runs','protocol_run_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.protocol_apply_changes(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protocol_apply_changes(jsonb) TO service_role;

COMMIT;

-- Reload the PostgREST schema cache so the API recognises the new tables and
-- function immediately (avoids PGRST202/PGRST205 "not found in schema cache").
NOTIFY pgrst, 'reload schema';

-- Verification: expect 17 rows (13 core + 4 v3 workflow tables).
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'protocol%'
 ORDER BY table_name;
