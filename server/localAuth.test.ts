import { describe, expect, it } from "vitest";
import { localLogin } from "./db";

describe("local Supabase authentication", () => {
  it("authenticates the provisioned administrator with the configured initial credentials", async () => {
    const user = await localLogin({
      email: "tadkrah@gmail.com",
      password: process.env.INITIAL_ADMIN_PASSWORD!,
    });

    expect(user.email).toBe("tadkrah@gmail.com");
    expect(user.role).toBe("admin");
  });
});
