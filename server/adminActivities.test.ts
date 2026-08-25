import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listAdminActivityEvents: vi.fn() }));
vi.mock("./db", () => ({ listAdminActivityEvents: mocks.listAdminActivityEvents }));

import { adminActivitiesRouter } from "./routers/adminActivities";

const adminContext = { user: { id: 1, openId: "supabase:admin", name: "Admin", email: "admin@example.test", loginMethod: "local", role: "admin" as const, isActive: true, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } } as any;
const userContext = { user: { ...adminContext.user, id: 2, role: "user" as const } } as any;

describe("administrative activity log", () => {
  beforeEach(() => { mocks.listAdminActivityEvents.mockReset(); mocks.listAdminActivityEvents.mockResolvedValue([]); });
  it("passes validated activity filters for an administrator", async () => {
    const filters = { eventType: "account_disabled" as const, dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await adminActivitiesRouter.createCaller(adminContext).list(filters);
    expect(mocks.listAdminActivityEvents).toHaveBeenCalledWith(filters);
  });
  it("forbids non-administrators from viewing the security register", async () => {
    await expect(adminActivitiesRouter.createCaller(userContext).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
