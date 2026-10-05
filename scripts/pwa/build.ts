import { execFileSync } from "node:child_process";
import { packageRelease } from "./package.ts";
import { verifyRelease } from "./verify.ts";
execFileSync("pnpm", ["build"], { stdio: "inherit", env: { ...process.env, NONAME_TARGET: "pwa" } });
await packageRelease();
await verifyRelease();
