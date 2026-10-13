/** Patient files: what the record accepts, shared by the upload form and the server. Mirrors the patient_files checks. */

export const FILE_CATEGORIES = ["xray", "photo", "consent", "id", "lab", "referral", "other"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  xray: "X-ray",
  photo: "Photo",
  consent: "Signed form or consent",
  id: "ID or HMO card",
  lab: "Lab result",
  referral: "Referral letter",
  other: "Other",
};

export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type FileType = (typeof FILE_TYPES)[number];

/** 4 MB: Vercel refuses a request body over 4.5 MB, and the form adds a little. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** For the file picker. The server still checks the bytes. */
export const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b);

/**
 * The file's real type, read from its first bytes, or null when it is none of the accepted ones. The name and the
 * browser's stated type are never trusted: a page saved as "xray.png" must not be served back as a page.
 */
export function sniffType(bytes: Uint8Array): FileType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  return null;
}

/** A file name fit to keep and to send back: no folders, no control characters, at most 120 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  if (clean.length <= 120) return clean || "file";
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, 120 - ext.length) + ext;
}

/** "820 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
