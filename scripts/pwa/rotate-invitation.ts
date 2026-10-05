/** Create/rotate a shared download invitation without printing it or committing it. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { releaseConfig as config } from "./release-config";
const args = process.argv.slice(2);
if (args.some(a => a !== "--rotate")) throw new Error("Use --rotate to replace the current invitation");
const repo = execFileSync("gh", ["api", `repos/${config.repository}`, "--jq", ".full_name"], { encoding: "utf8" }).trim();
if (repo !== config.repository) throw new Error("Unexpected invitation repository");
const directory = path.resolve("..");
const file = path.join(directory, "noname-pwa-invite.txt");
const owner = await fs.stat(directory);
let code: string | undefined;
try {
	const info = await fs.lstat(file);
	if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== owner.uid) throw new Error("Unexpected invitation file permissions");
	code = (await fs.readFile(file, "utf8")).trim();
	if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error("Unexpected invitation format");
} catch (error: any) {
	if (error.code !== "ENOENT") throw error;
}
if (!code || args.includes("--rotate")) {
	code = randomBytes(24).toString("base64url");
	const temporary = file + "." + randomBytes(8).toString("hex");
	await fs.writeFile(temporary, code + "\n", { mode: 0o600, flag: "wx" });
	await fs.chown(temporary, owner.uid, owner.gid);
	await fs.rename(temporary, file);
}
try {
	execFileSync("wrangler", ["secret", "put", "PWA_INVITE_CODE", "--config", "packages/pwa-host/wrangler.jsonc"], { input: code + "\n", stdio: ["pipe", "pipe", "pipe"] });
	execFileSync("gh", ["secret", "set", "PWA_INVITE_CODE", "--repo", config.repository, "--env", "pwa-production"], { input: code, stdio: ["pipe", "pipe", "pipe"] });
} catch {
	console.error(`Invitation configuration did not finish; the invitation is saved in ${file}. Fix authentication/permissions and rerun without --rotate.`);
	process.exit(1);
}
console.log(`Invitation configured for the dedicated PWA Worker and personal fork. Read ${file} through SSH to share with friends; no invitation value displayed.`);
