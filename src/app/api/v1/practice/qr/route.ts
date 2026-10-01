import { json, readJson, staffRoute } from "@/server/api";
import { qrSchema, setQr } from "@/server/billing";

export const PUT = staffRoute(async (req, staff) => {
  await setQr(staff, (await readJson(req, qrSchema)).image);
  return json({ ok: true });
});
