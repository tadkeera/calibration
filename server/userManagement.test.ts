import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateUserActiveState: vi.fn() }));
vi.mock("./db", () => ({
  createLocalUser: vi.fn(),
  listUsers: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserActiveState: mocks.updateUserActiveState,
}));

import { usersRouter } from "./routers/users";

const adminUser = { id: 17, openId: "supabase:admin", name: "Admin", email: "admin@example.test", loginMethod: "local", role: "admin" as const, isActive: true, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const userContext = { user: adminUser } as any;

describe("user account state management", () => {
  beforeEach(() => { mocks.updateUserActiveState.mockReset(); mocks.updateUserActiveState.mockResolvedValue({ id: 44, isActive: false }); });
  it("passes the admin identity when disabling a user", async () => {
    const result = await usersRouter.createCaller(userContext).setActive({ id: 44, isActive: false });
    expect(mocks.updateUserActiveState).toHaveBeenCalledWith({ id: 44, isActive: false, actorUserId: 17 });
    expect(result).toEqual({ id: 44, isActive: false });
  });
  it("rejects an unauthenticated caller before changing account state", async () => {
    await expect(usersRouter.createCaller({ user: null } as any).setActive({ id: 44, isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
