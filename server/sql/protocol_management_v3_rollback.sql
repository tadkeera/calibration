-- ROLLBACK NOTES — Protocol Management v3 (equipment specifications, equipment
-- field-level audit, calibration runs). DO NOT RUN unless you intend to remove
-- the v3 features. Read first:
--
--   * Rolling back DELETES the v3 records (equipment specifications, the
--     equipment change log, calibration-run drafts and their version history).
--     Export them first, for example:
--       COPY (SELECT * FROM public.protocol_equipment_changes) TO STDOUT WITH CSV HEADER;
--     or use Supabase Table Editor -> Export CSV for each of the 4 tables.
--   * The 13 core Protocol Management tables, all protocols, revisions,
--     executions, approvals and audit events are NOT touched. Protocols
--     imported from the 8-protocol package remain (they are ordinary drafts).
--   * Formal executions recorded from a run live in protocol_executions and are
--     kept; only the link run -> execution is lost.
--   * After rollback the app keeps working: the Protocol Management module
--     reports workflowOk=false and hides the equipment page / run workflow.
--   * To restore, re-run server/sql/protocol_management_migration.sql.
--
-- The append-only / no-delete triggers must be dropped before the tables.

BEGIN;

DROP TRIGGER IF EXISTS protocol_equipment_changes_append_only ON public.protocol_equipment_changes;
DROP TRIGGER IF EXISTS protocol_run_snapshots_append_only ON public.protocol_run_snapshots;
DROP TRIGGER IF EXISTS protocol_equipment_specs_no_delete ON public.protocol_equipment_specs;
DROP TRIGGER IF EXISTS protocol_runs_no_delete ON public.protocol_runs;
DROP TRIGGER IF EXISTS protocol_runs_guard ON public.protocol_runs;
DROP FUNCTION IF EXISTS public.protocol_runs_guard();

DROP TABLE IF EXISTS public.protocol_run_snapshots;
DROP TABLE IF EXISTS public.protocol_runs;
DROP TABLE IF EXISTS public.protocol_equipment_changes;
DROP TABLE IF EXISTS public.protocol_equipment_specs;

-- Restore the v2 write whitelist: re-run the protocol_apply_changes function
-- definition from the v2 version of protocol_management_migration.sql
-- (git: the file as of commit b8761d2). Leaving the v3 function in place is
-- harmless: writes to the dropped tables simply fail.

COMMIT;
NOTIFY pgrst, 'reload schema';
