import { afterEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import * as db from "./db";
import { localLogin, completePasswordRecovery, requestPasswordRecovery } from "./db";
import { sdk } from "./_core/sdk";

const disabledUser = { id: 12, openId: "supabase:disabled-user", name: "Disabled", email: "disabled@example.test", loginMethod: "local", role: "user" as const, isActive: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

describe("account security", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a disabled profile during local password login", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "disabled-user", email: "disabled@example.test" } }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 12, auth_user_id: "disabled-user", open_id: "supabase:disabled-user", name: "Disabled", email: "disabled@example.test", login_method: "local", role: "user", is_active: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_signed_in: new Date().toISOString() }]), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response("", { status: 201 }));
    await expect(localLogin({ email: "disabled@example.test", password: "any-password" })).rejects.toThrow("User account is unavailable");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/rest/v1/admin_activity_events");
  });

  it("rejects an existing application session after the profile is disabled", async () => {
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue(disabledUser);
    const token = await sdk.createSessionToken(disabledUser.openId, { name: "Disabled" });
    await expect(sdk.authenticateRequest({ headers: { cookie: `${COOKIE_NAME}=${token}` } } as any)).rejects.toThrow("User account is disabled");
  });

  it("calls Supabase recovery endpoints with a bounded recovery redirect and token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
    await expect(requestPasswordRecovery({ email: "account@example.test", redirectTo: "https://example.test/?recovery=1" })).resolves.toEqual({ success: true });
    await expect(completePasswordRecovery({ recoveryToken: "a".repeat(32), newPassword: "new-secure-password" })).resolves.toEqual({ success: true });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/v1/recover"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/v1/user"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/rest/v1/admin_activity_events"))).toBe(true);
  });
});
