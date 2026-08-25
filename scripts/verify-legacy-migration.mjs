import mysql from "mysql2/promise";

const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;
if (!projectUrl || !serviceRoleKey || !databaseUrl) throw new Error("Migration verification configuration is unavailable");

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
const rest = async (path, options = {}) => {
  const response = await fetch(`${projectUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase verification failed (${response.status}): ${await response.text()}`);
  return response.json();
};
const sourceTables = ["users", "validationRecords", "auditEvents", "recordApprovals", "instrumentProfiles", "instrumentChangeEvents"];
const targetTables = { users: "app_users", validationRecords: "validation_records", auditEvents: "audit_events", recordApprovals: "record_approvals", instrumentProfiles: "instrument_profiles", instrumentChangeEvents: "instrument_change_events" };
const connection = await mysql.createConnection(databaseUrl);
const report = [];

for (const sourceTable of sourceTables) {
  const [[{ total: sourceCount }]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${sourceTable}\``);
  const imports = await rest(`/rest/v1/legacy_imports?source_table=eq.${encodeURIComponent(sourceTable)}&select=source_id,target_id&order=source_id.asc`);
  if (Number(sourceCount) !== imports.length) throw new Error(`${sourceTable}: expected ${sourceCount} imports but found ${imports.length}`);
  if (imports[0]) {
    const targetTable = targetTables[sourceTable];
    const sample = await rest(`/rest/v1/${targetTable}?id=eq.${imports[0].target_id}&select=id&limit=1`);
    if (!sample[0]) throw new Error(`${sourceTable}: imported sample target is missing`);
  }
  report.push({ sourceTable, sourceCount: Number(sourceCount), importedCount: imports.length });
}

await connection.end();
console.table(report);
console.log("Legacy migration verification completed");
