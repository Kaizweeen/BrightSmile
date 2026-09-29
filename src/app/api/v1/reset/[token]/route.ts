import { json, publicRoute, readJson } from "@/server/api";
import { resetSchema, resetWithToken } from "@/server/staff";

export const POST = publicRoute<{ token: string }>(async (req, { token }) =>
  json(await resetWithToken(token, await readJson(req, resetSchema))),
);
