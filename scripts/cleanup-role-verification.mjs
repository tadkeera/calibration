const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = "role-verification@example.test";
if (!projectUrl || !serviceRoleKey) throw new Error("Supabase service configuration is unavailable");
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
const request = async (path, init = {}) => {
  const response = await fetch(`${projectUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Cleanup failed (${response.status}): ${await response.text()}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};
const profiles = await request(`/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=id,auth_user_id&limit=1`);
if (profiles[0]) {
  const profile = profiles[0];
  const admins = await request(`/rest/v1/app_users?email=eq.tadkrah%40gmail.com&select=id&limit=1`);
  const adminId = admins[0]?.id;
  const records = await request(`/rest/v1/validation_records?validated_by_user_id=eq.${profile.id}&select=id`);
  for (const record of records) {
    await request(`/rest/v1/audit_events?validation_record_id=eq.${record.id}`, { method: "DELETE" });
    await request(`/rest/v1/record_approvals?validation_record_id=eq.${record.id}`, { method: "DELETE" });
    await request(`/rest/v1/validation_records?id=eq.${record.id}`, { method: "DELETE" });
  }
  await request(`/rest/v1/instrument_change_events?editor_user_id=eq.${profile.id}`, { method: "DELETE" });
  if (adminId) await request(`/rest/v1/instrument_profiles?instrument_key=eq.disintegration`, { method: "PATCH", body: JSON.stringify({ model: "ZT51", updated_by_user_id: adminId, updated_at: new Date().toISOString() }) });
  await request(`/auth/v1/admin/users/${profile.auth_user_id}`, { method: "DELETE" });
}
console.log("Role verification data cleaned up");
