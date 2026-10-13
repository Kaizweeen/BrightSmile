import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { patientFiles, patients, users } from "@/db/schema";
import { cleanFileName, FILE_CATEGORIES, MAX_FILE_BYTES, sniffType, type FileType } from "@/lib/files";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const detailsSchema = z.object({
  category: z.enum(FILE_CATEGORIES, "Pick what the file is"),
  description: z.string().trim().max(200, "Use at most 200 characters").default(""),
});

export type FileUpload = z.infer<typeof detailsSchema> & { name: string; contentType: FileType; bytes: Buffer };

const invalid = (field: string, message: string) => new ApiError(400, "invalid", message, { fields: { [field]: message } });

/** The upload form's fields, checked: the file must be one of the accepted types by its bytes, and at most 4 MB. */
export async function readUpload(form: FormData): Promise<FileUpload> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw invalid("file", "Choose a file");
  if (file.size > MAX_FILE_BYTES) throw invalid("file", "The file is over 4 MB. Scan or save it smaller and try again.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = sniffType(bytes);
  if (!contentType) throw invalid("file", "Upload a PDF, JPEG, PNG, or WebP file.");
  const details = detailsSchema.parse({ category: form.get("category") ?? undefined, description: form.get("description") ?? undefined });
  return { ...details, name: cleanFileName(file.name), contentType, bytes };
}

async function requirePatient(id: string): Promise<void> {
  const [row] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, id));
  if (!row) throw notFound("That patient");
}

/** A patient's files, newest first, without their bytes. */
export async function patientFileList(actor: Staff, patientId: string) {
  requireCan(actor, "clinical.read");
  await requirePatient(patientId);
  const rows = await db
    .select({
      id: patientFiles.id,
      name: patientFiles.name,
      contentType: patientFiles.contentType,
      size: patientFiles.size,
      category: patientFiles.category,
      description: patientFiles.description,
      createdAt: patientFiles.createdAt,
      uploadedBy: patientFiles.uploadedBy,
      uploaderName: users.name,
    })
    .from(patientFiles)
    .innerJoin(users, eq(users.id, patientFiles.uploadedBy))
    .where(eq(patientFiles.patientId, patientId))
    .orderBy(desc(patientFiles.createdAt));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: patientId, details: { part: "files" } });
  return rows;
}

/** Adds a file to the record. The audit row names the file's id and size, never its name, which may describe health. */
export async function addPatientFile(actor: Staff, patientId: string, upload: FileUpload): Promise<{ id: string }> {
  requireCan(actor, "files.add");
  await requirePatient(patientId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(patientFiles)
      .values({
        patientId,
        name: upload.name,
        contentType: upload.contentType,
        size: upload.bytes.length,
        category: upload.category,
        description: upload.description,
        data: upload.bytes,
        uploadedBy: actor.id,
      })
      .returning({ id: patientFiles.id });
    await audit(
      { userId: actor.id, action: "file.added", entity: "patient", entityId: patientId, details: { fileId: row.id, size: upload.bytes.length } },
      tx,
    );
    return row;
  });
}

/** One file with its bytes, to view or download. Every opening is logged as a view of the record. */
export async function readPatientFile(actor: Staff, fileId: string) {
  requireCan(actor, "clinical.read");
  const [file] = await db
    .select({ patientId: patientFiles.patientId, name: patientFiles.name, contentType: patientFiles.contentType, data: patientFiles.data })
    .from(patientFiles)
    .where(eq(patientFiles.id, fileId));
  if (!file) throw notFound("That file");
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: file.patientId, details: { part: "file", fileId } });
  return { ...file, contentType: file.contentType as FileType, data: Buffer.from(file.data) };
}

/** Removes a file for good: the uploader, the owner, or a manager. The audit row keeps that it existed. */
export async function removePatientFile(actor: Staff, fileId: string): Promise<void> {
  const [file] = await db
    .select({ patientId: patientFiles.patientId, uploadedBy: patientFiles.uploadedBy, size: patientFiles.size })
    .from(patientFiles)
    .where(eq(patientFiles.id, fileId));
  if (!file) throw notFound("That file");
  requireCan(actor, "files.remove", { userId: file.uploadedBy });
  await db.transaction(async (tx) => {
    await tx.delete(patientFiles).where(eq(patientFiles.id, fileId));
    await audit(
      { userId: actor.id, action: "file.removed", entity: "patient", entityId: file.patientId, details: { fileId, size: file.size } },
      tx,
    );
  });
}
