import { execFileSync } from "node:child_process";
import { packageRelease } from "./package.ts";
import { verifyRelease } from "./verify.ts";
execFileSync("pnpm", ["build"], { stdio: "inherit", env: { ...process.env, NONAME_TARGET: "pwa" } });
await packageRelease();
if (process.env.NONAME_PWA_VERIFY !== "0") await verifyRelease();
