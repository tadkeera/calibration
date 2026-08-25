import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listValidationRecords: vi.fn(), getValidationRecordSummary: vi.fn() }));
vi.mock("./db", () => ({
  approveValidationRecord: vi.fn(), createValidationRecord: vi.fn(), getAuditTrail: vi.fn(), getValidationRecordById: vi.fn(),
  getValidationRecordSummary: mocks.getValidationRecordSummary, listValidationRecords: mocks.listValidationRecords,
  markValidationRecordExported: vi.fn(), updateValidationRecord: vi.fn(),
}));

import { recordsRouter } from "./routers/records";

const adminContext = { user: { id: 9, openId: "supabase:admin", name: "Admin", email: "admin@example.test", loginMethod: "local", role: "admin" as const, isActive: true, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } } as any;
const filters = { instrumentKey: "hplc", resultStatus: "pass" as const, lifecycleStatus: "approved" as const, dateFrom: "2026-08-01", dateTo: "2026-08-31" };

describe("record filters and summary contract", () => {
  beforeEach(() => { mocks.listValidationRecords.mockReset(); mocks.getValidationRecordSummary.mockReset(); mocks.listValidationRecords.mockResolvedValue([]); mocks.getValidationRecordSummary.mockResolvedValue({ total: 0, instruments: [] }); });
  it("passes the same validated filters to the list and statistical summary", async () => {
    const caller = recordsRouter.createCaller(adminContext);
    await caller.list(filters);
    await caller.summary(filters);
    const expected = { userId: 9, canViewAll: true, ...filters };
    expect(mocks.listValidationRecords).toHaveBeenCalledWith(expected);
    expect(mocks.getValidationRecordSummary).toHaveBeenCalledWith(expected);
  });
  it("rejects an invalid date before querying the record data layer", async () => {
    await expect(recordsRouter.createCaller(adminContext).list({ dateFrom: "31-08-2026" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.listValidationRecords).not.toHaveBeenCalled();
  });
});
