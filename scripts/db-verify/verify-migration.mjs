#!/usr/bin/env node
/**
 * Verifies server/sql/polarimeter_workflow_migration.sql against a REAL
 * PostgreSQL server (embedded-postgres), reproducing the deployed state:
 *   supabase_schema.sql (no retest columns) + historical rows → migration ×2.
 *
 * This is a schema-level test. It does NOT run PostgREST and does NOT touch
 * the deployed Supabase project — use GET /api/health/schema for that.
 *
 *   cd scripts/db-verify && npm install && npm test
 */
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const repo = new URL("../../server/sql/", import.meta.url).pathname;
const schemaSql = fs.readFileSync(repo + "supabase_schema.sql", "utf8");
const migrationSql = fs.readFileSync(repo + "polarimeter_workflow_migration.sql", "utf8");
const pgsrv = new EmbeddedPostgres({ databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "qc-pg-")), user: "postgres", password: "pw", port: 54329, persistent: false });
await pgsrv.initialise(); await pgsrv.start();
const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres", password: "pw", database: "postgres" });
await c.connect();
const q = (s, p) => c.query(s, p);
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1; };
const expectErr = async (name, sql, params, pattern) => {
  try { await q(sql, params); ok(name + " (expected error, got success)", false); }
  catch (e) { ok(`${name} → rejected: ${e.message.slice(0, 90)}`, pattern.test(e.message)); }
};
try {
  // Supabase-like environment
  await q(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
           create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());`);
  await q(schemaSql);
  // Pre-migration state = what the deployed DB looked like
  const pre = await q(`select column_name from information_schema.columns where table_name='validation_records' and column_name in ('retest_of_record_id','record_version','retest_reason')`);
  ok("pre-migration: retest columns absent (reproduces deployed state)", pre.rowCount === 0);
  // Historical data
  const u = await q(`insert into auth.users default values returning id`);
  const u2 = await q(`insert into auth.users default values returning id`);
  await q(`insert into app_users (auth_user_id, open_id, email, role) values ($1,'supabase:a','a@x.test','admin'), ($2,'supabase:b','b@x.test','user')`, [u.rows[0].id, u2.rows[0].id]);
  await q(`insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id)
           values ('hplc','HPLC','QC-I-104','QC-121D','QC-121D','pass','{"x":1}','A',1),
                  ('polarimeter','Polarimeter','QC-I-POL','QC-032D','F','fail','{"legacy":true}','A',2)`);
  const before = (await q(`select id, instrument_key, result_status, result_data::text, lifecycle_status, created_at from validation_records order by id`)).rows;

  // Apply migration twice (idempotency)
  await q(migrationSql); ok("migration run #1 succeeded", true);
  await q(migrationSql); ok("migration run #2 (re-run) succeeded — idempotent", true);

  const cols = (await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='validation_records' and column_name in ('retest_of_record_id','record_version','retest_reason') order by 1`)).rows;
  console.log(cols);
  const r = cols.find(x => x.column_name === "retest_of_record_id");
  ok("retest_of_record_id is bigint (matches PK type)", r?.data_type === "bigint");
  ok("retest_of_record_id is NULLable", r?.is_nullable === "YES");
  const fks = (await q(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.validation_records'::regclass and contype='f' and pg_get_constraintdef(oid) like '%retest_of_record_id%'`)).rows;
  ok(`exactly one self-referencing FK (no duplicate on re-run): ${fks.map(f=>f.d).join("; ")}`, fks.length === 1 && /REFERENCES validation_records\(id\)/.test(fks[0].d));
  const idx = (await q(`select indexname from pg_indexes where tablename='validation_records' and indexname='validation_records_retest_parent_idx'`)).rowCount;
  ok("retest parent index exists", idx === 1);
  const after = (await q(`select id, instrument_key, result_status, result_data::text, lifecycle_status, created_at from validation_records order by id`)).rows;
  ok("historical rows unchanged", JSON.stringify(before) === JSON.stringify(after));
  const hist = (await q(`select retest_of_record_id, record_version from validation_records order by id`)).rows;
  ok("historical rows get retest_of_record_id NULL, record_version 1", hist.every(h => h.retest_of_record_id === null && h.record_version === 1));
  for (const t of ["polarimeter_drafts","record_technical_reviews","polarimeter_deviations","polarimeter_deviation_events"])
    ok(`table ${t} exists`, (await q(`select to_regclass('public.${t}') r`)).rows[0].r !== null);

  // Behaviour: normal record with NULL
  const normal = await q(`insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id,retest_of_record_id,retest_reason)
           values ('polarimeter','Polarimeter','QC-I-POL','QC-032D','F','pass','{"polarimeterData":{"schemaVersion":"2"}}','A',2,null,null) returning id, retest_of_record_id`);
  ok("normal Polarimeter record saves with retest_of_record_id NULL", normal.rows[0].retest_of_record_id === null);
  // Update draft (record_version bump path used by app)
  const upd = await q(`update validation_records set result_data='{"polarimeterData":{"schemaVersion":"2","v":2}}', record_version=record_version+1 where id=$1 and record_version=1 returning record_version`, [normal.rows[0].id]);
  ok("existing non-failed draft can be updated (version 2)", upd.rows[0]?.record_version === 2);
  // Retest linked to failed polarimeter record (id 2)
  const retest = await q(`insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id,retest_of_record_id,retest_reason)
           values ('polarimeter','Polarimeter','QC-I-POL','QC-032D','F','pass','{}','A',2,2,'Lamp replaced after failed accuracy') returning retest_of_record_id`);
  ok("retest referencing failed original saves", Number(retest.rows[0].retest_of_record_id) === 2);
  ok("original failed record still present & unchanged", (await q(`select result_data::text d from validation_records where id=2`)).rows[0].d === before[1].result_data);
  await expectErr("retest of a PASSED record", `insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id,retest_of_record_id,retest_reason) values ('polarimeter','P','QC-I-POL','QC-032D','F','pass','{}','A',2,$1,'reason long enough')`, [normal.rows[0].id], /failed Polarimeter/);
  await expectErr("retest pointing to non-existent record", `insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id,retest_of_record_id,retest_reason) values ('polarimeter','P','QC-I-POL','QC-032D','F','pass','{}','A',2,99999,'reason long enough')`, [], /failed Polarimeter|foreign key/);
  await expectErr("retest reason without original", `insert into validation_records (instrument_key,instrument_name,instrument_id,sop_number,form_number,result_status,result_data,pharmacist_name,validated_by_user_id,retest_reason) values ('polarimeter','P','QC-I-POL','QC-032D','F','pass','{}','A',2,'orphan reason')`, [], /requires an original/);
  await expectErr("overwrite failed Polarimeter measurements", `update validation_records set result_data='{"tampered":true}' where id=2`, [], /immutable/);
  await expectErr("delete failed Polarimeter record", `delete from validation_records where id=2`, [], /retained/);
  // Other instrument unaffected
  const hplc = await q(`update validation_records set pharmacist_name='B' where id=1 returning id`);
  ok("other instrument (HPLC) record still editable", hplc.rowCount === 1);
  // Simulate column existing WITHOUT FK, then re-run → FK added
  await q(`alter table validation_records drop constraint ${fks[0].conname}`);
  await q(migrationSql);
  const fks2 = (await q(`select count(*)::int n from pg_constraint where conrelid='public.validation_records'::regclass and contype='f' and pg_get_constraintdef(oid) like '%retest_of_record_id%'`)).rows[0].n;
  ok("re-run restores missing FK on pre-existing column", fks2 === 1);
} catch (e) { console.error("ERROR", e); process.exitCode = 1; }
finally { await c.end(); await pgsrv.stop(); }
