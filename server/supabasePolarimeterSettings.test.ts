import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../client/src/lib/qc";
import { upsertValidationSettings } from "./supabaseDb";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Supabase Polarimeter protocol version persistence", () => {
  it("versions settings, writes a pending state, and retains the prior JSON snapshot", async () => {
    vi.stubEnv("SUPABASE_URL", "https://synthetic-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role");
    const previousSettings = {
      ...defaultSettings.polarimeter,
      protocolHistory: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            device_key: string;
            settings: Record<string, unknown>;
            updated_by_user_id: number;
            updated_at: string;
          };
          return new Response(
            JSON.stringify([
              {
                device_key: body.device_key,
                settings: body.settings,
                updated_by_user_id: body.updated_by_user_id,
                updated_at: body.updated_at,
              },
            ]),
            { status: 201 }
          );
        }
        return new Response(
          JSON.stringify([
            {
              settings: previousSettings,
              updated_by_user_id: 4,
              updated_at: "2025-01-01T00:00:00.000Z",
            },
          ]),
          { status: 200 }
        );
      });

    const saved = await upsertValidationSettings({
      deviceKey: "polarimeter",
      settings: { ...previousSettings, repeatTolerance: 0.04 },
      userId: 9,
    });

    const history = saved.settings.protocolHistory as Array<{
      protocolVersion: number;
      changedByUserId: number;
      snapshot: Record<string, unknown>;
    }>;
    expect(saved.settings.protocolVersion).toBe(2);
    expect(saved.settings.protocolStatus).toBe("pending-verification");
    expect(saved.settings.protocolEffectiveDate).toBeNull();
    expect(history.at(-1)).toMatchObject({
      protocolVersion: 1,
      changedByUserId: 4,
      snapshot: {
        repeatTolerance: defaultSettings.polarimeter.repeatTolerance,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
