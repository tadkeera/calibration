/**
 * Controlled attachments (§16.3 / §11): evidence files for executions and
 * documents for references. Stored in the database (works on Vercel, where the
 * filesystem is not persistent) with a server-computed SHA-256; append-only.
 * The size limit keeps uploads below the serverless request-body limit.
 */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const ATTACHMENT_ENTITY_TYPES = ["execution", "reference"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const ALLOWED_ATTACHMENT_TYPES: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

export const ATTACHMENT_ACCEPT = Object.values(ALLOWED_ATTACHMENT_TYPES).flat().join(",");

export function attachmentTypeProblem(fileName: string, mimeType: string): string | null {
  const allowed = ALLOWED_ATTACHMENT_TYPES[mimeType];
  if (!allowed) return `File type ${mimeType || "(unknown)"} is not allowed. Allowed: PDF, PNG, JPEG, WEBP, TXT, CSV, XLSX, DOCX`;
  const lower = fileName.toLowerCase();
  if (!allowed.some(ext => lower.endsWith(ext))) return `File extension does not match its type (${mimeType})`;
  return null;
}

/** MIME type from the extension (browsers sometimes report an empty type, e.g. for CSV on Windows). */
export function mimeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  return Object.entries(ALLOWED_ATTACHMENT_TYPES).find(([, exts]) => exts.some(e => lower.endsWith(e)))?.[0] ?? "";
}
