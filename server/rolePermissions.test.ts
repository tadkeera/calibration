import { describe, expect, it } from "vitest";
import { recordsRouter } from "./routers/records";
import { instrumentsRouter } from "./routers/instruments";
import type { TrpcContext } from "./_core/context";

const viewerContext = {
  user: {
    id: 999,
    openId: "supabase:viewer",
    name: "Viewer",
    email: "viewer@example.test",
    loginMethod: "local",
    role: "viewer",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} },
  res: {},
} as unknown as TrpcContext;

const editorContext = {
  user: {
    id: 998,
    openId: "supabase:editor",
    name: "Editor",
    email: "editor@example.test",
    loginMethod: "local",
    role: "user",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} },
  res: {},
} as unknown as TrpcContext;

describe("role permissions", () => {
  it("blocks a viewer from saving or approving validation records", async () => {
    const records = recordsRouter.createCaller(viewerContext);
    await expect(
      records.save({
        instrumentKey: "demo",
        instrumentName: "Demo",
        instrumentId: "QC-001",
        sopNumber: "SOP-1",
        formNumber: "F-1",
        resultStatus: "pass",
        pharmacistName: "Viewer",
        resultData: {},
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.decide({ id: 1, decision: "approved" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.submitTechnicalReview({
        id: 1,
        expectedVersion: 1,
        decision: "accepted",
        comments: "Reviewed",
        outstandingIssues: [],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.updateDeviation({
        recordId: 1,
        deviationId: 1,
        expectedVersion: 1,
        investigation: "",
        rootCause: "",
        correctiveAction: "",
        preventiveAction: "",
        responsibleUserId: null,
        targetCompletionDate: null,
        status: "open",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires administrator authorization for technical review and lifecycle decisions", async () => {
    const records = recordsRouter.createCaller(editorContext);
    await expect(
      records.submitTechnicalReview({
        id: 1,
        expectedVersion: 1,
        decision: "rejected",
        comments: "Synthetic route authorization test",
        rejectionReason: "Not an administrator",
        outstandingIssues: [],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      records.decide({
        id: 1,
        decision: "approved",
        expectedVersion: 1,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("blocks a viewer from editing instrument metadata", async () => {
    const instruments = instrumentsRouter.createCaller(viewerContext);
    await expect(
      instruments.update({
        instrumentKey: "demo",
        nameAr: "اختبار",
        nameEn: "Demo",
        instrumentId: "QC-001",
        sopNumber: "SOP-1",
        manufacturer: "Lab",
        model: "Model",
        serialNumber: "SN",
        formNumber: "F-1",
        accent: "#0C5A4C",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
