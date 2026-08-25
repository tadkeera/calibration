const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.INITIAL_ADMIN_PASSWORD;
const email = "tadkrah@gmail.com";

if (!projectUrl || !serviceRoleKey || !password) throw new Error("Supabase administrator provisioning is not configured");

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
const listed = await fetch(`${projectUrl}/auth/v1/admin/users?per_page=1000`, { headers });
if (!listed.ok) throw new Error("Unable to read Supabase Auth users");
const { users } = await listed.json();
let authUser = users.find((user) => user.email?.toLowerCase() === email);
if (!authUser) {
  const created = await fetch(`${projectUrl}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "System Administrator" } }) });
  if (!created.ok) throw new Error("Unable to create the initial administrator");
  authUser = await created.json();
}

const profile = await fetch(`${projectUrl}/rest/v1/app_users?on_conflict=auth_user_id`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({ auth_user_id: authUser.id, open_id: `supabase:${authUser.id}`, email, name: "System Administrator", role: "admin", login_method: "local", is_active: true, last_signed_in: new Date().toISOString() }),
});
if (!profile.ok) throw new Error("Unable to create the administrator profile");
console.log("Initial administrator provisioned");
