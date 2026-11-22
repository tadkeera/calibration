-- =============================================================================
-- Protocol module v4 — simplified Quality Manager approval + reset of the
-- experimental protocol data (2026-11-18).
--
-- Run the WHOLE file once in the Supabase SQL Editor AFTER
-- server/sql/protocol_management_migration.sql (v3) has been applied.
--
-- What it does (single transaction — all or nothing):
--   1. BACKUP: copies every protocol table into schema protocol_backup_20261118
--      (only if that backup does not exist yet — re-running never overwrites
--      the first backup).
--   2. Installs the updated revision guard (adds the draft > released
--      transition used by the one-step Quality Manager approval).
--   3. RESET: deletes all experimental protocol data — protocols, revisions
--      (tests / acceptance criteria / formulas live inside revision content),
--      approvals, review comments, executions and their reviews, calibration
--      runs and their versions, protocol notifications, protocol/reference
--      attachments, the reference library and saved templates.
--
-- NEVER touched: app_users (accounts), roles, protocol_duty_assignments
-- (permissions), instrument_profiles / protocol_equipment_specs /
-- protocol_equipment_changes (equipment master), validation_records (legacy
-- validation history), settings and the protocol audit trail
-- (protocol_audit_events — a reset event is appended).
--
-- Guard triggers are disabled ONLY inside this transaction for the deletion and
-- re-enabled before COMMIT. Foreign keys stay enforced.
--
-- Restore (if ever needed): see the commented block at the end of this file.
-- =============================================================================

BEGIN;

-- 1. Backup -------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['protocols','protocol_revisions','protocol_references','protocol_approvals',
    'protocol_review_comments','protocol_executions','protocol_execution_reviews','protocol_notifications',
    'protocol_notification_reads','protocol_templates','protocol_attachments','protocol_runs','protocol_run_snapshots'];
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'protocol_backup_20261118') THEN
    RAISE NOTICE 'Backup schema protocol_backup_20261118 already exists — keeping the original backup';
  ELSE
    EXECUTE 'CREATE SCHEMA protocol_backup_20261118';
    FOREACH t IN ARRAY tables LOOP
      EXECUTE format('CREATE TABLE protocol_backup_20261118.%I AS TABLE public.%I', t, t);
    END LOOP;
    EXECUTE 'REVOKE ALL ON SCHEMA protocol_backup_20261118 FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- 2. Simplified approval: revision guard with draft > released ------------------
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
    'draft>released',
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

-- 3. Reset of the experimental protocol data ------------------------------------
DO $$
DECLARE
  t text;
  guarded text[] := ARRAY['protocols','protocol_revisions','protocol_references','protocol_approvals',
    'protocol_review_comments','protocol_executions','protocol_execution_reviews','protocol_notifications',
    'protocol_notification_reads','protocol_templates','protocol_attachments','protocol_runs','protocol_run_snapshots'];
  counts jsonb := '{}'::jsonb;
  n bigint;
  admin_id bigint;
BEGIN
  FOREACH t IN ARRAY guarded LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    counts := counts || jsonb_build_object(t, n);
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;

  -- Child rows first (foreign keys remain enforced).
  DELETE FROM public.protocol_run_snapshots;
  DELETE FROM public.protocol_runs;
  DELETE FROM public.protocol_execution_reviews;
  DELETE FROM public.protocol_attachments;
  DELETE FROM public.protocol_executions;
  DELETE FROM public.protocol_notification_reads;
  DELETE FROM public.protocol_notifications;
  DELETE FROM public.protocol_approvals;
  DELETE FROM public.protocol_review_comments;
  DELETE FROM public.protocol_templates;
  DELETE FROM public.protocol_revisions;
  DELETE FROM public.protocols;
  DELETE FROM public.protocol_references;

  FOREACH t IN ARRAY guarded LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;

  SELECT id INTO admin_id FROM public.app_users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF admin_id IS NOT NULL THEN
    INSERT INTO public.protocol_audit_events (id, entity_type, entity_id, action, actor_user_id, actor_name, actor_role, previous_value, new_value, reason, created_at)
    VALUES (gen_random_uuid()::text, 'module', 'protocol-data', 'protocol-data.reset', admin_id, 'Database migration (v4)', 'system',
            counts, jsonb_build_object('backupSchema', 'protocol_backup_20261118', 'kept', jsonb_build_array('app_users','protocol_duty_assignments','instrument_profiles','protocol_equipment_specs','protocol_equipment_changes','validation_records','protocol_audit_events')),
            'Experimental protocol data removed before the new Protocol page / simplified Quality Manager approval (v4). Protocols are re-entered manually.', now());
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification: every protocol data table must report 0; users and equipment are untouched.
SELECT 'protocols' AS table_name, count(*) FROM public.protocols
UNION ALL SELECT 'protocol_revisions', count(*) FROM public.protocol_revisions
UNION ALL SELECT 'protocol_references', count(*) FROM public.protocol_references
UNION ALL SELECT 'protocol_runs', count(*) FROM public.protocol_runs
UNION ALL SELECT 'protocol_executions', count(*) FROM public.protocol_executions
UNION ALL SELECT 'app_users (kept)', count(*) FROM public.app_users
UNION ALL SELECT 'protocol_duty_assignments (kept)', count(*) FROM public.protocol_duty_assignments
UNION ALL SELECT 'protocol_equipment_specs (kept)', count(*) FROM public.protocol_equipment_specs;

-- -----------------------------------------------------------------------------
-- Restore from the backup (manual, only if required — run inside BEGIN/COMMIT):
--   ALTER TABLE public.<t> DISABLE TRIGGER USER;            -- for each table
--   INSERT INTO public.protocol_references SELECT * FROM protocol_backup_20261118.protocol_references;
--   INSERT INTO public.protocols            SELECT * FROM protocol_backup_20261118.protocols;
--   INSERT INTO public.protocol_revisions   SELECT * FROM protocol_backup_20261118.protocol_revisions;
--   ... (approvals, comments, templates, executions, reviews, attachments,
--        notifications, notification_reads, runs, run_snapshots)
--   ALTER TABLE public.<t> ENABLE TRIGGER USER;
-- -----------------------------------------------------------------------------
