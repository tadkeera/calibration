import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveValidationRecord,
  createValidationRecord,
  createPolarimeterTechnicalReview,
  getAuditTrail,
  getPolarimeterDraft,
  savePolarimeterDraft,
  clearPolarimeterDraft,
  listPolarimeterTechnicalReviews,
  listPolarimeterDeviations,
  listPolarimeterDeviationEvents,
  updatePolarimeterDeviation,
  getValidationRecordById,
  getValidationRecordSummary,
  listValidationRecords,
  markValidationRecordExported,
  updateValidationRecord,
} from "../db";
import {
  adminProcedure,
  editorProcedure,
  protectedProcedure,
  router,
} from "../_core/trpc";

const recordDataSchema = z.record(z.string(), z.unknown());
const protocolSchema = z.object({
  protocolId: z.string().min(1),
  protocolVersion: z.string().min(1),
  protocolStatus: z.enum(["pending-verification", "approved"]),
  effectiveDate: z.string().nullable(),
  sopNumber: z.string().min(1),
  formNumber: z.string().min(1),
  accuracy: z.object({
    formula: z.literal("100 * alpha / (tubeLengthDm * concentrationGPer100Ml)"),
    lowerLimit: z.number().finite(),
    upperLimit: z.number().finite(),
    displayPrecision: z.number().int().min(0).max(12),
    unit: z.literal("°"),
  }),
  repeatability: z.object({
    requiredReadings: z.number().int().min(2).max(50),
    method: z.enum([
      "first-reading-deviation",
      "reference-value-deviation",
      "mean-deviation",
      "maximum-range",
      "sample-standard-deviation",
      "rsd-percent",
    ]),
    tolerance: z.number().finite().nonnegative(),
    referenceValue: z.number().finite().nullable(),
    unit: z.enum(["°", "%"]),
    displayPrecision: z.number().int().min(0).max(12),
  }),
  linearity: z.object({
    xAxis: z.literal("concentration"),
    yAxis: z.literal("optical-rotation"),
    nominalConcentrations: z.array(z.number().finite()).min(2).max(20),
    concentrationUnit: z.literal("g/100ml"),
    rotationUnit: z.literal("°"),
    metric: z.enum(["r", "r2"]),
    minimumMetric: z.number().finite().min(0).max(1),
    useActualConcentration: z.boolean(),
    displayPrecision: z.number().int().min(0).max(12),
  }),
  conditions: z.object({
    tubeLengthDm: z.number().finite().positive(),
    referenceTemperatureC: z.number().finite(),
    wavelengthLabel: z.string().min(1),
    wavelengthNm: z.number().finite().positive(),
  }),
  requiredFields: z.object({
    measurementDateTime: z.boolean(),
    temperature: z.boolean(),
    referenceStandard: z.boolean(),
  }),
});
const polarimeterDataSchema = z.object({
  schemaVersion: z.literal(2),
  equipmentSnapshot: z.object({
    instrumentKey: z.literal("polarimeter"),
    instrumentName: z.string().min(1),
    equipmentId: z.string().min(1),
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    serialNumber: z.string().min(1),
    sopNumber: z.string().min(1),
    formNumber: z.string().min(1),
    department: z.string().nullable(),
    location: z.string().nullable(),
    status: z.string().nullable(),
  }),
  protocolSnapshot: protocolSchema,
  accuracy: z.object({
    opticalRotation: z.string().nullable(),
    concentrationGPer100Ml: z.string().nullable(),
    tubeLengthDm: z.string(),
    temperatureC: z.string().nullable(),
    wavelengthLabel: z.string(),
    wavelengthNm: z.number().finite(),
    measurementDateTime: z.string(),
    referenceStandardId: z.string(),
    referenceStandardExpiryDate: z.string(),
    referenceStandardCertificateNumber: z.string(),
    analystNotes: z.string(),
  }),
  repeatability: z.object({
    sampleId: z.string(),
    sampleConcentration: z.string().nullable(),
    concentrationUnit: z.literal("g/100ml"),
    readings: z.array(z.string()),
    measurementConditions: z.string(),
    analystNotes: z.string(),
  }),
  linearity: z.object({
    points: z.array(
      z.object({
        pointNumber: z.number().int().positive(),
        nominalConcentration: z.number().finite(),
        actualConcentration: z.string().nullable(),
        measuredOpticalRotation: z.string().nullable(),
        notes: z.string(),
      })
    ),
    measurementConditions: z.string(),
    analystNotes: z.string(),
  }),
  calculatedMetrics: z.object({
    specificRotation: z.number().finite(),
    repeatabilityMean: z.number().finite(),
    repeatabilityMinimum: z.number().finite(),
    repeatabilityMaximum: z.number().finite(),
    repeatabilityRange: z.number().finite().nonnegative(),
    repeatabilitySampleStandardDeviation: z
      .number()
      .finite()
      .nonnegative()
      .nullable(),
    repeatabilityRsdPercent: z.number().finite().nonnegative().nullable(),
    repeatabilityDeviations: z.array(z.number().finite().nonnegative()),
    regressionSlope: z.number().finite(),
    regressionIntercept: z.number().finite(),
    correlationCoefficient: z.number().finite().nullable(),
    coefficientOfDetermination: z.number().finite().min(0).max(1).nullable(),
    validLinearityPoints: z.number().int().min(2).max(20),
    overall: z.enum(["pass", "fail"]),
  }),
  testResults: z.object({
    accuracy: z.enum(["pass", "fail"]),
    repeatability: z.enum(["pass", "fail"]),
    linearity: z.enum(["pass", "fail"]),
  }),
  overallResult: z.enum(["pass", "fail"]),
});

const recordPayloadShape = {
  instrumentKey: z.string().min(1).max(64),
  instrumentName: z.string().min(1).max(255),
  instrumentId: z.string().min(1).max(64),
  sopNumber: z.string().min(1).max(64),
  formNumber: z.string().min(1).max(64),
  resultStatus: z.enum(["pass", "fail"]),
  pharmacistName: z.string().min(1).max(255),
  resultData: recordDataSchema,
};

function withPolarimeterValidation<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((input: any, context) => {
    if (input.instrumentKey !== "polarimeter") return;
    const parsed = polarimeterDataSchema.safeParse(
      input.resultData?.polarimeterData
    );
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        path: ["resultData", "polarimeterData"],
        message: `Invalid or missing versioned Polarimeter payload: ${parsed.error.issues.map(issue => issue.message).join("; ")}`,
      });
    }
  });
}

const recordPayloadSchema = withPolarimeterValidation(
  z.object(recordPayloadShape)
);
const saveRecordSchema = withPolarimeterValidation(
  z.object({
    ...recordPayloadShape,
    retestOfRecordId: z.number().int().positive().optional(),
    retestReason: z.string().trim().min(10).max(2000).optional(),
  })
).superRefine((input, context) => {
  if (input.retestOfRecordId && !input.retestReason)
    context.addIssue({
      code: "custom",
      path: ["retestReason"],
      message: "A reason is required for a linked retest",
    });
  if (!input.retestOfRecordId && input.retestReason)
    context.addIssue({
      code: "custom",
      path: ["retestOfRecordId"],
      message: "A retest reason requires an original record",
    });
});
const updateDraftSchema = withPolarimeterValidation(
  z.object({
    ...recordPayloadShape,
    id: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
  })
);
const polarimeterDraftSchema = z.object({
  draftKey: z.string().regex(/^(active|retest-[1-9]\d*)$/),
  protocolVersion: z.string().min(1).max(32),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({
    step: z.number().int().min(0).max(8),
    savedAt: z.string().datetime(),
    inputs: z.object({
      accuracy: z.object({
        opticalRotation: z.string().max(100),
        concentrationGPer100Ml: z.string().max(100),
        tubeLengthDm: z.string().max(100),
        temperatureC: z.string().max(100),
        wavelengthLabel: z.string().max(100),
        wavelengthNm: z.number().finite(),
        measurementDateTime: z.string().max(100),
        referenceStandardId: z.string().max(255),
        referenceStandardExpiryDate: z.string().max(100),
        referenceStandardCertificateNumber: z.string().max(255),
        analystNotes: z.string().max(5000),
      }),
      repeatability: z.object({
        sampleId: z.string().max(255),
        sampleConcentration: z.string().max(100).nullable(),
        concentrationUnit: z.literal("g/100ml"),
        readings: z.array(z.string().max(100)).max(50),
        measurementConditions: z.string().max(2000),
        analystNotes: z.string().max(5000),
      }),
      linearity: z.object({
        points: z
          .array(
            z.object({
              pointNumber: z.number().int().positive(),
              nominalConcentration: z.number().finite(),
              actualConcentration: z.string().max(100).nullable(),
              measuredOpticalRotation: z.string().max(100).nullable(),
              notes: z.string().max(2000),
            })
          )
          .max(20),
        measurementConditions: z.string().max(2000),
        analystNotes: z.string().max(5000),
      }),
    }),
  }),
});
const reviewSchema = z
  .object({
    id: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["accepted", "rejected"]),
    comments: z.string().trim().min(1).max(5000),
    rejectionReason: z.string().trim().max(5000).nullable().optional(),
    outstandingIssues: z
      .array(z.string().trim().min(1).max(1000))
      .max(30)
      .default([]),
  })
  .superRefine((input, context) => {
    if (input.decision === "rejected" && !input.rejectionReason?.trim())
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A rejection reason is required",
      });
    if (input.decision === "accepted" && input.outstandingIssues.length)
      context.addIssue({
        code: "custom",
        path: ["outstandingIssues"],
        message: "Resolve outstanding issues before acceptance",
      });
  });
const deviationUpdateSchema = z
  .object({
    recordId: z.number().int().positive(),
    deviationId: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    investigation: z.string().max(5000),
    rootCause: z.string().max(5000),
    correctiveAction: z.string().max(5000),
    preventiveAction: z.string().max(5000),
    responsibleUserId: z.number().int().positive().nullable(),
    targetCompletionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    status: z.enum(["open", "investigating", "actions-planned", "closed"]),
  })
  .superRefine((input, context) => {
    const value = input.targetCompletionDate;
    if (value) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== value
      )
        context.addIssue({
          code: "custom",
          path: ["targetCompletionDate"],
          message: "Target completion date must be a real calendar date",
        });
    }
  });
const recordFiltersSchema = z
  .object({
    instrumentKey: z.string().min(1).max(64).optional(),
    resultStatus: z.enum(["pass", "fail"]).optional(),
    lifecycleStatus: z.enum(["draft", "approved", "rejected"]).optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .optional();

async function requireRecordAccess(
  recordId: number,
  user: { id: number; role: "user" | "admin" | "viewer" }
) {
  const record = await getValidationRecordById(recordId);
  if (!record)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Validation record not found",
    });
  if (user.role === "user" && record.validatedByUserId !== user.id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You cannot access this validation record",
    });
  }
  return record;
}

export const recordsRouter = router({
  list: protectedProcedure.input(recordFiltersSchema).query(({ ctx, input }) =>
    listValidationRecords({
      userId: ctx.user.id,
      canViewAll: ctx.user.role === "admin" || ctx.user.role === "viewer",
      ...input,
    })
  ),

  summary: protectedProcedure
    .input(recordFiltersSchema)
    .query(({ ctx, input }) =>
      getValidationRecordSummary({
        userId: ctx.user.id,
        canViewAll: ctx.user.role === "admin" || ctx.user.role === "viewer",
        ...input,
      })
    ),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ ctx, input }) => requireRecordAccess(input.id, ctx.user)),

  save: editorProcedure
    .input(saveRecordSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.retestOfRecordId)
        await requireRecordAccess(input.retestOfRecordId, ctx.user);
      return createValidationRecord({ ...input, userId: ctx.user.id });
    }),

  getPolarimeterDraft: protectedProcedure
    .input(
      z.object({ draftKey: z.string().regex(/^(active|retest-[1-9]\d*)$/) })
    )
    .query(({ ctx, input }) =>
      getPolarimeterDraft({ userId: ctx.user.id, draftKey: input.draftKey })
    ),

  savePolarimeterDraft: editorProcedure
    .input(polarimeterDraftSchema)
    .mutation(({ ctx, input }) =>
      savePolarimeterDraft({ ...input, userId: ctx.user.id })
    ),

  clearPolarimeterDraft: editorProcedure
    .input(
      z.object({
        draftKey: z.string().regex(/^(active|retest-[1-9]\d*)$/),
        expectedVersion: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) =>
      clearPolarimeterDraft({ ...input, userId: ctx.user.id })
    ),

  technicalReviews: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      if (record.instrumentKey !== "polarimeter") return [];
      return listPolarimeterTechnicalReviews(input.id);
    }),

  submitTechnicalReview: adminProcedure
    .input(reviewSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      if (record.instrumentKey !== "polarimeter")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Technical review is defined for Polarimeter records only",
        });
      return createPolarimeterTechnicalReview({
        recordId: input.id,
        expectedVersion: input.expectedVersion,
        reviewerUserId: ctx.user.id,
        decision: input.decision,
        comments: input.comments,
        rejectionReason: input.rejectionReason ?? null,
        outstandingIssues: input.outstandingIssues,
      });
    }),

  deviations: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      if (record.instrumentKey !== "polarimeter")
        return { cases: [], events: [] };
      const [cases, events] = await Promise.all([
        listPolarimeterDeviations(input.id),
        listPolarimeterDeviationEvents(input.id),
      ]);
      return { cases, events };
    }),

  updateDeviation: editorProcedure
    .input(deviationUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.recordId, ctx.user);
      if (record.instrumentKey !== "polarimeter")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Deviation CAPA is defined for Polarimeter records only",
        });
      const cases = await listPolarimeterDeviations(input.recordId);
      if (!cases.some(entry => entry.id === input.deviationId))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deviation case not found on this record",
        });
      if (input.status === "closed" && ctx.user.role !== "admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an administrator may close a deviation",
        });
      const { recordId: _recordId, deviationId, ...payload } = input;
      return updatePolarimeterDeviation({
        id: deviationId,
        ...payload,
        actorUserId: ctx.user.id,
        actorIsAdmin: ctx.user.role === "admin",
      });
    }),

  updateDraft: editorProcedure
    .input(updateDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      if (record.lifecycleStatus !== "draft") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only draft records can be edited",
        });
      }
      const { id, ...payload } = input;
      return updateValidationRecord({ id, ...payload, userId: ctx.user.id });
    }),

  decide: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approved", "rejected"]),
        expectedVersion: z.number().int().positive().optional(),
        reason: z.string().trim().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const record = await getValidationRecordById(input.id);
      if (
        record?.instrumentKey === "polarimeter" &&
        input.expectedVersion === undefined
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Polarimeter lifecycle decisions require the current record version",
        });
      return approveValidationRecord({ ...input, userId: ctx.user.id });
    }),

  trail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireRecordAccess(input.id, ctx.user);
      return getAuditTrail(input.id);
    }),

  markExported: editorProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const record = await requireRecordAccess(input.id, ctx.user);
      return markValidationRecordExported({
        id: record.id,
        userId: ctx.user.id,
      });
    }),
});
