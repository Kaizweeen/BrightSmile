import { json, staffRoute } from "@/server/api";
import { readPatientFile, removePatientFile } from "@/server/patient-files";

/**
 * The file itself, shown in the browser, or saved with ?download=1. Its type was checked by its bytes on upload, and
 * the policy below lets it run nothing: an image may only be an image, and a PDF only the browser's own viewer.
 */
export const GET = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  const file = await readPatientFile(staff, id);
  const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": file.contentType === "application/pdf"
        ? "default-src 'none'; object-src 'self'; frame-ancestors 'none'"
        : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
    },
  });
});

export const DELETE = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await removePatientFile(staff, id);
  return json({ ok: true });
});
