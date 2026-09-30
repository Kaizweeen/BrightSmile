import { json, readJson, staffRoute } from "@/server/api";
import { voidBill, voidSchema } from "@/server/billing";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await voidBill(staff, id, await readJson(req, voidSchema));
  return json({ ok: true });
});
