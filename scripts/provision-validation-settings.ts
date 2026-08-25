import { defaultSettings } from "../client/src/lib/qc";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
const adminResponse = await fetch(`${url}/rest/v1/app_users?email=eq.tadkrah%40gmail.com&select=id&limit=1`, { headers });
if (!adminResponse.ok) throw new Error("Unable to find the initial administrator profile");
const [admin] = await adminResponse.json() as Array<{ id: number }>;
if (!admin) throw new Error("Initial administrator profile is unavailable");

for (const [deviceKey, settings] of Object.entries(defaultSettings)) {
  const response = await fetch(`${url}/rest/v1/validation_settings?on_conflict=device_key`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ device_key: deviceKey, settings, updated_by_user_id: admin.id }),
  });
  if (!response.ok) throw new Error(`Unable to provision settings for ${deviceKey}`);
}

console.log("Controlled validation settings provisioned");
