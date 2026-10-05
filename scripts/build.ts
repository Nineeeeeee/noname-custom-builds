import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
function runBuild(args: string[]) {
	const result = spawnSync("pnpm", args, { stdio: "inherit", shell: process.platform === "win32" });
	if (result.error || result.status !== 0) {
		throw result.error || new Error(`Build failed (${result.signal || result.status}): pnpm ${args.join(" ")}`);
	}
}
runBuild(["-F", "noname...", "build"]);
runBuild(["-F", "./packages/extension/**", "build"]);

console.log("合并打包结果");
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
await Promise.all([fs.cp("apps/core/dist", "dist", { recursive: true }), fs.cp("apps/core/audio", "dist/audio", { recursive: true }), fs.cp("apps/core/image", "dist/image", { recursive: true }), fs.cp("apps/core/extension", "dist/extension", { recursive: true }), fs.cp("docs", "dist/docs", { recursive: true }), fs.cp(".nomedia", "dist/.nomedia"), fs.cp("LICENSE", "dist/LICENSE"), fs.cp("README.md", "dist/README.md")]);
