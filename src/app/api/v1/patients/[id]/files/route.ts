import { MAX_FILE_BYTES } from "@/lib/files";
import { json, staffRoute } from "@/server/api";
import { ApiError } from "@/server/errors";
import { addPatientFile, patientFileList, readUpload } from "@/server/patient-files";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientFileList(staff, id)));

/** A multipart form: file, category, and description. The body is refused unread when it is plainly too big. */
export const POST = staffRoute<{ id: string }>(
  async (req, staff, { id }) => {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) {
      throw new ApiError(413, "too_large", "The file is over 4 MB. Scan or save it smaller and try again.");
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "invalid", "The upload did not arrive whole. Try again.");
    }
    return json(await addPatientFile(staff, id, await readUpload(form)), 201);
  },
  { upload: true },
);
