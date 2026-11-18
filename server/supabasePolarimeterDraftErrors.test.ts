import { afterEach, describe, expect, it, vi } from "vitest";
import { savePolarimeterDraft } from "./supabaseDb";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Supabase draft-insert error classification (mocked PostgREST)", () => {
  it("reports only duplicate-key responses as conflicts and preserves service failures", async () => {
    vi.stubEnv("SUPABASE_URL", "https://draft-error-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    let draftAttempts = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async input => {
        const url = String(input);
        if (url.includes("/rest/v1/validation_settings"))
          return new Response(
            JSON.stringify([{ settings: { protocolVersion: 1 } }]),
            { status: 200 }
          );
        if (url.includes("/rest/v1/polarimeter_drafts")) {
          draftAttempts += 1;
          if (draftAttempts === 1)
            return new Response(
              JSON.stringify({ code: "23505", message: "duplicate key" }),
              { status: 409 }
            );
          if (draftAttempts === 2)
            return new Response(
              JSON.stringify({
                code: "XX000",
                message: "database unavailable",
              }),
              { status: 503 }
            );
          return new Response(
            JSON.stringify({
              code: "PGRST000",
              message: "request could not be completed",
            }),
            { status: 409 }
          );
        }
        throw new Error(`Unexpected mocked Supabase request: ${url}`);
      });
    const payload = {
      step: 0,
      savedAt: "2026-01-02T10:00:00.000Z",
      inputs: { accuracy: {}, repeatability: {}, linearity: {} },
    };

    await expect(
      savePolarimeterDraft({
        userId: 2,
        draftKey: "active",
        protocolVersion: "1",
        payload,
        expectedVersion: 0,
      })
    ).rejects.toThrow("Draft conflict: a server draft already exists");

    await expect(
      savePolarimeterDraft({
        userId: 2,
        draftKey: "active",
        protocolVersion: "1",
        payload,
        expectedVersion: 0,
      })
    ).rejects.toThrow("Supabase request failed (503): database unavailable");

    await expect(
      savePolarimeterDraft({
        userId: 2,
        draftKey: "active",
        protocolVersion: "1",
        payload,
        expectedVersion: 0,
      })
    ).rejects.toThrow(
      "Supabase request failed (409): request could not be completed"
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});
