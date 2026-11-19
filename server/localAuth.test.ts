import { describe, expect, it } from "vitest";
import { REAL_SUPABASE_LABEL, runWithSecret } from "./testSupport/realSupabase";
import { localLogin } from "./db";

describe.skipIf(!runWithSecret("INITIAL_ADMIN_PASSWORD"))(`${REAL_SUPABASE_LABEL} Supabase authentication of the provisioned administrator`, () => {
  it("authenticates the provisioned administrator with the configured initial credentials", async () => {
    const user = await localLogin({
      email: "tadkrah@gmail.com",
      password: process.env.INITIAL_ADMIN_PASSWORD!,
    });

    expect(user.email).toBe("tadkrah@gmail.com");
    expect(user.role).toBe("admin");
  });
});
