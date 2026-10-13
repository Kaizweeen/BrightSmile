import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import * as fileRoute from "@/app/api/v1/files/[id]/route";
import * as filesRoute from "@/app/api/v1/patients/[id]/files/route";
import { db } from "@/db";
import { auditLog, patientFiles, patients } from "@/db/schema";
import { MAX_FILE_BYTES } from "@/lib/files";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

async function build() {
  const dt = await makeBranch();
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  return { ana, reyesId: reyes.id, reyes: await signIn(reyes.username), lim: await signIn(lim.username), desk: await signIn(desk.username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

/** A multipart upload as the browser sends it, from DentaSync's own origin unless told otherwise. */
function uploadRequest(id: string, cookie: string, fields: { file?: Blob; name?: string; category?: string; description?: string }, origin = "http://localhost:3700") {
  const form = new FormData();
  if (fields.file) form.set("file", fields.file, fields.name ?? "scan.png");
  if (fields.category !== undefined) form.set("category", fields.category);
  if (fields.description !== undefined) form.set("description", fields.description);
  return new NextRequest(new URL(`/api/v1/patients/${id}/files`, "http://localhost:3700"), { method: "POST", headers: { cookie, origin }, body: form });
}

const upload = (id: string, cookie: string, fields: Parameters<typeof uploadRequest>[2], origin?: string) =>
  call(filesRoute.POST, uploadRequest(id, cookie, fields, origin), { id });
const list = (id: string, cookie: string) => call(filesRoute.GET, request(`/api/v1/patients/${id}/files`, { cookie }), { id });
const open = (id: string, cookie: string, query = "") => call(fileRoute.GET, request(`/api/v1/files/${id}${query}`, { cookie }), { id });
const remove = (id: string, cookie: string) => call(fileRoute.DELETE, request(`/api/v1/files/${id}`, { method: "DELETE", cookie }), { id });

describe("patient files", () => {
  it("uploads a file, lists it without its bytes, and serves it back as uploaded", async () => {
    const w = await world();
    const res = await upload(w.ana.id, w.reyes, { file: new Blob([PNG]), name: "C:\\scans\\pa 16.png", category: "xray", description: "Before the root canal" });
    expect(res.status).toBe(201);
    const { id } = await res.json();

    const files = await (await list(w.ana.id, w.desk)).json();
    expect(files).toMatchObject([{ id, name: "pa 16.png", contentType: "image/png", size: PNG.length, category: "xray", description: "Before the root canal", uploaderName: "Dr. Reyes" }]);
    expect(files[0]).not.toHaveProperty("data");

    const file = await open(id, w.desk);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toMatch(/^inline; filename="pa 16.png"/);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    expect((await open(id, w.desk, "?download=1")).headers.get("content-disposition")).toMatch(/^attachment;/);

    const views = await db.select().from(auditLog).where(and(eq(auditLog.entityId, w.ana.id), eq(auditLog.action, "patient.view")));
    expect(views.map((v) => v.details.part)).toEqual(expect.arrayContaining(["files", "file"]));
    const [added] = await db.select().from(auditLog).where(eq(auditLog.action, "file.added"));
    expect(added.details).toEqual({ fileId: id, size: PNG.length });
  });

  it("keeps a PDF's real type whatever the file is called", async () => {
    const w = await world();
    const { id } = await (await upload(w.ana.id, w.desk, { file: new Blob([PDF], { type: "image/png" }), name: "consent.png", category: "consent" })).json();
    const file = await open(id, w.desk);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-security-policy")).not.toContain("sandbox");
  });

  it("refuses files that are not a PDF or image, are missing or too big, and uploads without a category", async () => {
    const w = await world();
    const page = await upload(w.ana.id, w.desk, { file: new Blob(["<html><script>alert(1)</script>"]), name: "xray.png", category: "xray" });
    expect(page.status).toBe(400);
    expect((await page.json()).error.fields).toEqual({ file: "Upload a PDF, JPEG, PNG, or WebP file." });
    expect((await upload(w.ana.id, w.desk, { category: "xray" })).status).toBe(400);
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PNG);
    const tooBig = await upload(w.ana.id, w.desk, { file: new Blob([big]), category: "xray" });
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error.fields.file).toMatch(/over 4 MB/);
    const nameless = await upload(w.ana.id, w.desk, { file: new Blob([PNG]) });
    expect(nameless.status).toBe(400);
    expect((await nameless.json()).error.fields).toHaveProperty("category");
  });

  it("refuses uploads from other sites, and for patients who do not exist", async () => {
    const w = await world();
    expect((await upload(w.ana.id, w.desk, { file: new Blob([PNG]), category: "xray" }, "https://evil.example")).status).toBe(403);
    expect((await upload(crypto.randomUUID(), w.desk, { file: new Blob([PNG]), category: "xray" })).status).toBe(404);
    // JSON-only routes still refuse a multipart form.
    const form = new NextRequest(new URL("/api/v1/files/x", "http://localhost:3700"), { method: "DELETE", headers: { cookie: w.desk, origin: "http://localhost:3700" }, body: new FormData() });
    expect((await call(fileRoute.DELETE, form, { id: "x" })).status).toBe(415);
  });

  it("lets the uploader or a manager remove a file, but not another dentist", async () => {
    const w = await world();
    const { id } = await (await upload(w.ana.id, w.reyes, { file: new Blob([PNG]), category: "photo" })).json();
    expect((await remove(id, w.lim)).status).toBe(403);
    expect((await remove(id, w.reyes)).status).toBe(200);
    expect(await db.select({ id: patientFiles.id }).from(patientFiles).where(eq(patientFiles.id, id))).toEqual([]);
    expect((await open(id, w.desk)).status).toBe(404);

    const other = await (await upload(w.ana.id, w.reyes, { file: new Blob([PNG]), category: "photo" })).json();
    expect((await remove(other.id, w.desk)).status).toBe(200);
    const removed = await db.select().from(auditLog).where(eq(auditLog.action, "file.removed"));
    expect(removed.map((r) => r.details.fileId)).toEqual(expect.arrayContaining([id, other.id]));
  });
});
