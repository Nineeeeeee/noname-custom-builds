import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (target !== "apk" && target !== "aab") {
	throw new Error("Usage: pnpm build:apk | pnpm build:aab");
}

const mobileDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = fileURLToPath(new URL("../../..", import.meta.url));
const androidDir = fileURLToPath(new URL("../android", import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(pnpm, ["build"], repoDir);
run(pnpm, ["sync"], mobileDir);

if (process.platform === "win32") {
	run("gradlew.bat", [target === "apk" ? "assembleRelease" : "bundleRelease"], androidDir);
} else {
	run("bash", ["./gradlew", target === "apk" ? "assembleRelease" : "bundleRelease"], androidDir);
}

const output = target === "apk"
	? "app/build/outputs/apk/release/app-release.apk"
	: "app/build/outputs/bundle/release/app-release.aab";
const outputPath = fileURLToPath(new URL(`../android/${output}`, import.meta.url));
if (!existsSync(outputPath)) throw new Error(`Build completed but output is missing: ${outputPath}`);

console.log(`\nCreated: ${outputPath}`);
