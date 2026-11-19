import { describe, expect, it } from "vitest";
import { REAL_SUPABASE_LABEL, runRealSupabase, runWithSecret } from "./testSupport/realSupabase";

describe.skipIf(!runRealSupabase)(`${REAL_SUPABASE_LABEL} Supabase service connection`, () => {
  it("authenticates against the project settings endpoint", async () => {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(url).toMatch(/^https:\/\/.+\.supabase\.co$/);
    expect(serviceRoleKey).toBeTruthy();

    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: {
        apikey: serviceRoleKey!,
        Authorization: `Bearer ${serviceRoleKey!}`,
      },
    });

    expect(response.ok).toBe(true);
  });

  it.skipIf(!runWithSecret("SUPABASE_ACCESS_TOKEN"))("authenticates with the management API for the configured project", async () => {
    const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
    const projectRef = new URL(process.env.SUPABASE_URL!).hostname.split(".")[0];

    expect(accessToken).toBeTruthy();

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
      headers: { Authorization: `Bearer ${accessToken!}` },
    });

    expect(response.ok).toBe(true);
  });

  it.skipIf(!runWithSecret("INITIAL_ADMIN_PASSWORD"))("has the required initial administrator password before provisioning", async () => {
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(password).toBeTruthy();

    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: {
        apikey: serviceRoleKey!,
        Authorization: `Bearer ${serviceRoleKey!}`,
        "x-initial-admin-password-present": password ? "true" : "false",
      },
    });

    expect(response.ok).toBe(true);
  });
});
