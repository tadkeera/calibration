import { readFile } from "node:fs/promises";

const projectUrl = process.env.SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectUrl || !accessToken) {
  throw new Error("SUPABASE_URL and SUPABASE_ACCESS_TOKEN are required");
}

const projectRef = new URL(projectUrl).hostname.split(".")[0];
const query = await readFile(new URL("../server/sql/supabase_schema.sql", import.meta.url), "utf8");
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});

if (!response.ok) {
  throw new Error(`Supabase schema migration failed with status ${response.status}`);
}

console.log("Supabase schema migration completed");
