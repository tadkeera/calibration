import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { closeLocalDatabase, createInitialAdmin, createLocalUser, getUserByEmail, listAdminActivityEvents, localLogin, updateUserActiveState } from "./localDb";

const testDatabase = "/tmp/miayar-local-storage.test.sqlite";

describe("local SQLite desktop storage", () => {
  beforeEach(() => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
    process.env.QC_LOCAL_DB_PATH = testDatabase;
    process.env.QC_INITIAL_ADMIN_PASSWORD = "offline-admin-test-password";
  });

  afterEach(() => {
    closeLocalDatabase();
    if (existsSync(testDatabase)) rmSync(testDatabase);
  });

  it("creates the first administrator locally and authenticates without Supabase", async () => {
    const administrator = await createInitialAdmin();
    const signedIn = await localLogin({ email: "tadkrah@gmail.com", password: "offline-admin-test-password" });

    expect(administrator.role).toBe("admin");
    expect(signedIn.id).toBe(administrator.id);
    expect(existsSync(testDatabase)).toBe(true);
  });

  it("prevents a disabled local account from signing in and retains the admin activity", async () => {
    const administrator = await createInitialAdmin();
    const user = await createLocalUser({ email: "offline.user@example.test", password: "offline-user-password", name: "Offline User", role: "user" });

    await updateUserActiveState({ id: user.id, isActive: false, actorUserId: administrator.id });
    await expect(localLogin({ email: "offline.user@example.test", password: "offline-user-password" })).rejects.toThrow("User account is unavailable");

    expect((await getUserByEmail("offline.user@example.test"))?.isActive).toBe(false);
    const events = await listAdminActivityEvents();
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["account_disabled", "login_failed"]));
  });
});
