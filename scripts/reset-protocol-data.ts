/**
 * Local / desktop (SQLite) reset of the experimental protocol data.
 * Usage:  QC_STORAGE_MODE=local NODE_OPTIONS=--experimental-sqlite npx tsx scripts/reset-protocol-data.ts --confirm
 * For Supabase run server/sql/protocol_v4_simplified_approval_reset.sql in the SQL Editor instead.
 * A full copy of the database is written next to it before anything is deleted.
 */
import { localConnection } from "../server/localDb";
import { resetProtocolDataSqlite } from "../server/protocols/sqliteStore";

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to run without --confirm (this deletes ALL protocol data after a backup).");
    process.exit(2);
  }
  const conn = localConnection();
  const admin = conn.prepare("SELECT id, name FROM app_users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { id: number; name: string } | undefined;
  if (!admin) throw new Error("No administrator account found");
  const dbPath = (conn.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>).find(d => d.name === "main")?.file;
  if (!dbPath) throw new Error("Cannot determine the database file");
  const backupPath = `${dbPath}.protocol-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
  const result = await resetProtocolDataSqlite({ backupPath, actor: { id: admin.id, name: admin.name ?? "admin" } });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
