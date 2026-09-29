import { clientIp, json, publicRoute, readJson } from "@/server/api";
import { joinSchema, requestToJoin } from "@/server/staff";

export const POST = publicRoute<{ code: string }>(async (req, { code }) =>
  json(await requestToJoin(code, await readJson(req, joinSchema), clientIp(req)), 201),
);
