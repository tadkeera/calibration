import * as supabase from "./supabaseDb";

export * from "./supabaseDb";

const offlineMode = () => process.env.QC_STORAGE_MODE === "local";
let localProvider: Promise<typeof import("./localDb")> | null = null;
async function provider() { return offlineMode() ? (localProvider ??= import("./localDb")) : supabase; }

export const getUserByOpenId = async (...args: Parameters<typeof supabase.getUserByOpenId>) => (await provider()).getUserByOpenId(...args);
export const getUserById = async (...args: Parameters<typeof supabase.getUserById>) => (await provider()).getUserById(...args);
export const getUserByEmail = async (...args: Parameters<typeof supabase.getUserByEmail>) => (await provider()).getUserByEmail(...args);
export const listUsers = async () => (await provider()).listUsers();
export const createInitialAdmin = async () => (await provider()).createInitialAdmin();
export const createLocalUser = async (...args: Parameters<typeof supabase.createLocalUser>) => (await provider()).createLocalUser(...args);
export const localLogin = async (...args: Parameters<typeof supabase.localLogin>) => (await provider()).localLogin(...args);
export const updateUserRole = async (...args: Parameters<typeof supabase.updateUserRole>) => (await provider()).updateUserRole(...args);
export const changeLocalPassword = async (...args: Parameters<typeof supabase.changeLocalPassword>) => (await provider()).changeLocalPassword(...args);
export const requestPasswordRecovery = async (...args: Parameters<typeof supabase.requestPasswordRecovery>) => (await provider()).requestPasswordRecovery(...args);
export const completePasswordRecovery = async (...args: Parameters<typeof supabase.completePasswordRecovery>) => (await provider()).completePasswordRecovery(...args);
export const updateUserActiveState = async (...args: Parameters<typeof supabase.updateUserActiveState>) => (await provider()).updateUserActiveState(...args);
export const listAdminActivityEvents = async (...args: Parameters<typeof supabase.listAdminActivityEvents>) => (await provider()).listAdminActivityEvents(...args);
export const upsertUser = async (...args: Parameters<typeof supabase.upsertUser>) => (await provider()).upsertUser(...args);
export const assertControlledSettingsMatch = supabase.assertControlledSettingsMatch;
export const createValidationRecord = async (...args: Parameters<typeof supabase.createValidationRecord>) => (await provider()).createValidationRecord(...args);
export const updateValidationRecord = async (...args: Parameters<typeof supabase.updateValidationRecord>) => (await provider()).updateValidationRecord(...args);
export const approveValidationRecord = async (...args: Parameters<typeof supabase.approveValidationRecord>) => (await provider()).approveValidationRecord(...args);
export const markValidationRecordExported = async (...args: Parameters<typeof supabase.markValidationRecordExported>) => (await provider()).markValidationRecordExported(...args);
export const getValidationRecordById = async (...args: Parameters<typeof supabase.getValidationRecordById>) => (await provider()).getValidationRecordById(...args);
export const listValidationRecords = async (...args: Parameters<typeof supabase.listValidationRecords>) => (await provider()).listValidationRecords(...args);
export const summarizeValidationRecords = supabase.summarizeValidationRecords;
export const getValidationRecordSummary = async (...args: Parameters<typeof supabase.getValidationRecordSummary>) => (await provider()).getValidationRecordSummary(...args);
export const getAuditTrail = async (...args: Parameters<typeof supabase.getAuditTrail>) => (await provider()).getAuditTrail(...args);
export const listInstrumentProfiles = async () => (await provider()).listInstrumentProfiles();
export const upsertInstrumentProfile = async (...args: Parameters<typeof supabase.upsertInstrumentProfile>) => (await provider()).upsertInstrumentProfile(...args);
export const listInstrumentChanges = async (...args: Parameters<typeof supabase.listInstrumentChanges>) => (await provider()).listInstrumentChanges(...args);
export const listValidationSettings = async () => (await provider()).listValidationSettings();
export const upsertValidationSettings = async (...args: Parameters<typeof supabase.upsertValidationSettings>) => (await provider()).upsertValidationSettings(...args);
export const isOfflineStorageMode = offlineMode;
