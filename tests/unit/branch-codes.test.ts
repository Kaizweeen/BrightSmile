import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { branchCodeSchema } from "@/server/branches";

// A branch lives at /{code}, so no code may be the name of one of the app's own top-level pages: every folder directly
// under src/app that is a fixed name (not a dynamic "[branch]" or a route group "(name)").
const appFolders = readdirSync(fileURLToPath(new URL("../../src/app", import.meta.url)), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("("))
  .map((entry) => entry.name);

describe("branch codes", () => {
  it("refuse every top-level folder of src/app, and all", () => {
    expect(appFolders.length).toBeGreaterThan(0);
    for (const name of [...appFolders, "all"]) expect(branchCodeSchema.safeParse(name).success, name).toBe(false);
  });
});
