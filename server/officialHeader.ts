import { ENV } from "./_core/env";

export const OFFICIAL_REPORT_HEADER_KEY = "yemen-qc-official-report-header_14217543.png";

export async function getOfficialReportHeaderUrl() {
  if (process.env.QC_STORAGE_MODE === "local") {
    return `/manus-storage/${OFFICIAL_REPORT_HEADER_KEY}`;
  }

  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    throw new Error("Storage proxy is not configured");
  }

  const forgeUrl = new URL("v1/storage/presign/get", `${ENV.forgeApiUrl.replace(/\/+$/, "")}/`);
  forgeUrl.searchParams.set("path", OFFICIAL_REPORT_HEADER_KEY);

  const response = await fetch(forgeUrl, {
    headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Unable to obtain official header asset (${response.status})`);
  }

  const { url } = (await response.json()) as { url?: string };
  if (!url) throw new Error("Official header asset URL is empty");
  return url;
}
