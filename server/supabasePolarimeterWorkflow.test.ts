import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveValidationRecord,
  clearPolarimeterDraft,
  createPolarimeterTechnicalReview,
  savePolarimeterDraft,
  updatePolarimeterDeviation,
} from "./supabaseDb";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const config = () => {
  vi.stubEnv("SUPABASE_URL", "https://workflow-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
};
const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const reviewRecord = {
  id: 44,
  instrument_key: "polarimeter",
  instrument_name: "Synthetic Polarimeter",
  instrument_id: "POL-TEST",
  sop_number: "QC-032D",
  form_number: "QC-032B-01",
  result_status: "pass",
  lifecycle_status: "draft",
  result_data: {
    polarimeterData: {
      protocolSnapshot: { protocolStatus: "pending-verification" },
    },
  },
  pharmacist_name: "Synthetic Analyst",
  validated_by_user_id: 5,
  approved_by_user_id: null,
  approved_at: null,
  created_at: "2026-01-02T10:00:00.000Z",
  updated_at: "2026-01-02T10:00:00.000Z",
  record_version: 3,
  retest_of_record_id: null,
  retest_reason: null,
};

function activeAdminRow(id: number) {
  return {
    id,
    auth_user_id: `synthetic-${id}`,
    open_id: `supabase:synthetic-${id}`,
    name: `Synthetic admin ${id}`,
    email: `admin-${id}@example.test`,
    login_method: "local",
    role: "admin",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_signed_in: "2026-01-01T00:00:00.000Z",
  };
}

describe("[Supabase-mocked] Supabase Polarimeter workflow persistence (mocked PostgREST)", () => {
  it("uses version compare-and-swap for account-scoped server drafts and refuses stale writes", async () => {
    config();
    const payload = {
      step: 3,
      savedAt: "2026-01-02T10:00:00.000Z",
      inputs: { accuracy: {}, repeatability: {}, linearity: {} },
    };
    const calls: Array<{
      url: string;
      method: string | undefined;
      body?: string | null;
    }> = [];
    let draftVersion = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method;
        calls.push({ url, method, body: init?.body?.toString() });
        if (url.includes("/rest/v1/validation_settings"))
          return jsonResponse([{ settings: { protocolVersion: 1 } }]);
        if (url.includes("/rest/v1/polarimeter_drafts")) {
          if (method === "POST") {
            draftVersion = 1;
            return jsonResponse(
              [
                {
                  id: 71,
                  user_id: 5,
                  draft_key: "active",
                  protocol_version: "1",
                  payload,
                  version: draftVersion,
                  created_at: "2026-01-02T10:00:00.000Z",
                  updated_at: "2026-01-02T10:00:00.000Z",
                },
              ],
              201
            );
          }
          if (method === "PATCH") {
            const expected = Number(
              new URL(url).searchParams.get("version")?.replace("eq.", "")
            );
            if (expected !== draftVersion) return jsonResponse([]);
            draftVersion += 1;
            return jsonResponse([
              {
                id: 71,
                user_id: 5,
                draft_key: "active",
                protocol_version: "1",
                payload: { ...payload, step: 4 },
                version: draftVersion,
                created_at: "2026-01-02T10:00:00.000Z",
                updated_at: "2026-01-02T10:01:00.000Z",
              },
            ]);
          }
          if (method === "DELETE")
            return jsonResponse([{ id: 71, version: 2 }]);
        }
        throw new Error(`Unexpected mocked Supabase call: ${method} ${url}`);
      });

    const created = await savePolarimeterDraft({
      userId: 5,
      draftKey: "active",
      protocolVersion: "1",
      payload,
      expectedVersion: 0,
    });
    expect(created.version).toBe(1);
    const updated = await savePolarimeterDraft({
      userId: 5,
      draftKey: "active",
      protocolVersion: "1",
      payload: { ...payload, step: 4 },
      expectedVersion: 1,
    });
    expect(updated.version).toBe(2);
    await expect(
      savePolarimeterDraft({
        userId: 5,
        draftKey: "active",
        protocolVersion: "1",
        payload,
        expectedVersion: 1,
      })
    ).rejects.toThrow("Draft conflict");
    await clearPolarimeterDraft({
      userId: 5,
      draftKey: "active",
      expectedVersion: 2,
    });
    expect(
      calls.some(
        call => call.method === "PATCH" && call.url.includes("version=eq.1")
      )
    ).toBe(true);
    expect(
      calls.some(
        call => call.method === "DELETE" && call.url.includes("version=eq.2")
      )
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("stores rejected independent technical reviews with user, record-version and rejection evidence", async () => {
    config();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_records"))
          return jsonResponse([reviewRecord]);
        if (url.includes("/rest/v1/app_users?id=eq.9"))
          return jsonResponse([activeAdminRow(9)]);
        if (
          url.endsWith("/rest/v1/rpc/submit_polarimeter_technical_review") &&
          init?.method === "POST"
        ) {
          const body = JSON.parse(String(init.body));
          return jsonResponse(
            [
              {
                id: 81,
                validation_record_id: body.p_validation_record_id,
                record_version: body.p_expected_record_version,
                reviewer_user_id: body.p_reviewer_user_id,
                decision: body.p_decision,
                comments: body.p_comments,
                rejection_reason: body.p_rejection_reason,
                outstanding_issues: body.p_outstanding_issues,
                created_at: "2026-01-02T10:05:00.000Z",
              },
            ],
            201
          );
        }
        throw new Error(
          `Unexpected mocked Supabase call: ${init?.method} ${url}`
        );
      });

    await expect(
      createPolarimeterTechnicalReview({
        recordId: 44,
        expectedVersion: 3,
        reviewerUserId: 9,
        decision: "accepted",
        comments: "Review complete",
        rejectionReason: null,
        outstandingIssues: [],
      })
    ).rejects.toThrow("protocol is verified");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("submit_polarimeter_technical_review")
      )
    ).toBe(false);

    const review = await createPolarimeterTechnicalReview({
      recordId: 44,
      expectedVersion: 3,
      reviewerUserId: 9,
      decision: "rejected",
      comments: "Synthetic review record only",
      rejectionReason: "SOP pending verification",
      outstandingIssues: ["Verify QC-032D before acceptance"],
    });
    expect(review.reviewerUserId).toBe(9);
    expect(review.recordVersion).toBe(3);
    expect(review.decision).toBe("rejected");
    expect(review.rejectionReason).toBe("SOP pending verification");
    expect(review.outstandingIssues).toEqual([
      "Verify QC-032D before acceptance",
    ]);
  });

  it("saves deviation changes through a database RPC so update and audit event share a transaction", async () => {
    config();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/rest/v1/polarimeter_deviations?id=eq.17"))
          return jsonResponse([
            {
              id: 17,
              validation_record_id: 44,
              test_key: "accuracy",
              actual_result: "100 °",
              acceptance_limit: "20 to 80 ° specific rotation",
              protocol_status: "pending-verification",
              investigation: "",
              root_cause: "",
              corrective_action: "",
              preventive_action: "",
              responsible_user_id: null,
              target_completion_date: null,
              status: "open",
              version: 1,
              created_by_user_id: 5,
              updated_by_user_id: 5,
              created_at: "2026-01-02T10:00:00.000Z",
              updated_at: "2026-01-02T10:00:00.000Z",
              closed_at: null,
            },
          ]);
        if (url.includes("/rest/v1/app_users?id=eq.9"))
          return jsonResponse([activeAdminRow(9)]);
        if (url.endsWith("/rest/v1/rpc/update_polarimeter_deviation")) {
          const body = JSON.parse(String(init?.body));
          expect(body.p_expected_version).toBe(1);
          expect(body.p_actor_user_id).toBe(9);
          return jsonResponse([
            {
              id: 17,
              validation_record_id: 44,
              test_key: "accuracy",
              actual_result: "100 °",
              acceptance_limit: "20 to 80 ° specific rotation",
              protocol_status: "pending-verification",
              investigation: body.p_investigation,
              root_cause: body.p_root_cause,
              corrective_action: body.p_corrective_action,
              preventive_action: body.p_preventive_action,
              responsible_user_id: 9,
              target_completion_date: "2026-12-15",
              status: "investigating",
              version: 2,
              created_by_user_id: 5,
              updated_by_user_id: 9,
              created_at: "2026-01-02T10:00:00.000Z",
              updated_at: "2026-01-02T10:04:00.000Z",
              closed_at: null,
            },
          ]);
        }
        throw new Error(
          `Unexpected mocked Supabase call: ${init?.method} ${url}`
        );
      });
    const updated = await updatePolarimeterDeviation({
      id: 17,
      expectedVersion: 1,
      actorUserId: 9,
      investigation: "Investigated",
      rootCause: "Synthetic cause",
      correctiveAction: "Corrective plan",
      preventiveAction: "Preventive plan",
      responsibleUserId: 9,
      targetCompletionDate: "2026-12-15",
      status: "investigating",
      actorIsAdmin: true,
    });
    expect(updated.version).toBe(2);
    expect(updated.responsibleName).toBe("Synthetic admin 9");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/rpc/update_polarimeter_deviation")
      )
    ).toBe(true);
  });

  it("uses one authoritative RPC for Polarimeter approval, reviewer separation and audit persistence", async () => {
    config();
    const approvedRecord = structuredClone(reviewRecord);
    approvedRecord.result_data = {
      polarimeterData: {
        overallResult: "pass",
        protocolSnapshot: { protocolStatus: "approved" },
      },
    };
    const reviewRow = {
      id: 82,
      validation_record_id: 44,
      record_version: 3,
      reviewer_user_id: 7,
      decision: "accepted",
      comments: "Synthetic accepted-review fixture",
      rejection_reason: null,
      outstanding_issues: [],
      created_at: "2026-01-02T10:05:00.000Z",
    };
    const decidedRecord = {
      ...approvedRecord,
      lifecycle_status: "approved",
      approved_by_user_id: 8,
      approved_at: "2026-01-02T10:10:00.000Z",
      updated_at: "2026-01-02T10:10:00.000Z",
    };
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        calls.push({ url, method: init?.method });
        if (url.includes("/rest/v1/validation_records"))
          return jsonResponse([approvedRecord]);
        if (url.includes("/rest/v1/record_technical_reviews"))
          return jsonResponse([reviewRow]);
        if (url.includes("/rest/v1/app_users?id=in.(7)"))
          return jsonResponse([activeAdminRow(7)]);
        if (url.includes("/rest/v1/app_users?id=eq.8"))
          return jsonResponse([activeAdminRow(8)]);
        if (url.endsWith("/rest/v1/rpc/decide_polarimeter_validation_record")) {
          const body = JSON.parse(String(init?.body));
          expect(body.p_validation_record_id).toBe(44);
          expect(body.p_expected_record_version).toBe(3);
          expect(body.p_approver_user_id).toBe(8);
          expect(body.p_decision).toBe("approved");
          return jsonResponse([decidedRecord]);
        }
        throw new Error(
          `Unexpected mocked Supabase call: ${init?.method} ${url}`
        );
      });

    reviewRow.outstanding_issues = ["Synthetic unresolved approval blocker"];
    await expect(
      approveValidationRecord({
        id: 44,
        decision: "approved",
        userId: 8,
        expectedVersion: 3,
      })
    ).rejects.toThrow("current accepted independent technical review");
    expect(
      calls.filter(call =>
        call.url.endsWith("decide_polarimeter_validation_record")
      )
    ).toHaveLength(0);

    reviewRow.outstanding_issues = [];
    const record = await approveValidationRecord({
      id: 44,
      decision: "approved",
      userId: 8,
      expectedVersion: 3,
    });
    expect(record.lifecycleStatus).toBe("approved");
    expect(record.approvedByUserId).toBe(8);
    expect(
      calls.filter(call =>
        call.url.endsWith("decide_polarimeter_validation_record")
      ).length
    ).toBe(1);
    expect(
      calls.some(call => call.url.includes("/rest/v1/record_approvals"))
    ).toBe(false);
    expect(calls.some(call => call.url.endsWith("/rest/v1/audit_events"))).toBe(
      false
    );
    expect(
      calls.some(
        call =>
          call.method === "PATCH" && call.url.includes("validation_records")
      )
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });
});
