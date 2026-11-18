import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import {
  closeLocalDatabase,
  createInitialAdmin,
  createLocalUser,
  createValidationRecord,
  createPolarimeterTechnicalReview,
  getPolarimeterDraft,
  listPolarimeterDeviationEvents,
  listPolarimeterDeviations,
  listPolarimeterTechnicalReviews,
  savePolarimeterDraft,
  clearPolarimeterDraft,
  updatePolarimeterDeviation,
  updateValidationRecord,
  getUserByEmail,
  getValidationRecordById,
  listAdminActivityEvents,
  listInstrumentProfiles,
  listValidationSettings,
  localLogin,
  approveValidationRecord,
  upsertValidationSettings,
  updateUserActiveState,
} from "./localDb";
import {
  createPolarimeterProtocolSnapshot,
  type PolarimeterV2,
} from "../shared/polarimeter";
import { buildPolarimeterDerivedResult } from "./validationRecompute";

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
    const signedIn = await localLogin({
      email: "tadkrah@gmail.com",
      password: "offline-admin-test-password",
    });

    expect(administrator.role).toBe("admin");
    expect(signedIn.id).toBe(administrator.id);
    expect(existsSync(testDatabase)).toBe(true);
  });

  it("prevents a disabled local account from signing in and retains the admin activity", async () => {
    const administrator = await createInitialAdmin();
    const user = await createLocalUser({
      email: "offline.user@example.test",
      password: "offline-user-password",
      name: "Offline User",
      role: "user",
    });

    await updateUserActiveState({
      id: user.id,
      isActive: false,
      actorUserId: administrator.id,
    });
    await expect(
      localLogin({
        email: "offline.user@example.test",
        password: "offline-user-password",
      })
    ).rejects.toThrow("User account is unavailable");

    expect((await getUserByEmail("offline.user@example.test"))?.isActive).toBe(
      false
    );
    const events = await listAdminActivityEvents();
    expect(events.map(event => event.eventType)).toEqual(
      expect.arrayContaining(["account_disabled", "login_failed"])
    );
  });

  it("stores a new pending Polarimeter protocol version and retains the previous snapshot", async () => {
    const administrator = await createInitialAdmin();
    const current = (await listValidationSettings()).find(
      entry => entry.deviceKey === "polarimeter"
    )!;
    const saved = await upsertValidationSettings({
      deviceKey: "polarimeter",
      settings: {
        ...current.settings,
        repeatTolerance: Number(current.settings.repeatTolerance) + 0.01,
      },
      userId: administrator.id,
    });
    const history = saved.settings.protocolHistory as Array<{
      protocolVersion: number;
      snapshot: Record<string, unknown>;
    }>;

    expect(saved.settings.protocolVersion).toBe(
      Number(current.settings.protocolVersion) + 1
    );
    expect(saved.settings.protocolStatus).toBe("pending-verification");
    expect(saved.settings.protocolEffectiveDate).toBeNull();
    expect(history.at(-1)?.snapshot.repeatTolerance).toBe(
      current.settings.repeatTolerance
    );
  });

  it("server-recomputes a synthetic Polarimeter draft and blocks its pending protocol approval", async () => {
    const administrator = await createInitialAdmin();
    const reviewer = await createLocalUser({
      email: "technical.reviewer@example.test",
      password: "offline-reviewer-password",
      name: "Technical Reviewer",
      role: "admin",
    });
    const thirdAdmin = await createLocalUser({
      email: "approval.officer@example.test",
      password: "offline-approver-password",
      name: "Approval Officer",
      role: "admin",
    });
    const editor = await createLocalUser({
      email: "capa.editor@example.test",
      password: "offline-capa-editor-password",
      name: "CAPA Editor",
      role: "user",
    });
    const settings = (await listValidationSettings()).find(
      entry => entry.deviceKey === "polarimeter"
    )!.settings;
    const profile = (await listInstrumentProfiles()).find(
      entry => entry.instrumentKey === "polarimeter"
    )!;
    const protocol = createPolarimeterProtocolSnapshot(settings);
    const inputData: PolarimeterV2 = {
      schemaVersion: 2,
      equipmentSnapshot: {
        instrumentKey: "polarimeter",
        instrumentName: profile.nameEn,
        equipmentId: profile.instrumentId,
        manufacturer: profile.manufacturer,
        model: profile.model,
        serialNumber: profile.serialNumber,
        sopNumber: profile.sopNumber,
        formNumber: profile.formNumber,
        department: null,
        location: null,
        status: null,
      },
      protocolSnapshot: protocol,
      accuracy: {
        opticalRotation: "1.33",
        concentrationGPer100Ml: "1",
        tubeLengthDm: String(protocol.conditions.tubeLengthDm),
        temperatureC: "",
        wavelengthLabel: protocol.conditions.wavelengthLabel,
        wavelengthNm: protocol.conditions.wavelengthNm,
        measurementDateTime: "2025-01-02T10:00",
        referenceStandardId: "",
        referenceStandardExpiryDate: "",
        referenceStandardCertificateNumber: "",
        analystNotes:
          "Synthetic server-test fixture only; not laboratory data.",
      },
      repeatability: {
        sampleId: "SYNTHETIC-ONLY",
        sampleConcentration: "1",
        concentrationUnit: "g/100ml",
        readings: ["1.00", "1.01", "0.99", "1.02", "0.98", "1.01"],
        measurementConditions: "Synthetic fixture.",
        analystNotes: "Not laboratory data.",
      },
      linearity: {
        points: protocol.linearity.nominalConcentrations.map(
          (nominalConcentration, index) => ({
            pointNumber: index + 1,
            nominalConcentration,
            actualConcentration: "",
            measuredOpticalRotation: String((index + 1) * 10),
            notes: "Synthetic fixture.",
          })
        ),
        measurementConditions: "Synthetic fixture.",
        analystNotes: "Not laboratory data.",
      },
      calculatedMetrics: {
        specificRotation: 0,
        repeatabilityMean: 0,
        repeatabilityMinimum: 0,
        repeatabilityMaximum: 0,
        repeatabilityRange: 0,
        repeatabilitySampleStandardDeviation: null,
        repeatabilityRsdPercent: null,
        repeatabilityDeviations: [],
        regressionSlope: 0,
        regressionIntercept: 0,
        correlationCoefficient: null,
        coefficientOfDetermination: null,
        validLinearityPoints: 0,
        overall: "fail",
      },
      testResults: {
        accuracy: "fail",
        repeatability: "fail",
        linearity: "fail",
      },
      overallResult: "fail",
    };
    const result = buildPolarimeterDerivedResult(inputData, settings);
    expect(result.overall).toBe(true);
    const record = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "pass",
      pharmacistName: "Synthetic Test Analyst",
      resultData: result as unknown as Record<string, unknown>,
      userId: administrator.id,
    });
    const saved = record.resultData.polarimeterData as PolarimeterV2;
    expect(record.resultStatus).toBe("pass");
    expect(saved.calculatedMetrics.specificRotation).toBeCloseTo(66.5, 12);
    expect(saved.calculatedMetrics.correlationCoefficient).toBe(1);
    await expect(
      approveValidationRecord({
        id: record.id,
        decision: "approved",
        userId: editor.id,
        expectedVersion: record.recordVersion,
      })
    ).rejects.toThrow("active administrator");
    await expect(
      approveValidationRecord({
        id: record.id,
        decision: "approved",
        userId: administrator.id,
        expectedVersion: record.recordVersion,
      })
    ).rejects.toThrow("protocol is verified and approved");

    const failedData = structuredClone(inputData);
    failedData.repeatability.readings[1] = "1.50";
    const failedResult = buildPolarimeterDerivedResult(failedData, settings);
    expect(failedResult.overall).toBe(false);
    const failedRecord = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "fail",
      pharmacistName: "Synthetic Test Analyst",
      resultData: failedResult as unknown as Record<string, unknown>,
      userId: administrator.id,
    });
    expect(failedRecord.resultStatus).toBe("fail");
    await expect(
      approveValidationRecord({
        id: failedRecord.id,
        decision: "approved",
        userId: administrator.id,
        expectedVersion: failedRecord.recordVersion,
      })
    ).rejects.toThrow("Failed validation records cannot be approved");

    const draftPayload = {
      step: 3,
      savedAt: "2025-01-02T10:00:00.000Z",
      inputs: {
        accuracy: inputData.accuracy,
        repeatability: inputData.repeatability,
        linearity: inputData.linearity,
      },
    };
    const firstDraft = await savePolarimeterDraft({
      userId: administrator.id,
      draftKey: "active",
      protocolVersion: String(settings.protocolVersion ?? 1),
      payload: draftPayload,
      expectedVersion: 0,
    });
    expect(firstDraft.version).toBe(1);
    expect(
      await getPolarimeterDraft({ userId: reviewer.id, draftKey: "active" })
    ).toBeNull();
    await expect(
      savePolarimeterDraft({
        userId: administrator.id,
        draftKey: "active",
        protocolVersion: String(settings.protocolVersion ?? 1),
        payload: draftPayload,
        expectedVersion: 0,
      })
    ).rejects.toThrow("Draft conflict: a server draft already exists");
    const secondDraft = await savePolarimeterDraft({
      userId: administrator.id,
      draftKey: "active",
      protocolVersion: String(settings.protocolVersion ?? 1),
      payload: { ...draftPayload, step: 4 },
      expectedVersion: firstDraft.version,
    });
    expect(secondDraft.version).toBe(2);
    await expect(
      savePolarimeterDraft({
        userId: administrator.id,
        draftKey: "active",
        protocolVersion: String(settings.protocolVersion ?? 1),
        payload: draftPayload,
        expectedVersion: firstDraft.version,
      })
    ).rejects.toThrow("Draft conflict");
    await clearPolarimeterDraft({
      userId: administrator.id,
      draftKey: "active",
      expectedVersion: secondDraft.version,
    });
    expect(
      await getPolarimeterDraft({
        userId: administrator.id,
        draftKey: "active",
      })
    ).toBeNull();

    const updateInput = {
      instrumentKey: record.instrumentKey,
      instrumentName: record.instrumentName,
      instrumentId: record.instrumentId,
      sopNumber: record.sopNumber,
      formNumber: record.formNumber,
      resultStatus: record.resultStatus,
      pharmacistName: record.pharmacistName,
      resultData: record.resultData,
      id: record.id,
      userId: administrator.id,
      expectedVersion: record.recordVersion,
    };
    const concurrentUpdates = await Promise.allSettled([
      updateValidationRecord(updateInput),
      updateValidationRecord(updateInput),
    ]);
    const successfulUpdates = concurrentUpdates.filter(
      (
        result
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof updateValidationRecord>>
      > => result.status === "fulfilled"
    );
    expect(successfulUpdates).toHaveLength(1);
    expect(
      concurrentUpdates.filter(result => result.status === "rejected")
    ).toHaveLength(1);
    const updatedRecord = successfulUpdates[0].value;
    expect(updatedRecord.recordVersion).toBe(record.recordVersion + 1);
    await expect(
      updateValidationRecord({
        instrumentKey: record.instrumentKey,
        instrumentName: record.instrumentName,
        instrumentId: record.instrumentId,
        sopNumber: record.sopNumber,
        formNumber: record.formNumber,
        resultStatus: record.resultStatus,
        pharmacistName: record.pharmacistName,
        resultData: record.resultData,
        id: record.id,
        userId: administrator.id,
        expectedVersion: record.recordVersion,
      })
    ).rejects.toThrow("Draft version conflict");

    await expect(
      createPolarimeterTechnicalReview({
        recordId: updatedRecord.id,
        expectedVersion: updatedRecord.recordVersion,
        reviewerUserId: reviewer.id,
        decision: "accepted",
        comments: "Synthetic review fixture",
        rejectionReason: null,
        outstandingIssues: [],
      })
    ).rejects.toThrow("protocol is verified");
    await expect(
      createPolarimeterTechnicalReview({
        recordId: updatedRecord.id,
        expectedVersion: updatedRecord.recordVersion,
        reviewerUserId: administrator.id,
        decision: "rejected",
        comments: "Self-review must be blocked",
        rejectionReason: "Analyst cannot review self",
        outstandingIssues: ["Assign an independent reviewer"],
      })
    ).rejects.toThrow("analyst cannot perform");
    const review = await createPolarimeterTechnicalReview({
      recordId: updatedRecord.id,
      expectedVersion: updatedRecord.recordVersion,
      reviewerUserId: reviewer.id,
      decision: "rejected",
      comments: "Synthetic review fixture only",
      rejectionReason: "Protocol source is still pending verification",
      outstandingIssues: ["Verify SOP QC-032D"],
    });
    expect(review.reviewerUserId).toBe(reviewer.id);
    expect(review.recordVersion).toBe(updatedRecord.recordVersion);
    expect(
      await listPolarimeterTechnicalReviews(updatedRecord.id)
    ).toHaveLength(1);
    await expect(
      createPolarimeterTechnicalReview({
        recordId: updatedRecord.id,
        expectedVersion: updatedRecord.recordVersion,
        reviewerUserId: editor.id,
        decision: "rejected",
        comments: "Synthetic non-admin test",
        rejectionReason: "Not authorized",
        outstandingIssues: [],
      })
    ).rejects.toThrow("active administrator");
    await expect(
      updateValidationRecord({
        id: updatedRecord.id,
        userId: administrator.id,
        expectedVersion: updatedRecord.recordVersion,
        instrumentKey: "another-instrument",
        instrumentName: "Different instrument",
        instrumentId: "OTHER-001",
        sopNumber: "OTHER-SOP",
        formNumber: "OTHER-FORM",
        resultStatus: "pass",
        pharmacistName: updatedRecord.pharmacistName,
        resultData: updatedRecord.resultData,
      })
    ).rejects.toThrow("cannot be reassigned");

    const failures = await listPolarimeterDeviations(failedRecord.id);
    expect(failures).toHaveLength(1);
    expect(failures[0].testKey).toBe("repeatability");
    expect(failures[0].actualResult).toContain("deviations");
    expect(failures[0].protocolStatus).toBe("pending-verification");
    expect(failures[0].status).toBe("open");
    const creationEvents = await listPolarimeterDeviationEvents(
      failedRecord.id
    );
    expect(creationEvents).toHaveLength(1);
    expect(creationEvents[0]).toMatchObject({
      deviationId: failures[0].id,
      actorUserId: administrator.id,
      eventType: "created",
    });
    let deviation = await updatePolarimeterDeviation({
      id: failures[0].id,
      expectedVersion: failures[0].version,
      actorUserId: administrator.id,
      investigation: "Synthetic investigation record only",
      rootCause: "Synthetic root-cause fixture",
      correctiveAction: "Synthetic action plan",
      preventiveAction: "Monitor the process",
      responsibleUserId: administrator.id,
      targetCompletionDate: "2026-12-15",
      status: "investigating",
      actorIsAdmin: true,
    });
    deviation = await updatePolarimeterDeviation({
      id: deviation.id,
      expectedVersion: deviation.version,
      actorUserId: administrator.id,
      investigation: "Synthetic investigation record only",
      rootCause: "Synthetic root-cause fixture",
      correctiveAction: "Synthetic action plan",
      preventiveAction: "Monitor the process",
      responsibleUserId: administrator.id,
      targetCompletionDate: "2026-12-15",
      status: "actions-planned",
      actorIsAdmin: true,
    });
    await expect(
      updatePolarimeterDeviation({
        id: deviation.id,
        expectedVersion: deviation.version,
        actorUserId: editor.id,
        investigation: "Synthetic investigation record only",
        rootCause: "Synthetic root-cause fixture",
        correctiveAction: "Synthetic action plan",
        preventiveAction: "Monitor the process",
        responsibleUserId: administrator.id,
        targetCompletionDate: "2026-12-15",
        status: "closed",
        actorIsAdmin: false,
      })
    ).rejects.toThrow("Only an administrator");
    deviation = await updatePolarimeterDeviation({
      id: deviation.id,
      expectedVersion: deviation.version,
      actorUserId: thirdAdmin.id,
      investigation: "Synthetic investigation record only",
      rootCause: "Synthetic root-cause fixture",
      correctiveAction: "Synthetic action plan",
      preventiveAction: "Monitor the process",
      responsibleUserId: administrator.id,
      targetCompletionDate: "2026-12-15",
      status: "closed",
      actorIsAdmin: true,
    });
    expect(deviation.status).toBe("closed");
    expect((await listPolarimeterDeviationEvents(failedRecord.id)).length).toBe(
      4
    );

    await expect(
      updateValidationRecord({
        instrumentKey: failedRecord.instrumentKey,
        instrumentName: failedRecord.instrumentName,
        instrumentId: failedRecord.instrumentId,
        sopNumber: failedRecord.sopNumber,
        formNumber: failedRecord.formNumber,
        resultStatus: "pass",
        pharmacistName: failedRecord.pharmacistName,
        resultData: failedRecord.resultData,
        id: failedRecord.id,
        userId: administrator.id,
        expectedVersion: failedRecord.recordVersion,
      })
    ).rejects.toThrow("Failed Polarimeter measurements are preserved");
    const retest = await createValidationRecord({
      instrumentKey: "polarimeter",
      instrumentName: profile.nameEn,
      instrumentId: profile.instrumentId,
      sopNumber: profile.sopNumber,
      formNumber: profile.formNumber,
      resultStatus: "fail",
      pharmacistName: "Synthetic Retest Analyst",
      resultData: failedResult as unknown as Record<string, unknown>,
      userId: administrator.id,
      retestOfRecordId: failedRecord.id,
      retestReason: "Synthetic retest fixture; not laboratory data.",
    });
    expect(retest.retestOfRecordId).toBe(failedRecord.id);
    expect(retest.retestReason).toContain("Synthetic retest");
    expect((await getValidationRecordById(failedRecord.id))?.resultStatus).toBe(
      "fail"
    );
    const concurrentDecisions = await Promise.allSettled([
      approveValidationRecord({
        id: failedRecord.id,
        decision: "rejected",
        reason: "Synthetic lifecycle rejection fixture A",
        userId: thirdAdmin.id,
        expectedVersion: failedRecord.recordVersion,
      }),
      approveValidationRecord({
        id: failedRecord.id,
        decision: "rejected",
        reason: "Synthetic lifecycle rejection fixture B",
        userId: thirdAdmin.id,
        expectedVersion: failedRecord.recordVersion,
      }),
    ]);
    expect(
      concurrentDecisions.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      (await getValidationRecordById(failedRecord.id))?.lifecycleStatus
    ).toBe("rejected");
  });
});
