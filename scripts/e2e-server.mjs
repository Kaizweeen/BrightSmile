// The end-to-end server (playwright.config.ts): a fresh PGlite folder, then `next dev` on the given port.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

rmSync(".data/e2e", { recursive: true, force: true });
const server = spawn(`npx next dev -p ${process.env.PORT}`, { stdio: "inherit", shell: true });
server.on("exit", (code) => process.exit(code ?? 0));
